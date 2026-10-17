# Music Assistant Bridge

**Status (2026-10-17):** Later, undecided. See [README.md](README.md#music-assistant-bridge) for the related party chat idea.

## Verdict

BUILD. Music Assistant (MA) 2.10.7 has a token-authenticated HTTP JSON-RPC endpoint, and its OpenSubsonic provider keys every track by the Navidrome song ID, so the bridge can hand MA a list of song IDs as provider URIs with no search by name [DIRECT: MA 2.10.7 source]. The bridge keeps the existing search and one-shot play tools, and it gives the Docker image, which has no mpv, a way to play audio [DERIVED: docs/DOCKER.md, src/tools/handlers/registry.ts:103]. MVP effort is 1.5 to 3 weeks and the full roadmap is 4 to 6 weeks [INFERRED].

## Scope

```
IN SCOPE:      play Navidrome songs, albums, playlists and search results on an MA player,
               transport control of an MA player (pause, resume, next, previous, volume, seek),
               now playing and queue reads for an MA player, list of MA players and groups,
               MA settings (URL, token) in the settings store and the settings GUI,
               a backend-neutral player target layer that Remote Player Agent can reuse
OUT OF SCOPE:  MA library browsing or search (Navidrome-MCP search tools already cover the library),
               MA player configuration, DSP, crossfade settings (MA's own UI owns these),
               controlling MA players from the web remote (MA ships its own web UI and apps),
               podcasts and audiobooks (Navidrome-MCP has no podcast tools),
               installing or running MA (a separate Python server)
BOUNDARY CASE: radio stations → IN (release 2), because play_radio_station is an existing play tool
               and MA can play a Navidrome station by URI
BOUNDARY CASE: queue transfer between the local mpv player and an MA player → IN (release 3),
               because transfer is an operation on two playback targets
BOUNDARY CASE: Navidrome play history for MA plays → OUT of the bridge, IN the docs, because MA's
               own Subsonic Scrobbler plugin submits those plays (see Feasibility)
```

Rule for new cases: a capability is in scope when it acts on a playback target with Navidrome content. Anything that configures MA itself stays in MA.

## Feasibility

No MA instance was available. Every claim about live MA behavior in this file comes from MA's source and docs, and it is untested.

| Requirement | Result | Evidence |
|---|---|---|
| MA exposes a documented API a Node process can call with a token | Verified. `POST /api` takes `{"command", "args"}` with `Authorization: Bearer <token>` and returns the bare result as JSON. `GET /info` returns the version without auth. | [DIRECT: MA 2.10.7 `controllers/webserver/controller.py` routes and `_handle_jsonrpc_api_command`] |
| Another LAN host can reach that API | Verified. MA binds `0.0.0.0:8095`. The HA app runs with host networking. Port 8095 requires a token on every install, the HA app included. Only the internal ingress site on port 8094 signs users in from HA headers. | [DIRECT: 2.10.7 `constants.py`, add-on `config.yaml`, webserver README] |
| MA can address a Navidrome track by its Navidrome song ID | Verified. The OpenSubsonic provider sets `item_id=sonic_song.id` and `provider=instance_id`. The URI is `{instance_id}://track/{item_id}`. | [DIRECT: MA 2.10.7 `providers/opensubsonic/parsers.py:142-153`, models 1.1.205 `helpers.create_uri`] |
| Navidrome's REST song ID equals its Subsonic song ID | Verified on the live server. Both IDs matched for the sampled songs, and they are 22-character alphanumeric strings. | [DIRECT: Navidrome 0.62.0, read-only check 2026-10-17] |
| `play_media` takes a list of URIs and an enqueue mode | Verified. `media` accepts a list of strings. `option` is one of `play`, `replace`, `next`, `replace_next`, `add`. | [DIRECT: MA 2.10.7 `player_queues/controller.py:487-500`, models `QueueOption`] |
| Several Navidrome providers can be told apart | Verified. The provider is `multi_instance`, and each instance ID is `opensubsonic--<8 random chars>`. A URI with the bare domain picks the first available instance. | [DIRECT: manifest.json, dev `config/providers.py:579`, `mass.py get_provider`] |
| MA reaches Sonos, AirPlay, Cast and WiiM hardware | Verified. The `sonos`, `airplay`, `chromecast`, `wiim`, `dlna`, `heos`, `bluesound` and `musiccast` player providers have stage `stable` in 2.10.7. | [DIRECT: 2.10.7 provider manifests] |
| Player operations exist | Verified. `players/all`, `players/cmd/volume_set`, `player_queues/pause`, `play`, `next`, `previous`, `seek`, `items`, `clear`, `play_index`, `move_item`, `delete_item`, `transfer`, `players/cmd/group`. | [DIRECT: 2.10.7 `player_queues/controller.py`, `players/controller.py`] |
| No new npm dependency | Verified. Global `fetch` covers the HTTP endpoint. `undici` 7.28.0, already a dependency, exports `WebSocket` if the WebSocket API is chosen later. | [DIRECT: package.json:76, node_modules/undici/index.js:193] |
| A least-privilege MA account works | Partly. The guest role holds every scope the bridge needs, but MA refuses long-lived tokens for guest accounts. The bridge needs a user-role account. | [DIRECT: 2.10.7 `helpers/auth_middleware.py:37-47`, `auth.py:1130`] |
| Curated order survives the handoff | Conditional. MA applies the queue's shuffle setting to a batch of tracks unless the call passes `shuffle: false`. | [DIRECT: dev `player_queues/README.md` invariants, `queue_loader.py`] |
| Plays reach Navidrome's play counts | Refuted by default. The OpenSubsonic provider's `on_played` returns early for tracks. The separate Subsonic Scrobbler plugin (stage stable) submits them. | [DIRECT: 2.10.7 `sonic_provider.py on_played`, `providers/subsonic_scrobble`] |
| A 500-song list plays in acceptable time | Untested. MA resolves the list one URI at a time. A synced library resolves each URI from MA's database. An unsynced one costs a Subsonic `getSong` per track. | [DIRECT: dev `queue_loader.py:_handle_play_media`, `music/media/base.py get`] [INFERRED: timing] |

Starting-list claims:

- "MA already reads Navidrome via its Subsonic provider" held. The provider page says it was tested against Navidrome [DIRECT: music-assistant.io/music-providers/subsonic].
- "Hand the queue to an MA player through MA's API" held, with the `shuffle: false` condition above.
- "This puts Navidrome-MCP on Sonos, AirPlay, Cast and WiiM hardware" held.
- "2 to 4 weeks" held only in part. The MVP is shorter and the full roadmap is longer (see Releases).

## Current system

The parts the bridge touches, with the direction a play request flows:

```
LLM client
  │ MCP tool call (stdio or HTTP transport)
  ▼
┌─ MCP server process ──────────────────────────────────────────────────────────┐
│ tool registry              src/tools/handlers/registry.ts                     │
│   │ registers the playback category only when mpv was found (line 103)        │
│   ▼                                                                           │
│ playback tool category     src/tools/handlers/playback-handlers.ts            │
│ radio tool category        src/tools/handlers/radio-handlers.ts (gate :299)   │
│   │ play tools respawn the web player first (PLAYBACK_STARTERS, line 19)      │
│   ├──► web player process  src/web/ (separate process, drives mpv only)       │
│   ▼                                                                           │
│ playback tool functions    src/tools/playback.ts                              │
│   ├──► search functions         src/tools/search/                             │
│   ├──► queue source readers     src/tools/queue-sources.ts                    │
│   ├──► queue orderer            src/tools/queue-order.ts                      │
│   │      (ordered song IDs + metadata)                                        │
│   └──► playback engine          src/services/playback/playback-engine.ts      │
│          singleton (line 1092), enqueue(songIds, mode, metadata) (line 256)   │
│                                                                               │
│ settings store             src/config/store.ts (SettingsFileSchema, :27)      │
│ config mapper + schema     src/config/map-config.ts (features, :88)           │
│                            src/config/schema.ts                               │
│ env fallback               src/config/env-settings.ts                         │
│ settings GUI               src/config-app/                                    │
│ fetch helper               src/utils/fetch-with-timeout.ts                    │
│ logger                     src/utils/logger.ts                                │
└──────────────┬──────────────────────────────────────┬─────────────────────────┘
               │ JSON-IPC (pipe or socket)             │ REST /api + Subsonic /rest
               ▼                                       ▼
             mpv ──────── HTTP /rest/stream ──────► Navidrome
```

Facts about these parts that shape the design:

- At the playback tool functions, every play tool resolves songs first and calls the playback engine last. `playSongs` calls `fetchSongMetadata` then `playbackEngine.enqueue` [DIRECT: src/tools/playback.ts:299-308]. That last call is the one seam the bridge needs.
- At the tool registry, `config.features.playback` means "an mpv binary was found" [DIRECT: src/config/map-config.ts:92]. The Docker image has no mpv, so it registers no play tools [DIRECT: docs/DOCKER.md].
- At the playback tool category, the play tools respawn the web player process before they run [DIRECT: playback-handlers.ts:378-380]. The web player process only drives mpv.
- At the settings store, secrets already live in plaintext with mode 0600 (`navidrome.password`, `transport.authToken`) [DIRECT: src/config/store.ts:118-124].
- At the logger, JWTs, `Bearer` values and keys ending in `token` are redacted [DIRECT: src/utils/logger.ts:14-37]. MA tokens are JWTs [DIRECT: MA webserver README].
- At the fetch helper, `respectProxy` defaults off for LAN calls and `nonIdempotent` marks writes whose timeout leaves an unknown outcome [DIRECT: src/utils/fetch-with-timeout.ts:62-64].

## Integration point

The current system extended with the new parts (marked NEW):

```
LLM client
  │ play_songs_search {genre: "Jazz", player: "Kitchen"}
  ▼
playback tool category      + player parameter, + list_players tool (NEW)
  ▼
playback tool functions     resolve songs (unchanged)
  │ ordered song IDs + metadata
  ▼
player registry             src/services/players/registry.ts (NEW)
  │ resolves the player argument to one PlayerTarget
  ├──► local mpv target     src/services/players/local-target.ts (NEW adapter)
  │      └──► playback engine ──► mpv ──► Navidrome
  │
  └──► MA player target     src/services/music-assistant/ma-target.ts (NEW)
         ├──► MA provider resolver   src/services/music-assistant/provider-resolver.ts (NEW)
         │      finds the OpenSubsonic instance ID that serves this Navidrome
         └──► MA HTTP client         src/services/music-assistant/ma-client.ts (NEW)
                │ POST /api {"command":"player_queues/play_media",
                │            "args":{"queue_id", "media":[URIs], "option", "shuffle":false}}
                ▼
┌─ MA server (2.10.x, separate host or container) ───────────────────────────┐
│ MA JSON-RPC endpoint         POST /api, GET /info                          │
│   ▼                                                                        │
│ MA player queues controller  queue_id = player_id                          │
│   ▼                                                                        │
│ MA music controller          URI → library track (database first)          │
│   ▼                                                                        │
│ MA OpenSubsonic provider instance   opensubsonic--<8 chars>                │
│   ▼                                                                        │
│ MA streams controller ──► MA player providers (sonos, airplay, chromecast, │
│                           wiim, dlna, ...)                                 │
└───────┬──────────────────────────────────────────────┬─────────────────────┘
        │ Subsonic getSong + stream (MA's own account)  │ native protocols
        ▼                                               ▼
    Navidrome                                        speakers

settings store  + musicAssistant section {url, token, providerInstanceId?} (NEW)
                + players.default (NEW, shared with Remote Player Agent)
```

The MCP server process never carries audio to MA. The MA server fetches audio from Navidrome with the credentials configured in its own OpenSubsonic provider.

Where each new part lives and why:

- **The player target interface and the player registry** go in `src/services/players/`. They are backend-neutral, the playback tool functions are their only caller, and Remote Player Agent plugs a third target into the same registry.
- **The local mpv target** goes in `src/services/players/`. It is a thin adapter that forwards each call to the playback engine, so the engine stays unchanged.
- **The MA HTTP client, the MA provider resolver and the MA player target** go in `src/services/music-assistant/`. This mirrors `src/services/playback/`, one folder per player backend. They do not go in `src/utils/` beside the Last.fm and MusicBrainz clients, because the MA code holds state (the resolved instance ID) and implements a player backend, not a metadata lookup.
- **The player schema** goes in `src/schemas/validation.ts`, per the established schema pattern.
- **The `musicAssistant` settings section** goes through the existing chain: `src/config/store.ts`, `schema.ts`, `map-config.ts`, `env-settings.ts`, and a form section in `src/config-app/`. A new `features.musicAssistant` flag sits beside `features.playback`. The tool registry gate becomes `playback || musicAssistant`. The `players.default` setting belongs to the `players` settings section that Remote Player Agent defines, since it names a player of any backend. Whichever item ships first adds that section.

The shared interface Remote Player Agent needs is the **player target interface** (`PlayerTarget`). Its contract, without its design:

```ts
interface PlayerTarget {
  readonly targetId: string;            // 'local', 'ma:<player_id>', later 'agent:<name>'
  describe(): Promise<PlayerDescription>;  // name, available, state, volume, capabilities
  enqueue(songIds: readonly string[], mode: EnqueueMode, metadata?: readonly QueueTrackMetadata[]): Promise<EnqueueResult>;
  pause(): Promise<TransportResult>;
  resume(): Promise<TransportResult>;
  next(): Promise<TransportResult>;
  previous(): Promise<TransportResult>;
  setVolume(level: number): Promise<number>;
  nowPlaying(): Promise<NowPlayingSnapshot>;
}
```

Release 2 adds queue reads and edits, seek and radio to it. Release 3 adds transfer.

Each existing tool maps to one MA command through the MA player target [DIRECT: 2.10.7 controllers]:

| Existing tool (file) | MA command | Release |
|---|---|---|
| `play_songs`, `play_albums`, `play_playlist`, `play_songs_search`, `play_albums_search` (playback-handlers.ts) | `player_queues/play_media` with `queue_id`, `media` (URI list), `option`, `shuffle: false` | MVP |
| `pause`, `resume`, `next`, `previous` | `player_queues/pause`, `play`, `next`, `previous` | MVP |
| `set_volume` | `players/cmd/volume_set`, or `players/cmd/group_volume` for a group | MVP |
| `now_playing` | `player_queues/get` (`current_item`, `elapsed_time`, `state`) | MVP |
| `list_players` (new) | `players/all` | MVP |
| `get_play_queue` | `player_queues/items` (`limit` up to 500, `offset`) | 2 |
| `clear_play_queue`, `play_queue_index`, `seek` | `player_queues/clear`, `play_index`, `seek` (absolute seconds) | 2 |
| `move_in_play_queue`, `remove_from_play_queue` | `player_queues/move_item` (`queue_item_id`, `pos_shift`), `delete_item` (`item_id_or_index`) | 2 |
| `shuffle_play_queue` | `player_queues/shuffle` (a persistent toggle, not a one-time reorder) | 2 |
| `play_radio_station` (radio-handlers.ts) | `player_queues/play_media` with a radio URI | 2 |
| `transfer_playback`, `group_players`, `ungroup_players` (new) | `player_queues/transfer`, `players/cmd/group`, `players/cmd/ungroup` | 3 |
| `playback_status` | none, it reports on mpv only | stays local |
| `get_saved_queue`, `save_queue`, `clear_saved_queue` (queue-management.ts) | none, they act on Navidrome's saved queue, not on a player | unchanged |

## Options

Each decision defines its criteria and weights first, then fills one option column at a time. Scores run from 1 (poor) to 5 (best). Maintainability and the match with popular comparable tools carry the most weight, per the brief. "LLM ergonomics" means one tool call per intent with no song ID list passed through the model's context, which this project already chose for its play tools [DIRECT: docs/PLAYBACK-SPEC.md, "Why search-driven tools are separate"].

### Bridge path

How Navidrome audio reaches networked speakers. Five options:

- **The MA bridge**: Navidrome-MCP calls MA's API with provider URIs.
- **The HA bridge**: Navidrome-MCP calls Home Assistant's REST API (`music_assistant.play_media` or `media_player.play_media`). Navidrome content still needs MA URIs, or raw stream URLs with credentials.
- **The direct protocol senders**: Navidrome-MCP speaks Cast, Sonos, AirPlay and UPnP itself from Node.
- **The Navidrome jukebox**: Subsonic `jukeboxControl`. It plays through mpv on the Navidrome host's own sound devices. This fails the goal of reaching networked speakers, and it scores below as a reference.
- **The two-server setup**: no code. The user attaches MA's own MCP server plugin beside Navidrome-MCP, and the LLM passes song IDs from one to the other.

| Criterion (weight) | MA bridge | HA bridge | Direct protocol senders | Navidrome jukebox | Two-server setup |
|---|---|---|---|---|---|
| Maintainability (0.25) | 4 | 3 | 1 | 5 | 5 |
| Match with comparable tools (0.20) | 5 | 4 | 2 | 2 | 4 |
| LLM ergonomics (0.20) | 5 | 4 | 5 | 5 | 1 |
| Device coverage (0.15) | 5 | 5 | 2 | 1 | 5 |
| User setup burden (0.10) | 2 | 1 | 5 | 3 | 2 |
| Build effort (0.05) | 3 | 4 | 1 | 4 | 5 |
| Playback fidelity (0.05) | 4 | 4 | 2 | 2 | 4 |
| **Weighted total** | **4.30** | **3.60** | **2.60** | **3.40** | **3.65** |

Score notes, one option at a time:

- MA bridge: one upstream API with a written versioning policy (see Risks). Setup needs MA, its OpenSubsonic provider and a token. Coverage is every stable MA player provider.
- HA bridge: two upstreams, HA and MA. `music_assistant.play_media` takes a list in `media_id` [DIRECT: HA 2026.10.2 `music_assistant/services.py`, `EnsureList`]. HA then checks every URI with a separate `verify_item_uri` call before one `play_media` [DIRECT: HA `media_player.py`]. `media_player.play_media` takes one ID per call [DIRECT: HA action docs]. Setup needs both HA and MA. Raw stream URLs through `media_player.play_media` would leak the Navidrome Subsonic token into HA.
- Direct protocol senders: four protocol stacks in Node. The Cast and DLNA packages are stale (`castv2-client` 1.2.0 from 2016, `upnp-mediarenderer-client` 1.4.0 from 2020) or new single-release packages. `@svrooij/sonos` is maintained. The AirPlay packages take PCM, so Node would also decode audio, and none documents AirPlay 2 multiroom sync [DIRECT: npm registry and READMEs, 2026-10-17]. Every speaker-fetched URL would carry Subsonic auth parameters [INFERRED].
- Navidrome jukebox: plays only on the Navidrome host's sound devices. `Jukebox.Enabled` defaults to false and `Jukebox.AdminOnly` to true [DIRECT: Navidrome `conf/configuration.go`, master]. The live server answers `jukeboxControl` with HTTP 501 [DIRECT: Navidrome 0.62.0].
- Two-server setup: MA's MCP server plugin first shipped in MA 2.9.0 (2026-06-10) [DERIVED: absent at tag 2.8.0, present at 2.9.0]. It is stage `experimental`, v0.17.0 in MA 2.10.7 and v2.2.2 on dev, and it serves Streamable HTTP only [DIRECT: plugin manifest and `VERSION`, music-assistant.io/plugins/fastmcp-server]. It exposes three meta-tools (`search_tools`, `get_tool_schema`, `call_tool`) over MA's commands [DIRECT: dev `meta_discovery.py`]. The LLM must find the OpenSubsonic instance ID, build each URI and pass every song ID through its context. A community server with a direct list-taking play tool, such as `davidpadbury/music-assistant-mcp` (3 stars, last push 2026-01-19), raises the LLM ergonomics score to 2 and the total to 3.85, and the winner holds [SINGLE-SOURCE: GitHub].

Flip check: the smallest change that flips the winner is LLM ergonomics weight 0.20 to 0.04, which makes the two-server setup win. The user already chose one-shot play tools over list-then-play, so the uncertainty in that weight is far smaller than 0.16. ROBUST.

How comparable tools made the same decision: Home Assistant's MA integration calls MA's API through the `music-assistant-client` library and implements no speaker protocol itself [DIRECT: HA core `music_assistant/manifest.json`, `media_player.py`]. MA implements every speaker protocol in its own Python player providers, so clients do not [DIRECT: 2.10.7 provider manifests]. The LLM DJ projects that reach speakers also go through MA. `swiftbird07/AI-Radio`, which became MA's `ai_radio` plugin, adds tracks by URI through `music-assistant-client`, and `asherflynt/tidesync-dj` pushes playback through MA [SINGLE-SOURCE: GitHub READMEs]. No Navidrome MCP server that targets speakers was found [ABSENT].

### MA transport

How the MA HTTP client talks to the MA server. Three options:

- **The HTTP JSON-RPC client**: one stateless `POST /api` per command, built on the existing fetch helper.
- **The WebSocket session client**: a persistent `/ws` session with an `auth` command, `message_id` correlation and event messages.
- **A community npm client**: an existing JavaScript package.

| Criterion (weight) | HTTP JSON-RPC client | WebSocket session client | Community npm client |
|---|---|---|---|
| Maintainability (0.30) | 5 | 3 | 2 |
| Match with MA's guidance and comparable clients (0.25) | 4 | 5 | 2 |
| Error detail (0.15) | 2 | 5 | 3 |
| Live state events (0.05) | 1 | 5 | 3 |
| Build effort (0.15) | 5 | 3 | 4 |
| New dependencies (0.10) | 5 | 5 | 1 |
| **Weighted total** | **4.10** | **4.10** | **2.40** |

Score notes:

- HTTP JSON-RPC client: MA's API docs page says the HTTP API is "Perfect for one-off commands without needing real-time updates" [DIRECT: 2.10.7 `helpers/resources/api_docs.html`]. MCP tool calls are one-off commands. Error detail is weak. In 2.10.7 only permission errors (403) and invalid data (400) carry text, and other MA errors return HTTP 500 "Internal server error" [DIRECT: 2.10.7 `_handle_jsonrpc_api_command`]. The dev branch adds HTTP 404 with text for an unavailable player [DIRECT: dev `webserver/controller.py`].
- WebSocket session client: the same page labels it "WebSocket API (Recommended)" for applications that need live updates. The Home Assistant integration, the official Python client and MA's frontend all use it [DIRECT: HA manifest, `music_assistant_client/connection.py`, frontend `websocket-transport.ts`]. It returns `error_code` and `details` for every error [DIRECT: models `ErrorResultMessage`]. It adds a connection lifecycle, reconnects and an auth step to the MCP server process.
- Community npm client: MA's docs say a dedicated TypeScript client "is in development" and point to the frontend code as the reference [DIRECT: api_docs.html]. The one unofficial client, `music-assistant-client` on npm, has a single version (0.1.0, 2026-09-26, MIT), about 23 weekly downloads, and targets MA 2.10.4 [SINGLE-SOURCE: npm registry]. Its error and event handling were not read, so those two scores are 3.

Flip check: the two top options tie at 4.10. Any change in the maintainability or comparable-tools weight flips the winner. FRAGILE. This decision is listed under Open decisions.

How comparable tools made the same decision: the MA clients that were read (Home Assistant, the Python client, MA's frontend) use the WebSocket API, and each one shows or reacts to live player state. No request-and-response MA client was found to compare against [ABSENT].

### Tool surface

How the LLM selects an MA player. Two options:

- **The player parameter**: an optional `player` argument on the existing play and transport tools, plus one new `list_players` tool.
- **The separate MA tool set**: new tools such as `ma_play_songs`, `ma_pause`, `ma_now_playing` beside the existing mpv tools.

| Criterion (weight) | Player parameter | Separate MA tool set |
|---|---|---|
| Maintainability (0.30) | 4 | 2 |
| Match with comparable tools (0.25) | 5 | 2 |
| LLM tool-choice clarity (0.20) | 4 | 2 |
| Regression risk to the mpv path (0.15) | 2 | 5 |
| Build effort (0.10) | 2 | 4 |
| **Weighted total** | **3.75** | **2.65** |

Score notes:

- Player parameter: one tool per verb and one code path per verb. The cost is a refactor of the playback tool functions behind the player target interface, which touches the 19 playback tools and their tests.
- Separate MA tool set: about 11 near-duplicate tools beside the current 72, with duplicated schemas and descriptions. `play_songs` beside `ma_play_songs` gives the model two tools for one intent.

Flip check: the smallest change that flips the winner is regression risk weight 0.15 to 0.52, which makes the separate MA tool set win. That change is far larger than the uncertainty in the weight. ROBUST.

How comparable tools made the same decision: Spotify's Web API takes an optional `device_id` on `PUT /me/player/play`, and "If not supplied, the user's currently active device is the target" [DIRECT: developer.spotify.com, read 2026-10-17]. Home Assistant targets every `media_player` action at an `entity_id`. MA itself passes `queue_id` or `player_id` to every player command [DIRECT: 2.10.7 controllers]. Subsonic's `jukeboxControl` is the one separate-endpoint design, and it addresses one implicit device.

### Track handoff form

How the MA player target names each song to MA. Three options:

- **The provider URI list**: `opensubsonic--<instance>://track/<songId>` per song.
- **The name search**: MA's `music/search` or `music/item_by_name` per song.
- **The raw stream URL list**: Navidrome `/rest/stream?id=...` URLs with Subsonic auth parameters, played by MA's builtin provider.

| Criterion (weight) | Provider URI list | Name search | Raw stream URL list |
|---|---|---|---|
| Correct identity (0.35) | 5 | 2 | 5 |
| Credential safety (0.20) | 5 | 5 | 1 |
| Maintainability (0.20) | 4 | 3 | 3 |
| Metadata on the player (0.15) | 5 | 5 | 2 |
| Setup burden (0.10) | 2 | 2 | 5 |
| **Weighted total** | **4.50** | **3.25** | **3.35** |

Score notes: the provider URI list needs MA's OpenSubsonic provider to point at this Navidrome. The name search fails on duplicate titles and versions. The raw stream URL list stores a replayable Subsonic token and salt in MA's queue, where MA's UI and logs show it.

Flip check: the smallest change that flips the winner is setup burden weight 0.10 to 0.49, which makes the raw stream URL list win. ROBUST.

How comparable tools made the same decision: Home Assistant's MA integration passes URIs first and falls back to a name lookup only when the string is not a URI [DIRECT: HA core `media_player.py _async_handle_play_media`]. MA's own docs use `library://track/456` URIs in the `play_media` example [DIRECT: api_docs.html]. MA's LLM voice script blueprint passes track names separated by `;` [DIRECT: `music-assistant/voice-support` `llm_voice_script.yaml`, version 20250526]. A voice assistant holds no provider IDs, while Navidrome-MCP holds the exact song IDs, so the name path does not apply here.

### Provider instance discovery

How the MA provider resolver finds the OpenSubsonic instance ID. Three options:

- **The probe-track check**: list the visible `opensubsonic` providers (`providers` command), resolve one known Navidrome song ID through each with `music/item_by_uri`, and keep the instance whose answer matches Navidrome's title and duration.
- **The configured instance ID**: the user copies the instance ID from MA's settings.
- **The base URL match**: read each instance's `baseURL` setting and compare it with `navidrome.url`.

| Criterion (weight) | Probe-track check | Configured instance ID | Base URL match |
|---|---|---|---|
| Correctness (0.40) | 5 | 3 | 3 |
| Setup burden (0.25) | 5 | 2 | 5 |
| Maintainability (0.20) | 4 | 5 | 2 |
| Scope needed by the token (0.15) | 5 | 5 | 3 |
| **Weighted total** | **4.80** | **3.45** | **3.30** |

Score notes: the probe-track check proves that the instance resolves this server's IDs, and it needs only `library.read` and `providers.read`. The base URL match fails when MA reaches Navidrome by another address (a container hostname against a LAN IP). The provider reads `baseURL` from setup data through `get_setup_value`, not from its regular config values [DIRECT: 2.10.7 `sonic_provider.py:193-217`], and reading provider config needs `config.providers.read`, a scope the guest role lacks [DIRECT: 2.10.7 `auth_middleware.py:37-47`].

Flip check: no weight inside 0 to 1 flips the winner. The configured instance ID would need maintainability weight 0.20 to 1.55. ROBUST. The recommendation keeps the configured instance ID as an optional override.

## Recommendation

- **Bridge path: the MA bridge.** It is the only option that reaches every target speaker type and keeps the one-shot play tools. MA already maintains the speaker protocols, so this project maintains one API client.
- **MA transport: the HTTP JSON-RPC client for the MVP.** The MVP sends one-off commands, which is the use MA's own docs name for the HTTP API. The MA HTTP client exposes one `call(command, args)` function, so a later WebSocket session can replace it inside that one module. This is an open decision.
- **Tool surface: the player parameter**, plus a `list_players` tool. A call without `player` uses `players.default` when set, otherwise `local` when mpv exists, otherwise it fails with a message that tells the model to call `list_players`. Existing users without MA see no change. A `player` value accepts `local`, an MA `player_id` or an exact MA display name.
- **Track handoff form: the provider URI list**, always with the full instance ID, never the bare `opensubsonic` domain, and always with `shuffle: false`. The playback tool functions already shuffle with Fisher-Yates.
- **Provider instance discovery: the probe-track check**, cached per process, with `musicAssistant.providerInstanceId` as an override when two instances serve the same Navidrome.

## Open decisions

**MA transport.** The HTTP JSON-RPC client and the WebSocket session client tie.

- What tips it toward the WebSocket session client: a later need for pushed MA player state, such as MA players in the web remote (out of scope in this file), or typed MA error codes in tool results before MA 2.11 ships the HTTP 404 for unavailable players.
- What tips it toward the HTTP JSON-RPC client: no long-lived connection, reconnect logic or auth step inside the MCP server process.
- Question for the user: should the web remote ever show or control MA players? If no, take the HTTP JSON-RPC client. If yes, take the WebSocket session client from the start, so the MA client is not written twice.

## Plan overview

Build steps in dependency order:

```
settings section        → requires nothing
MA HTTP client          → requires settings section
MA provider resolver    → requires MA HTTP client
player target interface + local mpv target → requires nothing
MA player target        → requires MA HTTP client, MA provider resolver, player target interface
player target registry  → requires player target interface, local mpv target, MA player target
tool changes            → requires player target registry, settings section
docs                    → requires tool changes
```

1. **Settings section.** Add `musicAssistant {url, token, providerInstanceId}` and `players.default` (unless Remote Player Agent already added it) to the settings store, the config schema, the config mapper and the env fallback (`MUSIC_ASSISTANT_URL`, `MUSIC_ASSISTANT_TOKEN`). Add `features.musicAssistant`, true when the URL and token are set. Add a form section with a Test button to the settings GUI. The Test button calls `GET /info` and `players/all`.
2. **MA HTTP client.** `call(command, args)` over the fetch helper, direct (no proxy), with `nonIdempotent: true` and no retry for play commands. Map 400, 401, 403, 404, 500 and 503 to messages that name the cause and the settings key. `serverInfo()` reads `GET /info`.
3. **MA provider resolver.** Implement the probe-track check. Cache the instance ID per process. Drop the cache when `play_media` fails, then resolve once more.
4. **Player target interface and local mpv target.** Move the playback engine calls out of the playback tool functions into the local mpv target. No behavior change. The existing playback tests are the acceptance check.
5. **MA player target.** Implement the MVP subset: `enqueue` (mode map `replace` → `replace`, `append` → `add`, chunked, `shuffle: false`), pause, resume, next, previous, `setVolume` (`players/cmd/volume_set`, or `group_volume` for a group), `nowPlaying` (`player_queues/get`, song ID read back from the provider mapping of the current item). Resolve the queue with `player_queues/get_active_queue`, as Home Assistant does, so a grouped player plays on its group's queue.
6. **Player registry.** Resolve the `player` argument, apply the default rule, and serve `list_players` (local target plus `players/all`, with availability, state, volume and group members).
7. **Tool changes.** Add `player` to the MVP tools, add `list_players`, change the registry gate, skip the web player respawn for MA targets, keep `playback_status` local-only, update tool descriptions so they no longer say "local speakers via mpv" when a player is given, and add an MA entry to `test_connection`'s feature report.
8. **Docs.** Add a README section and a row in docs/DOCKER.md for "HTTP in Docker + MA". Update the "Remote/network playback" line in docs/PLAYBACK-SPEC.md "Out of Scope".

## Edge cases

| Edge case | Part it hits | Intended behavior |
|---|---|---|
| MA unreachable (timeout, refused) | MA HTTP client | Tool error names the MA URL without credentials and the `musicAssistant.url` key. `list_players` still lists the local target and reports MA as unreachable. |
| MA in setup state (no users yet) | MA HTTP client | `POST /api` returns 503 "Setup required" [DIRECT: 2.10.7 controller]. The error says to finish MA onboarding. |
| Token invalid, revoked or expired | MA HTTP client | 401. The error names `musicAssistant.token` and says to create a long-lived token in MA. |
| Token belongs to a guest account | settings GUI Test button | MA refuses long-lived tokens for guests, so a guest token is short-lived and expires in 1 day [DIRECT: 2.10.7 `auth.py`]. The Test button warns when the JWT `exp` is under 30 days away. |
| Token lacks a scope | MA HTTP client | 403 with MA's text "This command requires the <scope> scope", passed through. |
| Long-lived token nears its 1-year expiry | MA player target, `list_players` | Read the JWT `exp` claim without verifying it. Warn in `list_players` and `test_connection` within 30 days of expiry (release 4). |
| MA 2.11 adds issuer and audience claims to tokens | MA HTTP client | Untested whether tokens created before 2.11 keep working [DIRECT: 2.11.0b5 release notes, #6758]. A 401 after an MA upgrade says to create a new token. |
| MA player offline or unknown | player target registry | Check `players/get` before a write, since 2.10.7 returns HTTP 500 for an unavailable player. The error lists the available players. |
| Target name matches two players | player target registry | Reject, and list the matching `player_id`s. |
| Player is a member of a sync group | MA player target | Send to the queue that `player_queues/get_active_queue` returns, so the group plays it. |
| MA has no OpenSubsonic provider | MA provider resolver | Error with a link to MA's Subsonic provider docs. |
| MA's provider points at another Navidrome | MA provider resolver | The probe resolves on no instance. Error says MA's provider serves another server. |
| Two OpenSubsonic instances serve this Navidrome (two accounts) | MA provider resolver | Use `musicAssistant.providerInstanceId` when set. Otherwise take the first match and name it in `list_players`. |
| MA's Navidrome account lacks a library that holds a song | MA player target | MA skips the song with only a log warning and raises only when every song fails [DIRECT: dev `queue_loader.py:1012-1037`]. After a replace, compare MA's queue `items` count with the sent count and report `skipped`. |
| Navidrome-MCP's active libraries differ from MA's account | playback tool functions | Songs are filtered by the active libraries before the handoff, as today (`fetchSongMetadata` with `scopeToActiveLibraries`). MA's own account scope applies after that. |
| Bare domain URI | MA player target | Never sent. `opensubsonic://track/<id>` picks the first available instance [DIRECT: `mass.py get_provider`]. |
| Large lists (hundreds of songs) | MA player target | Send the first chunk with `replace` and the rest with `add`. MA resolves URIs one at a time and holds a play lock for up to 120 s [DIRECT: dev player queues README]. Chunk size to be measured (untested). |
| MA queue has shuffle on | MA player target | Always send `shuffle: false`. Otherwise MA reorders a batch of tracks by the queue setting. |
| Append onto a radio stream | MA player target | Mirror the local rule: when the current MA item is a radio, `append` becomes `replace` and the result carries `demoted: true`. |
| Radio station play | MA player target (release 2) | Send `opensubsonic--<instance>://radio/<stationId>`. MA's provider enables radio stations by default [DIRECT: 2.10.7 `sonic_provider.py`]. |
| MA autoplay appends tracks after the curated list | MA player target | No change to MA's queue settings. `now_playing` omits `songId` for a track with no mapping to this Navidrome. |
| MA streams another provider's copy of a track | MA streams controller | MA's default `best_quality` mode can pick a higher-quality copy from another service when the library track has one [SINGLE-SOURCE: dev streams README]. Document it, and point users who want Navidrome files to MA's `prefer_local` mode. |
| Plays do not reach Navidrome history | listening-history tools | Document MA's Subsonic Scrobbler plugin. Release 4 reports whether it is loaded. It scrobbles as MA's Navidrome account, which may differ from Navidrome-MCP's account. |
| Some m4a, opus or VBR files fail in MA | MA streams controller | Known MA limitation [DIRECT: MA Subsonic provider page]. MA skips the track. Document it. |
| MA version drift | MA HTTP client | Read `schema_version` and `min_supported_schema_version` from `GET /info`. Refuse with a clear message below the minimum schema measured in the first live test. Log a warning when MA's `min_supported_schema_version` passes the schema the bridge was built against. |
| Unknown command after an MA upgrade | MA HTTP client | 400 "Invalid Command: <name>". The error names the MA version from `/info`. |
| Docker container cannot reach MA | MA HTTP client | Same as unreachable. docs/DOCKER.md names the container network requirement. |
| Two MCP clients drive one MA player | MA server | MA serializes play actions with its playback lock [DIRECT: dev player queues README]. The last request wins. No lock in the bridge. |
| Token in tool output or logs | MA HTTP client, logger | Never returned in a result. The logger already redacts JWTs and `Bearer` values. |

## Releases

**MVP: MA playback.**

- User-visible capability: "play my starred jazz on the Kitchen speaker", then pause, resume, skip, change volume and ask what is playing on that speaker. `list_players` shows every MA player and group. The Docker image gains playback through MA.
- Parts added: settings section, MA HTTP client, MA provider resolver, player target interface, local mpv target, MA player target, player registry, `player` on `play_songs`, `play_albums`, `play_playlist`, `play_songs_search`, `play_albums_search`, `pause`, `resume`, `next`, `previous`, `set_volume`, `now_playing`, and the `list_players` tool.
- Acceptance check: unit tests with a mocked `fetch` show each MVP tool sends the expected MA command and arguments. Every existing playback test passes unchanged. The user runs one live check: `play_songs_search` with a target plays the matched songs in order on a real speaker, and MA's queue length equals the sent count.
- Effort: 1.5 to 3 weeks [INFERRED: about 1,550 lines in src/tools/playback.ts and playback-handlers.ts change to route through the player target interface, plus a new client, resolver, target, settings section and tests].

**Release 2: MA queue parity.**

- User-visible capability: read, reorder and edit the MA queue, seek, jump to an entry, play a Navidrome radio station on an MA player, and a `next` mode on MA targets that plays songs after the current one (MA's `next` option).
- Parts added: `player` on `get_play_queue`, `clear_play_queue`, `move_in_play_queue` (index to `queue_item_id` plus `pos_shift`), `remove_from_play_queue`, `play_queue_index`, `seek` (relative seek computed from `elapsed_time`), `shuffle_play_queue`, `play_radio_station`. The player target interface grows the matching methods.
- Acceptance check: mocked tests per tool, plus a live check that a move and a remove land on the intended entries.
- Effort: 1 to 1.5 weeks [INFERRED].
- Semantic gap to document: MA's `player_queues/shuffle` toggles a persistent queue setting, while the local `shuffle_play_queue` reorders once.

**Release 3: multiroom.**

- User-visible capability: "move the music to the living room", "add the patio speaker to this group", group volume.
- Parts added: `transfer_playback` tool (`player_queues/transfer` between MA players, and a read-then-play path between the local target and an MA player), `group_players` and `ungroup_players` tools (`players/cmd/group`, `players/cmd/ungroup`), group volume in `set_volume`.
- Acceptance check: a live transfer keeps the current track and position within 5 seconds.
- Effort: 1 to 1.5 weeks [INFERRED].

**Release 4: MA health.**

- User-visible capability: warnings before the token expires, a note when MA plays do not reach Navidrome history, and clear version messages.
- Parts added: JWT `exp` check, Subsonic Scrobbler detection through the `providers` command, `/info` schema checks in `test_connection`. A WebSocket session if the open decision picks it.
- Acceptance check: mocked tests for each warning.
- Effort: 0.5 to 1 week [INFERRED].

Rejected ideas:

- Raw Navidrome stream URLs to MA's builtin provider: they put a replayable Subsonic token into MA's queue and UI.
- Navidrome public share links as stream URLs: every play would create a persistent public share, and sharing must be enabled on the server.
- Name search handoff: duplicate titles and versions resolve to the wrong track.
- Speaker protocols in Node: four stacks to maintain, and MA already maintains them.
- Navidrome jukebox: it reaches only the Navidrome host's sound devices.
- Mirroring the MA queue into Navidrome's saved queue: docs/PLAYBACK-SPEC.md already rejects bidirectional queue sync.
- MA player control in the web remote: MA ships its own web UI and apps.
- MA's MCP server plugin as the only path: it puts every song ID through the model's context, and the plugin is experimental.
- One Icecast stream that every speaker plays as a radio station, the design of `perminder-klair/subwave`: it needs an audio pipeline in this project and removes per-track control on the speaker.
- Home Assistant's official MCP server: its `HassMediaSearchAndPlay` intent plays the first search result only, with no list and no enqueue mode [DIRECT: HA 2026.10.2 `media_player/intent.py`].

## Dependencies

On other roadmap items:

- **Remote Player Agent**: shares the player target interface, the `player` argument, the `players.default` setting and the `list_players` tool. This file uses the names from `remote-player-agent.md`. Agree on the `list_players` result shape and the `player` value format (a static enum or a free string, since MA player names are only known at run time) before either item ships. No runtime capability is needed.
- **Audio-Device Selector**: no capability needed. Its device argument selects an output of the local mpv target, so the names must stay distinct (`player` for the player, `device` for the local output).
- **Web UI Auth + Roles**: none. MA has its own auth, and the bridge adds no web route.

On external services:

- MA server 2.10.x or later. Latest stable is 2.10.7 (2026-10-17). Latest beta is 2.11.0b5 (2026-10-14). Nightly is 2.11.0.dev2026101703 [DIRECT: GitHub releases]. Stable releases ship every 3 months, with patch releases every two weeks [DIRECT: music-assistant.io/release]. The minimum supported version is set after the first live test. Mandatory auth arrived in 2.7.0 (2025-12-17), so earlier versions are out [DIRECT: 2.7.0 release notes].
- MA deployed as the Home Assistant app or as standalone Docker (`ghcr.io/music-assistant/server` with `--network host`). Both expose port 8095 on the LAN, and MA runs without Home Assistant [DIRECT: MA installation page, add-on `config.yaml`].
- MA's OpenSubsonic provider configured against the same Navidrome. MA imports the entire library on sync [DIRECT: MA Subsonic provider page].
- An MA account with the user role and a long-lived token (1-year expiry, no renewal) [DIRECT: 2.10.7 `auth.py`].
- Optional: MA's Subsonic Scrobbler plugin, for Navidrome play counts.

On npm packages: none. The MA HTTP client uses global `fetch` through the existing fetch helper. If the open decision picks the WebSocket session client, `undici` 7.28.0 (MIT, already a dependency) exports `WebSocket`, and Node 22 has a global `WebSocket`.

## Risks

Assume the feature shipped and failed:

- **The curated order played shuffled.** Assumption violated: MA plays a URI list in the given order. MA applies the queue's shuffle setting to a batch of tracks.
- **Songs played on the wrong server or account.** Assumption violated: one OpenSubsonic instance per MA. A bare-domain URI picks the first available instance.
- **Large playlists timed out.** Assumption violated: `play_media` resolves hundreds of URIs fast. MA resolves them one at a time.
- **The bridge broke after an MA upgrade.** Assumption violated: command names and arguments stay put. MA's policy bumps `MIN_SCHEMA_VERSION` only on breaking changes. It has stayed at 28 from 2.7.0 (December 2025) to dev, while `API_SCHEMA_VERSION` rose from 28 to 97 with additions [DIRECT: `constants.py` at each tag]. Argument renames still happened inside that window, such as `use_pre_announce` to `pre_announce` on `play_announcement` [SINGLE-SOURCE: comparison of 2.6.0 and 2.10.7 source].
- **The bridge stopped working a year later.** Assumption violated: tokens last. Long-lived tokens expire after 365 days.
- **Listening history went stale.** Assumption violated: MA plays count in Navidrome. They count only with MA's Subsonic Scrobbler plugin.
- **Local playback regressed.** Assumption violated: the player target refactor is behavior-neutral. The existing playback tests guard it.
- **The model picked the wrong speaker.** Assumption violated: the model passes a target. The default rule and `list_players` cover it, and it needs a live LLM test.

Cheapest to guard now: send `shuffle: false` and the full instance ID in every `play_media` call. Both are fixed values in the MA player target, and they remove the first two failure modes.

## Sources

Official docs:

- MA API docs page, served at `/api-docs`, source `music_assistant/helpers/resources/api_docs.html` at tag 2.10.7: https://github.com/music-assistant/server/blob/2.10.7/music_assistant/helpers/resources/api_docs.html (2.10.7). HTTP versus WebSocket guidance, curl examples, auth handshake.
- MA webserver and authentication README: https://github.com/music-assistant/server/blob/dev/music_assistant/controllers/webserver/README.md (dev, October 2026). Roles, token types, ingress auth, `/api` and `/ws`.
- MA player queues README: https://github.com/music-assistant/server/blob/dev/music_assistant/controllers/player_queues/README.md (dev, October 2026). Enqueue semantics, shuffle rules, play locks, play counting.
- MA streams README: https://github.com/music-assistant/server/blob/dev/music_assistant/controllers/streams/README.md (dev, October 2026). Stream source selection and `stream_source_mode`.
- MA Subsonic provider page: https://music-assistant.io/music-providers/subsonic/ (shows 2.10.6, read 2026-10-17). Provider fields, library import, format limits.
- MA installation page: https://www.music-assistant.io/installation/ (shows 2.10.6). Docker with host networking, ports 8095 (UI and API) and 8097 (streams).
- MA release policy: https://www.music-assistant.io/release/ (shows 2.10.6). Three-month stable cadence, the base for a version support window.
- MA release notes 2.7.0 (2025-12-17, mandatory auth), 2.10.0 (no long-lived tokens for guests), 2.11.0b5 (2026-10-14, issuer and audience claims): https://github.com/music-assistant/server/releases. Token behavior across versions.
- MA MCP server plugin page: https://music-assistant.io/plugins/fastmcp-server/ (read 2026-10-17). Per-client tokens, write permissions off by default, experimental status.
- Home Assistant `music_assistant.play_media` action: https://www.home-assistant.io/actions/music_assistant.play_media/ (2026.10.2). List `media_id`, enqueue values. The HA bridge option.
- Home Assistant REST API: https://contributors.home-assistant.io/core/internals/rest-api/ (read 2026-10-17). `POST /api/services/<domain>/<service>` with a long-lived token.
- Navidrome jukebox: https://www.navidrome.org/docs/usage/features/jukebox/ (modified 2026-07-29) and https://opensubsonic.netlify.app/docs/endpoints/jukeboxcontrol/ (modified 2025-06-12). The jukebox option.
- Spotify Web API, start playback: https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback (read 2026-10-17). The `device_id` target pattern.

Comparable projects' source code:

- MA OpenSubsonic provider: https://github.com/music-assistant/server/tree/2.10.7/music_assistant/providers/opensubsonic (2.10.7, and dev at commit 406771ec91, 2026-10-12). Track item IDs, radio items, stream details, `is_streaming_provider`, `on_played`.
- MA URI helpers: https://github.com/music-assistant/server/blob/2.10.7/music_assistant/helpers/uri.py and `music_assistant_models/helpers.py` at models 1.1.205. URI format and parsing.
- MA core `mass.py`: https://github.com/music-assistant/server/blob/dev/music_assistant/mass.py (dev). `get_provider` domain fallback, per-user provider visibility.
- MA player queues controller: https://github.com/music-assistant/server/blob/2.10.7/music_assistant/controllers/player_queues/controller.py (2.10.7) and `queue_loader.py` (dev). Command signatures, per-item error handling.
- MA players controller: https://github.com/music-assistant/server/blob/2.10.7/music_assistant/controllers/players/controller.py (2.10.7). `players/all`, volume and group commands.
- MA webserver controller and auth: https://github.com/music-assistant/server/tree/2.10.7/music_assistant/controllers/webserver (2.10.7). `/api` error mapping, `/info`, long-lived tokens, guest rules, role scopes.
- MA config providers: https://github.com/music-assistant/server/blob/dev/music_assistant/controllers/config/providers.py (dev). Instance ID format.
- MA Subsonic Scrobbler plugin: https://github.com/music-assistant/server/tree/2.10.7/music_assistant/providers/subsonic_scrobble (2.10.7). How MA submits plays to Navidrome.
- MA MCP server plugin: https://github.com/music-assistant/server/tree/dev/music_assistant/providers/fastmcp_server (v0.17.0 in 2.10.7, v2.2.2 on dev). The two-server setup option.
- Home Assistant MA integration: https://github.com/home-assistant/core/blob/dev/homeassistant/components/music_assistant/media_player.py (dev, October 2026, `music-assistant-client==1.6.0`). Enqueue mapping, list `media_id`, `schema_version` gating, active queue resolution. The closest model for the MA player target.
- MA Python client: https://github.com/music-assistant/client (`music-assistant-client` 1.6.0 on PyPI, 2026-09-30, Apache-2.0), `connection.py` and `client.py`. Handshake order, `schema_version` checks, per-command schema gating.
- MA frontend API client: https://github.com/music-assistant/frontend/tree/main/src/plugins/api (main, Apache-2.0). The TypeScript reference that MA's docs point to, if the WebSocket session client is chosen.
- MA HA app config: https://github.com/music-assistant/home-assistant-addon/blob/main/music_assistant/config.yaml (version 2.10.7). Host networking and the ingress port.
- `davidpadbury/music-assistant-mcp`: https://github.com/davidpadbury/music-assistant-mcp (v0.1.0, last push 2026-01-19, MIT). A community MCP mapping of `play_media` with a URI list and enqueue options.
- `music-assistant/voice-support` LLM script blueprint: https://github.com/music-assistant/voice-support (version 20250526, Apache-2.0). How MA's own LLM integration names tracks.
- `swiftbird07/AI-Radio`: https://github.com/swiftbird07/AI-Radio (Apache-2.0). An LLM radio that adds tracks to MA by URI, merged into MA as the `ai_radio` plugin.

Specs and standards:

- MA models `api.py` (`CommandMessage`, `ErrorResultMessage`, `ServerInfoMessage`) and `enums.py` (`QueueOption`): https://github.com/music-assistant/models/tree/1.1.205/music_assistant_models (1.1.205, pinned by MA 2.10.7). Message shapes and enqueue values.
- MA `constants.py` `API_SCHEMA_VERSION` and `MIN_SCHEMA_VERSION`: 2.7.0 (28, 28), 2.10.7 (65, 28), 2.11.0b5 (91, 28), dev (97, 28). Versioning policy.
- MA runtime API docs: `GET /api-docs/commands.json` and `/api-docs/openapi.json` on any MA server (2.10.7, no auth). Machine-readable command list with parameters and required scopes, a usable input for TypeScript types and a contract test.

Other:

- Live Navidrome 0.62.0, read-only check on 2026-10-17: REST and Subsonic song IDs are equal, `jukeboxControl` returns HTTP 501, two music folders exist, OpenSubsonic extensions listed.
- npm `music-assistant-client`: https://registry.npmjs.org/music-assistant-client (0.1.0, 2026-09-26, MIT, unofficial). The community npm client option.
- Node speaker packages (`castv2-client`, `@svrooij/sonos`, `upnp-mediarenderer-client`, `node-airtunes2`, `@sonn-audio/node-airplay`): https://registry.npmjs.org (read 2026-10-17). The direct protocol senders option.
- MA also ships `party`, `ai_radio`, `sonic_analysis` and `sonic_similarity` providers [DIRECT: 2.10.7 and dev provider list]. Party Mode and Sonic-Similarity Tools may want to read them.
