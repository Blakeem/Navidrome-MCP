# Navidrome MCP Server

Turn your Navidrome music server into a conversational music assistant. This MCP (Model Context Protocol) server lets Claude, Cursor, and other MCP-compatible AI clients browse and curate your library, build playlists, discover new music, and — when [mpv](https://mpv.io/) is installed — play audio directly through your machine's speakers.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Available Tools](#available-tools)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

## Features

### Music Library

Browse and search songs, albums, artists, genres, and tags with rich filtering — query, starred status, year range, sort order, tag values, and more. Combine filters to ask things like *"all my starred jazz albums from the 90s, sorted by year"* or *"every song tagged Soundtrack with a 5-star rating"*. Tag analysis tools surface what's actually in your library so you don't have to guess at filter values.

### Local Audio Playback

> Requires [`mpv`](https://mpv.io/) on the host running the MCP server (see [Installing mpv](#installing-mpv-optional)).

Audio plays through your machine's speakers — no browser, no Navidrome web UI. Search and play in a single step: *"play 5 random starred albums"*, *"queue everything I've starred from the 90s sorted by year"*, *"add 10 random rock songs to whatever's already playing, shuffled"*. Three shuffle modes for albums (keep order, randomize album order, fully interleave tracks).

The live queue is actively manipulable — move a track to the front and it starts playing, shuffle and the new top plays, remove the current track and the next one auto-advances. Saved Navidrome radio stations (Icecast, SHOUTcast, etc.) stream through mpv with ICY metadata flowing through so you can see what the station is currently playing. mpv is lazy-spawned on first use, survives MCP client restarts via a per-user socket, and works on Linux, macOS, and Windows 11.

This design is built for conversational control and pairs cleanly with voice transports (Whisper STT + TTS) to build a hands-free music device on a Raspberry Pi or always-on machine.

### Playlists

Create, update, reorder, and delete playlists conversationally. Add content flexibly — single songs, entire albums, whole artist discographies, or specific discs — in one operation. Find which playlists contain a given song. Build dynamic playlists from listening data: *"a 'Hidden Gems' playlist of 5-star songs with under 5 plays"*, *"one top track from each album of my top 10 artists, in chronological order"*.

### Music Discovery (Last.fm)

> Requires `LASTFM_API_KEY`. Free key at [last.fm/api](https://www.last.fm/api/account/create).

Find similar artists and tracks, fetch biographies and top tracks, and browse global music charts. Combine with your library to do gap analysis (*"albums missing from my top 5 artists, ranked by popularity"*), rediscover overlooked music (*"tracks similar to my favorites that I own but never play"*), or build curated "Best Of" playlists scoped to what you actually own.

### Synchronized Lyrics

> Requires `LYRICS_PROVIDER=lrclib` and `LRCLIB_USER_AGENT`. No API key needed.

Fetch time-synced lyrics with millisecond-precision timestamps (LRC format) and plain-text fallbacks from LRCLIB's community database. Matched automatically by title, artist, album, and duration.

### Internet Radio

Manage Navidrome radio stations and discover new ones globally. Stream URLs are validated before adding (MP3, AAC, OGG, FLAC detection) and SHOUTcast/Icecast metadata is extracted automatically. Bulk maintenance is supported: *"validate all my stations and remove the broken ones"* or *"test these 10 URLs and add the working ones"*.

Global station discovery via Radio Browser (requires `RADIO_BROWSER_USER_AGENT`) covers thousands of stations filterable by genre, country, language, codec, bitrate, and popularity, with vote and click registration so your usage feeds the community ranking.

### Listening Analytics

Access play counts, recently-played activity, top-rated and most-played listings, and tag distribution across your library. Use this to drive taste analysis (*"genres I'm playing more vs. less this year"*), discover forgotten favorites, identify one-hit-wonders in your collection, or build mood-based playlists from your listening patterns.

### Ratings & Favorites

Star/unstar songs, albums, and artists, set 0–5 star ratings, and list everything starred or top-rated. Read and write the saved Navidrome queue used by the web UI for cross-device sync.

### Multi-Library Support

Filter all operations to a subset of your Navidrome libraries — either by setting a default in your client config (`NAVIDROME_DEFAULT_LIBRARIES`) or by switching active libraries at runtime.

## Installation

### Prerequisites

- **Node.js 20+** ([download](https://nodejs.org/))
- **A running Navidrome server**
- **An MCP-compatible client** — Claude Desktop, Cursor, Continue, or similar
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

For Claude Desktop, edit `claude_desktop_config.json` (locations: `%APPDATA%/Claude/` on Windows, `~/Library/Application Support/Claude/` on macOS, `~/.config/Claude/` on Linux). Other MCP clients use the same JSON shape.

```json
{
  "mcpServers": {
    "navidrome": {
      "command": "npx",
      "args": ["navidrome-mcp"],
      "env": {
        "NAVIDROME_URL": "http://your-server:4533",
        "NAVIDROME_USERNAME": "your_username",
        "NAVIDROME_PASSWORD": "your_password",
        "NAVIDROME_DEFAULT_LIBRARIES": "1,2",
        "LASTFM_API_KEY": "your_api_key",
        "RADIO_BROWSER_USER_AGENT": "Navidrome-MCP/2.0 (+https://github.com/Blakeem/Navidrome-MCP)",
        "LYRICS_PROVIDER": "lrclib",
        "LRCLIB_USER_AGENT": "Navidrome-MCP/2.0 (+https://github.com/Blakeem/Navidrome-MCP)"
      }
    }
  }
}
```

For a manual build, replace `command`/`args` with:

```json
"command": "node",
"args": ["/absolute/path/to/Navidrome-MCP/dist/index.js"]
```

**Required:** `NAVIDROME_URL`, `NAVIDROME_USERNAME`, `NAVIDROME_PASSWORD`.

**Optional:**
- `NAVIDROME_DEFAULT_LIBRARIES` — comma-separated library IDs to activate by default; omit for all libraries.
- `LASTFM_API_KEY` — enables Last.fm discovery features.
- `RADIO_BROWSER_USER_AGENT` — enables Radio Browser global station discovery. Replace the project URL with your own.
- `LYRICS_PROVIDER=lrclib` + `LRCLIB_USER_AGENT` — enables lyrics fetching.
- `MPV_PATH` — point at the mpv binary if it's not on `PATH` (e.g. `"C:\\Program Files\\mpv\\mpv.exe"`).

Features turn on automatically when their config is present. Restart your MCP client after changing the config.

### Installing mpv (optional)

mpv is a lightweight, cross-platform media player. When detected at startup, the server registers an additional set of playback tools so audio streams through your machine's speakers. Without it, the server still manages your library and Navidrome's saved queue — it just doesn't produce audio.

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
winget install mpv         # included on Windows 11
scoop install mpv
choco install mpv
```

Or a pre-built binary from [mpv.io](https://mpv.io/installation/). Verify with `mpv --version`, then restart your MCP client so the server re-detects mpv.

### A Note on ChatGPT Desktop

ChatGPT Desktop's MCP integration requires a hosted HTTPS endpoint and is not currently compatible with local stdio servers like this one. Use Claude Desktop, Cursor, Continue, or another MCP client that supports local stdio servers. Re-check once OpenAI adds first-party stdio MCP support.

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
| `set_rating` | Set a 0–5 star rating |
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

### Last.fm Discovery — *conditional on `LASTFM_API_KEY`*

| Tool | Description |
|------|-------------|
| `get_similar_artists` | Find artists similar to a given artist |
| `get_similar_tracks` | Find tracks similar to a given track |
| `get_artist_info` | Artist biography and tags |
| `get_top_tracks_by_artist` | Top tracks for an artist |
| `get_trending_music` | Trending artists, tracks, and tags from Last.fm charts |

### Lyrics — *conditional on `LYRICS_PROVIDER=lrclib` + `LRCLIB_USER_AGENT`*

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

### Global Radio Discovery — *conditional on `RADIO_BROWSER_USER_AGENT`*

| Tool | Description |
|------|-------------|
| `discover_radio_stations` | Find stations globally via Radio Browser |
| `get_radio_filters` | Available filter values (tags, countries, languages, codecs) |
| `get_station_by_uuid` | Detailed Radio Browser station info |
| `click_station` | Register a play click for popularity metrics |
| `vote_station` | Vote for a station |

### Local Playback — *conditional on [`mpv`](https://mpv.io/)*

Audio plays through the host's speakers. mpv is lazy-spawned on first use and survives MCP client restarts via a per-user IPC socket.

| Tool | Description |
|------|-------------|
| `play_songs` | Play one or many songs; `mode: 'replace' \| 'append'`, optional `shuffle` |
| `play_albums` | Play one or many albums; `mode` plus `shuffle: 'none' \| 'albums' \| 'songs'` (preserve, randomize album order, or fully interleave) |
| `play_albums_search` | One-shot filter-driven album playback — accepts all `search_albums` filters plus `mode`/`shuffle` |
| `play_songs_search` | One-shot filter-driven song playback — accepts all `search_songs` filters plus `mode`/`shuffle` |
| `play_radio_station` | Play a saved Navidrome radio station; replaces the queue (mutually exclusive with songs/albums) |
| `pause` | Pause playback (position preserved) |
| `resume` | Resume playback |
| `next` | Skip to the next track |
| `previous` | Skip to the previous track |
| `seek` | Move within the current track (absolute or relative) |
| `set_volume` | Set mpv's internal volume (0–100) |
| `now_playing` | Current title/artist/album/position/duration and queue index (or station + ICY metadata for radio) |
| `playback_status` | Engine health probe (running, mpv version, idle) without spawning mpv |
| `get_play_queue` | Snapshot of the live queue with metadata and current-track index |
| `clear_play_queue` | Clear the queue and stop playback |
| `shuffle_play_queue` | Randomize queue order (membership unchanged) |
| `move_in_play_queue` | Move a queue entry between indices |
| `remove_from_play_queue` | Remove an entry; mpv auto-advances if the current track is removed |

## Troubleshooting

**Connection problems**
- Verify Navidrome is running and reachable
- Ensure `NAVIDROME_URL` includes the protocol (`http://` or `https://`)
- Test credentials with `curl` or a browser first

**macOS-specific**
- See the [macOS Troubleshooting Guide](docs/MACOS_TROUBLESHOOTING.md) (commonly: Node.js path not found — fix with symlinks or full paths)

**Configuration**
- Use absolute paths in config files
- Validate JSON (no trailing commas)
- Restart your MCP client after changes

### Known Limitations

- **No audio without mpv.** When mpv isn't installed the library and saved-queue tools still work, but audio playback isn't available — use the Navidrome web UI or a Subsonic client.
- **Recently-played has no timestamps.** Navidrome exposes play counts and completion status, not last-played times.
- **Saved queue ≠ live queue.** The `*_saved_queue` tools operate on Navidrome's server-side advisory queue (web UI sync). The `*_play_queue` tools operate on the local mpv playlist. They are independent.
- **Scrobbling for local playback isn't wired up yet.** Listens through mpv don't currently feed back into Navidrome's play counts. Planned.

## Development

```bash
git clone https://github.com/Blakeem/Navidrome-MCP.git
cd Navidrome-MCP
cp .env.example .env
# Edit .env with your credentials

pnpm dev          # hot reload
pnpm test         # watch-mode tests
pnpm test:run     # one-shot tests
pnpm check:all    # lint + typecheck + dead-code
pnpm build        # production bundle
```

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
