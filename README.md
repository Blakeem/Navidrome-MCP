# Navidrome MCP Server

Turn your Navidrome music server into a conversational music assistant. This MCP (Model Context Protocol) server lets Claude Desktop, Claude Code, Cursor, and other MCP-compatible clients browse and curate your library, build playlists, discover new music, and play audio directly through your machine's speakers.

## Table of Contents

- [Features](#features)
- [Available Tools](#available-tools)
- [Installation & Setup](#installation--setup)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)
- [Support](#support)

## Features

### 🎵 Music Library

Browse and search songs, albums, artists, genres, and tags with rich filtering: query, starred status, year range, sort order, tag values, and more. Combine filters to ask things like *"all my starred jazz albums from the 90s, sorted by year"* or *"every song tagged Soundtrack with a 5-star rating"*. Tag analysis tools surface what's actually in your library so you don't have to guess at filter values.

### 🔊 Local Audio Playback

> Requires [`mpv`](https://mpv.io/) on the host running the MCP server (see [Installing mpv](#installing-mpv-optional)).

Audio plays through your machine's speakers, no browser or Navidrome web UI needed. Search and play in a single step: *"play 5 random starred albums"*, *"queue everything I've starred from the 90s sorted by year"*, *"add 10 random rock songs to whatever's already playing, shuffled"*. Albums get three shuffle modes: keep order, randomize album order, or fully interleave tracks.

The live queue stays editable during playback: reorder or shuffle without interrupting the current song (shuffle keeps it playing and reshuffles the rest), and removing the current track auto-advances to the next. Saved Navidrome radio stations (Icecast, SHOUTcast, etc.) stream through mpv with live ICY metadata, so you can see what the station is playing. Plays scrobble back to Navidrome, keeping your play counts and recently-played in sync. mpv is lazy-spawned on first use, can survive MCP client restarts via a per-user socket (see [MPV Remote setup](#mpv-remote-setup) for the lifetime rules), and works on Linux, macOS, and Windows 11.

This design is built for conversational control and pairs cleanly with voice transports (Whisper STT + TTS) to build a hands-free music device on a Raspberry Pi or always-on machine.

### 🎛️ MPV Remote (Web UI)

> Requires `mpv` (same as Local Audio Playback). On by default; starts with the server.

A companion web UI at `http://localhost:8808` that gives any browser direct access to the Local Playback tools: now-playing with cover art, transport and seek controls, volume, and a live queue you can click to jump around, all updated in real time. Beyond the tools, a built-in picker starts any playlist, your starred songs, or your starred albums straight from the page, so it works as a real remote without touching the assistant. Enable **Expose on LAN** to control playback from a phone or tablet; audio always comes out of the machine running the server. Setup, lifetime, and security details: [MPV Remote setup](#mpv-remote-setup).

[![MPV Remote web interface](navidome-mcp-mpv-remote-small.png)](navidome-mcp-mpv-remote-large.png)

### 🎶 Playlists

Create, update, reorder, and delete playlists conversationally. Add content flexibly in one operation: single songs, entire albums, whole artist discographies, or specific discs. Find which playlists contain a given song. Build dynamic playlists from listening data: *"a 'Hidden Gems' playlist of 5-star songs with under 5 plays"*, *"one top track from each album of my top 10 artists, in chronological order"*.

### 🎼 Music Discovery (Last.fm)

> Requires a Last.fm API key (free at [last.fm/api](https://www.last.fm/api/account/create)), set in the settings page.

Find similar artists and tracks, fetch biographies and top tracks, and browse global music charts. Combine with your library to do gap analysis (*"albums missing from my top 5 artists, ranked by popularity"*), rediscover overlooked music (*"tracks similar to my favorites that I own but never play"*), or build curated "Best Of" playlists scoped to what you actually own.

### 🎤 Synchronized Lyrics

> Enabled in the settings page (LRCLIB provider + a user agent). No API key needed.

Fetch time-synced lyrics with millisecond-precision timestamps (LRC format) and plain-text fallbacks from LRCLIB's community database. Matched automatically by title, artist, album, and duration.

### 📻 Internet Radio

Manage Navidrome radio stations and discover new ones globally. Stream URLs are validated before adding (MP3, AAC, OGG, FLAC detection) and SHOUTcast/Icecast metadata is extracted automatically. Bulk maintenance is supported: *"validate all my stations and remove the broken ones"* or *"test these 10 URLs and add the working ones"*.

Global station discovery via Radio Browser (requires a Radio Browser user agent, set in the settings page) covers thousands of stations filterable by genre, country, language, codec, bitrate, and popularity, with vote and click registration so your usage feeds the community ranking.

### 📊 Listening Analytics

Access play counts, recently-played activity, top-rated and most-played listings, and tag distribution across your library. Use this to drive taste analysis (*"genres I'm playing more vs. less this year"*), discover forgotten favorites, identify one-hit-wonders in your collection, or build mood-based playlists from your listening patterns.

### ⭐ Ratings & Favorites

Star/unstar songs, albums, and artists, set 0-5 star ratings, and list everything starred or top-rated. Read and write the saved Navidrome queue used by the web UI for cross-device sync.

### 📚 Multi-Library Support

Filter all operations to a subset of your Navidrome libraries, either by setting a default in the settings page (**Default libraries**, `library.defaultLibraryIds`) or by switching active libraries at runtime.

## Available Tools

Tool categories whose heading says **requires ...** are only registered when that configuration is present.

### Core System

| Tool | Description |
|------|-------------|
| `test_connection` | Verify Navidrome connectivity and report feature/tool availability |

### Library Management

| Tool | Description |
|------|-------------|
| `get_song` | Detailed song metadata by ID |
| `get_album` | Detailed album metadata by ID |
| `get_artist` | Detailed artist metadata by ID |
| `get_song_playlists` | List all playlists containing a given song |
| `get_user_details` | User profile, available libraries, and active-library status |
| `set_active_libraries` | Set which libraries are active for all search/list operations |

### Search

| Tool | Description |
|------|-------------|
| `search_all` | Search across artists, albums, and songs with filters and sorting |
| `search_songs` | Search songs with advanced filters and sorting |
| `search_albums` | Search albums with advanced filters and sorting |
| `search_artists` | Search artists with advanced filters and sorting |

### Playlists

| Tool | Description |
|------|-------------|
| `list_playlists` | View all accessible playlists |
| `get_playlist` | Get playlist metadata by ID |
| `create_playlist` | Create a new playlist |
| `update_playlist` | Update name, description, or visibility |
| `delete_playlist` | Delete a playlist |
| `get_playlist_tracks` | Get playlist contents (JSON or M3U) |
| `add_tracks_to_playlist` | Add songs, albums, artist discographies, or specific discs in one operation |
| `remove_tracks_from_playlist` | Remove tracks by position |
| `reorder_playlist_track` | Move a track to a new position |

### Ratings & Favorites

| Tool | Description |
|------|-------------|
| `star_item` | Star a song, album, or artist |
| `unstar_item` | Remove a star |
| `set_rating` | Set a 0-5 star rating |
| `list_starred_items` | View starred songs, albums, or artists |
| `list_top_rated` | View highest-rated items |

### Listening History & Saved Queue

| Tool | Description |
|------|-------------|
| `list_recently_played` | Recent listening activity with optional time-range filter |
| `list_most_played` | Most-played songs, albums, or artists |
| `get_saved_queue` | Read the Navidrome saved queue (web UI sync) |
| `save_queue` | Save a queue to Navidrome for web UI sync |
| `clear_saved_queue` | Clear the Navidrome saved queue |

### Metadata & Tags

| Tool | Description |
|------|-------------|
| `search_by_tags` | Search by tag values (genre, releasetype, media, etc.) |
| `get_tag_distribution` | Tag usage counts across the library |
| `get_filter_options` | Discover available filter values for search operations |

### Last.fm Discovery (requires a Last.fm API key)

| Tool | Description |
|------|-------------|
| `get_similar_artists` | Find artists similar to a given artist |
| `get_similar_tracks` | Find tracks similar to a given track |
| `get_artist_info` | Artist biography and tags |
| `get_top_tracks_by_artist` | Top tracks for an artist |
| `get_trending_music` | Trending artists, tracks, and tags from Last.fm charts |
| `get_artist_albums` | Full discography with release types/years (MusicBrainz), genres and popularity (Last.fm), and an in-library flag per album. Answers "what albums by X am I missing?" |
| `get_album_info` | Single-album deep dive: tracklist with durations, year/type, genres, wiki summary, popularity, and library membership. Works for albums you don't own |

### Lyrics (requires the LRCLIB provider, set in the settings page)

| Tool | Description |
|------|-------------|
| `get_lyrics` | Time-synced (LRC) and plain-text lyrics, matched by title/artist/album/duration |

### Radio Management

| Tool | Description |
|------|-------------|
| `list_radio_stations` | List all saved Navidrome radio stations |
| `get_radio_station` | Detailed info for a station by ID |
| `create_radio_station` | Create one or more stations (JSON array, optional `validateBeforeAdd`) |
| `delete_radio_station` | Delete a station |
| `validate_radio_stream` | Test an http(s) stream URL for accessibility and audio content |

### Global Radio Discovery (requires a Radio Browser user agent)

| Tool | Description |
|------|-------------|
| `discover_radio_stations` | Find stations globally via Radio Browser |
| `get_radio_filters` | Available filter values (tags, countries, languages, codecs) |
| `get_station_by_uuid` | Detailed Radio Browser station info |
| `click_station` | Register a play click for popularity metrics |
| `vote_station` | Vote for a station |

### Local Playback (requires [`mpv`](https://mpv.io/))

Audio plays through the host's speakers. mpv is lazy-spawned on first use and can survive MCP client restarts via a per-user IPC socket (see [MPV Remote setup](#mpv-remote-setup)). Playback streams the original file by default; set **Transcode format** to a codec for constrained bandwidth (see [First-run setup](#first-run-setup)).

| Tool | Description |
|------|-------------|
| `play_songs` | Play one or many songs; `mode: 'replace' \| 'append'`, optional `shuffle` |
| `play_albums` | Play one or many albums; `mode` plus `shuffle: 'none' \| 'albums' \| 'songs'` (preserve, randomize album order, or fully interleave) |
| `play_albums_search` | One-shot filter-driven album playback; accepts all `search_albums` filters plus `mode`/`shuffle` |
| `play_songs_search` | One-shot filter-driven song playback; accepts all `search_songs` filters plus `mode`/`shuffle` |
| `play_playlist` | One-shot load every track of a Navidrome playlist into the queue by `playlistId`; supports `mode` and `shuffle` |
| `play_radio_station` | Play a saved Navidrome radio station; replaces the queue (mutually exclusive with songs/albums) |
| `pause` | Pause playback (position preserved) |
| `resume` | Resume playback |
| `next` | Skip to the next track |
| `previous` | Skip to the previous track |
| `seek` | Move within the current track (absolute or relative) |
| `set_volume` | Set mpv's internal volume (0-100) |
| `now_playing` | Current title/artist/album/position/duration and queue index (or station + ICY metadata for radio) |
| `playback_status` | Engine health probe (running, mpv version, idle) without spawning mpv |
| `get_play_queue` | Snapshot of the live queue with metadata and current-track index |
| `clear_play_queue` | Clear the queue and stop playback |
| `shuffle_play_queue` | Randomize queue order (membership unchanged); the current track keeps playing and is lifted to the top |
| `move_in_play_queue` | Move a queue entry between indices; never changes what's currently playing |
| `remove_from_play_queue` | Remove an entry; mpv auto-advances if the current track is removed |
| `play_queue_index` | Jump directly to the queue entry at the given index; does not reorder |

## Installation & Setup

### Prerequisites

- **Node.js 20+** ([download](https://nodejs.org/))
- **A running Navidrome server**
- **An MCP-compatible client** (Claude Desktop, Claude Code, Cursor, or another MCP client with local stdio support)
- **Optional: [mpv](https://mpv.io/)** for local audio playback

### Quick Setup

Install the published package (auto-updates on launch):

```bash
npm install -g navidrome-mcp
```

Package: [navidrome-mcp on npm](https://www.npmjs.com/package/navidrome-mcp).

For a development build:

```bash
git clone https://github.com/Blakeem/Navidrome-MCP.git
cd Navidrome-MCP
pnpm install
pnpm build
```

### Configure Your MCP Client

The MCP client config does just one thing: tell it how to *launch* the server. Your Navidrome credentials and all options live in a local `settings.json`, edited through a browser-based settings page (no secrets in the client JSON or environment). The settings page opens automatically on first run (see [First-run setup](#first-run-setup)).

For Claude Desktop, edit `claude_desktop_config.json` (locations: `%APPDATA%/Claude/` on Windows, `~/Library/Application Support/Claude/` on macOS, `~/.config/Claude/` on Linux). Other MCP clients use the same JSON shape.

```json
{
  "mcpServers": {
    "navidrome": {
      "command": "npx",
      "args": ["navidrome-mcp"]
    }
  }
}
```

For a manual build, replace `command`/`args` with:

```json
"command": "node",
"args": ["/absolute/path/to/Navidrome-MCP/dist/index.js"]
```

### First-run setup

On first start without configuration, the **settings page** opens automatically in your browser, whether you launched the MCP server or the standalone web player (`navidrome-web`) first. If a browser can't open (e.g. over SSH), the URL is printed to the console, and the unconfigured MCP server also exposes an `open_settings` tool that returns it. You can open the settings page any time with:

```bash
npx navidrome-config
```

Enter your Navidrome URL, username, and password (plus any optional features), click **Test connection**, then **Save**. This writes a local `settings.json` (shape: [`settings.example.json`](settings.example.json)). Settings load at startup and don't hot-reload, so restart whatever you launched to apply them: the MCP client (quit and reopen, e.g. Claude Desktop) or the web player (re-run `navidrome-web`). Upgrading from the old env-based setup? The form pre-fills from your previous `env`/`.env` values; verify and save.

**Headless machines / containers:** the settings page binds loopback-only, so on a host with no browser (a VPS, a Docker container) configure with **environment variables** instead: when no `settings.json` exists, the server runs directly from `NAVIDROME_URL`, `NAVIDROME_USERNAME`, and `NAVIDROME_PASSWORD` (plus any optional variables such as `MCP_TRANSPORT`, `LASTFM_API_KEY`, ...). A `settings.json`, once created, always takes precedence over env.

**Required:** Navidrome URL, username, password.

**Optional (set in the settings page):**
- **Default libraries:** comma-separated library IDs to activate by default; blank = all.
- **Last.fm API key:** enables Last.fm discovery features.
- **Radio Browser user agent:** enables global station discovery.
- **Lyrics provider (LRCLIB)** + user agent: enables lyrics fetching.
- **mpv path:** point at the mpv binary if it's not on `PATH`; blank auto-detects.
- **Transcode format:** defaults to `raw` (streams the original file untouched for best quality and reliable seeking). Set a codec (e.g. `mp3`, `opus`) to transcode for slow/metered links; the bitrate applies then.
- **Web UI** (port / host / expose / enabled / auto-open browser): configures the MPV Remote (see [MPV Remote setup](#mpv-remote-setup); defaults to `localhost:8808`).
- **Transport** (type / host / port): how the server exposes the MCP protocol. Defaults to `stdio`, the standard local-process transport every desktop client uses. Set `type` to `http` to run the server as a long-lived network process instead (see [Running over HTTP](#running-over-http)).

Features turn on automatically when their settings are present. Restart your MCP client after saving.

### Installing mpv (optional)

mpv is a lightweight, cross-platform media player. When detected at startup, the server registers the playback toolset so audio streams through your machine's speakers. Without it, the server still manages your library and Navidrome's saved queue; it just doesn't produce audio.

**macOS** (via [Homebrew](https://brew.sh/)):
```bash
brew install mpv
```

**Linux:**
```bash
sudo apt install mpv       # Debian / Ubuntu / Mint / PopOS
sudo dnf install mpv       # Fedora / RHEL / CentOS Stream
sudo pacman -S mpv         # Arch / Manjaro
sudo zypper install mpv    # openSUSE
```

**Windows:**
```powershell
winget install shinchiro.mpv   # winget is included on Windows 11
scoop install mpv
choco install mpv
```

> Use the full ID `shinchiro.mpv`; plain `winget install mpv` prompts you to disambiguate from an unofficial Store package. The shinchiro build is the one [mpv.io](https://mpv.io/installation/) points to for Windows.
>
> **Windows `PATH` note.** The `shinchiro.mpv` package installs to `C:\Program Files\MPV Player\` and does **not** add itself to `PATH`. Either:
> - Add that folder to your `PATH` (System Properties → Environment Variables → Path → New), then open a new terminal, or
> - Set **mpv path** in the settings page (`playback.mpvPath`) to the full `mpv.exe` path, e.g. `C:\Program Files\MPV Player\mpv.exe`.
>
> Other install methods (scoop, choco, manual zip) use different folders. If `mpv --version` fails in a fresh terminal, locate `mpv.exe` and apply one of the fixes above.

Or a pre-built binary from [mpv.io](https://mpv.io/installation/). Verify with `mpv --version`, then restart your MCP client so the server re-detects mpv.

### MPV Remote setup

#### Enabling & lifetime

On by default: the server starts it as a separate `navidrome-web` process and the port binds immediately, so the page is reachable before anything plays. Hosts without mpv don't start it. Player settings live behind the in-player gear icon; the gear and power buttons only appear for browsers on the host machine.

Whether playback survives closing your AI client:

- **Default (off):** the MCP-launched player and mpv stop when the MCP server closes or restarts.
- **Keep playing after the MCP server closes** (`webui.persistAfterMcpExit`, in the settings page or the gear modal): the player keeps running; stop it later with the power button.
- **Launched yourself** (`navidrome-web`, below): always runs independently; the MCP server attaches to it and never shuts it down.

mpv stops exactly when the player stops (no background idle timeout). To disable the panel entirely, uncheck **Enable the companion control panel** in the settings page (`webui.enabled`).

#### Running it standalone

Run the player independently of any MCP client:

```bash
navidrome-web                # after: npm install -g navidrome-mcp
# or, from a dev clone / manual build:
node dist/web/main.js
```

It reads `settings.json`, opens your browser, and runs in the background until you stop it with the power button in the UI. It coexists with an MCP-launched instance: whoever binds the configured port first owns it and the other attaches to it. Logs go to `navidrome-web.log` in your config directory.

If nothing is configured yet, launching it brings up the settings page instead of the player (see [First-run setup](#first-run-setup)); fill it in, Save, then re-launch `navidrome-web`.

#### Desktop shortcut (recommended)

Generate a double-clickable icon for your platform. It starts the player in the background with no terminal window and opens your browser; if a player is already running, it just opens the browser.

```bash
navidrome-web-shortcut       # after: npm install -g navidrome-mcp
# or, from a dev clone (see Development):
pnpm make:launcher
```

The shortcut bakes in the absolute paths to your `node` and the built player, so it works without anything on `PATH`. It writes:

- **Linux:** `Navidrome Player.desktop` on your Desktop and in your app menu (`~/.local/share/applications`). On GNOME, right-click → *Allow Launching* the first time.
- **macOS:** `Navidrome Player.app` on your Desktop (drag to `/Applications` if you like).
- **Windows:** `Navidrome Player.vbs` on your Desktop and Start Menu. (A OneDrive-redirected Desktop puts it there.)

Re-run the generator after moving or rebuilding the project to refresh the baked-in paths.

#### Configuration

All optional; they live in the **Web UI** section of the settings page, keyed below by their `settings.json` paths. Restart the client after saving (except `persistAfterMcpExit`, which the gear modal applies live).

| Setting (`settings.json`) | Default | Effect |
|---|---|---|
| `webui.enabled` | `true` | Disable the panel entirely. |
| `webui.port` | `8808` | Port the HTTP server listens on. Pick a free port if 8808 is taken on your host. |
| `webui.host` | `127.0.0.1` | Bind address. Override only if you know which interface you want; usually **Expose on LAN** is the right knob. |
| `webui.expose` | `false` | Bind on `0.0.0.0` so other devices on your LAN can reach the panel. |
| `webui.autoOpenBrowser` | `false` | Open the player in your browser automatically when the MCP server starts. (Running `navidrome-web` directly always opens a browser regardless.) |
| `webui.persistAfterMcpExit` | `false` | Keep an MCP-launched player (and mpv) running after the MCP server closes/restarts. Toggle it live in the in-player gear modal too. |

#### Using it as a phone/tablet remote

1. Enable **Expose on LAN** in the settings page and Save.
2. Restart the MCP client (or restart `navidrome-web`).
3. The player logs the LAN URLs it's reachable on at bind time (e.g. `http://192.168.1.42:8808`). Open one in your phone's browser and bookmark it; the picker works immediately, no assistant needed.

#### Security note

The web UI has **no authentication**: anyone who can reach the port can pause, skip, seek, change volume, and jump around the queue.

- With `webui.host=127.0.0.1` (the default) it's only reachable from the host machine, which is safe.
- With **Expose on LAN** (`webui.expose=true`) it's reachable from anything on the LAN. That's usually fine on a trusted home network, but **do not expose it directly to the public internet**; there's no rate-limiting or auth, and the control API allows queue manipulation and starting playlists. Player settings and the power button stay loopback-only (and hidden for remote browsers), so a phone on your LAN can control playback but can't change settings or shut the player down. The browser-based main settings page is likewise never exposed. Once exposed, `GET /healthz` returns `404` off-box (to avoid leaking a version fingerprint), so health-check the player from inside its host.

### Running over HTTP

By default the server speaks MCP over **stdio**: the client launches it as a child process and talks to it over stdin/stdout. That's ideal for a desktop client on the same machine, but it can't be reached over a network.

Setting the transport to **`http`** makes the server bind a socket and serve the MCP [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http) at `/mcp` instead, so it can run as a standalone, always-on process that networked MCP clients connect to directly, with no external `supergateway`/`mcp-proxy` bridge.

Add a `transport` block to your `settings.json`. `host` defaults to `127.0.0.1` (loopback only); set `expose: true` to bind all interfaces (`0.0.0.0`) so a remote client can reach it; an explicit `host` overrides this. Set `authToken` to require bearer auth, recommended whenever the port is reachable beyond loopback (the settings page has a **Generate** button for it):

```json
"transport": {
  "type": "http",
  "port": 3000,
  "expose": true,
  "authToken": "a-long-random-secret"
}
```

Point an HTTP-capable MCP client at `http://<host>:<port>/mcp`:

```json
{
  "mcpServers": {
    "navidrome": {
      "type": "http",
      "url": "http://your-host:3000/mcp",
      "headers": { "Authorization": "Bearer a-long-random-secret" }
    }
  }
}
```

When a token is set, every `/mcp` request must carry `Authorization: Bearer <token>` (compared in constant time); anything else gets a `401`. If the transport binds a non-loopback address with **no** token, the server logs a loud warning at startup rather than refusing to start, so a firewalled or NetworkPolicy-locked deployment keeps zero-friction. `GET /healthz` is never gated: it's an unauthenticated liveness endpoint (returns `200 {"status":"ok"}`) for container and orchestrator health checks, and it performs no Navidrome call.

**Host filtering (DNS-rebinding protection):** on the default bind (loopback with no auth token), requests whose `Host` header isn't a loopback alias are rejected, so a malicious web page can't drive the server through your own browser. Setting an `authToken` or binding a non-loopback address turns the automatic filter **off**: a remote deployment is reached by names the server can't know in advance, and the bearer gate already blocks rebinding (a lured browser can't attach your token). To pin the accepted names explicitly, set `transport.allowedHosts`, which is always enforced when present. Set `transport.allowedOrigins` only for browser clients (it gates the `Origin` header).

The transport can also be configured entirely through environment variables: `MCP_TRANSPORT` (`stdio`|`http`), `MCP_HTTP_HOST`, `MCP_HTTP_PORT`, `MCP_HTTP_EXPOSE` (`true` to bind all interfaces), `MCP_HTTP_AUTH_TOKEN`, and `MCP_HTTP_ALLOWED_HOSTS` / `MCP_HTTP_ALLOWED_ORIGINS` (comma-separated). The web UI has a matching `WEBUI_*` family (`WEBUI_ENABLED`, `WEBUI_PORT`, `WEBUI_HOST`, `WEBUI_EXPOSE`, `WEBUI_AUTO_OPEN_BROWSER`, `WEBUI_PERSIST_AFTER_MCP_EXIT`). These apply two ways: as the **runtime config** whenever no `settings.json` exists (the headless/container path), and as **pre-fill** for the settings form on first run.

> **Single account, shared state:** every HTTP session is served by one process holding a single authenticated Navidrome account, and the active-library selection is process-global. A `set_active_libraries` call changes the library filter for **all** connected sessions, and `get_user_details` reflects that shared selection; there is no per-session library scoping under the HTTP transport.

> **Security:** the HTTP transport binds **loopback (`127.0.0.1`) by default** and is **unauthenticated unless you set `transport.authToken`**. The server holds an already-authenticated Navidrome session, so an open port is full library control with no credential. Exposing it beyond localhost is a deliberate opt-in (`expose: true`, or an explicit non-loopback `host`); when you do, set an auth token **and/or** restrict access with a firewall, a Kubernetes NetworkPolicy, or a reverse proxy that adds TLS. Keep the default `stdio` transport unless you specifically need remote access.

**Where the audio comes out.** The transport decides who can reach the MCP protocol; it does not move the audio. mpv runs next to the server process, so the machine running the server is always the machine that makes the sound. Running HTTP directly on a machine (not in a container) is the one shape that gives you remote MCP access *and* working playback: run the server on the machine wired to your speakers, point remote clients at `http://that-machine:3000/mcp`, and set an `authToken`. A container gives you an always-on, **library-only** endpoint (search, playlists, ratings, radio metadata, Last.fm, lyrics) with no audio.

Deploying in a container? See **[Running in Docker](https://github.com/Blakeem/Navidrome-MCP/blob/main/docs/DOCKER.md)**: the image, what each deployment shape gives you, mounted config, and the audio caveats.

### A Note on ChatGPT Desktop

ChatGPT's MCP support (web and desktop) requires a hosted HTTPS endpoint and isn't compatible with local stdio servers. This server can serve MCP directly over HTTP (see [Running over HTTP](#running-over-http)), so you can host it behind a reverse proxy that terminates TLS instead of reaching for an external bridge like [`mcp-remote`](https://www.npmjs.com/package/mcp-remote). For a self-hosted music server, though, it's still simplest to use Claude Desktop, Claude Code, Cursor, or another client with native stdio support.

## Troubleshooting

**Connection problems**
- Verify Navidrome is running and reachable
- Ensure the **Navidrome URL** in the settings page includes the protocol (`http://` or `https://`)
- Use the settings page's **Test connection** button (or test credentials with `curl` / a browser) before saving

**macOS-specific**
- See the [macOS Troubleshooting Guide](https://github.com/Blakeem/Navidrome-MCP/blob/main/docs/MACOS_TROUBLESHOOTING.md) (commonly: Node.js path not found; fix with symlinks or full paths)

**Configuration**
- Use absolute paths in config files
- Validate JSON (no trailing commas)
- Restart your MCP client after changes

### Known Limitations

- **No audio without mpv.** When mpv isn't installed the library and saved-queue tools still work, but audio playback isn't available; use the Navidrome web UI or a Subsonic client.
- **Recently-played has no timestamps.** Navidrome exposes play counts and completion status, not last-played times.
- **Saved queue ≠ live queue.** The `*_saved_queue` tools operate on Navidrome's server-side advisory queue (web UI sync). The `*_play_queue` tools operate on the local mpv playlist. They are independent.

## Development

```bash
git clone https://github.com/Blakeem/Navidrome-MCP.git
cd Navidrome-MCP
pnpm install
pnpm build
node dist/config-app/main.js   # opens the settings page; fill in + Save
# (writes settings.json to your OS config dir; see settings.example.json)

pnpm dev          # hot reload
pnpm test         # watch-mode tests
pnpm test:run     # one-shot tests
pnpm check:all    # lint + typecheck + dead-code
pnpm build        # production bundle
```

### Testing the standalone web player from a dev build

This is the from-source path for trying the player **before it's published to npm** (the published package may lag behind `dev`). It applies to the MCP server too; both run from the same `dist/`.

```bash
# 1. Build (also bundles the web UI's static assets into dist/)
pnpm build

# 2. Configure if needed; writes settings.json to your OS config dir
node dist/config-app/main.js     # opens the settings page; fill in + Save

# 3. Run the standalone player directly
node dist/web/main.js            # serves http://127.0.0.1:8808 and opens your browser
```

To make a double-clickable icon out of that build (no global install needed):

```bash
pnpm make:launcher               # writes a shortcut to your Desktop + app menu
```

**Windows notes** (PowerShell):

- Use `pnpm build` then `node dist\web\main.js`, same as above with backslashes.
- `pnpm make:launcher` writes `Navidrome Player.vbs` to your Desktop **and** Start Menu; it launches `node dist\web\main.js` with **no console window** and bakes in the absolute path to *this* checkout, so don't move the folder afterward (re-run it if you do).
- If a redirected/OneDrive Desktop hides the file, the Start Menu copy still works (Start → type "Navidrome").
- mpv must be installed and discoverable for playback to start; set `playback.mpvPath` in the settings page if it isn't on `PATH`.

When you publish, `npm install -g navidrome-mcp` puts `navidrome-web`, `navidrome-config`, and `navidrome-web-shortcut` on the user's `PATH`, so the same flows become `navidrome-web` / `navidrome-config` / `navidrome-web-shortcut` with no clone or build.

Testing with [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
pnpm build
npx @modelcontextprotocol/inspector node dist/index.js                  # web UI
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call --tool-name search_all --tool-arg query="jazz"    # CLI
```

## License

- **Code:** [AGPL-3.0](LICENSE)
- **Documentation:** CC-BY-SA-4.0

## Support

- [GitHub Issues](https://github.com/Blakeem/Navidrome-MCP/issues)
- [GitHub Discussions](https://github.com/Blakeem/Navidrome-MCP/discussions)

---

**Built with ❤️ for the Navidrome community**
