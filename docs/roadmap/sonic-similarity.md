# Sonic-Similarity Tools

**Status (2026-10-17):** Release 2, with text-to-music search included (the hybrid route). See [README.md](README.md#sonic-similarity-tools).

## Verdict

BUILD. The user's Navidrome 0.62.0 already registers the OpenSubsonic `sonicSimilarity` endpoints, so the MCP side of the MVP is two thin Subsonic calls plus the existing library filter and song transformer [DIRECT: live probe, Navidrome `server/subsonic/api.go:128-129`]. The sound analysis itself comes from AudioMuse-AI and its Navidrome plugin, which the user must deploy and run before any tool returns results. That deployment needs 4 cores with AVX2, 8 GB RAM and hours to days of analysis [DIRECT: AudioMuse-AI README and FAQ, v3.6.4]. MVP effort is 3 to 5 days and the full roadmap is 14 to 22 days (about 3 to 4.5 weeks) [INFERRED from the size of the Last.fm discovery category, which has the same shape]. Music Assistant 2.10.7 ships its own sonic analysis and an experimental MCP server. It analyzes a Navidrome track only while Music Assistant plays it, so it does not cover a Navidrome library and does not replace this item [DIRECT: Music Assistant `controllers/streams/audio_analysis.py:78-84`].

## Scope

IN SCOPE:
- Songs in the library that sound like a seed song.
- An ordered path of songs from a start song to an end song.
- One-shot tools that play a sonic mix or a sonic path through the local mpv player.
- Text-to-music search ("calm piano with rain sounds") through AudioMuse-AI's CLAP index.
- A status tool that reports whether the sonic provider is reachable and how much of the library it has analyzed.
- Feature gating, settings fields, error mapping and docs for the above.

OUT OF SCOPE:
- Computing audio embeddings inside this project. The decision matrix below scores it last on maintainability, and the MCP server process is designed to do no batch work (`docs/PLAYBACK-SPEC.md`, lazy engine startup).
- Starting AudioMuse-AI analysis, clustering or provider migration from a tool. These are multi-hour admin jobs that the AudioMuse-AI web UI owns.
- Wrapping AudioMuse-AI's own LLM chat (`/chat/api/chatPlaylist`). It runs a second LLM inside the first one and hides its reasoning from the user's assistant.
- Shipping AudioMuse-AI in this project's Docker image. It is a separate stack with its own PostgreSQL and workers.
- Changes to the Last.fm discovery tools, beyond a cross-reference in their descriptions.

BOUNDARY CASES:
- Navidrome's `getSimilarSongs` and `getSimilarSongs2` are OUT for the sonic tools. Rule: a sonic tool returns only results from a source that declares sonic similarity. These two endpoints answer from the first capable agent in `ND_AGENTS`, which is Last.fm or Deezer on the user's server today and AudioMuse-AI only when its plugin is listed first, so their provenance is not knowable from the response [DIRECT: Navidrome AudioMuse docs, live probe].
- Mood and centroid tools are IN for a later release, and AudioMuse-AI clustering playlists are OUT. Rule: a new tool must expose data no existing tool reaches. Clustering writes ordinary Navidrome playlists, which `list_playlists` already reads [DIRECT: AudioMuse-AI `docs/ARCHITECTURE.md`, clustering workflow step 7].
- Lyrics-meaning search (AudioMuse-AI `/api/lyrics/search/text`, SemGrove) is OUT. Rule: this item covers how songs sound. Lyrics meaning belongs with the lyrics tools.
- Music Assistant's Sonic Similarity commands as a result source are OUT for every planned release. Rule: a sonic source must cover the entire Navidrome library. Music Assistant analyzes Navidrome tracks only during its own playback (Feasibility statement 7). Revisit if the user plays most music through Music Assistant or mounts the music folder in it.

## Feasibility

Each statement below must hold for the feature to work.

1. A maintained engine analyzes a Navidrome library by sound. HELD. AudioMuse-AI v3.6.4 (released 2026-10-16, AGPL-3.0, 2,740 stars, repository created 2025-05-24) reads Navidrome over the Subsonic API with `getMusicFolders`, `getAlbumList2`, `search3` and `stream` [DIRECT: GitHub API, `tasks/mediaserver/navidrome.py`].
2. The user's Navidrome exposes sonic results to Subsonic clients. HELD, pending the plugin. The live server reports `serverVersion 0.62.0 (1b46b977)` [DIRECT: live `ping`, 2026-10-17]. `getSonicSimilarTracks` and `findSonicPath` answer HTTP 404 with an empty body, and an unknown method answers HTTP 404 with the router's `404 page not found` text. That difference shows the routes are registered and no provider is loaded [DIRECT: live probe] [DERIVED: `server/subsonic/sonic_similarity.go` writes a bare 404 when `HasProvider()` is false]. `/api/plugin` returns an empty list and `getOpenSubsonicExtensions` does not list `sonicSimilarity` [DIRECT: live probe].
3. Results carry Navidrome song IDs. HELD on both routes. On the Navidrome extension route, Navidrome's song matcher resolves each plugin result to a library media file, trying ID, then MusicBrainz recording ID, then ISRC, then title [DIRECT: Navidrome `core/matcher/matcher.go:61-70`], and the response is a standard Subsonic `Child` [DIRECT: `sonic_similarity.go`]. On the AudioMuse REST route, AudioMuse-AI turns caller-supplied provider IDs into its internal canonical `fp_` IDs and translates result IDs back to the provider IDs of the default or selected server [DIRECT: AudioMuse-AI `app_server_context.py`, `resolve_input_item_ids` and `filter_rows_for_request_server`]. The REST route is read from code and not tested live, since no AudioMuse-AI instance runs on the user's network.
4. Text-to-music search is reachable. HELD only on the AudioMuse REST route. The OpenSubsonic extension defines two endpoints, `getSonicSimilarTracks` and `findSonicPath` [DIRECT: OpenSubsonic `sonicSimilarity` page, modified 2026-04-12]. CLAP text search is `POST /api/clap/search` on AudioMuse-AI [DIRECT: `app_clap_search.py:68`].
5. The plugin works with the latest Navidrome. HELD. Navidrome 0.64.0 disabled Extism's built-in HTTP for plugins [DIRECT: Navidrome releases page]. The AudioMuse plugin v10 calls AudioMuse-AI through the Navidrome host service `host.HTTPSend` instead [DIRECT: AudioMuse-AI-NV-plugin `main.go`].
6. Library scoping is possible. HELD with work on the MCP side. The extension endpoints take only `id`/`count` and `startSongId`/`endSongId`/`count` [DIRECT: OpenSubsonic endpoint pages], so the MCP server must filter results to its active libraries itself [DERIVED].
7. Music Assistant does not cover a Navidrome library by sound. HELD (this statement must hold for the AudioMuse-AI plan to stay the better source). Music Assistant 2.10.7 (released 2026-10-17, Apache-2.0) analyzes a track live while it plays, and its nightly background scan reads only the `filesystem_local`, `filesystem_smb` and `filesystem_nfs` providers [DIRECT: `audio_analysis.py:78-84`, `:1180-1190`, Music Assistant Sonic Analysis docs]. Its OpenSubsonic provider is not on that list, so a Navidrome track gains an analysis only after Music Assistant plays it. A workaround is to mount the same music folder in Music Assistant as an SMB or NFS provider. At the default scan settings (at most 2 tracks at once, at most 4x realtime, a 4-hour nightly budget) the user's 16,731 songs would take about 35 nights [DERIVED: `audio_analysis.py:54`, `:59-62`, `constants.py:215-218`, assuming 4-minute songs].

AudioMuse-AI state (v3.6.4, read 2026-10-17):

| Aspect | Finding |
|---|---|
| License | AGPL-3.0 (file headers say AGPL-3.0-only). Calls over HTTP create no license combination with this project [DIRECT: GitHub API, source headers] |
| Architecture | Flask API on port 8000, one or more workers, PostgreSQL 15 holding data, embeddings, disk-paged IVF indexes and the task queue (LISTEN/NOTIFY, no broker) [DIRECT: `docs/ARCHITECTURE.md`] |
| Models | ONNX Runtime with MusiCNN (200-dimension embedding and mood labels), DCLAP (512-dimension CLAP embedding for text search), Whisper, Silero and GTE for lyrics, optional neural fingerprint [DIRECT: `docs/ALGORITHM.md` stage 4] |
| Resources | Minimum 4-core CPU with AVX2 or ARM, 8 GB RAM, NVMe SSD. GPU optional with 8 GB VRAM [DIRECT: README, `docs/GPU.md`] |
| Analysis time | "a few hours to several days", resumable [DIRECT: `docs/FAQ.md`]. One user report gives about 5 days for 170,000 files on about 90 cores [SINGLE-SOURCE: search summary of a Lyrion forum thread, the page itself returned 403]. The user's 16,731 songs are untested |
| Deployment | Docker Compose, Helm, Podman quadlets, native apps for macOS, Linux and Windows with embedded PostgreSQL [DIRECT: README] |
| Auth | `Authorization: Bearer <API_TOKEN>` for machine callers [DIRECT: `docs/AUTH.md`] |
| MCP server | None. Its "MCP tools" (`seed_search`, `text_match`, `knowledge_lookup`, `search_database`) are an in-process tool schema for its own planner LLM, and no MCP SDK is in its requirements [DIRECT: `tasks/ai/tools.py` docstring, `requirements/common.txt`] |
| LLM feature | Yes. "Instant Playlist" chat at `/chat/api/chatPlaylist` with Ollama, OpenAI, Gemini or Mistral [DIRECT: `app_chat.py`] |

AudioMuse-AI HTTP endpoints relevant here (v3.6.4, documented in its Swagger UI at `/apidocs/`):

| Endpoint | Purpose |
|---|---|
| `GET /api/similar_tracks` | `item_id` or `title`+`artist`, `n`, `eliminate_duplicates`, `mood_similarity`, `radius_similarity`, `server`. Returns `item_id`, `title`, `author`, `album`, `distance` [DIRECT: `app_ivf.py:362`] |
| `GET /api/find_path` | `start_song_id`, `end_song_id` (or `start_mood`/`end_mood`), `max_steps`, `path_fix_size`, `path_space` (`audio` or `lyrics`). Returns `path` and `total_distance` [DIRECT: `app_path.py:197`] |
| `POST /api/clap/search` | `query`, `limit`, optional `steering` concepts. Returns `item_id`, `title`, `author`, `similarity`. Answers 503 while the CLAP cache is not loaded [DIRECT: `app_clap_search.py:68`] |
| `GET /api/mood_centroids` | Mood centroids that seed `similar_tracks` in mood mode [DIRECT: `app_ivf.py:332`] |
| `POST /api/alchemy` | Add and subtract seed songs [DIRECT: `app_alchemy.py:148`] |
| `GET /api/similar_artists` | Sonic artist similarity [DIRECT: `app_artist_similarity.py:127`] |
| `POST /api/clustering/start` | Clustering into Navidrome playlists [DIRECT: `app_clustering.py:91`] |
| `GET /api/version`, `/api/health`, `/api/last_task`, `/api/dashboard/summary` | Version, liveness, latest analysis task, library stats [DIRECT: `app.py:288`, `:315`, `:760`, `app_dashboard.py:788`] |
| `POST /chat/api/chatPlaylist` | The built-in LLM playlist [DIRECT: `app_chat.py:214`] |

Starting-list claims:
- "Sonic-Similarity Tools via AudioMuse-AI" HELD. AudioMuse-AI is the only maintained engine with a Navidrome integration that Navidrome's own docs describe [DIRECT: navidrome.org AudioMuse-AI page, modified 2026-10-16]. The better route to it is Navidrome's extension, not AudioMuse-AI's REST API (see Options).
- "1 to 2 weeks" PARTLY REFUTED. The MVP is 3 to 5 days because Navidrome already ships the endpoints. The full roadmap is 3 to 4.5 weeks [INFERRED].
- "The unique angle: an LLM DJ that understands sound" REFUTED in its general form. AudioMuse-AI already ships an LLM playlist chat with sonic tools [DIRECT: `app_chat.py`]. Plexamp's Sonic Sage (2023) builds playlists with ChatGPT [SINGLE-SOURCE: Sound & Vision]. Music Assistant's MCP Server plugin already gives the user's own assistant sonic results. In 2.10.7 it does so indirectly, through radio mode and global search, and on its development line it exposes the Sonic Similarity commands themselves (see the Music Assistant sonic stack in Current system). The claim holds only in this narrower form: sonic similar songs and sonic paths across the entire Navidrome library, returned as Navidrome song IDs, next to this project's playlist, playback, Last.fm and lyrics tools. Music Assistant has no path command and analyzes only the Navidrome tracks it has played [DIRECT: Music Assistant `sonic_similarity/provider.py:305-360`, Feasibility statement 7]. No other MCP server found offers sonic tools [ABSENT: searches of GitHub, MCP directories and Plex MCP servers on 2026-10-17].
- The task prompt places the gating logic in `src/capabilities.ts`. That file holds only the MCP `ServerCapabilities` objects (`capabilities.ts:9-17`). Gating lives in the config mapper and the tool registry (see Current system).

## Current system

Three systems take part. The first is the MCP server process as it exists. The second is the external sonic stack (Navidrome plus AudioMuse-AI), which the user has not deployed yet. The third is the Music Assistant sonic stack, which the plan does not use and which is drawn so the Options can compare it.

MCP server process:

```
LLM client
   | MCP (stdio or HTTP)
   v
+--------------------------------------------------------------------------------+
| MCP server process                                                             |
|                                                                                |
|  settings store (src/config/store.ts:46-54, features.* fields)                 |
|     |                                                                          |
|     v                                                                          |
|  config mapper (src/config/map-config.ts:88-93)                                |
|     features.lastfm = lastFmApiKey set                                         |
|     features.lyrics = lyricsProvider and lrclibUserAgent set                   |
|     features.playback = mpv binary found                                       |
|     |                                                                          |
|     v                                                                          |
|  startup bootstrap (src/bootstrap.ts:27-46, createRuntime)                     |
|     Navidrome client.initialize -> library manager -> filter cache             |
|     |                                                                          |
|     v                                                                          |
|  tool registry (src/tools/handlers/registry.ts:84-110)                         |
|     registers a category when its feature flag is true                         |
|     |                         |                          |                     |
|     v                         v                          v                     |
|  Last.fm discovery tools   library and search tools   playback tools           |
|  (lastfm-discovery.ts,     (media-library.ts,         (playback.ts,            |
|   lastfm-handlers.ts)       search/, song transformer) queue-sources.ts)       |
|     |                         |                          |                     |
|     v                         v                          v                     |
|  Last.fm API client        Navidrome client           song metadata resolver   |
|  (utils/lastfm.ts)         (client/navidrome-client)  (queue-sources.ts:213)   |
+-----|-------------------------|--------------------------|---------------------+
      v                         v                          |
  Last.fm (internet)        Navidrome server  <------------+
                            /api/* REST, /rest/* Subsonic
```

Facts placed on this diagram:
- The Last.fm discovery tools answer `get_similar_tracks` with Last.fm `track.getSimilar` and `get_similar_artists` with `artist.getSimilar` [DIRECT: `lastfm-discovery.ts:155`, `:195`]. Results come from Last.fm's global catalog, carry no Navidrome IDs, and the tool description tells the LLM to resolve names with `search_songs` [DIRECT: `lastfm-handlers.ts:22-24`]. No sonic code exists anywhere in `src/` [DIRECT: grep for "sonic"].
- The tool registry registers the Last.fm category only when `config.features.lastfm` is true [DIRECT: `registry.ts:99-101`]. The lyrics category always registers and adds `search_lyrics` only when `config.features.lyrics` is true [DIRECT: `registry.ts:96-97`, `lyrics-handlers.ts:78`]. `test_connection` reports each feature with `enabled`, a remedy `description` and its tool names [DIRECT: `test.ts:73-110`].
- The startup bootstrap already makes network calls before tools register, and it configures module singletons such as the library manager [DIRECT: `bootstrap.ts:14-16`, `:31-34`].
- The Navidrome client's `subsonicRequest` POSTs form-encoded salted-MD5 auth and throws on a non-2xx status or a `status` other than `ok` [DIRECT: `navidrome-client.ts:153-204`].
- The song metadata resolver reads `/song?id=...` in chunks of 100 and can scope the read to the active libraries [DIRECT: `queue-sources.ts:213-250`].
- List tools return compact rows by default, with a `verbose` opt-in [DIRECT: `shared-transformers.ts:36-55`].

External sonic stack:

```
+--------------------------- Navidrome server (0.62.0 or later) ----------------------+
|  Subsonic router (server/subsonic/api.go:128-129)                                   |
|     getOpenSubsonicExtensions -> adds sonicSimilarity v1 only when a provider is    |
|                                  loaded (opensubsonic.go:20-22)                     |
|     getSonicSimilarTracks, findSonicPath                                           |
|        |                                                                            |
|        v                                                                            |
|  sonic engine (core/sonic/sonic.go)                                                 |
|     loads the first plugin with the SonicSimilarity capability                      |
|        |                                  ^                                         |
|        v                                  | song refs (id, title, artist, album,    |
|  plugin host (WASM sandbox)               |            similarity)                  |
|     AudioMuse plugin (audiomuseai.ndp, v8 or later, v10 current)                    |
|        |                                  |                                         |
|        |                         song matcher (core/matcher/matcher.go)             |
|        |                            ID > MBID > ISRC > title -> library media files |
+--------|----------------------------------------------------------------------------+
         | HTTP GET /api/similar_tracks, /api/find_path, Bearer API token
         v
+--------------------------- AudioMuse-AI stack (v3.6.4) -----------------------------+
|  AudioMuse Flask API (:8000, Swagger at /apidocs/)                                   |
|        | enqueue jobs, read indexes                                                 |
|        v                                                                            |
|  AudioMuse database (PostgreSQL 15: tracks, embeddings, IVF indexes, task queue)    |
|        ^ claim jobs, write embeddings                                               |
|        |                                                                            |
|  AudioMuse worker (ONNX: MusiCNN, DCLAP, lyrics models)                             |
|        | Subsonic getMusicFolders, getAlbumList2, search3, stream                   |
+--------|----------------------------------------------------------------------------+
         v
   Navidrome server (audio files)
```

Facts placed on this diagram:
- The AudioMuse plugin maps AudioMuse-AI `distance` to `similarity = 1 - distance`, clamped to 0..1, and returns `-1` for every step of a path [DIRECT: plugin `main.go`, `normalizeSimilarity` and `FindSonicPath`].
- The AudioMuse plugin also answers `getSimilarSongs`, `getSimilarSongs2` and artist radio when `audiomuseai` comes first in `ND_AGENTS` [DIRECT: plugin README, Navidrome AudioMuse-AI page].
- Navidrome's maintainer prefers external analyzers through plugins over analysis inside Navidrome [DIRECT: navidrome discussion #4332, deluan, 2025-07-31 and 2025-10-27]. Navidrome has no built-in sonic analysis.

Music Assistant sonic stack (2.10.7, paths under `music_assistant/`):

```
+------------------------------ Music Assistant server (2.10.7) -----------------------------+
|  OpenSubsonic provider (providers/opensubsonic)                                            |
|     reads and streams from Navidrome, track item_id = Subsonic song ID                     |
|     get_similar_tracks -> Navidrome getSimilarSongs                                        |
|        | audio flows only when Music Assistant plays the track                             |
|        v                                                                                   |
|  audio analysis controller (controllers/streams/audio_analysis.py)                         |
|     live analysis of the playing track and the preloaded next track                        |
|     nightly background scan of filesystem_local, filesystem_smb, filesystem_nfs only       |
|        |                                                                                   |
|        v                                                                                   |
|  Sonic Analysis provider (providers/sonic_analysis): librosa scalars, Microsoft CLAP       |
|  Smart Fades analysis: BPM and musical key                                                 |
|        |                                                                                   |
|        v                                                                                   |
|  Sonic Similarity plugin (providers/sonic_similarity, beta): usearch HNSW indexes          |
|     18-dimension traits index, optional 1024-dimension CLAP index, optional text search    |
|     API commands sonic_similarity/similar, /similar_clap, /text_search, /status            |
|     feeds Similar Tracks, radio mode, a discover row and global search                     |
|        |                                                                                   |
|        v                                                                                   |
|  MCP Server plugin (providers/fastmcp_server, experimental)                                |
|     2.10.7, plugin 0.17.0: fixed tools (search_tracks, play_media with radio,              |
|        recommendation_rows and recommendation_items). No sonic tool                        |
|     dev line, plugin 2.2.2: dynamic layer over the live command registry                   |
|                                                                                            |
|  AI Radio plugin (providers/ai_radio, alpha): LLM-written host segments spoken by TTS      |
|     between the tracks of a playlist                                                       |
+--------------------------------------------------------------------------------------------+
```

Facts placed on this diagram:
- The Sonic Analysis provider combines librosa features with Microsoft CLAP and needs at least 4 GB RAM and 2 cores, with 6 GB and 4 cores recommended [DIRECT: `sonic_analysis/__init__.py:1`, `:78-84`]. The first enable downloads about 300 MB of models [DIRECT: Music Assistant Sonic Analysis docs].
- The Sonic Similarity plugin needs both Sonic Analysis and Smart Fades results, and skips a track that lacks either [DIRECT: `sonic_similarity/manifest.json`]. It registers its API commands at `sonic_similarity/provider.py:305-360`, and `similar` returns `item_id`, `provider` and `distance` per row [DIRECT: `provider.py:742-1027`]. It has no command for a path between two songs [DIRECT: command list].
- The OpenSubsonic provider uses the Subsonic song ID as its track `item_id`, so a Music Assistant result from that provider carries a Navidrome song ID [DIRECT: `opensubsonic/parsers.py:142`]. Its own similar tracks come from Navidrome `getSimilarSongs`, and it never calls `getSonicSimilarTracks` or `findSonicPath` [DIRECT: `opensubsonic/sonic_provider.py:730-740`, grep].
- In 2.10.7 the MCP Server plugin reaches sonic results only indirectly. `play_media` with `radio: true` starts a radio that refills from the similar-tracks providers [DIRECT: `fastmcp_server/tools/playback.py:185-218`, Sonic Similarity manifest]. `search_tracks` runs Music Assistant's global search, and the Sonic Similarity plugin joins that search when text search is on [DIRECT: `tools/library.py:248-264`, `sonic_similarity/__init__.py:38-47`] [INFERRED: global search queries plugin providers that declare SEARCH].
- On the dev line the MCP Server plugin builds its tool catalog from `mass.command_handlers`, the registry that holds `sonic_similarity/similar` and `sonic_similarity/text_search` [DIRECT: dev `fastmcp_server/execution.py:542-559`]. 2.11.0 beta 5 updates this plugin to v2.1.24 [DIRECT: Music Assistant releases page]. That the dynamic layer is already in v2.1.24 is [INFERRED].
- The AI Radio plugin reads the tracks of a chosen playlist and splices LLM-written, TTS-spoken host segments between them. It does not choose tracks by sound [DIRECT: `ai_radio/runtime.py:426-428`, `ai_radio/queue_dj.py` docstring].

Connection steps:
- The Navidrome client in the MCP server process calls `getSonicSimilarTracks` and `findSonicPath` on the Navidrome Subsonic router. Nothing else in the MCP server process touches the external sonic stack in the MVP.
- The Music Assistant OpenSubsonic provider reads and streams from the same Navidrome server. No part of this plan connects the MCP server process to Music Assistant.

## Integration point

New parts are marked with `+`.

```
+--------------------------------------------------------------------------------+
| MCP server process                                                             |
|                                                                                |
|  startup bootstrap (bootstrap.ts createRuntime)                                |
|     +-> + sonic extension probe (src/services/, module singleton)              |
|            calls getOpenSubsonicExtensions once, records sonicSimilarity v1    |
|     |                                                                          |
|     v                                                                          |
|  tool registry (registry.ts)                                                   |
|     + registers the sonic tool category when the probe flag is true            |
|     |                                                                          |
|     v                                                                          |
|  + sonic tool category (src/tools/handlers/sonic-handlers.ts)                  |
|  + sonic similarity tools (src/tools/sonic-similarity.ts)                      |
|        get_sonic_similar_songs, find_sonic_path            (MVP)               |
|        play_sonic_mix, play_sonic_path  [needs playback]   (release 2)         |
|        search_songs_by_sound, get_sonic_status             (release 3)         |
|     |                         |                          |                     |
|     v                         v                          v                     |
|  Navidrome client          active-library filter      existing play path       |
|  subsonicRequest           (/song read with library   (the code play_songs     |
|  getSonicSimilarTracks,     filter + song transformer) uses)                   |
|  findSonicPath                                                                 |
|                                                                                |
|  + AudioMuse REST client (src/utils/audiomuse.ts)          (release 3)         |
|        gated by features.audioMuseUrl in the settings store                    |
+-----|-----------------------------------------------------|--------------------+
      v                                                     v
  Navidrome Subsonic router                           AudioMuse Flask API
  (sonicSimilarity extension)                         (/api/clap/search, /api/version,
                                                       /api/last_task)
```

Where each new part lives, and why:
- The sonic extension probe lives in `src/services/` as a module singleton that the startup bootstrap initializes. The bootstrap already initializes the library manager and filter cache this way, and each HTTP session builds its server from the same runtime [DIRECT: `bootstrap.ts:14-16`, `index.ts` `createConfiguredServer`]. The probe cannot live in the config mapper, since the mapper runs before the Navidrome client authenticates.
- The sonic similarity tools and the sonic tool category mirror `lastfm-discovery.ts` and `lastfm-handlers.ts`, which is the established split between impl and registration (CLAUDE.md layout table).
- The active-library filter reuses the scoped `/song` read that `search_songs` and the song metadata resolver already use, so sonic results honor `set_active_libraries` and come out in the same compact row shape as other song tools.
- The sonic play tools sit in the sonic tool category and register only when both the probe flag and `features.playback` are true. They hand IDs to the existing play path, so queue, scrobble and web remote behavior stays unchanged.
- The AudioMuse REST client lives in `src/utils/` beside `lastfm.ts` and `musicbrainz.ts`. It calls `fetchWithTimeout` without `respectProxy`, since AudioMuse-AI sits on the LAN like Navidrome (CLAUDE.md, Outbound proxy).

Tool surface (compact by default, `verbose` adds the full song fields):

| Tool | Input | Output rows |
|---|---|---|
| `get_sonic_similar_songs` | `songId`, `limit` (1 to 100, default 20), `verbose` | `id`, `title`, `artist`, `album`, `durationFormatted`, `similarity` (0 to 1) |
| `find_sonic_path` | `startSongId`, `endSongId` (must differ), `length` (2 to 100, default 25), `verbose` | Same row, in path order. `similarity` omitted when the provider sends `-1` |
| `play_sonic_mix` | `songId` (defaults to the now-playing song), `limit`, `mode`, `includeSeed` | Same summary shape as `play_songs` |
| `play_sonic_path` | `startSongId`, `endSongId`, `length`, `mode` | Same summary shape as `play_songs` |
| `search_songs_by_sound` | `query` (free text), `limit`, `verbose` | Song rows plus `similarity` |
| `get_sonic_status` | none | Provider reachable, AudioMuse-AI version, last analysis task state and progress |

Example compact output of `get_sonic_similar_songs`:

```json
{
  "count": 2,
  "skipped": 1,
  "songs": [
    { "id": "<song id>", "title": "<title>", "artist": "<artist>", "album": "<album>", "durationFormatted": "3:41", "similarity": 0.91 },
    { "id": "<song id>", "title": "<title>", "artist": "<artist>", "album": "<album>", "durationFormatted": "4:05", "similarity": 0.88 }
  ]
}
```

`skipped` counts results dropped by the active-library filter, the same word `play_songs` uses for unknown or out-of-scope IDs. The output does not echo the seed, following the rule in `lastfm-discovery.ts:32`. Each sonic tool description states that it ranks by how songs sound (audio analysis) and points to `get_similar_tracks` for "listeners also like" results. The Last.fm tool descriptions gain the reverse pointer when the sonic category is registered.

## Options

### Sonic engine

Criteria and weights, set before scoring:
- Maintainability for this project (0.30): code and infrastructure this project must own.
- Match with popular comparable tools (0.20): how media servers and players solve the same problem.
- Capability coverage (0.20): similar songs, paths, text search, moods.
- Deployment burden, higher score means lighter (0.15).
- Stack and license fit with TypeScript, Node and AGPL-3.0-or-later (0.15).

Options:
- The AudioMuse-AI engine: an external service, reached through Navidrome or its REST API.
- The bliss-rs engine: crate `bliss-audio` 0.13.0 (2026-08-18, GPL-3.0-only), about 20 hand-built features (tempo, timbre, loudness, chroma) [DIRECT: crates.io, bliss-rs README].
- The Essentia engine: Essentia 2.1b6.dev1438 on PyPI (2026-05-19, AGPL-3.0). `essentia.js` 0.1.3 has had no release since 2021-06-24 [DIRECT: PyPI, npm registry].
- The LMS Music Similarity engine: CDrummond's `music-similarity` (musly, Essentia, bliss), now marked "DEPRECATED Please use Bliss Analyser instead". musly (MPL-2.0) lists version 0.2 as unreleased [DIRECT: repository READMEs].
- The in-project CLAP engine: decode with ffmpeg, embed with `onnxruntime-node` 1.30.0 (MIT, 301 MB unpacked) and a CLAP model, store vectors locally [DIRECT: npm registry].
- The Music Assistant engine: Music Assistant's Sonic Analysis provider and Sonic Similarity plugin (librosa scalars, Microsoft CLAP, usearch), reached through Music Assistant's API (see the Music Assistant sonic stack).
- An engine built into Navidrome is not an option. None exists, and the maintainer directs analyzers to plugins [DIRECT: discussion #4332].

| Criterion (weight) | AudioMuse-AI engine | bliss-rs engine | Essentia engine | LMS Music Similarity engine | in-project CLAP engine | Music Assistant engine |
|---|---|---|---|---|---|---|
| Maintainability (0.30) | 5 | 2 | 1 | 1 | 1 | 4 |
| Match with comparable tools (0.20) | 5 | 3 | 2 | 1 | 1 | 3 |
| Capability coverage (0.20) | 5 | 2 | 3 | 2 | 4 | 2 |
| Deployment burden (0.15) | 2 | 4 | 2 | 3 | 3 | 3 |
| Stack and license fit (0.15) | 5 | 2 | 2 | 2 | 3 | 4 |
| Weighted total | 4.55 | 2.50 | 1.90 | 1.65 | 2.20 | 3.25 |

Scoring notes:
- The AudioMuse-AI engine needs only an HTTP client in this project. Its deployment cost is the PostgreSQL stack, 8 GB RAM and days of analysis.
- The bliss-rs engine analyzes 10,000 files in about 56 minutes with FFmpeg [DIRECT: bliss-rs README], so its deployment is light. This project would still own the analyzer orchestration, the Navidrome download loop, storage, re-sync and ID drift. Its TypeScript binding `bliss-audio-ts` 0.1.11 targets Bun only [DIRECT: bliss-rs README]. It has no text search.
- The in-project CLAP engine covers text search, but it puts multi-day batch work inside the MCP server process.
- The Music Assistant engine needs only an API client in this project and no PostgreSQL. It loses on coverage because it has no paths and analyzes a Navidrome track only after playing it. Its match score is 3 because Music Assistant's own players and MCP plugin use it, but no Subsonic client does. Music Assistant's API carries no version, and the Sonic Similarity plugin is beta, which caps maintainability at 4. Its Apache-2.0 license is compatible.

Flip check: the smallest change that flips the winner is the deployment burden weight 0.15 to 0.58, with the other weights rescaled to keep the total at 1.0, which makes the bliss-rs engine win. ROBUST. The Music Assistant engine needs the deployment weight at 0.63 to win, so adding it leaves the flip check unchanged.

How comparable tools made this decision:
- Navidrome: no built-in analysis. Sonic features come from a plugin that calls AudioMuse-AI [DIRECT: Navidrome docs].
- Jellyfin: the AudioMuse-AI Jellyfin plugin, plus Navidrome 0.64.0 exposing sonic features to Jellyfin clients [DIRECT: plugin README, Navidrome releases].
- LMS and Lyrion: moved from musly and Essentia (`music-similarity`) to Bliss Analyser and `bliss-mixer` [DIRECT: CDrummond repositories]. An unofficial Lyrion AudioMuse-AI plugin also exists [DIRECT: AudioMuse-AI README].
- MPD: `blissify` 0.6.1 [DIRECT: crates.io].
- Music Assistant: ships its own on-device engine (librosa and Microsoft CLAP), and limits its background scan to local and network-share files on purpose. Its source comment rules out pulling audio from streaming providers that nobody asked to hear [DIRECT: `audio_analysis.py:78-79`].
- Plex: closed, built-in server-side sonic analysis with "Sonically Similar" and "Sonic Adventure" in Plexamp [SINGLE-SOURCE: Plex blog and press coverage, support article returned 403].

### Integration route

Criteria and weights:
- Maintainability (0.30): code owned and stability of the contract.
- Match with popular comparable tools (0.25).
- Capability coverage (0.20).
- Setup burden for the user, higher score means lighter (0.10).
- ID correctness and access control (0.15).

Options:
- The Navidrome extension route: the MCP server calls `getSonicSimilarTracks` and `findSonicPath` on Navidrome. Any plugin with the SonicSimilarity capability backs it.
- The AudioMuse REST route: the MCP server calls AudioMuse-AI's HTTP API with a Bearer token.
- The hybrid route: the Navidrome extension route for similar songs and paths, the AudioMuse REST route for text search and status.
- The Music Assistant sonic route: the MCP server calls Music Assistant's `sonic_similarity/similar` and `sonic_similarity/text_search` commands with a Music Assistant token, keeps rows whose `provider` is the OpenSubsonic instance, and reads their `item_id` as the Navidrome song ID.

| Criterion (weight) | Navidrome extension route | AudioMuse REST route | hybrid route | Music Assistant sonic route |
|---|---|---|---|---|
| Maintainability (0.30) | 5 | 3 | 3 | 2 |
| Match with comparable tools (0.25) | 5 | 3 | 4 | 2 |
| Capability coverage (0.20) | 2 | 5 | 5 | 2 |
| Setup burden (0.10) | 3 | 4 | 3 | 3 |
| ID correctness and access control (0.15) | 5 | 3 | 4 | 3 |
| Weighted total | 4.20 | 3.50 | 3.80 | 2.25 |

Scoring notes:
- The Navidrome extension route depends on a versioned OpenSubsonic contract (`sonicSimilarity` version 1) that the Navidrome team maintains [DIRECT: OpenSubsonic spec, PR #5419 merged 2026-04-27]. AudioMuse-AI's REST API carries no version in its paths, and AudioMuse-AI shipped 8 releases between 2026-08-27 and 2026-10-16 [DIRECT: GitHub releases].
- The Navidrome extension route returns songs that Navidrome's matcher resolved under the MCP user's session, with a title fallback when an ID is stale [DIRECT: `matcher.go:61-70`]. That the matcher applies the user's library access is [INFERRED].
- The AudioMuse REST route alone reaches CLAP text search, moods and analysis status.
- The Music Assistant sonic route depends on an unversioned API, a beta plugin and, for MCP-side reuse, an experimental plugin. It has similar songs and text search but no paths, and on a Navidrome library it returns only tracks Music Assistant has played, so its coverage scores 2 like the extension route. Its rows carry Navidrome song IDs only after filtering to the OpenSubsonic provider, and Music Assistant applies no Navidrome library scoping. Its setup burden is 3 when the Music Assistant Bridge item already runs Music Assistant, and lower otherwise.

Flip check: the smallest change that flips the winner is the capability coverage weight 0.20 to 0.29, with the other weights rescaled, which makes the hybrid route win. FRAGILE, since the weight is a judgment with an uncertainty near 0.1. See Open decisions. Adding the Music Assistant sonic route leaves the totals of the other three routes and this flip check unchanged. The Music Assistant sonic route scores at or below the Navidrome extension route on every criterion, so no weight change makes it win.

How comparable tools made this decision:
- The Navidrome web UI Instant Mix, Symfonium, Feishin, Substreamer, Tempo and Wavio all reach AudioMuse-AI through Navidrome's Subsonic endpoints, not through AudioMuse-AI directly [DIRECT: AudioMuse-AI-NV-plugin README].
- The AudioMuse-AI Jellyfin plugin proxies `similar_tracks` and `find_path` through Jellyfin's own API (`/AudioMuseAI/similar_tracks`) [DIRECT: Jellyfin plugin README]. Players treat the media server as the gateway in both ecosystems.
- Music Assistant's own OpenSubsonic provider takes Navidrome's similar songs from `getSimilarSongs`, the media server gateway, and its sonic results come from its own engine, not from AudioMuse-AI [DIRECT: `opensubsonic/sonic_provider.py:730-740`].

### Feature gating

Criteria and weights:
- Consistency with this codebase's gating (0.35).
- Tool-list hygiene, meaning no tool the LLM can see but not use (0.25).
- User setup effort, higher score means less (0.20).
- Behavior when the plugin is installed after the MCP server starts (0.20).

Options:
- The extension probe gate: register the sonic tool category when `getOpenSubsonicExtensions` lists `sonicSimilarity` version 1 at startup.
- The settings key gate: a `features.sonicSimilarity` switch in the settings store.
- The always-on gate: register always and fail at call time.

| Criterion (weight) | extension probe gate | settings key gate | always-on gate |
|---|---|---|---|
| Consistency (0.35) | 4 | 5 | 2 |
| Tool-list hygiene (0.25) | 5 | 3 | 1 |
| Setup effort (0.20) | 5 | 3 | 5 |
| Later install (0.20) | 3 | 3 | 5 |
| Weighted total | 4.25 | 3.70 | 2.95 |

Flip check: the smallest change that flips the winner is the consistency weight 0.35 to 0.58, with the other weights rescaled, which makes the settings key gate win. ROBUST.

How comparable tools made this decision:
- This codebase detects mpv at startup and registers playback tools only when it is found ("install mpv, restart MCP, tools appear") [DIRECT: `docs/PLAYBACK-SPEC.md` Detection, `map-config.ts:92`].
- OpenSubsonic clients detect optional features through `getOpenSubsonicExtensions`, and Navidrome advertises `sonicSimilarity` only when a provider is loaded [DIRECT: `opensubsonic.go:20-22`].
- The AudioMuse REST route in release 3 has nothing to probe without a URL, so it uses the settings key pattern of `features.lastFmApiKey`.

### Play tool shape

Criteria and weights:
- Consistency with the one-shot pattern (0.35).
- Context token cost per DJ action (0.25).
- Tool-count growth (0.15), higher score means fewer new tools.
- Separation of concerns (0.25).

Options:
- The one-shot play tools: `play_sonic_mix` and `play_sonic_path` resolve and enqueue in one call.
- The read-then-play pattern: the LLM reads IDs with `get_sonic_similar_songs` and passes them to `play_songs`.
- The play flag on read tools: a `play: true` input on the read tools.

| Criterion (weight) | one-shot play tools | read-then-play pattern | play flag on read tools |
|---|---|---|---|
| Consistency (0.35) | 5 | 3 | 2 |
| Token cost (0.25) | 5 | 2 | 5 |
| Tool-count growth (0.15) | 2 | 5 | 5 |
| Separation of concerns (0.25) | 4 | 5 | 2 |
| Weighted total | 4.30 | 3.55 | 3.20 |

Flip check: the smallest change that flips the winner is the tool-count weight 0.15 to 0.32, with the other weights rescaled, which makes the read-then-play pattern win. ROBUST.

How comparable tools made this decision:
- This codebase ships `play_songs_search` and `play_albums_search` as one-shot tools and tells the LLM to prefer them over list-then-play [DIRECT: `playback-handlers.ts:160`, `:179`].
- Navidrome's Instant Mix and Plexamp's Sonic Adventure start playback directly from a seed or a start and end song [DIRECT: Navidrome docs] [SINGLE-SOURCE: Plex press coverage for Sonic Adventure].

## Recommendation

Sonic engine: use the AudioMuse-AI engine. It is the only option that keeps this project to an HTTP client while covering similar songs, paths and text search, and every media server ecosystem studied reaches it or an equivalent through a plugin.

Integration route: build the MVP on the Navidrome extension route and add the AudioMuse REST client in release 3, so the roadmap ends at the hybrid route. The extension keeps the MVP provider-agnostic, scoped by Navidrome, and stable under a versioned contract. Text search is the one capability that forces the REST client. The Music Assistant sonic route is rejected, since it scores at or below the extension route on every criterion and does not cover a Navidrome library.

Feature gating: use the extension probe gate for the Navidrome extension route and a settings key (`features.audioMuseUrl` plus `features.audioMuseApiToken`) for the AudioMuse REST route. `test_connection` reports both with a remedy line, as it does for Last.fm and lyrics.

Play tool shape: ship `play_sonic_mix` and `play_sonic_path` as one-shot tools in release 2, registered only when playback is on.

## Open decisions

Integration route for the MVP: the Navidrome extension route against the hybrid route.
- What tips it: whether text-to-music search ("songs that sound like a rainy night") belongs in the first release. It is the most LLM-native sonic capability, and only the AudioMuse REST route reaches it.
- Cost of moving it into the MVP: the settings fields, GUI field, secret masking, env import and REST client from release 3, about 4 to 6 extra days [INFERRED].
- Question for the user: should the first release include text-to-music search, or ship similar songs and paths first and add text search in the next release?

## Plan overview

Build steps in dependency order:

1. The sonic extension probe. Add a module singleton in `src/services/` that the startup bootstrap initializes after the Navidrome client authenticates. It calls `getOpenSubsonicExtensions` once, records whether `sonicSimilarity` lists version 1, and logs a warning and records false on any failure.
2. The sonic similarity tools. Add `src/tools/sonic-similarity.ts` with input schemas in `src/schemas/validation.ts`. Each call goes through `client.subsonicRequest`, validates the `sonicMatch` array with zod, drops the seed song, omits negative similarity, runs the active-library filter, and shapes rows with the song transformer plus `similarity`. Request about twice the asked count, capped at 100, so the filter still fills the result.
3. The sonic tool category. Add `src/tools/handlers/sonic-handlers.ts` and register it in the tool registry behind the probe flag. Add the cross-reference line to the Last.fm tool descriptions when both categories are present.
4. The status report. Add a `sonicSimilarity` entry to `test_connection` with `enabled`, a remedy `description` that names Navidrome 0.62.0, the AudioMuse plugin and `ND_AGENTS`, and the tool names.
5. Tests and docs. Mock the Subsonic responses for success, provider error, empty list, `-1` similarity and cross-library rows (see `tests/CLAUDE.md`). Add a README section with the setup order.
6. The sonic play tools (release 2). Resolve the seed (input or the playback engine's now-playing song), call the step 2 functions, and pass IDs to the existing play path.
7. The AudioMuse settings (release 3). Add `features.audioMuseUrl`, `features.audioMuseApiToken` and `features.audioMuseServer` to `SettingsFileSchema` (`store.ts:46-54`), `ConfigSchema` (`schema.ts:33-38`), the config mapper (`map-config.ts:88-93`), the env import (`env-settings.ts:107`, as `AUDIOMUSE_URL`, `AUDIOMUSE_API_TOKEN`, `AUDIOMUSE_SERVER`), the config app field list (`config-app/public/app.js:20-24`), secret masking (`config-app/routes.ts:170-197`) and `settings.example.json`.
8. The AudioMuse REST client (release 3). Add `src/utils/audiomuse.ts` with the Bearer header, zod response schemas, the `server` parameter, and error mapping for 401, 404 and 503.
9. Text search and status tools (release 3). Add `search_songs_by_sound` on `POST /api/clap/search` and `get_sonic_status` on `/api/version` and `/api/last_task`. Run REST results through the active-library filter, which also drops IDs Navidrome no longer knows.
10. Mood and blend tools (release 4). Add mood-endpoint paths, mood-centroid mixes, alchemy and sonic artist similarity on the AudioMuse REST client.

Setup order for the user, outside the code: upgrade Navidrome to 0.64.x first, then deploy AudioMuse-AI, run the first analysis, install the plugin and put `audiomuseai` first in `ND_AGENTS`. Navidrome 0.64 rewrites every song ID once on first start [SINGLE-SOURCE: maintainer heads-up post], and AudioMuse-AI then needs a Navidrome-to-Navidrome provider migration [DIRECT: AudioMuse-AI v3.1.1 release notes]. Upgrading first avoids that migration.

## Edge cases

| Edge case | Part it hits | Intended behavior |
|---|---|---|
| No plugin, or Navidrome older than 0.62.0 | sonic extension probe | Flag false. Sonic tools not registered. `test_connection` names the missing piece |
| Plugin removed after startup | sonic similarity tools | Navidrome answers a bare 404. Tool error says the provider is gone and the MCP server needs a restart |
| Library not analyzed yet | AudioMuse plugin, sonic similarity tools | AudioMuse-AI answers 404 "Target track not found in index" [DIRECT: `app_ivf.py`], which reaches the MCP server as a Subsonic error [DERIVED: the plugin returns an error on any non-200 status, and Navidrome maps a handler error to a Subsonic error]. Tool error says the song is not analyzed and points to the AudioMuse-AI analysis page. No silent fallback to Last.fm |
| Partial analysis | sonic similarity tools | Results come only from the analyzed part. `get_sonic_status` (release 3) shows analysis progress |
| Newly added songs | AudioMuse worker | Not analyzed until the next analysis run. Same error as an unanalyzed seed. AudioMuse-AI's scheduler can run analysis on a cron [DIRECT: `app_cron.py:181`] |
| Navidrome song-ID migration (0.64) | song matcher, AudioMuse database | Extension route: the matcher falls back to MBID, ISRC and title, so most results still resolve [DIRECT: `matcher.go:61-70`]. Seeds fail inside AudioMuse-AI until the provider migration runs. REST route: stale IDs are dropped by the active-library filter and counted in `skipped` |
| File moved or renamed | Navidrome scanner | Navidrome keeps the song ID when it matches the missing file by persistent ID [DIRECT: `scanner/phase_2_missing_tracks.go:300`]. AudioMuse-AI's alignment sweep prunes and adds mappings [DIRECT: `docs/ALGORITHM.md` alignment sweeps] |
| AudioMuse-AI down | AudioMuse plugin, AudioMuse REST client | Plugin HTTP error becomes a Subsonic error. Tool error names AudioMuse-AI as unreachable. Cold index loads may answer slowly, so the call uses the Navidrome request timeout |
| CLAP cache not loaded | AudioMuse REST client | 503 maps to "text search index is loading, retry shortly" |
| Several Navidrome libraries | active-library filter | Rows outside the active libraries are dropped and counted in `skipped`. The user's server has two libraries (11,104 and 5,627 songs) [DIRECT: live `/api/library`] |
| AudioMuse-AI analyzes only some libraries (`MUSIC_LIBRARIES`) | AudioMuse worker | Seeds from an excluded library fail like an unanalyzed seed |
| AudioMuse-AI with several media servers | AudioMuse REST client | Send `features.audioMuseServer` as the `server` parameter, the same setting the plugin has [DIRECT: plugin `manifest.json`] |
| Same recording in two libraries | sonic similarity tools | AudioMuse-AI merges duplicates by fingerprint, but Navidrome can still return both copies. Drop rows with the same normalized title and artist after the first |
| Start song equals end song | `find_sonic_path` input schema | Rejected before the call, since AudioMuse-AI answers 400 [DIRECT: `app_path.py`] |
| Path steps with similarity `-1` | sonic similarity tools | Field omitted [DIRECT: plugin `FindSonicPath`] |
| Seed returned in its own results | sonic similarity tools | Seed dropped from `get_sonic_similar_songs`. Kept as first and last row of a path |
| Large limit | input schemas | `limit` 1 to 100, path `length` 2 to 100 |

## Releases

### MVP: sonic similarity through Navidrome

- Capability: "find songs that sound like this one" and "build a path from this song to that one" over the library, with Navidrome song IDs the other tools accept.
- Parts added: the sonic extension probe, the sonic similarity tools (`get_sonic_similar_songs`, `find_sonic_path`), the sonic tool category, the `test_connection` entry, README section.
- Acceptance check: with the plugin loaded and the library analyzed, both tools return songs whose IDs `play_songs` accepts, and only from the active libraries. With no plugin, neither tool is listed and `test_connection` explains why. Mocked tests cover success, provider error, `-1` similarity and cross-library rows.
- Effort: 3 to 5 days [INFERRED].

### Release 2: sonic DJ one-shots

- Capability: "play more like this" and "take me from this song to that one" in one call, seeded from the now-playing song by default.
- Parts added: `play_sonic_mix`, `play_sonic_path`.
- Acceptance check: with playback on, one call replaces or appends the queue with the sonic results. With playback off, neither tool is listed.
- Effort: 2 to 3 days [INFERRED].

### Release 3: describe-the-sound search

- Capability: text-to-music search ("warm analog synths, slow tempo") and an analysis status report.
- Parts added: AudioMuse settings in the store, GUI, env import and secret masking, the AudioMuse REST client, `search_songs_by_sound`, `get_sonic_status`, and optionally a one-shot `play_songs_by_sound`.
- Acceptance check: with `features.audioMuseUrl` and a token set, search returns library songs ranked by text match. A wrong token yields a clear 401 message. With no URL set, the tools are absent.
- Effort: 5 to 8 days [INFERRED].

### Release 4: moods and blends

- Capability: paths that end at a mood, mixes seeded by a mood centroid, add and subtract blends of several seeds, and artists that sound alike.
- Parts added: tools on `/api/find_path` mood endpoints, `/api/similar_tracks` mood mode, `/api/alchemy` and `/api/similar_artists`.
- Acceptance check: each tool returns library song IDs filtered to the active libraries. Decide which tools to build from usage of the earlier releases.
- Effort: 4 to 6 days [INFERRED].

Rejected ideas:
- Computing embeddings in this project. It scores last on maintainability, and it adds a 301 MB native dependency and batch work to the MCP server process.
- Calling AudioMuse-AI's chat playlist endpoint. It nests a second LLM and returns a finished playlist the user's assistant cannot reason about.
- Using `getSimilarSongs` for the sonic tools. Its source depends on `ND_AGENTS` order, so the tool could not say whether a result is sonic.
- Starting analysis or clustering from a tool. These are multi-hour admin jobs, and the AudioMuse-AI UI and scheduler already own them.
- A mood-cluster listing tool. Clustering output is a set of Navidrome playlists, which `list_playlists` already returns.
- Calling Music Assistant's Sonic Similarity commands. They cover only the Navidrome tracks Music Assistant has played, and they have no path command. Revisit if the Music Assistant Bridge item ships and the user plays most music through Music Assistant.

## Dependencies

Other roadmap items:
- None required.
- Alignment only: if Remote Player Agent or Music Assistant Bridge adds a player-target input to `play_songs`, the release 2 sonic play tools take the same input.
- Party Mode may consume the sonic tools. That is its dependency on this item, not the reverse.
- Music Assistant Bridge: no capability needed. A sonic mix built by this item is a list of Navidrome song IDs, which the bridge can hand to Music Assistant like any other queue.

External services:
- Navidrome 0.62.0 or later for the `sonicSimilarity` extension [DIRECT: Navidrome v0.62.0 release, 2026-06-08]. 0.64.2 (2026-09-24) is current [DIRECT: releases page].
- AudioMuse-AI-NV-plugin v8 or later for the SonicSimilarity capability [DIRECT: plugin README], v10 (2026-08-31) current.
- AudioMuse-AI core, v3.6.4 (2026-10-16) current, with PostgreSQL 15.
- Navidrome `ND_PLUGINS_ENABLED=true` and `ND_AGENTS` starting with `audiomuseai` [DIRECT: Navidrome AudioMuse-AI page].

New npm packages: none. The MVP uses the existing Navidrome client. The AudioMuse REST client uses `fetchWithTimeout` and zod, which the project already has. Packages considered and rejected:

| Package | License | Status | Reason rejected |
|---|---|---|---|
| `onnxruntime-node` | MIT | 1.30.0, 2026-09-14 | Only needed for the in-project CLAP engine. 301 MB unpacked |
| `bliss-audio-ts` | MIT | 0.1.11, 2026-09-11 | Bun only |
| `essentia.js` | AGPL-3.0 | 0.1.3, last publish 2021-06-24 | Unmaintained |

## Risks

Pre-mortem. Assume the feature shipped and failed.

- Nobody uses it, because users never deploy AudioMuse-AI. Violated assumption: the target users run, or will run, a stack that needs 8 GB RAM, AVX2 and days of analysis.
- The tools break after a Navidrome, plugin or AudioMuse-AI update. Violated assumption: the three projects stay compatible, while AudioMuse-AI's own docs name version mismatch as the most common failure [DIRECT: `docs/NAVIDROME.md`].
- Results look wrong after the user upgrades Navidrome to 0.64. Violated assumption: song IDs are stable, while that release rewrites them and AudioMuse-AI needs a manual provider migration.
- The LLM calls the sonic tools for "artists fans also like" and the Last.fm tools for "sounds like". Violated assumption: tool names alone route intent. The descriptions must state the difference.
- Release 3 tools break on an AudioMuse-AI minor release. Violated assumption: an unversioned REST API keeps its response shape, while the project shipped 8 releases in 7 weeks.
- The user runs this server and Music Assistant's MCP server together, and the LLM picks Music Assistant's radio or search for "sounds like" requests, which cover only played tracks. Violated assumption: one MCP server owns sonic intent. The sonic tool descriptions should state that they cover the entire Navidrome library.
- Sonic results leak songs from a library the user deactivated. Violated assumption: Navidrome scopes extension results to the MCP's active libraries, while the extension has no library parameter.

Cheapest to guard against now: the routing risk. It costs two description sentences in the MVP (sonic tools say "sounds like", Last.fm tools say "listeners also like", each points to the other), and it prevents wrong answers even when the stack works.

## Sources

Official docs:
- https://www.navidrome.org/docs/usage/integration/audiomuse/ (modified 2026-10-16). Setup steps, `ND_AGENTS` order, endpoints the plugin powers, 404 behavior without a provider.
- https://www.navidrome.org/docs/usage/features/plugins/ (read 2026-10-17). `ND_PLUGINS_*` settings, `.ndp` packages, sandbox and host permissions.
- https://github.com/navidrome/navidrome/releases (v0.62.0 2026-06-08, v0.64.0 2026-09-12, v0.64.2 2026-09-24). Minimum version for `sonicSimilarity`, Jellyfin sonic support, plugin HTTP change.
- https://opensubsonic.netlify.app/docs/extensions/sonicsimilarity/ and the `getSonicSimilarTracks`, `findSonicPath` and `sonicMatch` pages (modified 2026-04-12). Request parameters and response shape for the MVP client.
- https://github.com/NeptuneHub/AudioMuse-AI/tree/v3.6.4/docs (`ARCHITECTURE.md`, `ALGORITHM.md`, `NAVIDROME.md`, `AUTH.md`, `PARAMETERS.md`, `FAQ.md`, `GPU.md`). Deployment, models, ID identity, Bearer auth, analysis settings.
- AudioMuse-AI Swagger UI at `http://<audiomuse-host>:8000/apidocs/` on a running instance. Field-level contract for the release 3 client.

Comparable projects' source code:
- AudioMuse-AI v3.6.4: `app_ivf.py` (similar tracks), `app_path.py` (paths), `app_clap_search.py` (text search), `app_server_context.py` (provider ID translation), `tasks/mediaserver/navidrome.py` (library reads). Response shapes and ID behavior for the REST client.
- AudioMuse-AI v3.6.4: `app_chat.py` and `tasks/ai/tools.py`. How AudioMuse-AI words tool descriptions so small models route between similarity, text and database tools. Useful for writing the sonic tool descriptions.
- https://github.com/NeptuneHub/AudioMuse-AI-NV-plugin (v10, 2026-08-31, AGPL-3.0): `main.go`, `manifest.json`. Distance-to-similarity mapping, `-1` path scores, the `server` parameter.
- https://github.com/NeptuneHub/audiomuse-ai-plugin (Jellyfin plugin, README read 2026-10-17). The media-server-as-gateway pattern.
- Navidrome v0.64.2: `core/sonic/sonic.go`, `server/subsonic/sonic_similarity.go`, `server/subsonic/opensubsonic.go`, `server/subsonic/api.go`. Provider selection, 404 behavior, extension advertisement.
- Navidrome v0.64.2: `core/matcher/matcher.go`, `scanner/phase_2_missing_tracks.go`, `model/metadata/legacy_ids.go`. Match order, ID kept on move, ID derivation.
- https://github.com/navidrome/navidrome/pull/5419 (merged 2026-04-27). Design of the SonicSimilarity plugin capability.
- https://github.com/Polochon-street/bliss-rs (crate 0.13.0, 2026-08-18, GPL-3.0-only) and https://github.com/Polochon-street/blissify-rs (0.6.1, 2025-10-09). The alternative engine and its MPD integration.
- https://github.com/CDrummond/bliss-mixer (GPL-3.0) and https://github.com/CDrummond/music-similarity (deprecated). LMS's move from musly and Essentia to bliss.
- https://github.com/dominikschnitzer/musly (MPL-2.0, 0.2 unreleased). The older timbre-similarity library.
- https://github.com/craiglush/navidrome-mood-plugin (updated 2026-03-26). A Navidrome plugin built on essentia-tensorflow.
- https://github.com/music-assistant/server tag 2.10.7 (2026-10-17, Apache-2.0): `providers/sonic_analysis/`, `providers/sonic_similarity/` (`provider.py`, `manifest.json`), `controllers/streams/audio_analysis.py`, `providers/opensubsonic/` (`parsers.py`, `sonic_provider.py`). Analysis scope, similarity commands and ID mapping for the Music Assistant comparison.
- https://github.com/music-assistant/server tag 2.10.7 and `dev` branch: `providers/fastmcp_server/` (plugin 0.17.0 at 2.10.7, 2.2.2 on `dev`, `execution.py`, `tools/`). How a music-server MCP plugin shapes tools, tags, confirmation policy and a dynamic command catalog. Useful for this project's tool design and for the overlap check.
- https://github.com/music-assistant/server tag 2.10.7: `providers/ai_radio/`. An LLM radio-host layer with TTS, a different feature from sonic similarity.
- https://music-assistant.io/audio-analysis/sonic-analysis/ and https://music-assistant.io/plugins/sonic-similarity/ (read 2026-10-17). User-facing behavior of Music Assistant's sonic features.

Specs and standards:
- OpenSubsonic `sonicSimilarity` extension version 1 (above).
- MCP specification 2025-06-18, https://modelcontextprotocol.io/specification/2025-06-18. `tools.listChanged`, which this server does not declare (`capabilities.ts:10`), so tools cannot appear without a restart.

Other:
- https://github.com/navidrome/navidrome/discussions/4332 (2025-07-11 to 2025-10-27). Maintainer stance on analyzers as plugins, bliss-rs timing (about 2 s per track on an i5-2500) [SINGLE-SOURCE].
- https://pie.gravitywell.xyz/post/122732 (about 2026-07). Navidrome maintainer's heads-up that the release after 0.63.2 rewrites all song IDs. Links https://gist.github.com/deluan/917ebc243c8b486101de857ffae6739b.
- https://newreleases.io/project/github/NeptuneHub/AudioMuse-AI/release/v3.1.1 (2026-08-01). Provider migration after the Navidrome ID change.
- https://www.soundandvision.com/content/plexamp-s-sonic-sage-uses-chatgpt-improved-discovery (2023). Plexamp Sonic Sage behavior, for the uniqueness check.
- Live read-only probe of the user's Navidrome on 2026-10-17: `ping`, `getOpenSubsonicExtensions`, `getSimilarSongs`, `getSimilarSongs2`, `getSonicSimilarTracks`, `findSonicPath`, `/api/plugin`, `/api/library`. Scripts in the session scratch folder.
