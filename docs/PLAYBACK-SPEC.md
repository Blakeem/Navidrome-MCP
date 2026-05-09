# Local Playback Spec — mpv-driven Audio Output

> **Status:** Draft v1. Initial scope is intentionally small. Expansion happens after real-world testing.

## Goal

Let the AI queue and play songs/albums directly through the speakers of the machine running the MCP server, with no browser or external Navidrome client required. Cross-platform: Linux and Windows 11.

Use case driver: "Queue 5 random favorite albums" should be one tool call. Long-term: voice-controlled music device on a Raspberry Pi or similar.

## Decisions (locked for v1)

| Decision | Choice | Rationale |
|---|---|---|
| Playback engine | **mpv** controlled via JSON-IPC | One binary on every platform, gapless playback, observable property stream, ~50 lines of Node to talk to it |
| Decoding | Server-side via Navidrome `?format=mp3` | Navidrome+FFmpeg handle every source codec; mpv just opens an HTTP URL |
| Queue source of truth | **mpv's playlist** (in-memory only) | No SQLite, no Navidrome-queue mirror, no persistence across MCP restarts |
| Navidrome `/api/queue` sync | **Not in v1** | Bidirectional sync is a bug factory; revisit after testing |
| Engine startup | **Lazy** — mpv spawns on first playback tool call | No cost when feature is unused |
| Volume control | **mpv internal volume only** (0–100), exposed as a tool | System mixer is OS-specific; mpv's own volume is sufficient |
| Failure mode | **Fail fast, surface to AI** | Not fault-tolerant in v1; we'll add resilience after the happy path is proven |
| Scrobbling | Subsonic `/scrobble` driven by mpv `start-file` / `end-file` events | Free win — existing `list_recently_played` / `list_most_played` start reflecting MCP playback automatically |

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
│       ├── exposes: playSong / enqueue / pause / next / etc.      │
│       └── emits internal events for scrobbler                    │
│       │                                                          │
│       ├──► src/services/playback/mpv-process.ts                  │
│       │    spawn / kill mpv, platform-aware IPC path             │
│       │                                                          │
│       ├──► src/services/playback/mpv-ipc.ts                      │
│       │    net.createConnection → JSON framing → request/event   │
│       │                                                          │
│       └──► src/services/playback/scrobbler.ts                    │
│            on track-end → /scrobble?id=X&submission=true         │
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
├── mpv-process.ts        # spawn/kill, exec detection, exit handling
├── mpv-ipc.ts            # JSON-IPC client (net socket + line framing)
├── playback-engine.ts    # high-level facade; the only thing handlers use
└── scrobbler.ts          # event listener that calls Subsonic /scrobble

src/tools/
├── playback.ts           # tool function impls (mirror existing pattern)
└── handlers/
    └── playback-handlers.ts  # ToolCategory factory, registered conditionally
```

Mirrors how Last.fm and lyrics features are organized today.

## Configuration

### Detection (no env var needed)

On first playback tool call, the engine attempts `spawn('mpv', ['--version'])`. If `ENOENT`, the tool returns a clear error pointing to install instructions. Same auto-detect pattern as existing optional features.

### Env vars

| Var | Default | Purpose |
|---|---|---|
| `MPV_PATH` | `mpv` (resolved on PATH) | Override binary location (Windows users with non-standard installs) |
| `PLAYBACK_TRANSCODE_FORMAT` | `mp3` | Stream format requested from Navidrome |
| `PLAYBACK_TRANSCODE_BITRATE` | `192` | Max bitrate kbps |

All optional. Sensible defaults work out of the box.

## mpv Process Flags

```
mpv \
  --idle=yes                  # don't exit when playlist is empty
  --no-video                  # audio only
  --no-terminal               # no TTY interaction
  --no-config                 # ignore user config that could break us
  --load-scripts=no           # no user scripts
  --gapless-audio=yes         # the whole point
  --prefetch-playlist=yes     # pre-buffer next track to minimize HTTP gap
  --input-ipc-server=<PATH>   # the IPC endpoint
  --volume=100                # we manage volume via IPC
```

IPC path:
- Linux/macOS: `/tmp/navidrome-mcp-mpv-<pid>.sock`
- Windows: `\\.\pipe\navidrome-mcp-mpv-<pid>`

PID-suffixed to allow multiple MCP instances on one host without collision.

## IPC Protocol (mpv side, what we use)

mpv's IPC is newline-delimited JSON, bidirectional. Every command gets a response with the same `request_id`. Property changes and lifecycle events arrive unsolicited as `event` messages.

**Commands we send:**
```jsonc
{ "command": ["loadfile", "<url>", "replace"], "request_id": 1 }
{ "command": ["loadfile", "<url>", "append"], "request_id": 2 }
{ "command": ["playlist-clear"], "request_id": 3 }
{ "command": ["playlist-next"], "request_id": 4 }
{ "command": ["playlist-prev"], "request_id": 5 }
{ "command": ["playlist-remove", 2], "request_id": 6 }
{ "command": ["playlist-move", 0, 3], "request_id": 7 }
{ "command": ["set_property", "pause", true], "request_id": 8 }
{ "command": ["set_property", "volume", 75], "request_id": 9 }
{ "command": ["seek", 30, "absolute"], "request_id": 10 }
{ "command": ["observe_property", 1, "playlist-pos"], "request_id": 11 }
```

**Events we observe** (via `observe_property` + `event`):
- `playlist-pos` — current track index
- `time-pos` — playback position (we throttle observation)
- `duration` — current track length
- `pause` — paused?
- `idle-active` — queue exhausted
- `playlist` — full list, any change
- `media-title` / `metadata` — display info
- Lifecycle events: `start-file`, `end-file`, `playback-restart`

The IPC client maintains a property cache so `now_playing` is a synchronous local read.

## Tool Surface (v1)

### Playback control
| Tool | Args | Effect |
|---|---|---|
| `play_album` | `{ albumId, shuffle? }` | Replace queue with album in track order |
| `play_song` | `{ songId }` | Replace queue with single song |
| `enqueue_album` | `{ albumId, position? }` | Append (or insert at position) |
| `enqueue_songs` | `{ songIds[], position? }` | Append/insert multiple |
| `enqueue_random_albums` | `{ count, source: 'starred' \| 'top-rated' \| 'all', replace? }` | The headline tool |
| `clear_queue` | — | `playlist-clear`, stop |
| `pause` / `resume` | — | Toggle |
| `next` / `previous` | — | Skip |
| `seek` | `{ seconds, mode: 'absolute' \| 'relative' }` | Position |
| `set_volume` | `{ level }` (0–100) | mpv volume |
| `shuffle_queue` | — | `playlist-shuffle` |
| `move_in_queue` | `{ from, to }` | Reorder |
| `remove_from_queue` | `{ index }` | Drop one |

### Read state
| Tool | Returns |
|---|---|
| `now_playing` | `{ song, album, artist, position, duration, paused, queueIndex, queueLength }` (synchronous from cache) |
| `get_play_queue` | Full ordered queue with track metadata |
| `playback_status` | `{ engineRunning, mpvVersion, volume, idle }` |

### Naming collision (resolved in Stage 1)
The original `get_queue` / `set_queue` / `clear_queue` tools were renamed to `get_saved_queue` / `save_queue` / `clear_saved_queue` so the live playback tools own the simpler names. The "saved" tools manipulate Navidrome's server-side advisory queue (cross-device sync, what the web UI shows); the playback tools control actual audio output via mpv.

## Error Model (v1)

Fail fast. Every error surfaces a structured message via `ErrorFormatter`:

| Condition | Behavior |
|---|---|
| mpv not on PATH | First call returns "mpv not found — install from https://mpv.io/" |
| mpv exits unexpectedly | Tool call returns error; engine marks itself dead; next call attempts fresh spawn |
| IPC socket disconnects | Same — error to caller, engine state cleared |
| Navidrome stream URL 4xx/5xx | mpv emits `end-file` with reason `error`; we surface in `now_playing` and via tool errors |
| Tool called before mpv is ready | Block briefly (≤1s) on the spawn promise, then error if not ready |

No retry loops, no auto-recovery. We add those after the happy path is proven.

## Scrobbling Logic

| Event | Action |
|---|---|
| `start-file` | Subsonic `/scrobble?id=<X>&submission=false` (now-playing) |
| `end-file` with `>50%` or `>240s` played | Subsonic `/scrobble?id=<X>&submission=true` (count it) |
| `end-file` early skip | No scrobble |

Threshold mirrors Last.fm convention; existing `list_recently_played` / `list_most_played` benefit immediately.

## Out of Scope (v1)

- SQLite / persistence across MCP restart
- Navidrome `/api/queue` sync
- Crossfade / replay gain
- Multiple simultaneous playback engines
- Remote/network playback (Chromecast, AirPlay, MPRIS)
- System volume mixer
- Browser-based control surface
- Auto-recovery from mpv crashes

Each is a future iteration.

## Future Hooks (kept in mind, not built)

1. **Browser controls.** A small HTTP/WS layer in front of `playback-engine` exposes the same commands to a web UI. Clean addition because the engine is the only thing handlers ever talk to.
2. **Voice / Pi.** The engine has no MCP-specific assumptions; it could be reused by a different transport.
3. **Persistence.** If we later want survive-restart, snapshot the playlist + position to disk on every change and restore on spawn. Not before testing reveals it's needed.

## Validation Plan

1. **Standalone POC** — `scripts/playback-poc.ts`. Spawns mpv, plays 3 auto-picked songs, exercises pause/resume/skip/volume/seek, prints event stream. Run with `pnpm tsx scripts/playback-poc.ts`. **This is where we start.**
2. **Engine + 4 tools** — `play_song`, `pause`, `resume`, `now_playing`. Smallest meaningful PR. Manual MCP Inspector verification.
3. **Album-level tools + scrobbling** — once the basics feel right.
4. **Random-favorites + queue manipulation** — the headline UX.
5. **Unit tests** — once the shape stabilizes.

## Quality Gates

All existing project rules apply: `pnpm check:all` zero issues, dead-code clean, ErrorFormatter for messages, logger (never `console.log`), shared schemas, lazy initialization following existing conditional-feature pattern.
