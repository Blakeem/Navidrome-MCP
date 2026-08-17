# Navidrome MCP Server

An MCP (Model Context Protocol) server for Navidrome. Claude Desktop, Claude Code, Cursor, and other MCP clients can browse your library, build playlists, discover new music, and play audio through your machine's speakers.

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

Browse and search songs, albums, artists, genres, and tags. Filters cover query, starred status, year range, sort order, and tag values, and they combine: *"all my starred jazz albums from the 90s, sorted by year"* or *"every song tagged Soundtrack with a 5-star rating"*. Tag analysis tools show what is in your library, so you don't have to guess at filter values.

### 🔊 Local Audio Playback

> Requires [`mpv`](https://mpv.io/) on the host running the MCP server (see [Installing mpv](#installing-mpv-optional)).

Audio plays through your machine's speakers with no browser or Navidrome web UI. Search and play in one step: *"play 5 random starred albums"*, *"queue everything I've starred from the 90s sorted by year"*, or *"add 10 random rock songs to whatever's already playing, shuffled"*. Albums have three shuffle modes: keep order, randomize album order, or interleave tracks.

The queue is editable during playback: reorder or shuffle without interrupting the current song, and removing the current track advances to the next. Saved Navidrome radio stations (Icecast, SHOUTcast) stream through mpv with live ICY metadata, so you can see what the station is playing. Plays scrobble back to Navidrome, so play counts and recent activity stay in sync. mpv starts on first use, can survive MCP client restarts through a per-user socket (see [MPV Remote setup](#mpv-remote-setup) for the lifetime rules), and works on Linux, macOS, and Windows 11.

This works with voice transports (Whisper STT + TTS) for a hands-free music device on a Raspberry Pi or an always-on machine.

### 🎛️ MPV Remote (Web UI)

> Requires `mpv` (same as Local Audio Playback). On by default and starts with the server.

A web UI at `http://localhost:8808` gives any browser the Local Playback controls: now playing with cover art, transport and seek, volume, and a live queue you can click to jump around, updated in real time. A built-in picker starts any playlist, your starred songs, or your starred albums from the page, so it works as a remote without the assistant. Enable **Expose on LAN** to control playback from a phone or tablet. Audio always comes out of the machine running the server. Setup, lifetime, and security details are in [MPV Remote setup](#mpv-remote-setup).

[![MPV Remote web interface](navidome-mcp-mpv-remote-small.png)](navidome-mcp-mpv-remote-large.png)

### 🎶 Playlists

Create, update, reorder, and delete playlists. Add songs, whole albums, artist discographies, or specific discs in one operation. Find which playlists contain a given song. Build playlists from listening data: *"a 'Hidden Gems' playlist of 5-star songs with under 5 plays"* or *"one top track from each album of my top 10 artists, in chronological order"*.

### 🎼 Music Discovery (Last.fm)

> Requires a Last.fm API key (free at [last.fm/api](https://www.last.fm/api/account/create)), set in the settings page.

Find similar artists and tracks, fetch biographies and top tracks, and browse global music charts. Combine this with your library to find missing albums (*"albums missing from my top 5 artists, ranked by popularity"*), rediscover overlooked music (*"tracks similar to my favorites that I own but never play"*), or build "Best Of" playlists from what you own.

### 🎤 Synchronized Lyrics

> Enabled in the settings page (LRCLIB provider + a user agent). No API key needed.

Fetch time-synced lyrics (LRC format, millisecond timestamps) from LRCLIB's community database, matched by title, artist, album, and duration. Plain text is returned when no synced version exists.

### 📻 Internet Radio

Manage Navidrome radio stations and discover new ones globally. Stream URLs are validated before they are added (MP3, AAC, OGG, and FLAC detection), and SHOUTcast/Icecast metadata is extracted. Bulk maintenance works: *"validate all my stations and remove the broken ones"* or *"test these 10 URLs and add the working ones"*.

Global discovery uses Radio Browser (requires a user agent, set in the settings page). It covers thousands of stations with filters for genre, country, language, codec, bitrate, and popularity. Votes and clicks are registered, so your usage feeds the community ranking.

### 📊 Listening Analytics

Access play counts, recent activity, top-rated and most-played listings, and tag distribution across your library. Use this to compare habits (*"genres I'm playing more vs. less this year"*), find forgotten favorites and one-hit wonders, or build mood playlists from your listening patterns.

### ⭐ Ratings & Favorites

Star and unstar songs, albums, and artists. Set 0-5 star ratings and list everything starred or top-rated. Read and write the saved Navidrome queue that the web UI uses for cross-device sync.

### 📚 Multi-Library Support

Filter all operations to a subset of your Navidrome libraries. Set a default in the settings page (**Default libraries**, `library.defaultLibraryIds`) or switch active libraries at runtime.

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
| `get_artist_albums` | Full discography with release types and years (MusicBrainz), genres and popularity (Last.fm), and an in-library flag per album. Answers "what albums by X am I missing?" |
| `get_album_info` | Album detail: tracklist with durations, year and type, genres, wiki summary, popularity, and library membership. Works for albums you don't own |

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

Playback streams the original file by default (see **Transcode format** in [First-run setup](#first-run-setup)).

| Tool | Description |
|------|-------------|
| `play_songs` | Play one or many songs. `mode: 'replace' \| 'append'`, optional `shuffle` |
| `play_albums` | Play one or many albums. `mode` plus `shuffle: 'none' \| 'albums' \| 'songs'` (keep order, randomize album order, or interleave tracks) |
| `play_albums_search` | Search and play albums in one step. Accepts all `search_albums` filters plus `mode` and `shuffle` |
| `play_songs_search` | Search and play songs in one step. Accepts all `search_songs` filters plus `mode` and `shuffle` |
| `play_playlist` | Load a playlist's tracks into the queue by `playlistId`. Supports `mode` and `shuffle` |
| `play_radio_station` | Play a saved Navidrome radio station. Replaces the queue, since radio cannot mix with songs or albums |
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
| `shuffle_play_queue` | Randomize queue order without changing membership. The current track keeps playing and moves to the top |
| `move_in_play_queue` | Move a queue entry between indices. Never changes what is playing |
| `remove_from_play_queue` | Remove an entry. mpv advances to the next track if the current one is removed |
| `play_queue_index` | Jump to the queue entry at the given index. Does not reorder |

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

The MCP client config only tells the client how to launch the server. Your Navidrome credentials and all options live in a local `settings.json`, edited through a browser settings page, so no secrets go in the client JSON or environment. The settings page opens on first run (see [First-run setup](#first-run-setup)).

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

On first start without configuration, the settings page opens in your browser. This happens whether you launched the MCP server or the standalone web player (`navidrome-web`). If a browser can't open (e.g. over SSH), the URL is printed to the console, and the unconfigured MCP server exposes an `open_settings` tool that returns it. Open the settings page any time with:

```bash
npx navidrome-config
```

Enter your Navidrome URL, username, and password, plus any optional features. Then click **Test connection** and **Save**. This writes a local `settings.json` (shape: [`settings.example.json`](settings.example.json)). Settings load at startup and don't hot reload, so restart what you launched: quit and reopen the MCP client, or re-run `navidrome-web`. When upgrading from the old env setup, the form pre-fills from your previous `env`/`.env` values. Verify and save.

**Headless machines and containers:** the settings page binds loopback only, so a host with no browser (a VPS, a Docker container) is configured with environment variables instead. When no `settings.json` exists, the server runs from `NAVIDROME_URL`, `NAVIDROME_USERNAME`, and `NAVIDROME_PASSWORD`, plus optional variables such as `MCP_TRANSPORT` and `LASTFM_API_KEY`. A `settings.json`, once created, always wins over env.

**Required:** Navidrome URL, username, password.

**Optional (set in the settings page):**
- **Default libraries:** comma-separated library IDs to activate by default. Blank means all.
- **Last.fm API key:** enables Last.fm discovery.
- **Radio Browser user agent:** enables global station discovery.
- **Lyrics provider (LRCLIB)** + user agent: enables lyrics fetching.
- **mpv path:** the mpv binary location if it's not on `PATH`. Blank auto-detects.
- **Transcode format:** defaults to `raw`, which streams the original file for best quality and reliable seeking. Set a codec (e.g. `mp3`, `opus`) for slow or metered links. The bitrate applies only when a codec is set.
- **Web UI** (port / host / expose / enabled / auto-open browser): configures the MPV Remote (see [MPV Remote setup](#mpv-remote-setup)). Defaults to `localhost:8808`.
- **Transport** (type / host / port): how the server exposes the MCP protocol. Defaults to `stdio`, the local transport desktop clients use. Set `type` to `http` to run the server as a network process (see [Running over HTTP](#running-over-http)).

Features turn on when their settings are present.

### Installing mpv (optional)

mpv is a cross-platform media player. The server registers the playback tools when it detects mpv at startup. Without it, the server still manages your library and the saved Navidrome queue, but produces no audio.

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

> Use the full ID `shinchiro.mpv`. Plain `winget install mpv` prompts you to pick between it and an unofficial Store package. The shinchiro build is the one [mpv.io](https://mpv.io/installation/) links for Windows.
>
> **Windows `PATH` note.** The `shinchiro.mpv` package installs to `C:\Program Files\MPV Player\` and does **not** add itself to `PATH`. Either:
> - Add that folder to your `PATH` (System Properties → Environment Variables → Path → New), then open a new terminal, or
> - Set **mpv path** in the settings page (`playback.mpvPath`) to the full `mpv.exe` path, e.g. `C:\Program Files\MPV Player\mpv.exe`.
>
> Other install methods (scoop, choco, manual zip) use different folders. If `mpv --version` fails in a fresh terminal, locate `mpv.exe` and apply one of the fixes above.

A pre-built binary from [mpv.io](https://mpv.io/installation/) also works. Verify with `mpv --version`. Then restart your MCP client so the server re-detects mpv.

### MPV Remote setup

#### Enabling & lifetime

The panel is on by default. The server starts it as a separate `navidrome-web` process and the port binds immediately, so the page is reachable before anything plays. Hosts without mpv don't start it. Player settings live behind the in-player gear icon, and the gear and power buttons only appear for browsers on the host machine.

Whether playback survives closing your AI client:

- **Default (off):** the MCP-launched player and mpv stop when the MCP server closes or restarts.
- **Keep playing after the MCP server closes** (`webui.persistAfterMcpExit`, in the settings page or the gear modal): the player keeps running. Stop it with the power button.
- **Launched yourself** (`navidrome-web`, below): always runs independently. The MCP server attaches to it and never shuts it down.

mpv stops when the player stops, with no background idle timeout. To disable the panel, uncheck **Enable the companion control panel** in the settings page (`webui.enabled`).

#### Running it standalone

Run the player independently of any MCP client:

```bash
navidrome-web                # after: npm install -g navidrome-mcp
# or, from a dev clone / manual build:
node dist/web/main.js
```

It reads `settings.json`, opens your browser, and runs in the background until you stop it with the power button. It coexists with an MCP-launched instance: the process that binds the port first owns it and the other attaches. Logs go to `navidrome-web.log` in your config directory.

If nothing is configured yet, launching it opens the settings page instead of the player (see [First-run setup](#first-run-setup)). Fill it in and Save. Then re-launch `navidrome-web`.

#### Desktop shortcut (recommended)

Generate a double-clickable icon for your platform. It starts the player in the background with no terminal window and opens your browser. If a player is already running, it only opens the browser.

```bash
navidrome-web-shortcut       # after: npm install -g navidrome-mcp
# or, from a dev clone (see Development):
pnpm make:launcher
```

The shortcut bakes in the absolute paths to your `node` and the built player, so it works with nothing on `PATH`. It writes:

- **Linux:** `Navidrome Player.desktop` on your Desktop and in your app menu (`~/.local/share/applications`). On GNOME, right-click → *Allow Launching* the first time.
- **macOS:** `Navidrome Player.app` on your Desktop (drag to `/Applications` if you like).
- **Windows:** `Navidrome Player.vbs` on your Desktop and Start Menu. (A OneDrive-redirected Desktop puts it there.)

Re-run the generator after moving or rebuilding the project to refresh the paths.

#### Configuration

All settings are optional and live in the **Web UI** section of the settings page, keyed below by their `settings.json` paths. Restart the client after saving. The exception is `persistAfterMcpExit`, which the gear modal applies live.

| Setting (`settings.json`) | Default | Effect |
|---|---|---|
| `webui.enabled` | `true` | Set `false` to disable the panel. |
| `webui.port` | `8808` | Port the HTTP server listens on. Pick a free port if 8808 is taken on your host. |
| `webui.host` | `127.0.0.1` | Bind address. Override only if you need a specific interface. Usually **Expose on LAN** is the right setting. |
| `webui.expose` | `false` | Bind on `0.0.0.0` so other devices on your LAN can reach the panel. |
| `webui.autoOpenBrowser` | `false` | Open the player in your browser when the MCP server starts. Running `navidrome-web` directly always opens a browser. |
| `webui.persistAfterMcpExit` | `false` | Keep an MCP-launched player (and mpv) running after the MCP server closes or restarts. Toggle it live in the in-player gear modal. |

#### Using it as a phone/tablet remote

1. Enable **Expose on LAN** in the settings page and Save.
2. Restart the MCP client (or restart `navidrome-web`).
3. The player logs the LAN URLs it's reachable on at bind time (e.g. `http://192.168.1.42:8808`). Open one in your phone's browser and bookmark it.

#### Security note

The web UI has **no authentication**. Anyone who can reach the port can pause, skip, seek, change volume, and jump around the queue.

- With `webui.host=127.0.0.1` (the default) it's only reachable from the host machine, which is safe.
- With **Expose on LAN** (`webui.expose=true`) it's reachable from anything on the LAN. That's fine on a trusted home network, but **do not expose it to the public internet**. There is no rate limiting, and the control API allows queue changes and starting playlists. Player settings and the power button stay loopback only and are hidden for remote browsers, so a phone on your LAN can control playback but can't change settings or shut the player down. The main settings page is never exposed. Once exposed, `GET /healthz` returns `404` off the host to avoid leaking a version fingerprint, so check the player's health from its host.

### Running over HTTP

By default the server speaks MCP over **stdio**. The client launches it as a child process and talks to it over stdin/stdout. This works for a desktop client on the same machine but can't be reached over a network.

Setting the transport to **`http`** makes the server bind a socket and serve the MCP [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http) at `/mcp`. It then runs as a standalone process that networked MCP clients connect to directly, with no `supergateway` or `mcp-proxy` bridge.

Add a `transport` block to your `settings.json`. `host` defaults to `127.0.0.1` (loopback only). Set `expose: true` to bind all interfaces (`0.0.0.0`) so a remote client can reach it, and an explicit `host` overrides `expose`. Set `authToken` to require bearer auth. This is recommended whenever the port is reachable beyond loopback, and the settings page has a **Generate** button for it:

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

When a token is set, every `/mcp` request must carry `Authorization: Bearer <token>` (compared in constant time), and anything else gets a `401`. If the transport binds a non-loopback address with no token, the server logs a warning at startup instead of refusing to start, so a deployment locked down by a firewall or NetworkPolicy still runs. `GET /healthz` is never gated. It is an unauthenticated liveness endpoint for container health checks, returns `200 {"status":"ok"}`, and makes no Navidrome call.

**Host filtering (DNS rebinding protection):** on the default bind (loopback with no auth token), requests whose `Host` header isn't a loopback alias are rejected, so a malicious web page can't drive the server through your browser. Setting an `authToken` or binding a non-loopback address turns the automatic filter off. A remote deployment is reached by names the server can't know in advance, and the bearer token already blocks rebinding (a lured browser can't attach your token). To pin the accepted names, set `transport.allowedHosts`, which is enforced whenever present. Set `transport.allowedOrigins` only for browser clients. It gates the `Origin` header.

The transport can also be configured through environment variables: `MCP_TRANSPORT` (`stdio`|`http`), `MCP_HTTP_HOST`, `MCP_HTTP_PORT`, `MCP_HTTP_EXPOSE` (`true` to bind all interfaces), `MCP_HTTP_AUTH_TOKEN`, and `MCP_HTTP_ALLOWED_HOSTS` / `MCP_HTTP_ALLOWED_ORIGINS` (comma-separated). The web UI has a matching `WEBUI_*` family (`WEBUI_ENABLED`, `WEBUI_PORT`, `WEBUI_HOST`, `WEBUI_EXPOSE`, `WEBUI_AUTO_OPEN_BROWSER`, `WEBUI_PERSIST_AFTER_MCP_EXIT`). These apply when no `settings.json` exists, and they pre-fill the settings form on first run (see [First-run setup](#first-run-setup)).

> **Single account, shared state:** every HTTP session is served by one process holding one authenticated Navidrome account, and the active-library selection is process-global. A `set_active_libraries` call changes the library filter for all connected sessions, and `get_user_details` reflects that shared selection.

> **Security:** the server holds an authenticated Navidrome session, so an open port is full library control with no credential. Exposing the port beyond localhost is an opt-in (`expose: true`, or an explicit non-loopback `host`). When you do, set an auth token or restrict access with a firewall, a Kubernetes NetworkPolicy, or a reverse proxy that adds TLS. Keep the default `stdio` transport unless you need remote access.

**Where the audio comes out.** The transport decides who can reach the MCP protocol and does not move the audio. mpv runs next to the server process, so the machine running the server makes the sound. HTTP on a machine outside a container gives remote MCP access with working playback: run the server on the machine wired to your speakers, point remote clients at `http://that-machine:3000/mcp`, and set an `authToken`. A container gives an always-on endpoint for the library tools only (search, playlists, ratings, radio metadata, Last.fm, lyrics) with no audio.

For containers, see **[Running in Docker](https://github.com/Blakeem/Navidrome-MCP/blob/main/docs/DOCKER.md)**: the image, deployment shapes, mounted config, and audio caveats.

### A Note on ChatGPT Desktop

ChatGPT's MCP support (web and desktop) requires a hosted HTTPS endpoint and does not work with local stdio servers. This server can serve MCP over HTTP (see [Running over HTTP](#running-over-http)), so you can host it behind a reverse proxy that terminates TLS instead of a bridge like [`mcp-remote`](https://www.npmjs.com/package/mcp-remote). For a self-hosted music server, it is simpler to use Claude Desktop, Claude Code, Cursor, or another client with stdio support.

## Troubleshooting

**Connection problems**
- Verify Navidrome is running and reachable
- Ensure the **Navidrome URL** in the settings page includes the protocol (`http://` or `https://`)
- Use the settings page's **Test connection** button (or test credentials with `curl` / a browser) before saving

**macOS-specific**
- See the [macOS Troubleshooting Guide](https://github.com/Blakeem/Navidrome-MCP/blob/main/docs/MACOS_TROUBLESHOOTING.md). The common issue is a Node.js path not found, fixed with symlinks or full paths.

**Configuration**
- Use absolute paths in config files
- Validate JSON (no trailing commas)
- Restart your MCP client after changes

### Known Limitations

- **No audio without mpv.** Use the Navidrome web UI or a Subsonic client instead (see [Installing mpv](#installing-mpv-optional)).
- **Recently played has no timestamps.** Navidrome exposes play counts and completion status, not when a track was last played.
- **Saved queue ≠ live queue.** The `*_saved_queue` tools operate on Navidrome's server-side queue (web UI sync). The `*_play_queue` tools operate on the local mpv playlist.

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

This is the from-source path for trying the player before a release reaches npm (the published package may lag behind `dev`). It applies to the MCP server too, since both run from the same `dist/`.

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
- `pnpm make:launcher` writes `Navidrome Player.vbs` to your Desktop and Start Menu. It launches `node dist\web\main.js` with no console window and bakes in the absolute path to this checkout, so re-run it after moving the folder.
- If a redirected/OneDrive Desktop hides the file, the Start Menu copy still works (Start → type "Navidrome").
- mpv must be installed for playback. Set `playback.mpvPath` in the settings page if it isn't on `PATH`.

After `npm install -g navidrome-mcp`, the same flows run as `navidrome-web`, `navidrome-config`, and `navidrome-web-shortcut` with no clone or build.

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
