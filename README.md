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

Browse and search songs, albums, artists, genres, and tags. Filters cover the query, starred status, a single year, sort order, and tag values. They combine, such as *"all my starred jazz albums from 1994"* or *"every song tagged Soundtrack with a 5-star rating"*. Tag analysis tools show what is in your library, so you don't have to guess at filter values.

### 🔊 Local Audio Playback

> Requires [`mpv`](https://mpv.io/) on the host running the MCP server (see [mpv Installation](#mpv-installation)).

Audio plays through your machine's speakers with no browser or Navidrome web UI. Search and play in one step, such as *"play 5 random starred albums"*, *"queue everything I've starred from 1994"*, or *"add 10 random rock songs to whatever's already playing, shuffled"*. Album playback can shuffle the album order, the tracks, or both.

The queue is editable during playback. Reorder or shuffle it without interrupting the current song. Saved Navidrome radio stations (Icecast, SHOUTcast) stream through mpv with live ICY metadata, so you can see what the station is playing. Plays scrobble back to Navidrome, so play counts and recent activity stay in sync. mpv starts on first use. It can survive MCP client restarts through a per-user socket (see [MPV Remote setup](#mpv-remote-setup) for the lifetime rules). It works on Linux, macOS, and Windows 11.

This works with voice transports (Whisper STT + TTS) for a hands-free music device on a Raspberry Pi or an always-on machine.

### 🎛️ MPV Remote (Web UI)

> Requires `mpv` (same as Local Audio Playback).

A web UI at `http://localhost:8808` gives any browser the Local Playback controls. These include now playing with cover art, transport and seek, volume, and a live queue you can click to jump around, updated in real time. A built-in Play Music window searches artists, albums, and songs. It also starts any playlist, your starred songs, or your starred albums. Each pick adds to the queue or replaces it, with an option to shuffle songs or albums. So the page works as a remote without the assistant. Enable **Expose on LAN** to control playback from a phone or tablet. Audio always comes out of the machine running the server. Setup, lifetime, and security details are in [MPV Remote setup](#mpv-remote-setup).

[![MPV Remote web interface](navidome-mcp-mpv-remote-small.png)](navidome-mcp-mpv-remote-large.png)

### 🎶 Playlists

Create, update, reorder, and delete playlists. Add songs, whole albums, artist discographies, or specific discs in one operation. Find which playlists contain a given song. Build playlists from listening data: *"a 'Hidden Gems' playlist of 5-star songs with under 5 plays"* or *"one top track from each album of my top 10 artists, in chronological order"*.

### 🎼 Music Discovery (Last.fm)

> Requires a Last.fm API key (free at [last.fm/api](https://www.last.fm/api/account/create)), set in the settings page.

Find similar artists and tracks, fetch biographies and top tracks, and browse global music charts. Combine this with your library to find missing albums (*"albums missing from my top 5 artists, ranked by popularity"*), rediscover overlooked music (*"tracks similar to my favorites that I own but never play"*), or build "Best Of" playlists from what you own.

### 🎤 Synchronized Lyrics

> LRCLIB is set in the settings page and needs no API key. Lyrics stored in your files work without it.

Lyrics come from the audio file's own tags and from LRCLIB's community database. Timed lyrics carry millisecond timestamps and take priority over plain text. For each kind, the file's lyrics take priority over LRCLIB.

The web player shows a lyrics view that highlights the current line and scrolls to follow it. Click a line to jump playback there. Scrolling pauses the follow so you can read ahead. A control returns you to the current line. Font size and sync offset are adjustable. Each device keeps its own values. The screen stays awake while the view is open and playing.

[![Lyrics view](navidome-mcp-lyrics-remote-small.png)](navidome-mcp-lyrics-remote-large.png)

### 📻 Internet Radio

Manage Navidrome radio stations and discover new ones globally. `create_radio_station` probes stream URLs before adding them when `validateBeforeAdd` is set, with MP3, AAC, OGG, and FLAC detection. `validate_radio_stream` tests any public http(s) URL on demand. Both probes refuse private, loopback, and link-local addresses. SHOUTcast and Icecast metadata is extracted. Bulk maintenance works, such as *"validate all my stations and remove the broken ones"* or *"test these 10 URLs and add the working ones"*.

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
| `search_artists` | Search artists by name with a starred filter and sorting |

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
| `list_tag_values` | List tag values (genre, releasetype, media, etc.) with their counts |
| `get_tag_distribution` | Tag usage counts. Genre gives the top values by count, and other tags give an alphabetical sample |
| `get_filter_options` | Discover available filter values for search operations |

### Last.fm Discovery (requires a Last.fm API key)

| Tool | Description |
|------|-------------|
| `get_similar_artists` | Find artists similar to a given artist |
| `get_similar_tracks` | Find tracks similar to a given track |
| `get_artist_info` | Artist biography and tags |
| `get_top_tracks_by_artist` | Top tracks for an artist |
| `get_trending_music` | Trending artists, tracks, and tags from Last.fm charts |
| `get_artist_albums` | Full discography with release types, years, and genres (MusicBrainz), popularity (Last.fm), and an in-library flag per album. Answers "what albums by X am I missing?" |
| `get_album_info` | Album detail: tracklist with durations, year and type, genres, wiki summary, popularity, and library membership. Works for albums you don't own |

### Lyrics

| Tool | Description |
|------|-------------|
| `get_lyrics` | Lyrics for one song, by Navidrome song ID. Lookup by LRCLIB record ID requires the LRCLIB provider. Time-synced (LRC) lines when the source carries them |
| `search_lyrics` | Search LRCLIB by title and artist. Returns candidate records plus the matching library song. Requires the LRCLIB provider, set in the settings page |

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

**Transcode format** in [First-run setup](#first-run-setup) sets the stream format.

| Tool | Description |
|------|-------------|
| `play_songs` | Play one or many songs. `mode: 'replace' \| 'append'`, optional `shuffle` |
| `play_albums` | Play one or many albums. `mode` plus the `shuffleAlbums` and `shuffleSongs` flags |
| `play_albums_search` | Search and play albums in one step. Accepts all `search_albums` filters plus `mode`, `shuffleAlbums`, and `shuffleSongs` |
| `play_songs_search` | Search and play songs in one step. Accepts all `search_songs` filters plus `mode` and `shuffle` |
| `play_playlist` | Load a playlist's tracks into the queue by `playlistId`. Supports `mode` and `shuffle` |
| `play_radio_station` | Play a saved Navidrome radio station. Replaces the queue, since radio cannot mix with songs or albums |
| `pause` | Pause playback (position preserved) |
| `resume` | Resume playback |
| `next` | Skip to the next track |
| `previous` | Skip to the previous track |
| `seek` | Move within the current track (absolute or relative) |
| `set_volume` | Set mpv's internal volume (0-100) |
| `now_playing` | Current song ID, title, artist, album, position, duration and queue index. Radio reports the station and its ICY title. |
| `playback_status` | Engine health probe (running, mpv version, idle) without spawning mpv |
| `get_play_queue` | One page of the live queue (`limit`, `offset`) with metadata and the current-track index |
| `clear_play_queue` | Clear the queue and stop playback |
| `shuffle_play_queue` | Randomize queue order without changing membership. The current track keeps playing and moves to the top |
| `move_in_play_queue` | Move a queue entry so that it lands at the given index. Never changes what is playing |
| `remove_from_play_queue` | Remove an entry. mpv advances to the next track if the current one is removed |
| `play_queue_index` | Jump to the queue entry at the given index. Does not reorder |

## Installation & Setup

### Prerequisites

- **Node.js 20.18.1+** ([download](https://nodejs.org/))
- **A running Navidrome server**
- **An MCP-compatible client** (Claude Desktop, Claude Code, Cursor, or another MCP client with local stdio support)
- **Optional: [mpv](https://mpv.io/)** for local audio playback

### Quick Setup

Install the published package:

```bash
npm install -g navidrome-mcp
```

Update it later with `npm update -g navidrome-mcp`.

Package: [navidrome-mcp on npm](https://www.npmjs.com/package/navidrome-mcp).

For a development build:

```bash
git clone https://github.com/Blakeem/Navidrome-MCP.git
cd Navidrome-MCP
pnpm install
pnpm build
```

### MCP Client Configuration

The MCP client config only tells the client how to launch the server. Your Navidrome credentials and all options live in a local `settings.json`. No secrets go in the client JSON or environment. A browser settings page edits the file. It opens on first run (see [First-run setup](#first-run-setup)).

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

On native Windows, a client that starts the server without a shell (such as Claude Code) needs `"command": "cmd"` with `"args": ["/c", "npx", "navidrome-mcp"]`.

For a manual build, replace `command`/`args` with:

```json
"command": "node",
"args": ["/absolute/path/to/Navidrome-MCP/dist/index.js"]
```

### First-run setup

On first start without configuration, the settings page opens in your browser. This happens whether you launched the MCP server or the standalone web player (`navidrome-web`). If a browser can't open (such as over SSH), the URL is printed to the console. The unconfigured MCP server also exposes an `open_settings` tool that returns it.

On the stdio transport, the MCP server enters the same setup mode when the saved settings fail at startup. The tool notice gives the reason. Rejected settings open the settings page. An unreachable Navidrome does not, since the settings may be correct. In that case, restart the MCP client once Navidrome is reachable.

Open the settings page any time with:

```bash
navidrome-config
```

Enter your Navidrome URL, username, and password, plus any optional features. Then click **Test connection** and **Save**. This writes a local `settings.json` (shape: [`settings.example.json`](settings.example.json)) to your config directory.

- **Windows:** `%APPDATA%\navidrome-mcp\`
- **macOS:** `~/Library/Application Support/navidrome-mcp/`
- **Linux:** `~/.config/navidrome-mcp/` (or `$XDG_CONFIG_HOME/navidrome-mcp/`)

Settings load only at startup. To apply a change, quit and reopen the MCP client, or re-run `navidrome-web`. When upgrading from the old env setup, the form pre-fills from your shell environment and a `.env` file. It sees the `env` block in your MCP client's JSON only when the MCP server opens the settings page itself. Otherwise re-enter those values, or export them in the shell before running `navidrome-config`.

**Headless machines and containers:** the settings page binds loopback only, so a host with no browser (a VPS, a Docker container) is configured with environment variables instead. When no usable `settings.json` exists, the server runs from `NAVIDROME_URL`, `NAVIDROME_USERNAME`, and `NAVIDROME_PASSWORD`. Optional features read these variables.

- `LASTFM_API_KEY` enables Last.fm discovery.
- `RADIO_BROWSER_USER_AGENT` (such as `Navidrome-MCP`) enables radio discovery.
- `LYRICS_PROVIDER=lrclib` with `LRCLIB_USER_AGENT` enables LRCLIB lyrics.
- `NAVIDROME_DEFAULT_LIBRARIES` sets the default library IDs, comma separated.
- `MPV_PATH` sets the mpv binary location.
- `DEBUG=true` turns on verbose logs.

Radio discovery and lyrics stay off until their variables are set. The transport variables are listed in [HTTP Transport](#http-transport).

**Required:** Navidrome URL, username, password.

**Optional (set in the settings page):**
- **Default libraries:** comma-separated library IDs to activate by default. Blank means all.
- **Last.fm API key:** enables Last.fm discovery.
- **Radio Browser user agent:** enables global station discovery.
- **Lyrics provider (LRCLIB)** + user agent: enables lyrics fetching.
- **mpv path:** the mpv binary location if it's not on `PATH`. Blank auto-detects.
- **Transcode format:** defaults to `raw`, which streams the original file for best quality and reliable seeking. Set a codec (e.g. `mp3`, `opus`) for slow or metered links. The bitrate applies only when a codec is set.
- **Web UI** (port / host / expose / enabled / auto-open browser): configures the MPV Remote (see [MPV Remote setup](#mpv-remote-setup)). Defaults to `localhost:8808`.
- **Transport** (type / host / port): how the server exposes the MCP protocol. Defaults to `stdio`, the local transport desktop clients use. Set `type` to `http` to run the server as a network process (see [HTTP Transport](#http-transport)).

Features turn on when their settings are present.

### mpv Installation

mpv is a cross-platform media player. The server registers the playback tools when it detects mpv at startup. Without it, the server still manages your library and the saved Navidrome queue, but produces no audio.

**macOS** (via [Homebrew](https://brew.sh/)):
```bash
brew install mpv
```

If a GUI-launched MCP client does not detect Homebrew's mpv, set **mpv path** (`playback.mpvPath`) to `/opt/homebrew/bin/mpv` on Apple Silicon or `/usr/local/bin/mpv` on Intel.

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

#### Panel Lifetime

The server starts the panel as a separate `navidrome-web` process. The port binds immediately, so the page is reachable before anything plays. Hosts without mpv don't start it. The in-player gear icon opens the player settings, including the theme that every device uses.

Whether playback survives closing your AI client:

- **Default (off):** the MCP-launched player and mpv stop when the last MCP server using them closes or restarts.
- **Keep playing after the MCP server closes** (`webui.persistAfterMcpExit`, in the settings page or the gear modal): the player keeps running. Stop it with the power button.
- **Launched yourself** (`navidrome-web`, below): always runs independently. The MCP server attaches to it and never shuts it down.

mpv stops when the player stops, with no background idle timeout.

#### Standalone Player

Run the player independently of any MCP client:

```bash
navidrome-web                # after: npm install -g navidrome-mcp
# or, from a dev clone / manual build:
node dist/web/main.js
```

It reads `settings.json` and opens your browser. Run from a terminal, it stays in the foreground and stops when you close the terminal, press Ctrl+C, or click the power button. The desktop shortcut below runs it in the background. It coexists with an MCP-launched instance. The first process to bind the port owns the player, and any later one attaches to it. Logs go to `navidrome-web.log` in your config directory.

If nothing is configured yet, launching it opens the settings page instead of the player (see [First-run setup](#first-run-setup)). Fill it in and Save. Then re-launch `navidrome-web`.

#### Desktop Shortcut

Generate a double-clickable icon for your platform. It starts the player in the background with no terminal window and opens your browser. If a player is already running, it only opens the browser.

```bash
navidrome-web-shortcut       # after: npm install -g navidrome-mcp
# or, from a dev clone (see Development):
pnpm make:launcher
```

The shortcut bakes in the absolute paths to your `node` and the built player, so neither needs to be on `PATH`. It writes:

- **Linux:** `navidrome-player.desktop` on your Desktop and in your app menu (`~/.local/share/applications`). On GNOME, right-click → *Allow Launching* the first time.
- **macOS:** `Navidrome Player.app` on your Desktop (drag to `/Applications` if you like).
- **Windows:** `Navidrome Player.lnk` shortcuts on your Desktop and in the Start Menu.

Re-run the generator after moving or rebuilding the project to refresh the paths.

#### Configuration

All settings are optional and are keyed below by their `settings.json` paths. Every setting except `webui.theme` lives in the **Web UI** section of the settings page. To apply a change, stop a running player with the power button, then restart the MCP client or `navidrome-web`. The exceptions are `persistAfterMcpExit` and `theme`, which the gear modal applies live.

| Setting (`settings.json`) | Default | Effect |
|---|---|---|
| `webui.enabled` | `true` | Set `false` to disable the panel. The settings page labels it **Enable the companion control panel**. |
| `webui.port` | `8808` | Port the HTTP server listens on. Pick a free port if 8808 is taken on your host. |
| `webui.host` | `127.0.0.1` | Bind address, one of `127.0.0.1`, `0.0.0.0`, or `::`. Any other value falls back to `127.0.0.1`. A value set here overrides `webui.expose`. |
| `webui.expose` | `false` | Bind on `0.0.0.0` so other devices on your LAN can reach the panel, unless `webui.host` is set. |
| `webui.autoOpenBrowser` | `false` | Open the player in your browser when the MCP server starts. Running `navidrome-web` directly always opens a browser. |
| `webui.persistAfterMcpExit` | `false` | Keep an MCP-launched player running after the last MCP server using it closes. |
| `webui.theme` | unset | Forces `light` or `dark` on every device viewing the player. Unset, each device follows its own setting. The in-player gear modal sets it. Its **System** option clears it. |

#### Phone and Tablet Remote

1. Enable **Expose on LAN** in the settings page and Save.
2. Restart the player as [Configuration](#configuration) describes.
3. Open the player's **Network info** dialog to see its LAN URLs (e.g. `http://192.168.1.42:8808`). A player run from a terminal also prints them. Open one in your phone's browser and bookmark it.

#### Security note

The web UI has **no authentication**. Anyone who can reach the port can use two groups of features.

- **Control:** playback transport, volume, queue jumps, shuffling, clearing the queue, and starting any library source.
- **Read:** library search and browsing, recently played history, playlist names, starred counts, cover art, live now-playing and queue state, lyrics of queued songs, and the host's LAN addresses.

Who can reach the port depends on the bind address.

- With `webui.host=127.0.0.1` (the default) it's only reachable from the host machine, which is safe.
- With **Expose on LAN** (`webui.expose=true`) it's reachable from anything on the LAN. That's fine on a trusted home network. **Do not expose it to the public internet.** There is no rate limiting. Player settings and the power button stay loopback only, so a phone on your LAN can't change settings or shut the player down. The main settings page is never exposed. Once exposed, `GET /healthz` returns `404` off the host to avoid leaking a version fingerprint. Check the player's health from its host.

### HTTP Transport

By default the server speaks MCP over **stdio**. The client launches it as a child process and talks to it over stdin/stdout. This works for a desktop client on the same machine but can't be reached over a network.

Setting the transport to **`http`** makes the server bind a socket and serve the MCP [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http) at `/mcp`. It then runs as a standalone process that networked MCP clients connect to directly, with no `supergateway` or `mcp-proxy` bridge.

Add a `transport` block to your `settings.json`. `host` defaults to `127.0.0.1` (loopback only). Set `expose: true` to bind all interfaces (`0.0.0.0`) so a remote client can reach it. An explicit `host` overrides `expose`. Set `authToken` to require bearer auth. The settings page has a **Generate** button for it.

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

When a token is set, every `/mcp` request must carry `Authorization: Bearer <token>` (compared in constant time). Anything else gets a `401`. If the transport binds a non-loopback address with no token, the server logs a warning at startup. It still starts, so that a deployment locked down by a firewall or NetworkPolicy runs. `GET /healthz` is an unauthenticated liveness endpoint for container health checks. It returns `200 {"status":"ok"}` and makes no Navidrome call.

**Host filtering (DNS rebinding protection):** on the default bind (loopback with no auth token), requests whose `Host` header isn't a loopback alias are rejected, so a malicious web page can't drive the server through your browser. Setting an `authToken` or binding a non-loopback address turns the automatic filter off. A remote deployment is reached by names the server can't know in advance. The bearer token already blocks rebinding, since a lured browser can't attach your token. To pin the accepted names, set `transport.allowedHosts`, which is enforced whenever present. Each entry is the exact `Host` header value, with the port when it is not 80 or 443 (such as `mcp.example.com:3000`). Set `transport.allowedOrigins` only for browser clients. It gates the `Origin` header.

The transport can also be configured through environment variables: `MCP_TRANSPORT` (`stdio`|`http`), `MCP_HTTP_HOST`, `MCP_HTTP_PORT`, `MCP_HTTP_EXPOSE` (`true` to bind all interfaces), `MCP_HTTP_AUTH_TOKEN`, and `MCP_HTTP_ALLOWED_HOSTS` / `MCP_HTTP_ALLOWED_ORIGINS` (comma-separated). The web UI has a matching `WEBUI_*` family (`WEBUI_ENABLED`, `WEBUI_PORT`, `WEBUI_HOST`, `WEBUI_EXPOSE`, `WEBUI_AUTO_OPEN_BROWSER`, `WEBUI_PERSIST_AFTER_MCP_EXIT`). These follow the headless fallback rule in [First-run setup](#first-run-setup). They also pre-fill the settings form on first run.

> **Single account, shared state:** every HTTP session is served by one process holding one authenticated Navidrome account, and the active-library selection is process-global. A `set_active_libraries` call changes the library filter for all connected sessions, and `get_user_details` reflects that shared selection.

> **Security:** the server holds an authenticated Navidrome session, so an open port is full library control with no credential. When the port is reachable beyond loopback, set an auth token or restrict access with a firewall, a Kubernetes NetworkPolicy, or a reverse proxy that adds TLS. Keep the default `stdio` transport unless you need remote access.

**Where the audio comes out.** mpv runs next to the server process, so the machine running the server makes the sound, whatever the transport. HTTP on a machine outside a container gives remote MCP access with working playback.

1. Run the server on the machine wired to your speakers.
2. Point remote clients at `http://that-machine:3000/mcp`.
3. Set an `authToken`.

A container gives an always-on endpoint for the library tools only (search, playlists, ratings, radio metadata, Last.fm, lyrics) with no audio. For containers, see **[Running in Docker](https://github.com/Blakeem/Navidrome-MCP/blob/main/docs/DOCKER.md)**. It covers the image, deployment shapes, mounted config, and audio caveats.

### A Note on ChatGPT Desktop

ChatGPT's MCP support (web and desktop) requires a hosted HTTPS endpoint and does not work with local stdio servers. This server can serve MCP over HTTP (see [HTTP Transport](#http-transport)), so you can host it behind a reverse proxy that terminates TLS instead of a bridge like [`mcp-remote`](https://www.npmjs.com/package/mcp-remote). For a self-hosted music server, it is simpler to use Claude Desktop, Claude Code, Cursor, or another client with stdio support.

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

**Desktop shortcut**
- If the shortcut opens nothing, read `navidrome-web.log` beside `settings.json` (see [First-run setup](#first-run-setup)). Fix the settings with `navidrome-config`, then launch the shortcut again.

### Known Limitations

- **No audio without mpv.** Use the Navidrome web UI or a Subsonic client instead (see [mpv Installation](#mpv-installation)).
- **Recently played shows one play per track.** Navidrome stores each track's last play time, not a full play history.
- **Saved queue ≠ live queue.** The saved-queue tools (`get_saved_queue`, `save_queue`, `clear_saved_queue`) operate on Navidrome's server-side queue (web UI sync). The live-queue tools (`get_play_queue`, `clear_play_queue`, `shuffle_play_queue`, `move_in_play_queue`, `remove_from_play_queue`, `play_queue_index`) operate on the live mpv queue.

## Development

Start from the development build in [Quick Setup](#quick-setup).

```bash
node dist/config-app/main.js   # opens the settings page. Fill in and Save.

pnpm dev          # hot reload
pnpm test         # watch-mode tests
pnpm test:run     # one-shot tests
pnpm check:all    # lint + typecheck (src and tests) + dead-code
pnpm build        # production bundle
```

The published package may lag behind `dev`. `pnpm build` also bundles the web UI's static assets into `dist/`. The MCP server and the player both run from that `dist/`. [MPV Remote setup](#mpv-remote-setup) covers running the player and the desktop shortcut from a dev build.

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
