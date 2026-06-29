# Navidrome MCP Server

Turn your Navidrome music server into a conversational music assistant. This MCP (Model Context Protocol) server lets Claude Desktop, Claude Code, Cursor, and other MCP-compatible clients browse and curate your library, build playlists, discover new music, and play audio directly through your machine's speakers.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [MPV Remote (Web UI)](#mpv-remote-web-ui)
- [Available Tools](#available-tools)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

## Features

### 🎵 Music Library

Browse and search songs, albums, artists, genres, and tags with rich filtering: query, starred status, year range, sort order, tag values, and more. Combine filters to ask things like *"all my starred jazz albums from the 90s, sorted by year"* or *"every song tagged Soundtrack with a 5-star rating"*. Tag analysis tools surface what's actually in your library so you don't have to guess at filter values.

### 🔊 Local Audio Playback

> Requires [`mpv`](https://mpv.io/) on the host running the MCP server (see [Installing mpv](#installing-mpv-optional)).

Audio plays through your machine's speakers, no browser or Navidrome web UI needed. Search and play in a single step: *"play 5 random starred albums"*, *"queue everything I've starred from the 90s sorted by year"*, *"add 10 random rock songs to whatever's already playing, shuffled"*. Three shuffle modes for albums (keep order, randomize album order, fully interleave tracks).

The live queue is actively manipulable: reorder and shuffle tracks without interrupting what's playing — shuffle keeps the current song going and reshuffles the rest around it — and removing the current track auto-advances to the next. Saved Navidrome radio stations (Icecast, SHOUTcast, etc.) stream through mpv with ICY metadata flowing through so you can see what the station is currently playing. Plays scrobble back to Navidrome so your recently-played and play counts stay in sync with what you actually listen to through mpv. mpv is lazy-spawned on first use, survives MCP client restarts via a per-user socket, and works on Linux, macOS, and Windows 11.

This design is built for conversational control and pairs cleanly with voice transports (Whisper STT + TTS) to build a hands-free music device on a Raspberry Pi or always-on machine.

### 🎛️ MPV Remote (Standalone Web Player)

> Requires `mpv` (same as Local Audio Playback). On by default; starts with the server.

A companion web UI at `http://localhost:8808` for controlling local mpv playback from any browser: a now-playing card with cover art, transport controls, a seek bar, volume, and a live queue you can click to jump around. A built-in playlist picker starts any Navidrome playlist straight from the page, so it works as a real remote, not just a now-playing mirror. Expose it on your LAN to use a phone or tablet to control playback. See [MPV Remote (Web UI)](#mpv-remote-web-ui) for setup, lifetime, and the security note.

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

## Installation

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

The MCP client config does just one thing: tell it how to *launch* the server. Your
Navidrome credentials and all options live in a local `settings.json`, edited through a
browser-based settings page (no secrets in the client JSON or environment). The settings
page opens automatically on first run (see [First-run setup](#first-run-setup)).

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

On first start without configuration, the **settings page** opens automatically in your
browser. This happens whether you launched the MCP server or the standalone web player
(`navidrome-web`) first; either one, run unconfigured, brings it up. If a browser can't
open (e.g. over SSH), the URL is printed to the console, and the unconfigured MCP server
also exposes an `open_settings` tool that returns it. You can open the settings page any
time with:

```bash
npx navidrome-config
```

Enter your Navidrome URL, username, and password (plus any optional features), click
**Test connection**, then **Save**. This writes a local `settings.json` (shape:
[`settings.example.json`](settings.example.json)). Settings load at startup and don't
hot-reload, so restart whatever you launched to apply them: the MCP client (quit and
reopen, e.g. Claude Desktop) or the web player (re-run `navidrome-web`). If the web
player brought up the settings page itself, it stays open for further edits and
self-closes when idle; re-launch `navidrome-web` to start playing. Upgrading from the old
env-based setup? The form pre-fills from your previous `env`/`.env` values; verify and
save.

**Required:** Navidrome URL, username, password.

**Optional (set in the settings page):**
- **Default libraries:** comma-separated library IDs to activate by default; blank = all.
- **Last.fm API key:** enables Last.fm discovery features.
- **Radio Browser user agent:** enables global station discovery.
- **Lyrics provider (LRCLIB)** + user agent: enables lyrics fetching.
- **mpv path:** point at the mpv binary if it's not on `PATH`; blank auto-detects.
- **Transcode format:** defaults to `raw` (streams the original file untouched for best quality and reliable seeking). Set a codec (e.g. `mp3`, `opus`) to transcode for slow/metered links; the bitrate applies then.
- **Web UI** (port / host / expose / enabled / auto-open browser): configures the [MPV Remote web UI](#mpv-remote-web-ui) (defaults to `localhost:8808`).
- **Transport** (type / host / port): how the server exposes the MCP protocol itself. Defaults to `stdio` (the standard local-process transport every desktop client uses). Set `type` to `http` to serve the [Streamable HTTP transport](#running-over-http-containers--remote-clients) instead — for running the server as a long-lived process that remote clients connect to over the network.

Features turn on automatically when their settings are present. Restart your MCP client after saving.

### Running over HTTP (containers / remote clients)

By default the server speaks MCP over **stdio**: the client launches it as a child
process and talks to it over stdin/stdout. That's ideal for a desktop client on the same
machine, but it can't be reached over a network.

Setting the transport to **`http`** makes the server bind a socket and serve the MCP
[Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http)
at `/mcp` instead. This lets you run it as a standalone, always-on process — for example
a container in the same Kubernetes namespace as Navidrome — and point networked MCP
clients at it directly, with no external `supergateway`/`mcp-proxy` bridge.

Add a `transport` block to your `settings.json`. `host` defaults to `127.0.0.1`
(loopback only); set `expose: true` to bind all interfaces (`0.0.0.0`) so a remote or in-cluster client can reach it; an explicit `host` overrides this. Set `authToken` to require bearer auth (recommended whenever the port is reachable beyond loopback):

```json
"transport": {
  "type": "http",
  "port": 3000,
  "expose": true,
  "authToken": "a-long-random-secret"
}
```

The settings page has a **Generate** button next to the auth-token field. When a token is
set, every `/mcp` request must carry `Authorization: Bearer <token>` (compared in constant
time); anything else gets a `401`. `/healthz` is never gated. If the transport binds a
non-loopback address with **no** token, the server logs a loud warning at startup rather
than refusing to start, so a NetworkPolicy-locked deployment keeps zero-friction.

The MCP endpoint is then served at `http://<host>:<port>/mcp`. Point an HTTP-capable MCP
client at that URL (add the `Authorization` header if you set a token):

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

In HTTP mode the server also exposes an unauthenticated liveness endpoint at
`GET /healthz` (returns `200 {"status":"ok"}`) for container/orchestrator health
checks — it reports only that the HTTP server is up, and performs no Navidrome call.

On first run the settings form also pre-fills the transport from these environment
variables (import-only, like all other settings): `MCP_TRANSPORT` (`stdio`|`http`),
`MCP_HTTP_HOST`, `MCP_HTTP_PORT`, `MCP_HTTP_EXPOSE` (`true` to bind all interfaces), and
`MCP_HTTP_AUTH_TOKEN`.

> **Security:** the HTTP transport binds **loopback (`127.0.0.1`) by default** and is
> **unauthenticated unless you set `transport.authToken`** — the server holds an
> already-authenticated Navidrome session, so an open port is full library control with no
> credential. Exposing it beyond localhost is a deliberate opt-in (`expose: true`, or an
> explicit non-loopback `host`); when you do, set an auth token **and/or** restrict access
> with a Kubernetes NetworkPolicy, a firewall, or a reverse proxy that adds TLS. Keep the
> default `stdio` transport unless you specifically need remote access.

#### Running in Docker

A [`Dockerfile`](Dockerfile) is included for exactly this HTTP-transport use case. The
image reads its config from a mounted `settings.json` (it points
`NAVIDROME_CONFIG_PATH` at `/config/settings.json`), so create one with `transport.type`
set to `http` and `transport.expose: true` — a container must bind `0.0.0.0` (not the default loopback) to be reachable through the published port — then mount it:

```bash
docker build -t navidrome-mcp .
docker run --rm -p 3000:3000 \
  -v "$PWD/settings.json:/config/settings.json:ro" \
  navidrome-mcp
```

The MCP endpoint is then at `http://localhost:3000/mcp`, with the `GET /healthz` liveness endpoint available for an orchestrator probe. The container runs as a non-root user. (mpv
playback isn't included in the image — it's meant as a headless, networked MCP server.)

### Installing mpv (optional)

mpv is a lightweight, cross-platform media player. When detected at startup, the server registers an additional set of playback tools so audio streams through your machine's speakers. Without it, the server still manages your library and Navidrome's saved queue; it just doesn't produce audio.

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

### A Note on ChatGPT Desktop

ChatGPT's MCP support (web and desktop) requires a hosted HTTPS endpoint and isn't compatible with local stdio servers. This server can now serve MCP directly over HTTP — see [Running over HTTP](#running-over-http-containers--remote-clients) — so you can host it behind a reverse proxy that terminates TLS instead of reaching for an external bridge like [`mcp-remote`](https://www.npmjs.com/package/mcp-remote). For a self-hosted music server, though, it's still simplest to use Claude Desktop, Claude Code, Cursor, or another client with native stdio support.

## MPV Remote (Web UI)

When local audio playback is active, the server runs a companion web interface: a now-playing display and transport-control remote. Open it in any browser on the host (or anywhere on your LAN once exposed).

[![MPV Remote web interface](navidome-mcp-mpv-remote-small.png)](navidome-mcp-mpv-remote-large.png)

### What it does

- **Now-playing card:** cover art, title, artist, album, and queue position. A `Live` indicator confirms the SSE stream is healthy.
- **Transport controls:** previous / pause-resume / next, with a seek bar showing position and remaining time.
- **Volume slider:** drives mpv's internal volume (independent of your OS volume).
- **Queue list:** every track with title, artist · album, and duration. Click a row to jump to it; the **clear** icon empties the queue and stops playback.
- **Playlist picker:** the playlist icon opens your Navidrome playlists; pick one to start it (Replace or Add to queue, with optional Shuffle).
- **Gear + power buttons (host only):** the top bar shows a **gear** (player settings, including "keep playing after the MCP server closes") and a **power** button that stops mpv and the player. Both are hidden for remote (LAN) browsers.
- **Live updates:** Server-Sent Events push state changes as they happen (throttled to ~1 Hz) and auto-reconnect on disconnect.

### Enabling & lifetime

On by default, it starts with the server as a separate `navidrome-web` process; the port binds immediately, so the page and its playlist picker are reachable before anything plays. Hosts without mpv don't start it.

**Does it keep playing after you close the AI?**

- **Default (off):** the MCP-launched player and mpv stop when you close or restart the MCP server.
- **Keep playing after the MCP server closes** (`webui.persistAfterMcpExit`, in the settings page or the in-player gear modal): the player keeps running after you close the AI; stop it later with the **power** button.
- **Launched it yourself** (`navidrome-web`, below): always runs independently; the MCP server attaches to it and never shuts it down.

mpv stops exactly when the player stops (no background idle timeout).

To disable the panel entirely, uncheck **Enable the companion control panel** in the settings page (`webui.enabled`).

### Running it standalone (without an MCP client)

Launch the player directly to run it independently of any MCP client. It reads the `settings.json` and opens your browser automatically. A standalone launch always persists: it runs in the background until you stop it with the **power** button in the UI. It **coexists** with an MCP-launched instance: whoever binds the configured port first owns it and the other connects to it (an MCP server attaches rather than replacing or stopping it). Logs go to `navidrome-web.log` in your config directory.

> **Configure first.** The player needs your Navidrome details in `settings.json`. If it isn't configured yet, launching it brings up the **settings page** instead of the player (see [First-run setup](#first-run-setup)). Fill it in and Save, then re-launch `navidrome-web` to start playing. The setup page self-closes when idle, so it never lingers. You can also configure ahead of time with `npx navidrome-config`.

#### Desktop shortcut (recommended)

Generate a double-clickable icon for your platform. It starts the player in the background with **no terminal window** and opens your browser; if a player is already running, it just opens the browser. Stop it with the **power** button in the UI.

```bash
navidrome-web-shortcut       # after: npm install -g navidrome-mcp
# or, from a dev clone (see Development):
pnpm make:launcher
```

This bakes the absolute paths to your `node` and the built player into the shortcut, so it works without anything on your `PATH`. It writes:

- **Linux:** `Navidrome Player.desktop` on your Desktop **and** in your app menu (`~/.local/share/applications`). On GNOME, right-click → *Allow Launching* the first time.
- **macOS:** `Navidrome Player.app` on your Desktop (drag to `/Applications` if you like).
- **Windows:** `Navidrome Player.vbs` on your Desktop **and** Start Menu. (If your Desktop is redirected into OneDrive, it lands there.)

Re-run the generator any time you move or rebuild the project to refresh the baked-in paths.

#### From the command line

```bash
navidrome-web                # after: npm install -g navidrome-mcp
# or, from a dev clone / manual build:
node dist/web/main.js
```

### Configuration

All of these are optional and live in the **Web UI** section of the settings page (`navidrome-config`); the keys below are their `settings.json` paths. Restart the client after saving (except `persistAfterMcpExit`, which the in-player gear modal applies live).

| Setting (`settings.json`) | Default | Effect |
|---|---|---|
| `webui.enabled` | `true` | Disable the panel entirely. |
| `webui.port` | `8808` | Port the HTTP server listens on. Pick a free port if 8808 is taken on your host. |
| `webui.host` | `127.0.0.1` | Bind address. Override only if you know which interface you want; usually **Expose on LAN** is the right knob. |
| `webui.expose` | `false` | Bind on `0.0.0.0` so other devices on your LAN can reach the panel. |
| `webui.autoOpenBrowser` | `false` | Open the player in your browser automatically when the MCP server starts. (Running `navidrome-web` directly always opens a browser regardless.) |
| `webui.persistAfterMcpExit` | `false` | Keep an MCP-launched player (and mpv) running after the MCP server closes/restarts. Toggle it live in the in-player gear modal too. |

When **Expose on LAN** is enabled, the player logs the LAN URLs it's reachable on at bind time (e.g. `http://192.168.1.42:8808`). Open one of those on your phone or tablet.

### Using it as a phone/tablet remote

1. Enable **Expose on LAN** in the settings page and Save.
2. Restart the MCP client (or restart `navidrome-web`).
3. Open the LAN URL from the startup log in your phone's browser. The player is reachable immediately; start a playlist from the picker without touching the assistant. Bookmark it for one-tap access (the page is a single static bundle, no install required).

### Security note

The web UI has **no authentication**: anyone who can reach the port can pause, skip, seek, change volume, and jump around the queue.

- With `webui.host=127.0.0.1` (the default) it's only reachable from the host machine, which is safe.
- With **Expose on LAN** (`webui.expose=true`) it's reachable from anything on the LAN. That's usually fine on a trusted home network, but **do not expose it directly to the public internet**. There's no rate-limiting, no auth, and the control API allows queue manipulation and starting playlists. The **player settings and the power button are loopback-only** (and hidden in the UI for remote browsers), so a phone on your LAN can control playback but can't change settings or shut the server down. The browser-based main settings page is likewise never exposed.

## Available Tools

Tools marked **conditional** are only registered when the corresponding configuration is present.

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
| `get_artist_albums` | Full discography with release types/years (MusicBrainz), genres + popularity (Last.fm), and an in-library flag per album — "what albums by X am I missing?" |
| `get_album_info` | Single-album deep dive: tracklist with durations, year/type, genres, wiki summary, popularity, and library membership — works for albums you don't own |

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

Audio plays through the host's speakers. mpv is lazy-spawned on first use and survives MCP client restarts via a per-user IPC socket. Playback streams the original file by default; set **Transcode format** to a codec for constrained bandwidth (see [First-run setup](#first-run-setup)).

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

## Troubleshooting

**Connection problems**
- Verify Navidrome is running and reachable
- Ensure the **Navidrome URL** in the settings page includes the protocol (`http://` or `https://`)
- Use the settings page's **Test connection** button (or test credentials with `curl` / a browser) before saving

**macOS-specific**
- See the [macOS Troubleshooting Guide](docs/MACOS_TROUBLESHOOTING.md) (commonly: Node.js path not found; fix with symlinks or full paths)

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
