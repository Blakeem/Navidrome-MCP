# Local Playback Spec — mpv-driven Audio Output

## Goal

Let the AI queue and play songs/albums directly through the speakers of the machine running the MCP server, with no browser or external Navidrome client required. Cross-platform: Linux and Windows 11.

Use case driver: "Queue 5 random favorite albums" should be one tool call. Long-term: voice-controlled music device on a Raspberry Pi or similar.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Playback engine | **mpv** controlled via JSON-IPC | One binary on every platform, gapless playback, observable property stream, ~50 lines of Node to talk to it |
| Decoding | Original file by default (`playback.transcodeFormat: raw`). Navidrome transcodes server-side only when that key names a codec. | The original file gives the best quality and reliable seeking. A codec helps on slow or metered links. |
| Queue source of truth | **mpv's playlist** (in-memory only) | No SQLite, no Navidrome-queue mirror, no persistence across MCP restarts |
| Navidrome `/api/queue` sync | **Not implemented** | Bidirectional sync is a bug factory; revisit if real demand emerges |
| Engine startup | **Lazy** — mpv spawns on first playback tool call | No cost when feature is unused |
| mpv lifecycle | **Quit when the last MCP exits, by default** | The web player counts its spawning MCP plus one kept-open `POST /api/mcp-lease` per other MCP, and quits mpv when the last one closes. It keeps mpv alive across an MCP exit when `webui.persistAfterMcpExit` is on or when it was launched standalone. A new MCP server then attaches over the stable per-uid IPC path |
| Volume control | **mpv internal volume only** (0–100), exposed as a tool | System mixer is OS-specific; mpv's own volume is sufficient |
| Failure mode | **Fail fast, surface to AI** | Not fault-tolerant; resilience can be added once the happy path is proven |
| Scrobbling | Subsonic `/scrobble` from `ScrobbleTracker` (`src/services/playback/scrobble-tracker.ts`), driven by playback-engine state changes | Now-playing on track start. One submission per play after half the duration or 240 s, whichever comes first. Tracks under 30 s never submit. Every process attached to mpv tracks plays. At the threshold, a process that counted the play broadcasts a claim with mpv `script-message`, and the first claim mpv delivers submits. |

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  MCP server process (Node)                                       │
│                                                                  │
│  src/tools/handlers/playback-handlers.ts                         │
│       │  thin shims, no business logic                           │
│       ▼                                                          │
│  src/services/playback/playback-engine.ts                        │
│       ├── lazy-spawns mpv on first call                          │
│       ├── owns observed-property cache (now-playing snapshot)    │
│       ├── exposes: enqueue / pause / next / getQueue / etc.      │
│       └── emits internal events (scrobbler hookup point)         │
│       │                                                          │
│       ├──► src/services/playback/mpv-process.ts                  │
│       │    spawn / detect mpv binary, platform-aware IPC path    │
│       │                                                          │
│       └──► src/services/playback/mpv-ipc.ts                      │
│            net.createConnection → JSON framing → request/event   │
│                                                                  │
└────────────────┬─────────────────────────────────────────────────┘
                 │ IPC: Unix socket on Linux/macOS,
                 │      named pipe on Windows
                 ▼
            ┌─────────┐         HTTP GET /rest/stream         ┌─────────────┐
            │   mpv   │ ───────────────────────────────────►  │  Navidrome  │
            │ (audio) │ ◄──────────  audio bytes  ──────────  │   (server)  │
            └─────────┘                                       └─────────────┘
```

## File Layout

```
src/services/playback/
├── mpv-process.ts        # spawn, binary detection, stable IPC path
├── mpv-ipc.ts            # JSON-IPC client (net socket + line framing, request_id correlation)
├── playback-engine.ts    # high-level facade; the only thing handlers use
├── visualizer-filter.ts  # the visualizer's mpv audio filter, its validation run and install rule
└── visualizer-log.ts     # groups the filter's log lines into level records

src/tools/
├── playback.ts           # tool function impls (mirror existing pattern)
└── handlers/
    └── playback-handlers.ts  # ToolCategory factory, registered conditionally
```

Mirrors how Last.fm and lyrics features are organized.

## Configuration

### Detection

At startup the engine uses `playback.mpvPath` from settings.json when it is set and executable, otherwise a PATH lookup (`command -v mpv` / `where mpv`). If no binary is found, `config.features.playback === false` and no playback tools are registered. Result: install mpv → restart MCP → tools appear.

### Settings

| Setting | Default | Purpose |
|---|---|---|
| `playback.mpvPath` | `null` (auto-detect) | Binary location |
| `playback.transcodeFormat` | `raw` | Stream format requested from Navidrome. `raw` streams the original file. |
| `playback.transcodeBitrate` | `192` | Max kbps, applied only when a codec is set |

`MPV_PATH`, `PLAYBACK_TRANSCODE_FORMAT` and `PLAYBACK_TRANSCODE_BITRATE` are read only by the env fallback when no usable store exists, and to pre-fill the first-run settings form.

## mpv Process Flags

```
mpv \
  --idle=yes                   # don't exit when playlist is empty
  --no-video                   # audio only
  --no-terminal                # no TTY interaction
  --no-config                  # ignore user config that could break us
  --load-scripts=no            # no user scripts
  --gapless-audio=weak         # docs-recommended for HTTP streams (more tolerant than 'yes')
  --prefetch-playlist=yes      # pre-buffer next track to minimize HTTP gap
  --cache=yes                  # prebuffer HTTP streams against network jitter
  --cache-secs=30
  --demuxer-readahead-secs=20
  --input-ipc-server=<PATH>    # the IPC endpoint
  --volume=80                  # initial; tools can change it
  --audio-display=no           # don't display cover art
  --ytdl=no                    # disable yt-dlp wrapper (security + reliability)
  --vo=null                    # belt + suspenders for headless
```

stdout/stderr from mpv are line-forwarded to `logger.debug()` so they never pollute the MCP stdio channel.

### IPC path

Per-uid (POSIX) / per-username (Windows), **not** per-PID. This lets a new MCP server attach to an mpv that a persisting web player kept alive, and lets several MCP servers share one mpv.

- Linux/macOS: `$XDG_RUNTIME_DIR/navidrome-mcp-mpv-<uid>.sock` when `XDG_RUNTIME_DIR` is set, otherwise `/tmp/navidrome-mcp-mpv-<uid>.sock`
- Windows: `\\.\pipe\navidrome-mcp-mpv-<USERNAME>`

Multiple MCP servers for the same user share the same mpv (otherwise simultaneous AIs would fight over audio output).

## IPC Protocol (mpv side, what we use)

mpv's IPC is newline-delimited JSON, bidirectional. Every command gets a response with the same `request_id`. Property changes and lifecycle events arrive unsolicited as `event` messages.

**Commands we send:**
```jsonc
{ "command": ["loadfile", "<url>", "replace"], "request_id": 1 }
{ "command": ["loadfile", "<url>", "append"], "request_id": 2 }
{ "command": ["playlist-clear"], "request_id": 3 }
{ "command": ["playlist-next", "force"], "request_id": 4 }
{ "command": ["playlist-prev"], "request_id": 5 }
{ "command": ["playlist-remove", 2], "request_id": 6 }
{ "command": ["playlist-move", 0, 3], "request_id": 7 }
{ "command": ["playlist-shuffle"], "request_id": 8 }
{ "command": ["set_property", "pause", true], "request_id": 9 }
{ "command": ["set_property", "volume", 75], "request_id": 10 }
{ "command": ["seek", 30, "absolute"], "request_id": 11 }
{ "command": ["stop"], "request_id": 12 }
{ "command": ["get_property", "playlist"], "request_id": 13 }
{ "command": ["observe_property", 1, "playlist-pos"], "request_id": 14 }
```

**Events we observe** (via `observe_property` + `event`):
- `playlist-pos` — current track index
- `playlist-count` — number of entries
- `pause` — paused?
- `time-pos` — playback position
- `duration` — current track length
- `media-title` / `metadata` — display info
- `idle-active` — queue exhausted
- `volume` — current volume
- `eof-reached` — end of file
- Lifecycle events: `start-file`, `end-file`, `playback-restart` (logged; not yet acted on)

The IPC client maintains a property cache so `now_playing` reads the cache first. It falls back to a `getQueue` IPC and Navidrome lookups for radio naming, duration repair and metadata repair, and a per-file cache skips the repeat on later polls. The full `playlist` property is fetched on-demand by `get_play_queue` rather than observed (would be noisy during loadfile loops).

## Tool Surface

### Naming domains (three-way separation)

The codebase has three distinct queue-like concepts. Their tool names are kept unambiguously separate so the AI never has to guess which one a call refers to.

| Domain | What it is | Tool naming | Examples |
|---|---|---|---|
| **Saved playlists** | Named, persistent track lists in Navidrome's database (web UI's "Playlists" page). Cross-session. | `*_playlist` | `create_playlist`, `add_tracks_to_playlist`, `reorder_playlist_track` |
| **Saved queue** | Navidrome's per-user "what was I last playing" advisory state. Used for cross-device resume. | `*_saved_queue` | `get_saved_queue`, `save_queue`, `clear_saved_queue` |
| **Live play queue** | mpv's in-memory playlist — the literal sequence of stream URLs being decoded right now. Lost on mpv shutdown. | `*_play_queue` (queue-level ops) or verb-only (`play_*`, `pause`, `next`, etc.) | `play_songs`, `play_albums`, `clear_play_queue`, `get_play_queue` |

The `play_` verb prefix consistently means "affect what's audibly coming out of the speakers right now." The `_play_queue` noun suffix means "operate on the live mpv playlist as a whole."

### Implemented tools (19 playback + 1 radio)

#### Playback start

| Tool | Args | Effect |
|---|---|---|
| `play_songs` | `{ songIds: string[], mode?: 'replace' \| 'append', shuffle?: boolean }` (defaults `'replace'`, `false`) | Play one or many songs. `replace` clears the play queue and unpauses; `append` adds to the end without clearing or unpausing. When no track is current (the queue is empty, finished, or mpv just started), `append` loads the first new track paused. `shuffle: true` Fisher-Yates the new batch only. |
| `play_albums` | `{ albumIds: string[], mode?: 'replace' \| 'append', shuffleAlbums?: boolean, shuffleSongs?: boolean }` (defaults `'replace'`, `false`, `false`) | Play one or many albums. With neither flag, albums play in input order with natural track order. `shuffleAlbums` randomizes the album order, and each album keeps its track order. `shuffleSongs` alone shuffles every track across all albums. Both together shuffle the album order and the tracks within each album. Empty albums silently skipped; all-empty throws. |
| `play_playlist` | `{ playlistId: string, mode?: 'replace' \| 'append', shuffle?: boolean }` | Load a saved playlist's tracks into the play queue. |

#### Search-driven playback

| Tool | Args | Effect |
|---|---|---|
| `play_albums_search` | All `search_albums` args (`query`, `limit`, `offset`, `genre`, `mediaType`, `country`, `releaseType`, `recordLabel`, `mood`, `sort`, `order`, `randomSeed`, `year`, `starred`) PLUS `mode?: 'replace' \| 'append'` (default `'replace'`) plus `shuffleAlbums?: boolean` and `shuffleSongs?: boolean` (both default `false`) | Run `search_albums` with the given filters → resolve each matching album's tracks → apply shuffle → enqueue. Empty search result throws `"No albums matched the search filters"`. Empty albums silently skipped; if every match resolves to zero tracks, throws `"No tracks found across all albums"`. Headline use case: `{ starred: true, sort: 'random', limit: 5 }` plays 5 random starred albums. Returns `{ success, matchCount, albumCount, trackCount, appliedFilters?, demoted? }`. |
| `play_songs_search` | All `search_songs` args (same filter set as above; `sort` enum is `'title' \| 'artist' \| 'album' \| 'year' \| 'duration' \| 'playCount' \| 'rating' \| 'recently_added' \| 'starred_at' \| 'random'`) PLUS `mode?: 'replace' \| 'append'` (default `'replace'`) and `shuffle?: boolean` (default `false`) | Run `search_songs` with the given filters → optionally Fisher-Yates the matched IDs → enqueue. Empty search result throws `"No songs matched the search filters"`. Headline use case: `{ starred: true, limit: 500 }` plays every starred song. Returns `{ success, count, appliedFilters?, demoted? }`. |

#### Transport / control

| Tool | Args | Effect |
|---|---|---|
| `pause` / `resume` | — | Pause or resume playback. Attach-only, so they return `{ success: false, message }` when no mpv runs. |
| `next` / `previous` | — | `next` sends `playlist-next force`, which stops playback on the last entry, and the result then carries `stopped: true`. `previous` sends `playlist-prev`, and on the first entry it restarts the current track. |
| `seek` | `{ seconds, mode: 'absolute' \| 'relative' }` (default `'relative'`) | Move within the current track. An absolute target must be 0 or more, since mpv reads a negative one as an offset from the end. A target past the end skips to the next track. |
| `set_volume` | `{ level }` (any finite number) | mpv internal volume. The engine clamps the level to 0-100. |

#### Queue management

| Tool | Args | Effect |
|---|---|---|
| `get_play_queue` | `{ limit?: number, offset?: number }` (defaults `100`, `0`, `limit` max 500) | Returns one page as `items: [{ index, songId, isCurrent, isPlaying, title?, artist?, album?, duration? }, ...]` plus `offset`, `limit`, `length` (the full queue count) and `currentIndex` (absolute). Returns empty `items` and `length: 0` when mpv isn't running. Read-only; does not spawn mpv. |
| `clear_play_queue` | — | mpv `stop` (clears playlist + halts playback). Idempotent on idle queue. |
| `shuffle_play_queue` | — | mpv `playlist-shuffle`, then `playlist-move` of the current track to index 0. The current track keeps playing at the top. Pause state preserved. |
| `move_in_play_queue` | `{ from: number, to: number }` | mpv `playlist-move`. The entry ends at index `to`, so a forward move passes `to + 1` to mpv. The play head stays on the same track. Short-circuits with `{ success: true, noop: true }` when `from === to`. A `to` past the last index is rejected. |
| `remove_from_play_queue` | `{ index: number }` | mpv `playlist-remove`. Removes one entry; mpv auto-advances if the removed entry was currently playing. |
| `play_queue_index` | `{ index: number }` | Jump to the queue entry at `index`. Does not reorder. |

#### Read state

| Tool | Returns |
|---|---|
| `now_playing` | `{ engineRunning, songId?, title?, artist?, album?, position?, duration?, paused?, queueIndex?, queueLength?, isRadio?, radioStation? }` (cache first, see above. Does NOT spawn mpv). `paused` is omitted when no entry is current, and `duration` is omitted for radio. |
| `playback_status` | `{ engineRunning, mpvPath, mpvVersion, volume, idle }` (does NOT spawn mpv) |

`now_playing` returns real-time playback state (current title, position, paused). It is **distinct from** `get_play_queue`: "now playing" answers *"what's happening right this second?"*; `get_play_queue` answers *"what's the full ordered list of tracks that are queued up?"*. Same underlying mpv playlist, different granularities and very different payload sizes. When a radio stream is loaded, `now_playing` adds `isRadio: true` and `radioStation: { name }`.

#### Radio playback (lives in the radio category, plays through mpv)

| Tool | Args | Effect |
|---|---|---|
| `play_radio_station` | `{ stationId: string }` | Play a saved Navidrome radio station through the local mpv player. Always replaces the entire play queue with the single radio stream (radio is mutually exclusive with songs/albums — see below). |

##### Radio / songs mutual exclusion

A radio stream is infinite; songs and albums are finite. Mixing them in one mpv playlist breaks queue semantics (skip/next, queue position, scrobbling thresholds). Per Navidrome's web UI convention, the engine enforces strict separation:

- `play_radio_station` always **replaces** whatever is in the queue (even other songs).
- `play_songs` / `play_albums` / `play_albums_search` / `play_songs_search` with `mode: 'replace'` work normally — the radio is replaced.
- `play_songs` / `play_albums` / `play_albums_search` / `play_songs_search` with `mode: 'append'` **demote to `'replace'`** when the queue currently contains a radio stream. Appending songs to a radio queue would create `[radio, song1, song2, ...]` which is nonsensical.

The recognition primitive is the queue entry's `songId` field: when a stream URL doesn't carry a Navidrome `?id=...` query parameter (i.e., it's an arbitrary URL like a SomaFM Icecast stream), `parseSongIdFromStreamUrl` returns `null` and the entry is treated as a radio stream. `playbackEngine.hasRadioStream()` exposes this check; `enqueue` calls it to decide whether to demote append → replace.

`radioStation.name` is the saved station whose stream URL matches mpv's `path` or `playlist-path`, or "Unknown station" when none matches. Saved stations can share a stream URL, so `play_radio_station` writes the station ID to mpv's `user-data/navidrome-mcp/radio-station-id` before the load, and that station wins among the matches. Any process attached to mpv resolves it the same way. An mpv older than 0.36 has no `user-data`, and the first matching station wins.

#### Why search-driven tools are separate from `play_albums` / `play_songs`

`play_albums` and `play_songs` accept explicit ID lists — they are the right
choice when the AI already has the targets in hand (e.g., it just called
`list_starred_items` and wants to play those exact albums, or the user
referenced specific items by name and the IDs were resolved upstream).

`play_albums_search` and `play_songs_search` accept the full search filter
vocabulary instead — they are the right choice for filter-driven ad-hoc
selection where the AI does not need to surface or reason about the
intermediate ID list (e.g., "play 5 random starred albums," "play all
Pink Floyd albums shuffled," "play every jazz song from the 70s").

The two pairs are composable: `list_starred_items` → `play_albums` is the
"display the list to the user first, then play" path; `play_albums_search`
is the equivalent one-shot path when no intermediate display is needed.
Folding both shapes into one tool would force the schema to accept either
`albumIds` xor every search filter, which is confusing for the AI to plan
against. Two crisp contracts beat one ambiguous one.

## Error Model

Fail fast. Every error surfaces a structured message via `ErrorFormatter`:

| Condition | Behavior |
|---|---|
| mpv not on PATH | Feature is gated off at startup; tools don't appear in `tools/list` |
| mpv exits unexpectedly | Tool call returns error; engine clears IPC state; next call re-attaches or spawns |
| IPC socket disconnects | Engine clears state; next call attempts re-attach |
| Navidrome stream URL 4xx/5xx | mpv emits `end-file` with reason `error`, the engine logs it at debug, and mpv moves to the next entry. No tool result or `now_playing` field reports it. |
| Out-of-range index for `move_in_play_queue` / `remove_from_play_queue` / `play_queue_index` | `move_in_play_queue` rejects a `to` past the last index, and `play_queue_index` rejects an index past the end, each with a bound message, since mpv accepts both without an error. An out-of-range `from` or `remove_from_play_queue` index fails with a message that names the index and points to `get_play_queue`. |

No retry loops, no auto-recovery beyond re-attach.

## Visualizer Filter

The web remote's visualizer reads band levels that mpv measures, since the browser receives no audio.

- **Filter.** `@navidrome-viz` is a `lavfi` graph. Its main path is `asplit` then `anull`, so the audio passes through unchanged in any channel layout. Its side path resamples a mono copy to 44.1 kHz, splits it into 16 log-spaced `bandpass` bands from 40 Hz to 16 kHz, measures each with `astats` every 1024 samples, prints the result with `ametadata=mode=print`, and ends in `anullsink`. It costs about 2.5% of one core while audio plays.
- **Validation.** mpv accepts a broken graph while idle, then fails every track. So the engine first runs the configured binary headless on 0.2 s of generated silence with the filter, and installs only when that run exits 0. It also reads `mpv --version` and installs only into a running mpv that reports the same mpv and FFmpeg versions, since an mpv started from another binary may lack what the graph needs. A rejection is cached per binary for the process lifetime. A run that timed out or failed to start runs again after 60 s.
- **Install timing.** A filter change during a track dropped about 40 ms of audio when measured, and a change at a gapless track start showed no measurable gap. Every engine adds the filter to an mpv it spawns, before the first load. It waits at most 1 s for the check, and a slower check leaves the first track without the filter. After spawn only the web player's engine changes the filter. It acts on attach when mpv is idle or paused, and otherwise at the next `start-file`, pause or idle. A `start-file` sync that waited in line past mpv's `playback-restart` counts as mid-track. The web player checks again at every `start-file`, since mpv disables a filter whose graph fails for one track and keeps playing.
- **Setting.** `webui.visualizer` (default `true`) decides whether the filter belongs in mpv. An MCP process reads the saved value when it spawns mpv, so the first track follows a toggle saved after that process started. The web player reads its live flag, which the snapshot and the settings dialog also report. In env-only mode an MCP process can read a different value than the web player's session toggle, which is why only the web player changes the filter after spawn. The snapshot hides the visualizer while the filter cannot run on the current mpv. With `webui.enabled` false no process installs it.
- **Level feed.** The web player opens a second IPC connection while a remote shows the visualizer and sends `request_log_messages v`. mpv forwards FFmpeg's info lines at level `v` as `Parsed_ametadata_N: frame:… pts_time:T` followed by one `lavfi.astats.K.RMS_level=V` line per band. The connection is separate because mpv finishes each write to a client before the next, so a slow log reader would stall commands on its connection.
- **Delivery.** `GET /api/visualizer` streams `levels` events every 100 ms as `[segment, ptsMs, ...levelsDb]` rows. Measurements arrive about 0.28 s before the sound. A segment changes when timestamps restart, which marks a new file, and the browser matches `pts` to its playback clock.
- **Limits.** mpv's IPC docs warn that log text can change between releases. A changed format leaves the visualizer at rest without affecting audio. At a gapless change the new file's first levels show during the old file's last 0.28 s.

## Out of Scope

- SQLite / queue persistence across MCP restart. mpv itself outlives an MCP exit only through a persisting web player.
- Shared mpv lifetime with `webui.enabled` false. No web player holds the MCP leases, so an exiting MCP that played music quits mpv even while another MCP plays through it.
- Navidrome `/api/queue` bidirectional sync
- Crossfade / replay gain
- Multiple simultaneous playback engines
- Remote/network playback (Chromecast, AirPlay, MPRIS)
- System volume mixer
- Auto-recovery from mpv crashes beyond the re-attach pattern

Each is a future iteration if real demand emerges.

## Future Hooks (kept in mind, not built)

1. **Voice / Pi.** The engine has no MCP-specific assumptions; it could be reused by a different transport.
2. **Persistence.** If we later want survive-restart for the queue contents (not just the mpv process), snapshot the playlist + position to disk on every change and restore on spawn.

## Quality Gates

All existing project rules apply: `pnpm check:all` zero issues, dead-code clean, `ErrorFormatter` for messages, `logger` (never `console.log`), shared schemas, lazy initialization following existing conditional-feature pattern.

## Tests

The playback tests live in `tests/unit/services/playback/` and `tests/integration/playback/`. `tests/CLAUDE.md` describes how each suite runs.
