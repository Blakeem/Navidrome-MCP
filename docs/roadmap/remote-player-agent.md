# Remote Player Agent

**Status (2026-10-17):** Later. No Docker for now, so the Docker image sections below are deferred. The target setup is a PC driving a Bluetooth or wired speaker. See [README.md](README.md#remote-player-agent).

## Verdict

BUILD, once Web UI Auth + Roles ships its machine grant. The web player process (`navidrome-web`) already holds Navidrome credentials, spawns mpv, builds stream URLs and scrobbles. A remote agent is that process plus an authenticated, versioned agent API. The MCP server needs one new seam, the player target, and Music Assistant Bridge can reuse it. MVP effort is 2 to 3 weeks and the full roadmap 6 to 9 weeks for one developer [INFERRED].

## Scope

```
IN SCOPE:      the player target seam in the MCP server process, the player registry and its default
               rule, the agent API v1 on the web player process, the agent player target (HTTP client),
               the `players` and `agent` settings sections, the optional `player` tool argument,
               the `list_players` tool, playback tool registration when only remote players exist,
               radio on remote players, the native agent install (npm plus a systemd user unit),
               the agent Docker image tag, pairing, built-in TLS, per-player Navidrome API keys
OUT OF SCOPE:  synchronized multiroom playback (no part of this design keeps two mpv clocks aligned,
               see the multiroom decision)
               agents reached over the internet (the agent API is a LAN control surface)
               Chromecast, AirPlay, Sonos (Music Assistant Bridge owns them)
               the design of Music Assistant Bridge (only the shared player target is named here)
               the authentication system itself (Web UI Auth + Roles owns it)
               audio device listing and selection (Audio-Device Selector owns it)
               agents in Docker Desktop on Windows or macOS (no audio device, DOCKER.md:75-77)
               Navidrome /api/queue sync (rejected in PLAYBACK-SPEC.md:16)
BOUNDARY CASE: an MCP server and an agent on one machine → OUT of the agent path, because the
               local player target already drives that mpv. Rule: a player whose mpv shares the MCP
               server's per-uid IPC path is the local player.
BOUNDARY CASE: an agent machine that also runs an MCP client (a Pi with a voice assistant) → IN,
               with no new code. Rule: that MCP server reaches its own mpv through the local
               player target and the existing loopback lease.
BOUNDARY CASE: the browser web remote served by each agent → IN as it exists today. A web remote
               that switches between players → IN, in a later release.
```

## Feasibility

Each statement below must hold for the feature to work.

1. **The web player process can run with no MCP server and stay up.** Holds. `shouldStopForMcpExit` stops the process only when it was launched by an MCP server (`src/web/player-runtime.ts:42-49`). A direct `navidrome-web` run has no IPC channel, so `launchedByMcp` is false (`src/web/main.ts:44`) [DIRECT: code].
2. **The web player process can start mpv by itself.** Holds. `POST /api/library/play` reaches `playbackEngine.enqueue`, which calls `ensureRunning` and spawns mpv when none answers (`src/tools/playback.ts:543`, `src/services/playback/playback-engine.ts:226-237`, `:739-760`) [DIRECT: code].
3. **The web player process can build stream URLs without help.** Holds. It runs `createRuntime` with the full config (`src/web/main.ts:199`), which configures the engine (`src/bootstrap.ts:37-43`). The engine signs each URL with the configured password (`playback-engine.ts:711-730`). An agent therefore needs only song IDs [DIRECT: code].
4. **The web player process scrobbles by itself.** Holds. It attaches its own `ScrobbleTracker` (`src/web/main.ts:236-237`) [DIRECT: code].
5. **mpv's IPC socket can stay local.** Holds, and it must. The IPC path is a per-uid Unix socket or a Windows named pipe (`src/services/playback/mpv-process.ts:16-30`). mpv offers only those two socket types. Its manual calls the IPC "explicitly insecure" and notes that "the `run` command is exposed, which can run arbitrary system commands" [DIRECT: mpv `DOCS/man/ipc.rst`, master, read 2026-10-17].
6. **The web player routes carry authentication.** Refuted for today. The dispatcher has no authentication (`src/webui/server.ts:97-199`). Only settings, shutdown, the lease and the LAN health route check `isLocalRequest` (`src/webui/routes/player.ts:54,72,140,156`, `src/webui/routes/health.ts:25`) [DIRECT: code]. The agent API needs the machine grant from Web UI Auth + Roles.
7. **A Subsonic token-signed URL expires.** Refuted. Navidrome validates `t == md5(password + salt)` with no expiry and no record of used salts [DIRECT: navidrome `server/subsonic/middlewares.go` `validateCredentials`, master, read 2026-10-17]. The same `t` and `s` pair passed twice against the live server, 2 s apart [DIRECT: probe of Navidrome 0.62.0, 2026-10-17]. The Subsonic spec says nothing about expiry or replay [DIRECT: subsonic.org/pages/api.jsp].
8. **A JWT-signed stream URL expires.** Holds. The live server issues a JWT with a 172800 s (48 h) lifetime, and `/rest/ping` accepts it as `jwt` with `u` [DIRECT: probe, 2026-10-17].
9. **Navidrome offers a revocable per-device credential.** Holds on Navidrome master only. PR #6219 adds per-player API keys (`nds_` plus 22 base62 characters, stored as a SHA-256 hash, revocable, bound to the player) and advertises `apiKeyAuthentication` [DIRECT: github.com/navidrome/navidrome/pull/6219, merged 2026-09-28]. The newest release, v0.64.2 (2026-09-24), predates the merge [DIRECT: GitHub releases page, read 2026-10-17]. The live 0.62.0 server does not advertise the extension [DIRECT: probe].
10. **An MCP server without mpv can register playback tools.** Refuted for today. Playback tools and `play_radio_station` register only when a local mpv binary resolves (`src/tools/handlers/registry.ts:103-107`, `src/tools/handlers/radio-handlers.ts:299`, `src/config/map-config.ts:92`) [DIRECT: code]. The gating rule must change so the Docker MCP image can drive agents.
11. **A Raspberry Pi can run the agent.** Holds. The release workflow already builds `linux/amd64,linux/arm64` (`.github/workflows/docker-release.yml:57`) [DIRECT]. `node:22-bookworm-slim` exists for arm64 at about 80 MB compressed [DIRECT: Docker Hub tag API, updated 2026-10-06]. Debian ships mpv for arm64, version 0.35.1 in bookworm and 0.40.0 in trixie [DIRECT: packages.debian.org]. The radio station tag needs mpv 0.36 or newer (`playback-engine.ts:60-65`), so the agent image wants a trixie base [DERIVED].

Starting-list claims:

- "Add mpv to an optional Docker image." Holds, as a separate image tag. Audio passthrough works on Linux hosts only (DOCKER.md:71-77).
- "Let one MCP server address multiple named agents." Holds, once playback tools can register without local mpv.
- "Keep mpv's socket local and expose only the authenticated agent API." Holds. On an agent the browser routes are LAN-exposed too, so Web UI Auth + Roles must also guard them.
- "1 to 2 weeks." Refuted as low. The MVP is 2 to 3 weeks and the full roadmap 6 to 9 weeks [INFERRED].
- "Web UI Auth + Roles unblocks this." Holds for the machine grant.

## Current system

```
                    AI client(s)
            stdio │                │ Streamable HTTP (/mcp, optional bearer)
                  ▼                ▼
┌─────────────── MCP server process (src/index.ts) ───────────────────────────┐
│ playback tool handlers   src/tools/handlers/playback-handlers.ts            │
│      │  play_* calls respawnWebForPlay first (respawn-on-play.ts)           │
│      ▼                                                                      │
│ playback tool impls      src/tools/playback.ts, src/tools/radio.ts          │
│      │  Navidrome reads (search, song metadata, stations) via NavidromeClient│
│      ▼                                                                      │
│ playback engine singleton  src/services/playback/playback-engine.ts         │
│      │  signs stream URLs with t + s (src/utils/subsonic-auth.ts)           │
│ scrobble tracker           src/services/playback/scrobble-tracker.ts        │
└──────┼─────────────────────────────────────┬────────────────────────────────┘
       │ JSON-IPC, per-uid socket or pipe    │ loopback HTTP to webui.port:
       │                                     │   GET /healthz probe (src/web/acquire.ts)
       │                                     │   POST /api/mcp-lease, kept open (src/web/lease.ts)
       │                                     │   or spawn a detached child (src/web/spawn.ts)
       ▼                                     ▼
   ┌───────┐   JSON-IPC    ┌──── web player process (src/web/main.ts, `navidrome-web`) ────┐
   │  mpv  │ ◄──────────── │ own playback engine singleton + own scrobble tracker         │
   └───┬───┘               │ HTTP server src/webui/server.ts, port-as-lock                │
       │                   │ routes: /api/controls/*, /api/library/*, /api/events (SSE),  │
       │ GET /rest/stream  │ /api/visualizer (SSE, second IPC connection), /api/mcp-lease │
       │ ?u&t&s&id         └──────────────────────────────▲───────────────────────────────┘
       ▼                                                  │ HTTP + SSE, no authentication,
   Navidrome                                              │ LAN-reachable with webui.expose
                                              browser web remote (src/webui/public/)
```

Facts about the parts in this diagram:

1. **At the playback tool impls**, every engine call goes to the module singleton `playbackEngine` (`src/tools/playback.ts:22-27`). Tool calls reach mpv in process over JSON-IPC, never through the web player process [DIRECT: code].
2. **Between the MCP server process and the web player process**, only the `/healthz` probe (`src/web/acquire.ts:55-106`), the kept-open lease (`src/web/lease.ts:25-68`) and the child spawn (`src/web/spawn.ts:46-68`) cross. The lease route refuses any non-local peer (`player.ts:140`) [DIRECT: code].
3. **At the web player process**, the browser routes call the same tool impls, such as `pause({})` in `src/webui/routes/controls.ts:22-24`, on its own engine instance [DIRECT: code].
4. **At mpv**, the per-uid IPC path makes every process of one user share one mpv (`mpv-process.ts:16-30`). The engine's mutation lock does not span processes (`playback-engine.ts:142-144`) [DIRECT: code].
5. **At the scrobble trackers**, every process attached to one mpv tracks plays, and the first claim mpv echoes wins (`scrobble-tracker.ts:46-49`, `:394-415`) [DIRECT: code].
6. **At the web player lifecycle**, an MCP-launched process stops when its last lease closes unless `persistAfterMcpExit` is on, and every shutdown path quits mpv (`src/web/main.ts:76-124`, `player-runtime.ts:42-49`). An exiting MCP server quits mpv only when its own engine controlled it and no web player owns the port (`src/index.ts:189-200`) [DIRECT: code].
7. **At the web player HTTP server**, the DNS-rebinding Host check accepts only a loopback `Host` on a loopback bind, and only an IP literal, a name of the machine or a `webui.allowedHosts` entry on a LAN bind (`server.ts:119-129`), and a request body is capped at 16 KB (`src/webui/http-helpers.ts:11`) [DIRECT: code].

## Integration point

```
┌───────── MCP server process (any machine, stdio or HTTP, the Docker image without mpv) ─────────┐
│ playback tool handlers ── optional `player` arg ──► player registry                            │
│                                                     src/services/players/registry.ts           │
│ playback tool impls: resolve song IDs + metadata    │ name → player target, default rule       │
│ (Navidrome reads stay here, active libraries apply) │                                          │
│                                ┌────────────────────┼─────────────────────┐                    │
│                                ▼                    ▼                     ▼                    │
│                     local player target    agent player target    Music Assistant target      │
│                     local-target.ts        agent-target.ts        (Music Assistant Bridge)    │
└────────────────────────────┼────────────────────────┼───────────────────────────────────────────┘
                             │ JSON-IPC (unchanged)   │ HTTP or HTTPS, Authorization: Bearer <machine grant>
                             ▼                        │ /api/agent/v1/*  carries song IDs, station IDs,
                         local mpv                    │ control ops and state reads, never URLs
                                                      ▼
                  ┌──── web player process in agent mode (garage Pi, `navidrome-web` as a service) ────┐
                  │ agent API routes  src/webui/routes/agent.ts  → existing tool impls and engine ops   │
                  │ playback engine → JSON-IPC → garage mpv (socket stays on the Pi)                   │
                  │ scrobble tracker with the agent's own Navidrome credentials                        │
                  │ browser web remote for the room, guarded by Web UI Auth + Roles                    │
                  └───────────────────────────────────┬────────────────────────────────────────────────┘
                                                      │ garage mpv: GET /rest/stream, URL signed on the Pi
                                                      ▼
                                                  Navidrome
```

Where each new part lives, and why there:

| New part | Location | Why there |
|---|---|---|
| the player target interface | `src/services/players/player-target.ts` | A service, beside `src/services/playback/`, since tools, the web remote and Music Assistant Bridge all consume it |
| the local player target | `src/services/players/local-target.ts` | A pass-through to the current engine calls, so local behavior does not change |
| the agent player target | `src/services/players/agent-target.ts` | The HTTP client for the agent API, built on `fetchWithTimeout` with `respectProxy` off, so an internet proxy never diverts LAN control (`src/utils/fetch-with-timeout.ts:162`) |
| the player registry | `src/services/players/registry.ts` | Builds targets from config once per process and applies the default rule |
| the agent API routes | `src/webui/routes/agent.ts`, dispatcher lines in `src/webui/server.ts` | The web player process already owns the engine, the tracker and the HTTP server on the agent machine |
| the `players` and `agent` settings sections | `src/config/store.ts`, `schema.ts`, `map-config.ts`, `env-settings.ts`, the config app | The single settings store is the established config path |
| the `list_players` tool and the `player` argument | `src/tools/handlers/playback-handlers.ts` | The playback category already owns the tool schemas |

The player target is the concept Music Assistant Bridge can reuse. It is one interface with one method per queue, transport and read operation, keyed by a player name. A sketch of its shape:

```ts
interface PlayerTarget {
  readonly name: string
  readonly kind: 'local' | 'agent' // Music Assistant Bridge adds its own kind
  enqueue(songIds: readonly string[], mode: 'replace' | 'append',
          metadata: readonly QueueTrackMetadata[]): Promise<{ demoted: boolean }>
  playRadio(stationId: string): Promise<void>
  // one method per transport, queue and read tool, returning today's result shapes
  describe(): Promise<PlayerSummary> // feeds list_players
}
```

The agent API v1 on the web player process:

```
GET  /api/agent/v1/info          name, app version, apiVersion, capabilities, Navidrome user, audio health
GET  /api/agent/v1/now-playing   the now_playing result
GET  /api/agent/v1/status        the playback_status result
GET  /api/agent/v1/queue         ?offset&limit, the get_play_queue page
POST /api/agent/v1/enqueue       { songIds, mode, metadata }
POST /api/agent/v1/radio         { stationId }, resolved by the agent's own Navidrome client
POST /api/agent/v1/pause | resume | next | previous | clear | shuffle
POST /api/agent/v1/seek          { seconds, mode }
POST /api/agent/v1/volume        { level }
POST /api/agent/v1/jump          { index }
POST /api/agent/v1/move          { from, to }
POST /api/agent/v1/remove        { index }
```

The settings sections, on the MCP server machine and on the agent machine:

```json
"players": {
  "default": "garage",
  "remotes": [
    { "name": "garage", "url": "http://garage.lan:8808", "token": "<machine grant>" }
  ]
}
```

```json
"webui": { "enabled": true, "expose": true, "port": 8808 },
"agent": { "enabled": true, "name": "garage" }
```

## Options

Every matrix scores 1 (worst) to 5 (best). Weights sum to 100. The weighted total is the sum of weight times score, divided by 100. Maintainability and the match with comparable tools carry the most weight in every matrix.

### Agent runtime

Criteria: maintainability 30, match with comparable tools 25, security surface 15, room features (web remote, visualizer, lyrics, scrobbling) 15, MVP effort 15.

| Criterion (weight) | web player agent mode | slim agent entry | MPD as the agent | native agent binary |
|---|---|---|---|---|
| maintainability (30) | 5 | 3 | 3 | 1 |
| comparable tools (25) | 4 | 4 | 4 | 3 |
| security surface (15) | 3 | 4 | 1 | 4 |
| room features (15) | 5 | 2 | 2 | 2 |
| MVP effort (15) | 5 | 4 | 3 | 1 |
| **Weighted total** | **4.45** | **3.40** | **2.80** | **2.10** |

- The web player agent mode reuses the lifecycle, engine, tracker, broadcaster and web remote in `src/web/main.ts`. Its security score is lower because its browser routes ship with it.
- The slim agent entry is a second `bin` that wires the engine and tracker without the web remote. It duplicates the lifecycle wiring in `main.ts`, and the two entries can drift.
- MPD as the agent means the MCP server speaks the MPD protocol. MPD's `password` command takes the password in plaintext [DIRECT: mpd.readthedocs.io protocol.html]. The MCP server would push signed URLs into MPD's queue, where any MPD client reads them.
- The native agent binary reimplements the engine in a second language.

Flip check: no single weight change between 0 and 100 flips the winner, and the slim agent entry still trails after a two-point rise in both maintainability and room features. ROBUST.

Comparable tools: Plexamp headless is the full Plexamp app run without a screen, distributed as `Plexamp-Linux-headless-v4.13.2.tar.bz2` [SINGLE-SOURCE: pimylifeup.com guide, modified 2026-05-13]. Jellyfin MPV Shim v3.1.0 is a full client [DIRECT: release 2026-10-05]. Squeezelite and librespot are slim players built for one job.

### Remote seam

Criteria: maintainability 30, match with comparable tools 25, security 20, reuse by Music Assistant Bridge 15, effort 10.

| Criterion (weight) | queue-op API | tool forwarding | mpv command proxy |
|---|---|---|---|
| maintainability (30) | 4 | 3 | 2 |
| comparable tools (25) | 5 | 2 | 1 |
| security (20) | 5 | 4 | 1 |
| Music Assistant reuse (15) | 5 | 2 | 1 |
| effort (10) | 3 | 5 | 3 |
| **Weighted total** | **4.50** | **3.00** | **1.50** |

- The queue-op API: the MCP server resolves song IDs and metadata with its own active libraries, then sends queue and transport operations. The agent handlers call the existing tool impls and engine methods.
- Tool forwarding: the MCP server sends the tool name and arguments, and the agent runs the entire tool. Search would then run against the agent's `libraryManager`, so `set_active_libraries` in the MCP server would not apply.
- The mpv command proxy: the agent relays raw mpv commands over HTTP. The MCP server would mirror mpv's property stream across the network, and signed stream URLs would cross the LAN.

Flip check: the smallest change that flips the winner is effort weight 10 to 86, which makes tool forwarding win. ROBUST.

Comparable tools: Jellyfin pushes a `Play` message with `ItemIds`, `StartIndex` and `PlayCommand`, and MPV Shim builds its own queue from those IDs [DIRECT: jellyfin-mpv-shim v3.1.0 `event_handler.py`, `media.py`]. Spotify Connect commands carry track IDs, and the device keeps `next_tracks` [DIRECT: librespot v0.8.0 `connect/src/spirc.rs`]. Plex controllers send a `containerKey` naming a server-side play queue [DIRECT: python-plexapi 4.18.3 `client.py`].

### Connection direction

Criteria: maintainability 30, match with comparable tools 25, fit with the MCP process model 25, no inbound port on the agent 10, effort 10.

| Criterion (weight) | MCP server dials the agent | agent dials a hub |
|---|---|---|
| maintainability (30) | 4 | 3 |
| comparable tools (25) | 3 | 4 |
| process model fit (25) | 5 | 2 |
| no inbound agent port (10) | 3 | 4 |
| effort (10) | 4 | 2 |
| **Weighted total** | **3.90** | **3.00** |

- An agent that dials in needs a long-lived hub. Stdio MCP servers start and stop with each AI client, and several can run at once. The only long-lived local process is the web player process, which stops with its last MCP server unless `persistAfterMcpExit` is on (`player-runtime.ts:48`).
- When the MCP server dials the agent, any MCP server, stdio or HTTP, reaches any agent with no relay.

Flip check: no single weight change between 0 and 100 flips the winner. ROBUST.

Comparable tools: the player dials the server in Jellyfin MPV Shim (WebSocket to `/socket`) [DIRECT: jellyfin-apiclient-python `ws_client.py`] and in Squeezelite (SlimProto, TCP 3483) [DIRECT: lyrion.org SlimProto reference]. The controller dials the player in Plexamp headless (port 32500) [SINGLE-SOURCE: Plex staff forum post, 2022-06-04], MPD and Mopidy [DIRECT: MPD protocol docs, Mopidy HTTP docs]. Those servers are long-lived hubs, which this project's stdio MCP servers are not.

### Control transport

Criteria: maintainability 30, match with comparable tools 25, new dependencies or infrastructure 15, debuggability 15, fit with request and response tool calls 15.

| Criterion (weight) | REST plus SSE | WebSocket | gRPC | MQTT |
|---|---|---|---|---|
| maintainability (30) | 5 | 3 | 2 | 2 |
| comparable tools (25) | 4 | 4 | 1 | 2 |
| new deps or infra (15) | 5 | 3 | 1 | 1 |
| debuggability (15) | 5 | 3 | 2 | 3 |
| request and response fit (15) | 5 | 3 | 4 | 2 |
| **Weighted total** | **4.75** | **3.25** | **1.90** | **2.00** |

- REST plus SSE is what the web player process serves today, on `node:http` with no dependency. Every tool call is one request and one response, and the existing `/api/events` SSE stream covers a later push need.
- WebSocket needs the `ws` package (8.22.0, MIT, 2026-09-26) on the agent. Node has a built-in WebSocket client (stable in 22.4.0) and no server [DIRECT: nodejs.org globals, npm registry]. gRPC needs code generation, and MQTT needs a broker.

Flip check: no single weight change flips the winner. ROBUST.

Comparable tools: Plex Companion is plain HTTP with a `commandID` and a 30 s subscribe [DIRECT: plexinc/plex-media-player wiki, edited 2015-10-21]. Mopidy serves JSON-RPC at `/mopidy/rpc` and a WebSocket at `/mopidy/ws` [DIRECT: docs.mopidy.com stable]. Snapcast serves JSON-RPC over TCP 1705, HTTP `/jsonrpc` on 1780 and a WebSocket [DIRECT: snapcast `doc/json_rpc_api/control.md`, develop].

### Discovery

Criteria: maintainability 30, match with comparable tools 25, reliability across subnets, Docker bridges and Windows 20, security 15, setup UX 10.

| Criterion (weight) | static player list | mDNS discovery only | static list plus mDNS-assisted add |
|---|---|---|---|
| maintainability (30) | 5 | 3 | 3 |
| comparable tools (25) | 3 | 5 | 5 |
| reliability (20) | 5 | 2 | 5 |
| security (15) | 5 | 2 | 4 |
| setup UX (10) | 2 | 4 | 5 |
| **Weighted total** | **4.20** | **3.25** | **4.25** |

- The static player list stores each name, URL and token in the settings store. A discovered agent still needs a token, so discovery never removes that step.
- mDNS discovery only fails across VLANs and from a Docker bridge network.
- The mDNS-assisted add keeps the static list as the source of truth, and discovery only fills the config app form. It needs `bonjour-service` (1.4.4, MIT, 2026-07-28), since `@homebridge/ciao` only advertises [DIRECT: npm registry, ciao README].

Flip check: the smallest change that flips the winner is setup UX weight 10 to 8, which makes the static player list win. A one-point rise in the static list's comparable-tools score also flips it. FRAGILE.

Comparable tools: librespot registers `_spotify-connect._tcp` [DIRECT: librespot v0.8.0 `discovery/src/lib.rs`]. Snapcast advertises over mDNS and made it optional in 0.33.0 [DIRECT: snapcast changelog]. Roon uses SOOD multicast on 239.255.90.90:9003 [DIRECT: RoonLabs node-roon-api `sood.js`]. Squeezelite finds its server by autodiscovery unless `-s` names it [DIRECT: squeezelite `main.c` usage].

### Tool surface

Criteria: maintainability 30, match with comparable tools 25, LLM reliability 25, safety with several sessions 10, token cost 10.

| Criterion (weight) | per-call player argument | active player selection | both |
|---|---|---|---|
| maintainability (30) | 4 | 3 | 3 |
| comparable tools (25) | 5 | 3 | 4 |
| LLM reliability (25) | 5 | 2 | 4 |
| several sessions (10) | 5 | 2 | 3 |
| token cost (10) | 3 | 5 | 3 |
| **Weighted total** | **4.50** | **2.85** | **3.50** |

- The per-call player argument: an optional `player` enum on every playback tool and on `play_radio_station`, plus `list_players`. Each result echoes `player`, so the conversation carries the target forward.
- Active player selection: `select_player` sets hidden state. With the HTTP transport, sessions share one process and would race on that state. A forgotten selection plays music in the wrong room.
- The `player` property appears only when the `players` section lists at least one remote or Music Assistant Bridge is configured, so single-player users see no schema change.

Flip check: the smallest change that flips the winner is token cost weight 10 to 93, which makes active player selection win. ROBUST.

Default when no player is named: the `players.default` setting. With no setting, the local player when local mpv exists. With no local mpv and one remote, that remote. Otherwise the tool fails with a message that lists the player names.

Comparable tools: the Spotify Web API takes an optional `device_id`, and "If not supplied, the user's currently active device is the target" [DIRECT: developer.spotify.com start-a-users-playback]. Home Assistant actions name a `target` `entity_id`, one entity per player [DIRECT: home-assistant.io media_player].

### Stream credentials

Criteria: maintainability 30, match with comparable tools 25, security 25, correctness for long queues 10, scrobble attribution 10.

| Criterion (weight) | agent-held credentials | MCP-pushed token URLs | MCP-pushed JWT URLs |
|---|---|---|---|
| maintainability (30) | 5 | 3 | 2 |
| comparable tools (25) | 5 | 2 | 2 |
| security (25) | 4 | 1 | 2 |
| long queues (10) | 5 | 5 | 2 |
| scrobble attribution (10) | 5 | 2 | 2 |
| **Weighted total** | **4.75** | **2.35** | **2.00** |

- Agent-held credentials: the agent's own settings store holds a Navidrome login, and the agent signs its own URLs with today's code. No password and no Subsonic token crosses the LAN between the MCP server and the agent.
- MCP-pushed token URLs: each URL carries a `t` and `s` pair that never expires and grants the entire Subsonic API (see the token expiry finding under Feasibility). The pairs would sit in the agent's mpv playlist.
- MCP-pushed JWT URLs: each URL carries a 48 h bearer for the entire API, and a long queue fails once it expires.

Flip check: no single weight change flips the winner. ROBUST.

Within agent-held credentials, a per-player Navidrome API key replaces the password once Navidrome releases PR #6219. The agent detects it through `getOpenSubsonicExtensions`.

Comparable tools: Jellyfin MPV Shim logs in once and stores the access token, never the password, in `users.json` [DIRECT: jellyfin-mpv-shim v3.1.0 README and `clients.py`]. It sends the token in an mpv HTTP header by default [DIRECT: `player.py` `_apply_auth_headers`]. A Spotify Connect controller hands the device a credential blob encrypted with a Diffie-Hellman shared key, and the device logs in by itself [DIRECT: librespot v0.8.0 `discovery/src/server.rs`]. A Squeezelite player holds no credential, since LMS streams the audio to it [DIRECT: lyrion.org SlimProto reference].

### Agent API encryption

Criteria: maintainability 30, match with comparable tools 25, security 25, setup UX 10, effort 10.

| Criterion (weight) | HTTP with bearer, HTTPS through a reverse proxy | built-in TLS with a pinned self-signed cert | required TLS with operator certs |
|---|---|---|---|
| maintainability (30) | 5 | 3 | 3 |
| comparable tools (25) | 4 | 3 | 2 |
| security (25) | 3 | 5 | 5 |
| setup UX (10) | 5 | 3 | 1 |
| effort (10) | 5 | 2 | 3 |
| **Weighted total** | **4.25** | **3.40** | **3.05** |

- With agent-held credentials, the agent API carries the machine grant, song IDs, metadata and queue state. It carries no Navidrome password and no Subsonic token. A sniffed machine grant lets the holder control that agent's playback.
- The agent player target accepts `https://` URLs from day one, so a reverse proxy such as Caddy gives TLS without new code.
- Built-in TLS needs certificate generation. Node can parse X.509 but not create it, so it adds `selfsigned` (5.5.0, MIT, 2026-01-12) [DIRECT: npm registry].

Flip check: the security weight would have to rise from 25 to 68 before built-in TLS wins. ROBUST.

The agent API does not need TLS for the MVP. No password or Subsonic credential crosses that link, and the reverse-proxy path works at once. Built-in TLS with fingerprint pinning arrives with pairing.

Comparable tools: Mopidy has no authentication and is "by default only available from localhost" [DIRECT: docs.mopidy.com ext/http]. MPD sends its password in plaintext [DIRECT: MPD protocol docs]. Snapcast keeps SSL optional and made it an optional build in 0.33.0 [DIRECT: snapcast changelog and `snapserver.conf`]. Lyrion 9.2.0 had a flaw reachable without authentication in its default configuration [SINGLE-SOURCE: zeroscience.mk ZSL-2026-5991, 2026-06-05].

### Agent packaging

Criteria: maintainability 30, match with comparable tools 25, image size for MCP-only users 20, setup UX 15, effort 10.

| Criterion (weight) | separate agent image tag | mpv in the main image | no image, npm plus systemd only |
|---|---|---|---|
| maintainability (30) | 4 | 5 | 5 |
| comparable tools (25) | 4 | 3 | 3 |
| MCP-only image size (20) | 5 | 2 | 5 |
| setup UX (15) | 4 | 3 | 2 |
| effort (10) | 4 | 5 | 5 |
| **Weighted total** | **4.20** | **3.60** | **4.05** |

- The separate agent image tag is a second target in the same `Dockerfile`, such as `ghcr.io/blakeem/navidrome-mcp:<version>-agent`, on a trixie base for mpv 0.40. Its command is `navidrome-web`.
- mpv in the main image makes every MCP-only user pull mpv's dependency closure. In Debian, mpv hard-depends on FFmpeg, X11, Wayland, Vulkan, SDL2 and libplacebo, and `--no-install-recommends` cannot drop them [DIRECT: packages.debian.org bookworm mpv]. The added size is unmeasured [ABSENT].
- The native install (npm, `apt install mpv`, a systemd user unit) is needed in any case, since a user unit reaches the user's PipeWire session without a socket mount.

Flip check: the smallest change that flips the winner is setup UX weight 15 to 7, which makes the native install win. A one-point rise in the native install's comparable-tools score also flips it. Both changes sit inside the uncertainty of those inputs. FRAGILE.

Comparable tools: Plexamp headless ships as a Node tarball [SINGLE-SOURCE: pimylifeup guide]. Jellyfin MPV Shim ships through pip and Flatpak [INFERRED]. Snapcast ships Debian packages [INFERRED].

### Multiroom synchronization

Criteria: maintainability 30, match with comparable tools 25, user value 20, effort 15, fit with the agent design 10.

| Criterion (weight) | out of this item, Snapcast as a later item | Snapcast inside this item | own sync across agents |
|---|---|---|---|
| maintainability (30) | 5 | 3 | 1 |
| comparable tools (25) | 4 | 4 | 1 |
| user value (20) | 3 | 4 | 4 |
| effort (15) | 5 | 2 | 1 |
| fit with agents (10) | 4 | 2 | 2 |
| **Weighted total** | **4.25** | **3.30** | **1.70** |

- Snapcast synchronizes by giving each client a time sync and correcting drift by dropping or duplicating samples, "typically" below 0.2 ms [DIRECT: snapcast README, develop, release 0.35.0 2026-03-08]. Its default end-to-end buffer is 1000 ms [DIRECT: `snapserver.conf`].
- Snapcast replaces the agent model. One mpv writes PCM to the snapserver pipe, and snapclients play it in each room. The rooms then share one queue, which is a Snapcast group, not a named agent.
- Snapcast's control API documents no authentication [DIRECT: `control.md`].

Flip check: no single weight change flips the winner. ROBUST.

Comparable tools: Lyrion keeps sync groups on the server [INFERRED]. Roon aims "to be within 1ms" and groups zones of one type [DIRECT: help.roonlabs.com RAAT and zone articles]. Home Assistant exposes `join_players` and `group_members` [DIRECT: contributors.home-assistant.io media-player]. The starting list places grouped Sonos, AirPlay and Cast hardware under Music Assistant Bridge.

## Recommendation

**Agent runtime.** Use the web player agent mode. Run `navidrome-web` standalone on the agent machine with `webui.expose` and an `agent` settings section. The lifecycle, the engine, the tracker and the per-room web remote come with it.

**Remote seam.** Use the queue-op API. The MCP server keeps every Navidrome read and its active-library scope. The agent receives song IDs with metadata, station IDs and control operations, and never a URL.

**Connection direction.** The MCP server dials the agent. Each agent listens on its web player port, and any stdio or HTTP MCP server can reach it with no hub.

**Control transport.** Use REST under the versioned prefix `/api/agent/v1/`. Keep the SSE stream for the later web remote player switcher.

**Discovery.** Use the static player list in the settings store for the MVP. Whether to add the mDNS-assisted add later is an open decision.

**Tool surface.** Add an optional `player` enum to every playback tool and to `play_radio_station`, and add `list_players`. Each result echoes `player`. The default rule is `players.default`, then local, then the single remote.

**Stream credentials.** The agent holds its own Navidrome login and signs its own URLs. Prefer a per-player API key once Navidrome ships PR #6219.

**Agent API encryption.** Plain HTTP with the machine grant as a bearer token, plus `https://` URLs for a reverse proxy. Add built-in TLS with fingerprint pinning together with pairing.

**Agent packaging.** Ship the native install in the MVP. Whether the agent image tag follows is an open decision.

**Multiroom synchronization.** Out of this item. A Snapcast output mode can become its own roadmap item later.

## Open decisions

**Discovery after the MVP.** The options are the static player list alone and the static list plus mDNS-assisted add. The weighted totals are 4.20 and 4.25. A setup UX weight of 8 instead of 10 flips them. What tips it: how many of your agents sit on the same subnet as the machine running the config app, and whether one more runtime dependency (`bonjour-service`) is acceptable. Question: should the config app discover agents on the LAN and pre-fill the form, or is typing a URL fine?

**Agent image tag.** The options are the separate agent image tag and the native install alone. The weighted totals are 4.20 and 4.05. A setup UX weight of 7 instead of 15 flips them. What tips it: whether your agent machines run Docker already, and whether you accept supporting audio passthrough questions (ALSA device sharing, PulseAudio socket user IDs). Question: do you want a `-agent` image for your Pi, or is `npm install -g` plus a systemd unit enough?

## Plan overview

Steps in dependency order. Each step names the parts it adds or changes.

1. **The player target seam.** Requires nothing. Adds the player target interface and the local player target. Changes `src/tools/playback.ts` and the play path in `src/tools/radio.ts`, so each play tool resolves IDs and metadata and then calls a target. Local behavior and tool results stay unchanged.
2. **The agent API v1.** Requires the machine grant from Web UI Auth + Roles. Adds `src/webui/routes/agent.ts` and its dispatcher lines, a larger body cap for `enqueue`, the `/info` capability list, and the `agent` settings section. Sets the Subsonic client name (`SUBSONIC_CLIENT_NAME`, `src/constants/defaults.ts:32`) to `navidrome-mcp-<agent name>` on an agent, so Navidrome lists each room as its own player.
3. **The agent player target and the player registry.** Requires the player target seam and the agent API v1. Adds the HTTP client with timeouts and error mapping, the `players` settings section, the default rule, the config app fields and the env fallback variables.
4. **The tool surface.** Requires the agent player target and the player registry. Adds the `player` enum and the `player` echo, `list_players`, and the rule that registers playback tools when local mpv or any remote player exists.
5. **The native agent install and docs.** Requires the agent API v1. Adds a systemd user unit example, the README agent section, and updates to `docs/PLAYBACK-SPEC.md`, whose Out of Scope list names remote playback at line 289.
6. **The later releases.** Each requires the MVP. See Releases.

## Edge cases

| Edge case | Part it hits | Intended behavior |
|---|---|---|
| Scrobbling across machines | the scrobble tracker on the agent | Each agent's mpv has its own claim channel. No MCP server on another machine attaches to that mpv, so the agent's tracker is the only claimant and each play submits once (`scrobble-tracker.ts:46-49`). |
| Scrobble owner | the agent's Navidrome credentials | Plays count for the user whose credentials the agent holds. Use the same user as the MCP server so `list_recently_played` shows room plays. `/info` reports the user, and `list_players` shows it. |
| Scrobble timestamps | the scrobble tracker on the agent | The submission time is the agent's clock (`scrobble-tracker.ts:463`). A Pi without a real-time clock needs NTP before the first play. The native install docs say so. |
| Leases across machines | the lease route | Leases stay loopback-only (`player.ts:140`). The agent runs standalone, so `shouldStopForMcpExit` is false and no remote lease is needed. A remote MCP server's exit never quits the agent's mpv, since `index.ts:192-197` acts only on its local engine. |
| Agent offline | the agent player target | Reads time out after a few seconds and the tool fails with a message that names the player and says it is unreachable. `list_players` reports `reachable: false`. |
| Mutation timeout | the agent player target | `enqueue` and the control POSTs never retry (`retryPolicy: 'never'`), since a retried `append` doubles the queue. A timeout returns an "outcome unknown" message that points to `now_playing` with that player. |
| Agent restart | the web player process on the agent | A crash leaves the detached mpv playing, and the restarted process re-attaches (`main.ts:140-148`, `:240-245`). A service stop sends SIGTERM, which quits mpv by design (`main.ts:76-95`). |
| Version skew | the agent API v1 | `/info` returns `apiVersion` and a capability list. The agent player target refuses an operation the agent does not list, with a message that names both versions. A breaking change moves to `/api/agent/v2/`. |
| Large queue | the agent API `enqueue` route | 5000 tracks with metadata come to roughly 1 MB of JSON [INFERRED], and the web body cap is 16 KB (`http-helpers.ts:11`). The `enqueue` route uses the 4 MB cap of the MCP transport (`src/transport/http.ts:22`). |
| Library access mismatch | the agent's Navidrome user | The MCP server's active libraries decide the queue. An agent user without access to a library gets stream errors, which mpv skips with no report (PLAYBACK-SPEC.md:263). `/info` returns the agent user's library IDs, and the agent player target warns when they differ. |
| Radio | the agent API `radio` route | The agent resolves the station ID through its own client, as `playRadioStation` does (`src/tools/radio.ts:384`). The agent API never accepts a URL, so a stolen grant cannot make mpv open arbitrary URLs or local files. |
| Volume | the agent's mpv | Each agent has its own mpv volume, starting at 80 per spawn (`mpv-process.ts:112`). `set_volume` with `player` targets that mpv. |
| Two controllers on one agent | the engine mutation lock on the agent | Every remote mutation runs in the one agent process, so the engine lock serializes them (`playback-engine.ts:733-737`). The last write wins. |
| Web remote per agent | the browser routes on the agent | Each agent serves its own web remote. The agent is LAN-exposed, so its browser routes need Web UI Auth + Roles. The web remote on the MCP machine shows only the local player until the player switcher release. |
| DNS rebinding | the agent API | A LAN bind refuses a `Host` that is not an IP literal, a name of the machine or a `webui.allowedHosts` entry (`server.ts:119-129`). The required bearer grant also defeats a rebinding page, the same rule the MCP transport follows (`src/transport/http.ts:271-273`). |
| An agent that is the local mpv | the player registry | An agent URL that points at the MCP server's own machine would double-control one mpv. `/info` returns an instance ID, and the registry warns when it matches the local web player's ID. |
| Duplicate or reserved names | the player registry | Names are case-insensitive and unique. `local` is reserved. Config validation rejects a clash at load. |
| Token rotation | the agent player target | A 401 fails the tool with a message that names the player and the settings key to update. |
| No audio output on the agent | the agent API `/info` | A Docker agent with no device plays nothing and reports success (DOCKER.md:79-82). `/info` and `list_players` report `current-ao` from Audio-Device Selector, so the assistant sees the missing output. |
| Navidrome player records | Navidrome's player table | Navidrome matches a player by user, client name and user agent (`core/players.go`, `FindMatch`). One shared client name would merge every room into one Navidrome player, so each agent sends its own client name. |
| Queue in another room | the player targets | Each agent has its own mpv queue. Moving a queue between rooms is a later release. |

## Releases

**Named remote players (the MVP).**
- Capability: "play five random starred albums in the garage" from any MCP server, including the Docker image without mpv. `list_players`, `now_playing` and every transport tool take `player`.
- Parts: the player target seam, the agent API v1, the agent player target, the player registry, the `players` and `agent` settings sections, the `player` argument, `list_players`, the native agent install docs.
- Acceptance check: an MCP server in Docker with no mpv plays a search result on a Pi agent. The play scrobbles once. `now_playing` with `player: "garage"` reports the track. Stopping the agent makes the next tool call fail with a named-player message. Stopping the MCP server leaves the garage playing.
- Effort: 2 to 3 weeks [INFERRED].

**Agent image tag** (pending the open decision).
- Capability: `docker run` an agent on a Linux host with ALSA (`--device /dev/snd --group-add audio`) or a PulseAudio or PipeWire socket (`PULSE_SERVER`, same user ID as the host) [DIRECT: x11docker wiki, edited 2025-12-15].
- Parts: an `agent` target in `Dockerfile` on `node:22-trixie-slim` plus mpv, a second tag in `docker-release.yml`, audio health in `/info`, device listing and selection through the agent API.
- Acceptance check: the arm64 image plays through ALSA on a Raspberry Pi OS 64-bit host, and a missing device shows in `list_players`.
- Effort: 3 to 5 days [INFERRED].

**Pairing and built-in TLS.**
- Capability: the agent shows a short pairing code, and the config app on the MCP machine exchanges it for the machine grant and the certificate fingerprint. The agent API runs over HTTPS with the pinned certificate.
- Parts: a pairing route, a self-signed certificate per agent, fingerprint pinning in the agent player target, optional mDNS-assisted add (pending the open decision).
- Acceptance check: a fresh agent pairs without copying a token by hand, and a swapped certificate fails the connection.
- Effort: 1 to 2 weeks [INFERRED].

**Per-player Navidrome API keys.**
- Capability: the agent stores a revocable `nds_` key instead of a password, once Navidrome releases PR #6219.
- Parts: an `apiKey` field in the agent settings, feature detection through `getOpenSubsonicExtensions`, and `apiKey` in place of `u`, `t` and `s` in stream URLs and in the tracker's requests.
- Acceptance check: revoking the key in Navidrome stops that agent and no other.
- Effort: 2 to 4 days [INFERRED].

**Player switcher and queue transfer.**
- Capability: the web remote on any machine lists every player and controls a remote one. `transfer_playback` moves the queue and position from one player to another.
- Parts: a player picker in `src/webui/public/`, a proxy from the local web player process to the agent API, the transfer tool built on two player targets, optional `reportPlayback` so Navidrome's now-playing shows each room's position (the live server advertises `playbackReport`) [DIRECT: probe].
- Acceptance check: a phone on the desktop's web remote pauses the garage, and a transfer resumes the kitchen queue in the garage within 2 s of position.
- Effort: 1 to 1.5 weeks [INFERRED].

Rejected ideas:
- Exposing mpv's IPC over TCP with socat. mpv calls its IPC "explicitly insecure" and exposes `run`.
- MPD as the agent. Plaintext password, and signed URLs sit in a queue any MPD client reads.
- MCP-pushed signed URLs. A `t` and `s` pair never expires.
- gRPC and MQTT. A codegen step or a broker, with no comparable home-audio player using them.
- `select_player` with hidden active state. It races between HTTP sessions and hides the target from the conversation.
- Agents dialing a hub. Stdio MCP servers are not long-lived, so the hub would be the desktop web player process.
- Synchronized multiroom inside this item. Snapcast replaces the agent model, and Music Assistant Bridge covers grouped hardware.

## Dependencies

On other roadmap items:
- **Web UI Auth + Roles:** the machine grant kind, presented as `Authorization: Bearer <token>`, with the reserved `machine` role. This item extends that role with `agent.control` and `agent.read`. It does not need `player.lease`, since remote MCP servers never lease an agent. It needs a way to create a machine grant on the agent machine that shows the token once, and permissions on the browser routes, since every agent is LAN-exposed.
- **Audio-Device Selector:** device listing, device selection and the `current-ao` output state as playback engine operations, not only as MCP tools, so the agent API can expose them per player.
- **Music Assistant Bridge:** no requirement. It may implement the player target interface as its own target kind.

On external services:
- Navidrome. Tested against 0.62.0. The per-player API key needs the first release that contains PR #6219.
- mpv 0.36 or newer on agents for the radio station tag. Debian trixie ships 0.40.0.

On new npm packages:
- MVP: none. The agent API uses `node:http`, and the agent player target uses `fetch` through `fetchWithTimeout`.
- Pairing and built-in TLS: `selfsigned` 5.5.0, MIT, published 2026-01-12, about 18 million weekly downloads [DIRECT: npm registry].
- mDNS-assisted add, if chosen: `bonjour-service` 1.4.4, MIT, published 2026-07-28, about 14 million weekly downloads, advertises and browses [DIRECT: npm registry].

## Risks

Assume the feature shipped and failed.

- **Agents play nothing and report success.** Violated assumption: mpv reports a missing audio device as an error. Docker agents without a device go idle in silence (DOCKER.md:79-82).
- **An upgrade on one machine breaks control.** Violated assumption: the MCP server and its agents upgrade together.
- **The seam refactor regresses local playback.** Violated assumption: moving engine calls behind the player target is mechanical. `src/tools/playback.ts` holds intricate queue and metadata repair logic.
- **Music plays in the wrong room.** Violated assumption: the assistant names a player on each call, or the default fits.
- **Room plays vanish from the user's history.** Violated assumption: each agent logs in as the same Navidrome user as the MCP server.
- **A sniffed grant lets a LAN guest control a room.** Violated assumption: the LAN is trusted.
- **Users pick Music Assistant plus Squeezelite instead.** Violated assumption: users want this project's own agent on their room hardware.

Cheapest to guard against now: version skew. An `apiVersion` and a capability list in `/info`, checked by the agent player target before each operation, cost a few hours and protect every later release. Audio health in `/info` is next, once Audio-Device Selector exposes `current-ao`.

## Sources

Official docs:
- https://www.subsonic.org/pages/api.jsp (API 1.16.1, read 2026-10-17): token and salt authentication text, no expiry or replay rule.
- https://opensubsonic.netlify.app/docs/extensions/playbackreport/ (extension v1, modified 2026-03-14): `reportPlayback` for a later per-room now-playing.
- https://github.com/mpv-player/mpv/blob/master/DOCS/man/ipc.rst (master, read 2026-10-17): IPC socket types and the security warning.
- https://packages.debian.org/bookworm/mpv and https://packages.debian.org/trixie/mpv (0.35.1-4 and 0.40.0-3+deb13u1): mpv versions, arm64 availability, hard dependencies.
- https://hub.docker.com/v2/repositories/library/node/tags/22-bookworm-slim (updated 2026-10-06): base image sizes per architecture.
- https://github.com/mviereck/x11docker/wiki/Container-sound:-ALSA-or-Pulseaudio (edited 2025-12-15): ALSA and PulseAudio socket passthrough flags for the agent image.
- https://docs.pipewire.org/page_man_pipewire-pulse_1.html (PipeWire 1.6.9): the PulseAudio-compatible socket for PipeWire hosts.
- https://nodejs.org/api/globals.html#websocket (Node 22.4.0 stability note): built-in WebSocket client, no server.
- https://docs.mopidy.com/stable/api/http/ and https://docs.mopidy.com/stable/ext/http/ (stable, read 2026-10-17): JSON-RPC and WebSocket endpoints, no authentication.
- https://mpd.readthedocs.io/en/latest/protocol.html (latest, read 2026-10-17): plaintext password, partitions.
- https://lyrion.org/reference/slimproto-protocol/ and https://lyrion.org/reference/cli/general/ (Lyrion 9.1.x, read 2026-10-17): player-dials-server model, server-side streaming, CLI login.
- https://contributors.home-assistant.io/core/entities/media-player/ (read 2026-10-17): one entity per player, feature flags, `join_players`.
- https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback (read 2026-10-17): optional `device_id` with an active-device default, the model for the `player` argument.
- https://help.roonlabs.com/portal/en/kb/articles/raat and https://help.roonlabs.com/portal/en/kb/articles/architecture (undated): Core-owned queue, 1 ms sync target.
- https://github.com/plexinc/plex-media-player/wiki/Remote-control-API (edited 2015-10-21): Plex Companion commands, `commandID`, subscribe and poll.

Comparable projects' source code:
- https://github.com/jellyfin/jellyfin-mpv-shim/tree/v3.1.0 (v3.1.0, 2026-10-05): `clients.py` login and capability registration, `event_handler.py` Play command with item IDs, `player.py` token in an mpv header, `player_reporting.py` progress reports. The closest match for the agent's credential and queue model.
- https://github.com/jellyfin/jellyfin-apiclient-python/blob/master/jellyfin_apiclient_python/ws_client.py (master, v1.20.2 2026-10-14): WebSocket reconnect and keep-alive, a model for a later push channel.
- https://github.com/librespot-org/librespot/tree/v0.8.0 (v0.8.0, 2025-11-10): `discovery/src/lib.rs` mDNS registration, `discovery/src/server.rs` encrypted credential handoff, `connect/src/spirc.rs` device-owned queue. A model for pairing.
- https://github.com/navidrome/navidrome/blob/master/server/subsonic/middlewares.go (master, read 2026-10-17): `validateCredentials` with no expiry, `jwt` and `apiKey` handling.
- https://github.com/navidrome/navidrome/blob/master/core/players.go (master, read 2026-10-17): player matching by user, client and user agent.
- https://github.com/navidrome/navidrome/pull/6219 (merged 2026-09-28): per-player API keys for the agent credential release.
- https://github.com/pushingkarmaorg/python-plexapi/blob/master/plexapi/client.py and `gdm.py` (4.18.3, 2026-09-28): Plex playMedia with a server-side play queue, GDM discovery ports.
- https://github.com/RoonLabs/node-roon-api/blob/master/sood.js (master): SOOD multicast discovery.
- https://github.com/badaix/snapcast (0.35.0, 2026-03-08): `doc/json_rpc_api/control.md`, `server/etc/snapserver.conf`, `changelog.md` for the later Snapcast item.
- https://github.com/ralph-irving/squeezelite/blob/master/main.c (master): player naming with `-n`, server autodiscovery.

Specs and standards:
- RFC 6762 (Multicast DNS) and RFC 6763 (DNS-Based Service Discovery): the service records for an mDNS-assisted add.

Other:
- https://github.com/navidrome/navidrome/releases (v0.64.2, 2026-09-24): confirms the API key work is unreleased.
- https://pimylifeup.com/raspberry-pi-plexamp/ (modified 2026-05-13): Plexamp headless as a Node tarball on a Pi.
- https://forums.plex.tv/t/rpi-plexamp-local-control/795580 (2022-06-04, Plex staff): Plexamp headless listens on port 32500.
- https://www.zeroscience.mk/advisories/ZSL-2026-5991.html (2026-06-05): an unauthenticated default in Lyrion, a reason to require the grant on every agent route.
- https://registry.npmjs.org/ (read 2026-10-17): versions, licenses and publish dates for `bonjour-service`, `@homebridge/ciao`, `ws`, `selfsigned`.
- Live probe of the user's Navidrome 0.62.0 (2026-10-17, read-only): `t` and `s` replay accepted, JWT lifetime 172800 s, extension list without `apiKeyAuthentication`.
