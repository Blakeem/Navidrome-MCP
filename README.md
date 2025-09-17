# Navidrome MCP Server

Transform your Navidrome music server with an AI-powered music assistant. This MCP (Model Context Protocol) server enables Claude, ChatGPT, and other AI assistants to interact with your personal music library through natural language, offering intelligent playlist creation, music discovery, and library management.

## Table of Contents

- [Why Navidrome MCP?](#why-navidrome-mcp)
- [Features](#features)
  - [Music Library Management](#-music-library-management)
  - [Intelligent Playlist Creation](#-intelligent-playlist-creation)
  - [Personalized Music Discovery](#-personalized-music-discovery)
  - [Smart Radio Management](#-smart-radio-management)
  - [Analytics & Insights](#-analytics--insights)
- [Installation](#installation)
  - [Prerequisites](#prerequisites)
  - [Quick Setup](#quick-setup)
  - [Configure Claude Desktop](#configure-claude-desktop)
  - [Configure ChatGPT Desktop](#configure-chatgpt-desktop)
- [Powerful Usage Examples](#powerful-usage-examples)
- [Available Tools](#available-tools)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

## Why Navidrome MCP?

Imagine having an AI assistant that truly understands your music taste. This MCP server enables AI assistants to:

- **Analyze your listening patterns** and create perfectly curated playlists
- **Discover hidden gems** in your library based on your mood or activity
- **Build custom radio stations** from your favorite tracks
- **Find music similar to what you love** using Last.fm's recommendation engine
- **Discover internet radio stations** from around the world with advanced filtering
- **Get synchronized lyrics** with millisecond-precision timestamps for your favorite tracks
- **Manage your library** with simple conversational commands

This isn't just another music tool – it's your personal music curator powered by AI.

## Features

### 🎵 Music Library Management

* **Intelligent Browsing**: Navigate songs, albums, artists, and genres with smart filtering
* **Deep Search**: Full-text search across all metadata or targeted searches for specific content
* **Rich Metadata**: Access detailed information about tracks, albums, and artists
* **Tag Analysis**: Explore and analyze metadata tags (genre, composer, label, year, and more)
* **Clean Responses**: Optimized data transfer with only essential fields (~10 properties vs 50+ raw)

### 🎶 Intelligent Playlist Creation

* **AI Assistant Integration**: Enables AI assistants to analyze your taste and build themed playlists
* **Smart Management**: Create, update, and organize playlists conversationally
* **Flexible Track Addition**: Add songs by ID, entire albums, artist discographies, or specific discs
* **Dynamic Reordering**: Rearrange tracks with simple commands
* **Cross-Reference**: Find which playlists contain specific songs

### 🎼 Personalized Music Discovery

* **Listening Data Access**: Provides listening history data for AI assistants to understand your preferences
* **Similar Artist/Track Finding**: Discover music similar to your favorites via Last.fm
* **Artist Deep Dives**: Get biographies, popular tracks, and related artists
* **Global Trends**: Browse worldwide music charts and trending genres
* **Library Analysis Tools**: Access data to help AI assistants find overlooked tracks in your library

### 📻 Smart Radio Management

* **Stream Validation**: Test radio URLs before adding to avoid broken streams
* **Format Detection**: Automatic detection of MP3, AAC, OGG, FLAC streams
* **Metadata Extraction**: Pull station info from SHOUTcast/Icecast headers
* **Custom Station Creation**: Build radio stations from your collection
* **One-Time Setup Tips**: Smart contextual help that appears only when needed

### 🌍 Internet Radio Discovery

* **Global Station Database**: Access thousands of internet radio stations worldwide via Radio Browser
* **Advanced Filtering**: Search by genre, country, language, codec, bitrate, and more
* **Automatic Validation**: Discovered stations are tested for availability
* **Quality Control**: Filter out broken stations and focus on high-quality streams
* **Popularity Metrics**: Discover stations by vote count and listener engagement
* **Station Management**: Tools for AI assistants to add discovered stations to your collection

### 🎤 Synchronized Lyrics

* **Time-Synchronized Lyrics**: Get lyrics with millisecond-precision timestamps for line-by-line timing
* **Dual Format Support**: Access both time-synced and plain text lyrics
* **Community-Powered**: Lyrics sourced from LRCLIB's community database
* **Smart Matching**: Automatic matching by title, artist, album, and duration
* **No API Keys Required**: Free lyrics access without registration

### 📊 Analytics & Insights

* **Listening Patterns**: Understand your music habits with play statistics
* **Taste Evolution**: Track how your preferences change over time
* **Most/Least Played**: Discover your true favorites and forgotten tracks
* **Genre Distribution**: Access data about your library's composition for analysis
* **Recommendation Data**: Provides data for AI assistants to generate suggestions based on your history

### ⭐ Preference Management

* **Star System**: Mark favorites for quick access
* **5-Star Ratings**: Rate content for better recommendations
* **Queue Control**: Manage playback queues across devices
* **Data Access for Organization**: Provides preference data for AI assistants to help organize your collection

## Installation

### Prerequisites

* **Node.js 20+** ([Download here](https://nodejs.org/))
* **Running Navidrome server** with your music library
* **Claude Desktop** or **ChatGPT Desktop** (or any MCP-compatible client)

**Additional for manual build:**
* **pnpm** package manager ([Install instructions](https://pnpm.io/installation))

### Quick Setup

#### Method 1: NPM Package (Recommended)

The easiest way to get started is using the published npm package, which auto-updates on launch:

```bash
npm install -g navidrome-mcp
```

📦 **Package**: [navidrome-mcp on npm](https://www.npmjs.com/package/navidrome-mcp)

This installs the MCP server globally and keeps it up-to-date automatically.

#### Method 2: Manual Build (Development)

For development or custom builds:

```bash
git clone https://github.com/Blakeem/Navidrome-MCP.git
cd navidrome-mcp
pnpm install
pnpm build
```

### Configure Claude Desktop

Find your configuration file:
* **Windows**: `%APPDATA%/Claude/claude_desktop_config.json`
* **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
* **Linux**: `~/.config/Claude/claude_desktop_config.json`

Add the Navidrome MCP server:

#### Using NPM Package (Recommended)

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
        "NAVIDROME_DEFAULT_LIBRARIES": "1,2", // Optional: Set default active libraries (comma-separated IDs)
        "LASTFM_API_KEY": "your_api_key", // Get your own at https://www.last.fm/api/account/create
        "RADIO_BROWSER_USER_AGENT": "Navidrome-MCP/1.0 (+https://github.com/Blakeem/Navidrome-MCP)",
        "LYRICS_PROVIDER": "lrclib",
        "LRCLIB_USER_AGENT": "Navidrome-MCP/1.0 (+https://github.com/Blakeem/Navidrome-MCP)"
      }
    }
  }
}
```

#### Using Manual Build (Alternative)

```json
{
  "mcpServers": {
    "navidrome": {
      "command": "node",
      "args": ["/absolute/path/to/navidrome-mcp/dist/index.js"],
      "env": {
        "NAVIDROME_URL": "http://your-server:4533",
        "NAVIDROME_USERNAME": "your_username",
        "NAVIDROME_PASSWORD": "your_password",
        "NAVIDROME_DEFAULT_LIBRARIES": "1,2", // Optional: Set default active libraries (comma-separated IDs)
        "LASTFM_API_KEY": "your_api_key", // Get your own at https://www.last.fm/api/account/create
        "RADIO_BROWSER_USER_AGENT": "Navidrome-MCP/1.0 (+https://github.com/Blakeem/Navidrome-MCP)",
        "LYRICS_PROVIDER": "lrclib",
        "LRCLIB_USER_AGENT": "Navidrome-MCP/1.0 (+https://github.com/Blakeem/Navidrome-MCP)"
      }
    }
  }
}
```

**Important**:
- **NPM method**: Uses `npx navidrome-mcp` which auto-updates on each launch
- **Manual method**: Requires absolute paths (full path from root) and manual updates
- **Library filtering**: Use `NAVIDROME_DEFAULT_LIBRARIES` to set default active libraries (e.g., "1" for one library, "1,2,3" for multiple)
  - If not set, all libraries are active by default
  - You can change active libraries at runtime using the `set_active_libraries` tool
  - Invalid library IDs are ignored with a warning
- Get a free Last.fm API key at [Last.fm](https://www.last.fm/api) (optional - enables music discovery)
- Radio Browser integration requires a User-Agent string (enables station discovery)
- Lyrics integration works without API keys (LRCLIB is free)
- Features are automatically enabled/disabled based on available configuration
- Restart Claude Desktop after saving

### Configure ChatGPT Desktop

#### Using NPM Package (Recommended)

1. Open **ChatGPT Desktop**
2. Go to **Settings → Connectors**
3. Click **Create** and add:
   - **Command**: `npx`
   - **Args**: `navidrome-mcp`
   - **Environment variables**: Same as above
4. Save and restart

#### Using Manual Build (Alternative)

1. Open **ChatGPT Desktop**
2. Go to **Settings → Connectors**
3. Click **Create** and add:
   - **Command**: `node`
   - **Args**: `/absolute/path/to/navidrome-mcp/dist/index.js`
   - **Environment variables**: Same as above
4. Save and restart

## Powerful Usage Examples

### 🎯 Smart Discovery & Playlist Creation

* **"Look at my most played artists, find what albums I'm missing from their discographies, and tell me which ones are most popular"**
* **"Create a 'Best of Pink Floyd' playlist using Last.fm's top tracks data, but only with songs I actually own"**
* **"Analyze my recently played songs, find similar tracks in my library I haven't played in 6 months, and create a rediscovery playlist"**
* **"Build me a playlist mixing my top 10 most played songs with similar tracks from artists I own but rarely listen to"**

### 🔍 Collection Gap Analysis

* **"Show me which albums are missing from my top 5 most played artists and rank them by Last.fm popularity"**
* **"Find artists where I only own singles or compilations, not their main albums"**
* **"Identify my favorite genres, then show me highly-rated albums in those genres that I don't own"**
* **"Look at artists similar to my favorites and tell me which ones I already have in my library but never play"**

### 📻 Radio Station Maintenance

* **"Go through all my existing radio stations, validate each one, and remove the broken ones"**
* **"Here are 10 jazz radio URLs I found online - test them all and add only the working ones with good bitrates"**
* **"Find the top-voted jazz and classical stations worldwide, validate them, and add the best 5 of each genre"**
* **"Check all my radio stations and replace any broken ones with similar working stations"**

### 🎼 Advanced Playlist Automation

* **"Create a 'Hidden Gems' playlist with 5-star rated songs that have less than 5 plays"**
* **"Build weekly playlists based on what I listened to most each month of last year"**
* **"Make a 'Complete Artist Journey' playlist with one top track from each album of my top 10 artists, in chronological order"**
* **"Generate mood playlists by analyzing my listening patterns: what I play in mornings vs evenings vs weekends"**

### 📊 Listening Insights & Organization

* **"Analyze my jazz collection: show play counts, ratings, and find which albums I've never fully listened to"**
* **"Find duplicate songs across different albums and create a cleanup list"**
* **"Show me my listening evolution: which genres I've moved away from and which I'm playing more"**
* **"Identify 'one-hit wonders' in my library - artists where I only play one song repeatedly"**

## Available Tools

### 🔧 Core System

| Tool | Description |
|------|-------------|
| `test_connection` | Verify Navidrome server connectivity and feature status |

### 📚 Library Management

| Tool | Description |
|------|-------------|
| `get_song` | Detailed song information |
| `get_album` | Detailed album information |
| `get_artist` | Detailed artist information |
| `get_song_playlists` | Get all playlists that contain a specific song |
| `get_user_details` | Get user information and available libraries |
| `set_active_libraries` | Set which libraries are active for filtering content |

### 🔍 Search & Discovery

| Tool | Description |
|------|-------------|
| `search_all` | Search across all content types |
| `search_songs` | Search for specific songs |
| `search_albums` | Search for albums |
| `search_artists` | Search for artists |
| `get_similar_artists` | Find similar artists (Last.fm) |
| `get_similar_tracks` | Find similar tracks (Last.fm) |
| `get_artist_info` | Artist biography and tags |
| `get_top_tracks_by_artist` | Get top tracks for an artist from Last.fm |
| `get_trending_music` | Global music trends |

### 🎵 Playlist Operations

| Tool | Description |
|------|-------------|
| `list_playlists` | View all playlists |
| `get_playlist` | Get detailed information about a specific playlist by ID |
| `create_playlist` | Create new playlist |
| `update_playlist` | Update playlist metadata |
| `delete_playlist` | Remove playlist |
| `get_playlist_tracks` | Get playlist contents |
| `add_tracks_to_playlist` | Add multiple types of content (songs/albums/artists) in a single operation |
| `remove_tracks_from_playlist` | Remove specific tracks |
| `reorder_playlist_track` | Rearrange track order |

### ⭐ Ratings & Favorites

| Tool | Description |
|------|-------------|
| `star_item` | Mark as favorite |
| `unstar_item` | Remove from favorites |
| `set_rating` | Set 0-5 star rating |
| `list_starred_items` | View favorites |
| `list_top_rated` | View highest rated items |

### 📊 Analytics & History

| Tool | Description |
|------|-------------|
| `list_recently_played` | View recent listening activity |
| `list_most_played` | Find most played content |
| `get_queue` | View playback queue |
| `set_queue` | Set playback queue |
| `clear_queue` | Clear the playback queue |

### 📻 Radio Management

| Tool | Description |
|------|-------------|
| `validate_radio_stream` | Test stream URL validity |
| `list_radio_stations` | View all stations |
| `get_radio_station` | Get detailed information about a specific radio station by ID |
| `create_radio_station` | Create radio stations using JSON array format (single or multiple stations, with optional validation*) |
| `delete_radio_station` | Delete an internet radio station by ID |
| `play_radio_station` | Start radio playback |
| `get_current_radio_info` | Get information about currently playing radio station and stream metadata |
| `discover_radio_stations` | Find internet radio stations globally |
| `get_radio_filters` | Get available search filters (genres, countries, etc.) |
| `get_station_by_uuid` | Get detailed station information |
| `click_station` | Register play click for popularity metrics |
| `vote_station` | Vote for a radio station |

*Note: `create_radio_station` supports an optional `validateBeforeAdd` parameter that will test stream URLs before adding them to Navidrome.

### 🎤 Lyrics & Timestamps

| Tool | Description |
|------|-------------|
| `get_lyrics` | Get synchronized and plain text lyrics |

### 🏷️ Metadata & Tags

| Tool | Description |
|------|-------------|
| `search_by_tags` | Search by specific tags |
| `get_tag_distribution` | Analyze tag usage patterns and distribution |
| `get_filter_options` | Get available filter values for search operations |

## Troubleshooting

### Common Issues

**Connection Problems**
- Verify Navidrome server is running
- Check URL includes protocol (http:// or https://)
- Ensure credentials are correct
- Test with `curl` or browser first

**macOS Specific**
- See [macOS Troubleshooting Guide](docs/MACOS_TROUBLESHOOTING.md)
- Common issue: Node.js path not found
- Solution: Create symlinks or use full paths

**Configuration Issues**
- Use absolute paths in config files
- Validate JSON syntax (no trailing commas)
- Check environment variables are set
- Restart client after changes

### Limitations

**Playback Control**: This MCP server manages your library and queues but doesn't directly control playback. Use your Navidrome client app for play/pause/skip.

**Recently Played**: Navidrome doesn't provide last-played timestamps, only play counts and completion status.

**Queue Management**: Works with Subsonic-compatible clients that support jukebox mode.

## Development

### Setup for Contributors

```bash
# Clone and setup
git clone https://github.com/Blakeem/Navidrome-MCP.git
cd navidrome-mcp
cp .env.example .env
# Edit .env with your credentials

# Development
pnpm dev       # Hot reload mode
pnpm test      # Run tests
pnpm lint      # Check code style
pnpm typecheck # Type checking
```

### Testing with MCP Inspector

```bash
# Build first
pnpm build

# Web UI testing
npx @modelcontextprotocol/inspector node dist/index.js

# CLI testing
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call \
  --tool-name search_all \
  --tool-arg query="jazz"
```

### Project Structure

```
navidrome-mcp/
├── src/           # TypeScript source
├── dist/          # Compiled JavaScript
├── docs/          # Documentation
├── tests/         # Test suites
└── CLAUDE.md      # AI assistant instructions
```

## License

### Code: AGPL-3.0

Source code is licensed under GNU Affero General Public License v3.0. See [LICENSE](LICENSE).

### Documentation: CC-BY-SA-4.0

Documentation is licensed under Creative Commons Attribution-ShareAlike 4.0 International.

## Support

- **Issues**: [GitHub Issues](https://github.com/Blakeem/Navidrome-MCP/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Blakeem/Navidrome-MCP/discussions)

---

**Built with ❤️ for the Navidrome community**
