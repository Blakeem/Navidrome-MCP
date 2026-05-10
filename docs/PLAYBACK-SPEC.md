# Local Playback Spec — mpv-driven Audio Output

## Goal

Let the AI queue and play songs/albums directly through the speakers of the machine running the MCP server, with no browser or external Navidrome client required. Cross-platform: Linux and Windows 11.

Use case driver: "Queue 5 random favorite albums" should be one tool call. Long-term: voice-controlled music device on a Raspberry Pi or similar.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Playback engine | **mpv** controlled via JSON-IPC | One binary on every platform, gapless playback, observable property stream, ~50 lines of Node to talk to it |
| Decoding | Server-side via Navidrome `?format=mp3` | Navidrome+FFmpeg handle every source codec; mpv just opens an HTTP URL |
| Queue source of truth | **mpv's playlist** (in-memory only) | No SQLite, no Navidrome-queue mirror, no persistence across MCP restarts |
| Navidrome `/api/queue` sync | **Not implemented** | Bidirectional sync is a bug factory; revisit if real demand emerges |
| Engine startup | **Lazy** — mpv spawns on first playback tool call | No cost when feature is unused |
| mpv lifecycle | **Survives MCP restart** via stable per-uid IPC path; new MCP servers attach to existing mpv | A `/mcp` reconnect doesn't kill audio |
| Volume control | **mpv internal volume only** (0–100), exposed as a tool | System mixer is OS-specific; mpv's own volume is sufficient |
| Failure mode | **Fail fast, surface to AI** | Not fault-tolerant; resilience can be added once the happy path is proven |
| Scrobbling | Subsonic `/scrobble` driven by mpv `start-file` / `end-file` events | Not yet wired up — see "Open work" below |

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
│       ├── exposes: enqueue / pause / next / getPlaylist / etc.   │
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
            │ (audio) │ ◄──────  transcoded MP3 bytes ──────  │   (server)  │
            └─────────┘                                       └─────────────┘
```

## File Layout

```
src/services/playback/
├── mpv-process.ts        # spawn, binary detection, stable IPC path, line logging
├── mpv-ipc.ts            # JSON-IPC client (net socket + line framing, request_id correlation)
└── playback-engine.ts    # high-level facade; the only thing handlers use

src/tools/
├── playback.ts           # tool function impls (mirror existing pattern)
└── handlers/
    └── playback-handlers.ts  # ToolCategory factory, registered conditionally
```

Mirrors how Last.fm and lyrics features are organized.

## Configuration

### Detection (no env var needed)

At MCP startup the engine resolves an mpv binary via `MPV_PATH` env override or `command -v mpv` / `where mpv`. If no binary is found, `config.features.playback === false` and no playback tools are registered. Result: install mpv → restart MCP → tools appear.

### Env vars

| Var | Default | Purpose |
|---|---|---|
| `MPV_PATH` | resolved on PATH | Override binary location (Windows users with non-standard installs) |
| `PLAYBACK_TRANSCODE_FORMAT` | `mp3` | Stream format requested from Navidrome |
| `PLAYBACK_TRANSCODE_BITRATE` | `192` | Max bitrate kbps |

All optional. Sensible defaults work out of the box.

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
  --input-ipc-server=<PATH>    # the IPC endpoint
  --volume=80                  # initial; tools can change it
  --audio-display=no           # don't display cover art
  --ytdl=no                    # disable yt-dlp wrapper (security + reliability)
  --vo=null                    # belt + suspenders for headless
  --msg-level=all=info         # log verbosity (Node logger filters from there)
```

stdout/stderr from mpv are line-forwarded to `logger.debug()` so they never pollute the MCP stdio channel.

### IPC path

Per-uid (POSIX) / per-username (Windows), **not** per-PID. This lets a fresh MCP server attach to a running mpv after restart instead of spawning a new instance — so `/mcp` reconnects don't interrupt audio.

- Linux/macOS: `/tmp/navidrome-mcp-mpv-<uid>.sock`
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
{ "command": ["playlist-prev", "force"], "request_id": 5 }
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

The IPC client maintains a property cache so `now_playing` is a synchronous local read. The full `playlist` property is fetched on-demand by `get_play_queue` rather than observed (would be noisy during loadfile loops).

## Tool Surface

### Naming domains (three-way separation)

The codebase has three distinct queue-like concepts. Their tool names are kept unambiguously separate so the AI never has to guess which one a call refers to.

| Domain | What it is | Tool naming | Examples |
|---|---|---|---|
| **Saved playlists** | Named, persistent track lists in Navidrome's database (web UI's "Playlists" page). Cross-session. | `*_playlist` | `create_playlist`, `add_tracks_to_playlist`, `reorder_playlist_track` |
| **Saved queue** | Navidrome's per-user "what was I last playing" advisory state. Used for cross-device resume. | `*_saved_queue` | `get_saved_queue`, `save_queue`, `clear_saved_queue` |
| **Live play queue** | mpv's in-memory playlist — the literal sequence of stream URLs being decoded right now. Lost on mpv shutdown. | `*_play_queue` (queue-level ops) or verb-only (`play_*`, `pause`, `next`, etc.) | `play_songs`, `play_albums`, `clear_play_queue`, `get_play_queue` |

The `play_` verb prefix consistently means "affect what's audibly coming out of the speakers right now." The `_play_queue` noun suffix means "operate on the live mpv playlist as a whole."

### Implemented tools (17)

#### Playback start

| Tool | Args | Effect |
|---|---|---|
| `play_songs` | `{ songIds: string[], mode?: 'replace' \| 'append', shuffle?: boolean }` (defaults `'replace'`, `false`) | Play one or many songs. `replace` clears the play queue and unpauses; `append` adds to the end without clearing or unpausing. `shuffle: true` Fisher-Yates the new batch only. |
| `play_albums` | `{ albumIds: string[], mode?: 'replace' \| 'append', shuffle?: 'none' \| 'albums' \| 'songs' }` (defaults `'replace'`, `'none'`) | Play one or many albums. Shuffle modes: `none` = input album order + natural track order; `albums` = random album order, natural track order within each; `songs` = fully randomize all tracks across all albums. Empty albums silently skipped; all-empty throws. |

#### Search-driven playback

| Tool | Args | Effect |
|---|---|---|
| `play_albums_search` | All `search_albums` args (`query`, `limit`, `offset`, `genre`, `mediaType`, `country`, `releaseType`, `recordLabel`, `mood`, `sort`, `order`, `randomSeed`, `yearFrom`, `yearTo`, `starred`) PLUS `mode?: 'replace' \| 'append'` (default `'replace'`) and `shuffle?: 'none' \| 'albums' \| 'songs'` (default `'none'`) | Run `search_albums` with the given filters → resolve each matching album's tracks → apply shuffle → enqueue. Empty search result throws `"No albums matched the search filters"`. Empty albums silently skipped; if every match resolves to zero tracks, throws `"Found albums but none had any tracks"`. Headline use case: `{ starred: true, sort: 'random', limit: 5 }` plays 5 random starred albums. Returns `{ matchCount, albumCount, trackCount, mode, shuffle, appliedFilters? }`. |
| `play_songs_search` | All `search_songs` args (same filter set as above; `sort` enum is `'title' \| 'artist' \| 'album' \| 'year' \| 'duration' \| 'playCount' \| 'rating' \| 'recently_added' \| 'starred_at' \| 'random'`) PLUS `mode?: 'replace' \| 'append'` (default `'replace'`) and `shuffle?: boolean` (default `false`) | Run `search_songs` with the given filters → optionally Fisher-Yates the matched IDs → enqueue. Empty search result throws `"No songs matched the search filters"`. Headline use case: `{ starred: true, limit: 500 }` plays every starred song. Returns `{ count, mode, shuffled, appliedFilters? }`. |

#### Transport / control

| Tool | Args | Effect |
|---|---|---|
| `pause` / `resume` | — | Toggle playback (lazy-spawns mpv on first call) |
| `next` / `previous` | — | Skip (uses mpv `force` flag so it advances even at playlist end) |
| `seek` | `{ seconds, mode: 'absolute' \| 'relative' }` (default `'relative'`) | Move within the current track |
| `set_volume` | `{ level }` (0–100) | mpv internal volume |

#### Queue management

| Tool | Args | Effect |
|---|---|---|
| `get_play_queue` | — | Returns ordered list `[{ index, songId, filename, title?, isCurrent, isPlaying }, ...]` plus `currentIndex` and `length`. Returns `{ items: [], length: 0 }` when mpv isn't running. Read-only; does not spawn mpv. |
| `clear_play_queue` | — | mpv `stop` (clears playlist + halts playback). Idempotent on idle queue. |
| `shuffle_play_queue` | — | mpv `playlist-shuffle` followed by `set_property playlist-pos 0`. Randomizes existing queue and resets the play head to the new top so it plays (active-queue behavior). Pause state preserved. |
| `move_in_play_queue` | `{ from: number, to: number }` | mpv `playlist-move`. Reorder by index. When the move involves index 0 (source or destination), the play head is reset to 0 so the new top plays (active-queue behavior). Short-circuits with `{ success: true, noop: true }` when `from === to`. Out-of-range surfaces mpv error via `ErrorFormatter`. |
| `remove_from_play_queue` | `{ index: number }` | mpv `playlist-remove`. Removes one entry; mpv auto-advances if the removed entry was currently playing. |

#### Read state

| Tool | Returns |
|---|---|
| `now_playing` | `{ engineRunning, title?, artist?, album?, position?, duration?, paused?, queueIndex?, queueLength? }` (synchronous from cache; does NOT spawn mpv) |
| `playback_status` | `{ engineRunning, mpvPath, mpvVersion, volume, idle }` (does NOT spawn mpv) |

`now_playing` returns real-time playback state (current title, position, paused). It is **distinct from** `get_play_queue`: "now playing" answers *"what's happening right this second?"*; `get_play_queue` answers *"what's the full ordered list of tracks that are queued up?"*. Same underlying mpv playlist, different granularities and very different payload sizes.

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
| Navidrome stream URL 4xx/5xx | mpv emits `end-file` with reason `error`; surfaces in `now_playing` and via tool errors |
| Out-of-range index for `move_in_play_queue` / `remove_from_play_queue` | mpv error surfaced via `ErrorFormatter.toolExecution` |

No retry loops, no auto-recovery beyond re-attach.

## Open work

### Scrobbling

Hook into mpv `start-file` / `end-file` events to call Subsonic `/scrobble`. Not yet wired up.

| Event | Action |
|---|---|
| `start-file` | Subsonic `/scrobble?id=<X>&submission=false` (now-playing) |
| `end-file` with `>50%` or `>240s` played | Subsonic `/scrobble?id=<X>&submission=true` (count it) |
| `end-file` early skip | No scrobble |

Existing `list_recently_played` / `list_most_played` will benefit immediately once wired.

## Out of Scope

- SQLite / persistence across MCP restart (the stable-IPC-path design covers the common case)
- Navidrome `/api/queue` bidirectional sync
- Crossfade / replay gain
- Multiple simultaneous playback engines
- Remote/network playback (Chromecast, AirPlay, MPRIS)
- System volume mixer
- Browser-based control surface
- Auto-recovery from mpv crashes beyond the re-attach pattern

Each is a future iteration if real demand emerges.

## Future Hooks (kept in mind, not built)

1. **Browser controls.** A small HTTP/WS layer in front of `playback-engine` exposes the same commands to a web UI. Clean addition because the engine is the only thing handlers ever talk to.
2. **Voice / Pi.** The engine has no MCP-specific assumptions; it could be reused by a different transport.
3. **Persistence.** If we later want survive-restart for the queue contents (not just the mpv process), snapshot the playlist + position to disk on every change and restore on spawn.

## Quality Gates

All existing project rules apply: `pnpm check:all` zero issues, dead-code clean, `ErrorFormatter` for messages, `logger` (never `console.log`), shared schemas, lazy initialization following existing conditional-feature pattern.

---

## Unit Test Plan

These are local-only tests; CI does not run them because contributors aren't required to install mpv. Run via `pnpm test:playback` or similar dedicated script.

### Test environment requirements

- A real Navidrome instance reachable per `.env.test` (already in use)
- mpv binary available on the test host
- Tests share one mpv instance per file run; each test calls `clear_play_queue` in `beforeEach` to reset state

### Shared helpers

```ts
// Pulls N song IDs from a stable source (starred items or fixed search)
async function getTestSongIds(count: number): Promise<string[]>
// Pulls N album IDs
async function getTestAlbumIds(count: number): Promise<string[]>
// Polls now_playing until predicate matches (mpv has a small async delay)
async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void>
```

### Per-tool tests

#### `play_songs`

| Case | Setup | Assert |
|---|---|---|
| Replace mode (default) | empty queue | `get_play_queue.length === N`, `currentIndex === 0`, `now_playing.title` matches first input ID |
| Replace overrides existing queue | queue with M unrelated tracks | length === N (M discarded) |
| Append to empty queue | empty | length === N (mpv auto-plays first track) |
| Append to populated queue | queue with M, current at idx 0 | length === M+N, `currentIndex === 0` unchanged, current track unchanged |
| `shuffle: true` reorders | input length ≥ 5 (so coincidental same-order is rare) | output is permutation of input, content set equal, order differs (retry once if same — Fisher-Yates can land on input order) |
| `shuffle: true` with append | queue with M existing | only the appended N are shuffled; first M positions untouched |
| Empty `songIds` | — | schema validation rejects |

#### `play_albums`

| Case | Setup | Assert |
|---|---|---|
| Single album, `shuffle: 'none'` | one album with K tracks | length === K, tracks in API natural order |
| Single album, `shuffle: 'songs'` | one album K ≥ 5 | length === K, content equal, order may differ |
| Two albums, `shuffle: 'none'` | albums A (a tracks), B (b tracks) | length === a+b, idx 0..a-1 from A in API order, idx a..a+b-1 from B in API order |
| Two albums, `shuffle: 'albums'` | A and B | length === a+b, either A-then-B or B-then-A, within each natural order preserved (deterministic content checks: idx 0 ∈ A.first ∪ B.first) |
| Two albums, `shuffle: 'songs'` | A and B, both ≥ 3 tracks | content set equal to union, no contiguous a-length block of A IDs (probabilistic; allow retry once) |
| Append mode preserves current | populated queue, current at idx 0 | current track unchanged after append |
| Empty album silently skipped | one valid album, one all-empty album | length === valid album track count |
| All albums empty | albums that resolve to zero tracks | tool throws with "No tracks found across all albums" |

#### `play_albums_search`

| Case | Setup | Assert |
|---|---|---|
| Empty search result | filter set known to match nothing (e.g., `query: 'NoSuchAlbum_zxqv'`) | tool throws with `"No albums matched the search filters"`; live queue unchanged |
| Headline random albums | `{ starred: true, sort: 'random', limit: 3 }` against a library with ≥3 starred albums | `matchCount === 3`; queue length equals total tracks across the 3 albums; first track playing |
| All search filters pass through | every filter from `search_albums` set to a known-matching value | `appliedFilters` round-trips genre/mediaType/etc. resolutions; matched album set is identical to the equivalent `search_albums` call |
| `shuffle: 'none'` | 2-album result | tracks appear in result-album order, natural disc/track order within each album (matches `play_albums` shuffle:'none') |
| `shuffle: 'albums'` | 2-album result, both ≥ 3 tracks | length === a+b, either A-then-B or B-then-A, natural order within each (matches `play_albums` shuffle:'albums') |
| `shuffle: 'songs'` | 2-album result, both ≥ 3 tracks | content set equal to union, no contiguous a-length block of A IDs (probabilistic; allow retry once) |
| All matched albums empty | filter set whose results all resolve to 0 tracks (rare; may need fixture albums) | tool throws with `"Found albums but none had any tracks"` |
| Some empty, some populated | mixed result set | empty albums silently skipped; `albumCount` reflects non-empty count, `matchCount` reflects raw search count |
| `mode: 'append'` preserves current | populated queue, current at idx 0; append-mode search call | length grows, currentIndex unchanged, current track unchanged |
| `appliedFilters` round-trip | filter with text→ID resolution (e.g., `genre: 'Rock'`) | `appliedFilters.genre` is the resolved ID, not the input string |

#### `play_songs_search`

| Case | Setup | Assert |
|---|---|---|
| Empty search result | filter set known to match nothing (e.g., `query: 'NoSuchSong_zxqv'`) | tool throws with `"No songs matched the search filters"`; live queue unchanged |
| Headline starred songs | `{ starred: true, limit: 10 }` against a library with ≥10 starred songs | `count === 10`; queue length === 10; first track playing; default sort is `title` ASC |
| All search filters pass through | every filter from `search_songs` set to a known-matching value | `appliedFilters` round-trips resolutions; matched song set is identical to the equivalent `search_songs` call |
| `shuffle: false` (default) | filter result of N≥5 with deterministic sort | songs appear in search-result order (matches `play_songs` shuffle:false) |
| `shuffle: true` | filter result of N≥5 | content set equal, order may differ; `shuffled: true` in result; matches `play_songs` shuffle:true semantics (Fisher-Yates) |
| `shuffle: true` with append | populated queue M; append-mode shuffled search call | only the appended N are shuffled; first M positions untouched |
| `mode: 'append'` preserves current | populated queue, current at idx 0 | length grows, currentIndex unchanged, current track unchanged |
| `appliedFilters` round-trip | filter with text→ID resolution (e.g., `genre: 'Jazz'`) | `appliedFilters.genre` is the resolved ID, not the input string |

#### `get_play_queue`

| Case | Setup | Assert |
|---|---|---|
| Engine cold | no prior playback this run | `{ items: [], length: 0 }` (no `currentIndex`) |
| Populated queue | after `play_songs` of N IDs | `length === N`, every item has `index` matching position, `songId` correctly parsed from `filename` URL, exactly one item has `isCurrent: true`, `currentIndex` matches that item's index |
| `songId: null` for non-stream URL | manually load file via direct mpv IPC (test-only escape hatch) | item appears with `songId: null`, no throw |

#### `clear_play_queue`

| Case | Setup | Assert |
|---|---|---|
| Non-empty queue | populated | after: `length === 0`, `now_playing.queueLength === 0`, `now_playing.queueIndex === -1` |
| Empty/idle queue | empty | call returns `{ success: true }`, no throw |

#### `shuffle_play_queue`

| Case | Setup | Assert |
|---|---|---|
| N ≥ 5 items | populated | length unchanged, content set equal, order may differ; `now_playing.queueIndex === 0` (active-queue: play head reset to top); pause state preserved |
| Single item | populated with 1 | call succeeds, no error |
| Empty queue | empty | call succeeds, no error (set-pos guarded on count) |
| Preserves pause | populated, paused before shuffle | after: still paused, but `queueIndex === 0` |

#### `move_in_play_queue`

| Case | Setup | Assert |
|---|---|---|
| `from === to` | populated | returns `{ success: true, noop: true }`, queue unchanged |
| Valid `from < to`, neither is 0 | current at idx 0, move 2 → 4 | source entry now at idx **3** (mpv's `playlist-move` removes from source first, then inserts before original `to`, so forward moves land at `to - 1`); intermediates between source and dest shift **down** by 1; `currentIndex` unchanged (lazy is correct here) |
| Valid `from > to`, neither is 0 | current at idx 0, move 4 → 2 | source entry now at idx 2 (backward moves are exact since source removal doesn't shift the destination); `currentIndex` unchanged |
| `to === 0` triggers active play | populated, current at idx 0, move 3 → 0 | source entry now at idx 0 AND `now_playing.queueIndex === 0` AND playing the moved track |
| `from === 0` triggers active play | populated, current at idx 0, move 0 → 4 | the originally-current track is now at idx **3** (per mpv's forward-move semantics — see `from < to` row above), and `now_playing.queueIndex === 0` (the new top, formerly idx 1, is now playing) |
| Pause preserved across active move | populated, paused, move 3 → 0 | after: queueIndex 0, still paused |
| Out of range `from` | populated, from = length+10 | throws via `ErrorFormatter` (MCP error) |

#### `remove_from_play_queue`

| Case | Setup | Assert |
|---|---|---|
| Remove non-current | populated, current at idx 0, remove idx 2 | length -1, current track unchanged |
| Remove current track | populated, current at idx 0 | length -1, mpv auto-advanced to former idx 1, `now_playing` reflects new track |
| Remove last (only) item | queue with 1 item | length === 0, queue idle |
| Out of range | index = length+10 | throws via `ErrorFormatter` |

#### `pause` / `resume`

| Case | Assert |
|---|---|
| Pause while playing | `now_playing.paused === true` |
| Resume while paused | `now_playing.paused === false` |
| Pause when already paused | idempotent, no error |
| Resume when already playing | idempotent, no error |

#### `set_volume`

| Case | Assert |
|---|---|
| Set 50 | `playback_status.volume === 50` |
| Set 0 | `playback_status.volume === 0` |
| Set 100 | `playback_status.volume === 100` |
| Below 0 | schema rejects (current Zod min(0)) |
| Above 100 | schema rejects (current Zod max(100)) |

#### `next` / `previous`

| Case | Setup | Assert |
|---|---|---|
| `next` mid-queue | current at idx 0 of N≥2 | after: `queueIndex === 1`, different track playing |
| `next` at last entry | current at idx N-1 | mpv `force` flag behavior — document actual: stops or wraps |
| `previous` mid-queue | current at idx 1 | after: `queueIndex === 0` |
| `previous` at idx 0 | current at idx 0 | document actual mpv behavior |

#### `seek`

| Case | Setup | Assert |
|---|---|---|
| Relative +30 | mid-track | position increases by ~30s |
| Relative -10 | position > 10 | position decreases by ~10s |
| Absolute 60 | mid-track | position ≈ 60s |
| Beyond duration | absolute beyond track end | mpv advances to next track or clamps; document actual |

#### `now_playing`

| Case | Assert |
|---|---|
| Engine cold | `{ engineRunning: false }` only |
| Engine running, queue populated | full payload with title/artist/album/position/duration/queueIndex/queueLength |
| After pause | `paused: true` |
| After clear | `queueIndex === -1`, `queueLength === 0` |

#### `playback_status`

| Case | Assert |
|---|---|
| Engine cold | `engineRunning: false`, `mpvPath` set, `mpvVersion: null`, `volume: null`, `idle: null` |
| Engine running | `engineRunning: true`, `mpvVersion` populated, `volume` populated, `idle` boolean |

### Cross-tool integration

A small set of "the queue actually works as a system" tests:

1. `play_songs` 5 tracks → `now_playing.queueIndex === 0` → `next` → `queueIndex === 1` → `pause` → `paused === true` → `resume` → `paused === false` → `clear_play_queue` → `length === 0`
2. `play_albums` 2 albums → `get_play_queue` confirms expected length → `move_in_play_queue` random valid pair → `get_play_queue` confirms reorder → `shuffle_play_queue` → length unchanged, content equal
3. `play_songs` 5 → `move_in_play_queue { from: 4, to: 0 }` → `now_playing.title` matches the song that was at idx 4 (active-queue verification)

### Notes for whoever writes the actual tests

- Every test should `clear_play_queue` in `beforeEach` and `afterEach` — leftover state across tests is a debugging nightmare.
- Use `waitFor` (poll `now_playing`) rather than fixed `setTimeout` — mpv's response timing varies on different hosts.
- For shuffle assertions, allow one retry on the rare same-order coincidence (5! = 120 permutations means ~0.8% false-fail rate per run on N=5).
- Tests that verify "currently playing" should use `get_play_queue.items.find(i => i.isCurrent)` rather than `currentIndex` directly — it's slightly more robust to mpv state transitions.
- Active-queue tests (`move_in_play_queue` with `to: 0` or `from: 0`, and `shuffle_play_queue`) verify both the structural reorder AND the play-head reset to idx 0.
