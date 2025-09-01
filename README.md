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
* **pnpm** package manager ([Install instructions](https://pnpm.io/installation))
* **Running Navidrome server** with your music library
* **Claude Desktop** or **ChatGPT Desktop** (or any MCP-compatible client)

### Quick Setup

#### 1. Clone and Build

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
        "LASTFM_API_KEY": "your_api_key",
        "RADIO_BROWSER_USER_AGENT": "Navidrome-MCP/1.0 (+https://github.com/your-username/Navidrome-MCP)",
        "LYRICS_PROVIDER": "lrclib",
        "LRCLIB_USER_AGENT": "Navidrome-MCP/1.0 (+https://github.com/your-username/Navidrome-MCP)"
      }
    }
  }
}
```

**Important**: 
- Use absolute paths (full path from root)
- Get a free Last.fm API key at [Last.fm](https://www.last.fm/api) (optional - enables music discovery)
- Radio Browser integration requires a User-Agent string (enables station discovery)
- Lyrics integration works without API keys (LRCLIB is free)
- Features are automatically enabled/disabled based on available configuration
- Restart Claude Desktop after saving

### Configure ChatGPT Desktop

1. Open **ChatGPT Desktop**
2. Go to **Settings → Connectors**
3. Click **Create** and add:
   - **Command**: `node`
   - **Args**: `/absolute/path/to/navidrome-mcp/dist/index.js`
   - **Environment variables**: Same as above
4. Save and restart

## Powerful Usage Examples

### 🎯 Intelligent Playlist Creation

* **"Analyze my top 50 most played songs and create a 'Ultimate Favorites' playlist with similar tracks I haven't discovered yet"**
* **"Build me a workout playlist with high-energy tracks from my library, focusing on 120-140 BPM"**
* **"Create a 'Sunday Morning' playlist with mellow tracks from my jazz and acoustic collections"**
* **"Make a road trip playlist mixing my favorite rock with some hidden gems I've never played"**

### 🔍 Music Discovery & Analysis

* **"What genres do I listen to most? Show me artists I own but rarely play"**
* **"Find all songs in my library similar to Radiohead but from different artists"**
* **"Analyze my listening patterns and suggest 10 albums I should explore more"**
* **"Show me all the progressive rock tracks longer than 8 minutes that I've rated 4+ stars"**

### 📻 Smart Radio Station Management

* **"Test these 5 radio stream URLs and add only the working ones to my collection"**
* **"Create custom radio stations based on my top 3 genres"**
* **"Find working jazz radio streams and validate them before adding"**

### 🌍 Internet Radio Discovery

* **"Discover high-quality jazz radio stations from the US with at least 128kbps bitrate"**
* **"Find classical music stations from Europe that are currently working"**
* **"Search for smooth jazz stations with the most votes and add the best ones to my collection"**
* **"Show me all available radio genres and find stations for my favorite ones"**

### 🎤 Lyrics & Timestamps

* **"Get the synchronized lyrics for 'Bohemian Rhapsody' with timing data"**
* **"Find lyrics with timestamps for my entire playlist"**
* **"Show me both the time-synced and plain text lyrics for this song"**
* **"Get lyrics for the currently playing track with line timing data"**

### 📊 Library Intelligence

* **"What's my music taste evolution over the last 6 months?"**
* **"Find albums I've only listened to once that match my usual preferences"**
* **"Show me artists where I own less than 20% of their discography"**
* **"Which songs do I skip most often? Maybe I should remove them"**

### 🎼 Advanced Curation

* **"Find all classical music by Bach and create separate playlists for each instrument type"**
* **"Build a 'Discovery' playlist with one song from each artist I've added this year"**
* **"Create mood-based playlists: Happy, Melancholic, Energetic, and Relaxing based on my ratings"**
* **"Find cover versions of songs in my library and create a 'Covers vs Originals' playlist"**

## Available Tools

### 🔧 Core System

| Tool | Description |
|------|-------------|
| `test_connection` | Verify Navidrome server connectivity and feature status |

### 📚 Library Management

| Tool | Description |
|------|-------------|
| `list_songs` | Browse songs with filtering and sorting |
| `list_albums` | Browse albums with metadata |
| `list_artists` | Browse artists with statistics |
| `list_genres` | View all music genres in library |
| `get_song` | Detailed song information |
| `get_album` | Detailed album information |
| `get_artist` | Detailed artist information |

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
| `get_trending_music` | Global music trends |

### 🎵 Playlist Operations

| Tool | Description |
|------|-------------|
| `list_playlists` | View all playlists |
| `create_playlist` | Create new playlist |
| `update_playlist` | Update playlist metadata |
| `delete_playlist` | Remove playlist |
| `get_playlist_tracks` | Get playlist contents |
| `add_tracks_to_playlist` | Add songs/albums/artists |
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

### 📻 Radio Management

| Tool | Description |
|------|-------------|
| `validate_radio_stream` | Test stream URL validity |
| `list_radio_stations` | View all stations |
| `create_radio_station` | Add new station |
| `play_radio_station` | Start radio playback |
| `discover_radio_stations` | Find internet radio stations globally |
| `get_radio_filters` | Get available search filters (genres, countries, etc.) |
| `get_station_by_uuid` | Get detailed station information |
| `click_station` | Register play click for popularity metrics |
| `vote_station` | Vote for a radio station |

### 🎤 Lyrics & Timestamps

| Tool | Description |
|------|-------------|
| `get_lyrics` | Get synchronized and plain text lyrics |

### 🏷️ Metadata & Tags

| Tool | Description |
|------|-------------|
| `list_tags` | Browse all metadata tags |
| `search_by_tags` | Search by specific tags |
| `get_tag_distribution` | Analyze tag usage |

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
