# Navidrome MCP Server

A comprehensive MCP (Model Context Protocol) server that enables AI assistants to interact with Navidrome music servers through natural language. Browse your music library, manage playlists, analyze metadata tags, and discover music with clean, LLM-friendly interfaces.

## Features

### 🎵 Music Library Management

* **Browse & Discover**: List songs, albums, artists, and genres with smart filtering and pagination
* **Powerful Search**: Full-text search across all content types or targeted searches for specific media
* **Detailed Lookups**: Get comprehensive information about specific tracks, albums, and artists
* **Advanced Tag Management**: Browse, search, and analyze metadata tags (genre, composer, label, technical metadata, etc.)
* **Clean Data**: All responses use optimized DTOs with essential fields (\~10 key properties instead of 50+ raw fields)

### 🎶 Playlist Management

* **Full CRUD Operations**: Create, read, update, and delete playlists
* **Track Management**: Add tracks by song ID, album ID, artist ID, or specific disc
* **Advanced Controls**: Remove tracks and reorder playlist items

### ⭐ User Preferences & Rating System

* **Star/Favorite Management**: Star and unstar songs, albums, and artists
* **Rating System**: Set 0-5 star ratings for any content
* **List Starred Content**: Browse your favorited songs, albums, and artists
* **Top Rated Content**: Find your highest-rated music with customizable minimum ratings

### 🎵 Playback Queue Management

* **Queue Operations**: View, set, and clear the playback queue
* **Queue Control**: Add specific songs to queue with position control
* **Real-time Status**: Get current queue state with track information

### 📊 Listening History & Analytics

* **Recently Played**: View recent tracks with play dates and filtering by time range
* **Most Played Content**: Discover your most-played songs, albums, and artists
* **Play Statistics**: Track play counts and listening patterns

### 🎼 Music Discovery (Last.fm Integration)

* **Similar Content**: Find artists and tracks similar to your favorites
* **Artist Information**: Get detailed biographies, tags, and statistics
* **Top Tracks**: Discover an artist's most popular songs
* **Global Charts**: Browse trending artists, tracks, and tags worldwide

### 🔄 Real-time Resources

* **Server Status**: Monitor Navidrome connection and server health

## Installation for MCP Clients (Claude Desktop & OpenAI ChatGPT Desktop)

### Prerequisites

* **Node.js 20+** ([Download here](https://nodejs.org/))
* **pnpm** package manager ([Install instructions](https://pnpm.io/installation))
* **Running Navidrome server** with your music library

### Quick Setup (3 Steps)

#### 1. **Download and Build**

```bash
git clone https://github.com/Blakeem/Navidrome-MCP.git
cd navidrome-mcp
pnpm install
pnpm build
```

#### 2A. **Configure Claude Desktop**

Find your Claude Desktop configuration file and add the MCP server entry.

* **Windows**: `%APPDATA%/Claude/claude_desktop_config.json`
* **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
* **Linux**: `~/.config/Claude/claude_desktop_config.json` *(path may vary by distro)*

Add your Navidrome server configuration:

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
        "LASTFM_API_KEY": "your_lastfm_api_key_here"
      }
    }
  }
}
```

**Important**: Replace the following values:

* `/absolute/path/to/navidrome-mcp` - Full path where you cloned the project
* `http://your-server:4533` - Your Navidrome server URL
* `your_username` / `your_password` - Your Navidrome credentials
* `your_lastfm_api_key_here` - Get a free API key at [Last.fm](https://www.last.fm/api)

#### 2B. **Configure OpenAI ChatGPT Desktop (macOS/Windows)**

ChatGPT Desktop connects to tools via in-app **Connectors**. You do **not** need a local JSON file. To add this MCP server:

1. Open **ChatGPT Desktop**.
2. Go to **Settings → Connectors**.
3. Click **Create** and follow the prompts to add a new connector that launches your local MCP server command:

   * **Command**: `node`
   * **Args**: `/absolute/path/to/navidrome-mcp/dist/index.js`
   * **Environment**: set the same variables shown above (`NAVIDROME_*`, `LASTFM_API_KEY`).
4. Save the connector.

> If your ChatGPT build doesn’t show **Connectors**, ensure you’re on a recent version and signed in. Some features may roll out gradually; see Help Center for details.

#### 3. **Restart Your Client**

* **Claude Desktop**: Quit and relaunch. You should see an MCP indicator (🔌) in the chat input when connected.
* **ChatGPT Desktop**: Close and reopen the app (or toggle the connector) so the new MCP server is detected.

## Usage with AI Assistants

Once configured, ask your assistant to use the Navidrome tools, for example:

* 🔍 "Search for songs by Pink Floyd"
* ⭐ "Show my starred albums"
* 🎵 "Create a playlist called 'Weekend Vibes'"
* 📊 "What did I listen to most this month?"
* 🎼 "Find artists similar to Radiohead"
* 🎯 "Rate the last played song 5 stars"
* 🏷️ "Show me all songs with the composer Bach"
* 📻 "Add BBC Radio 1 to my radio stations"
* 🏷️ "What are my most common genres?"

## Available Tools

### 🔧 System Tools

* **`test_connection`**: Test Navidrome server connectivity and optionally get server info

### 📚 Library Tools

* **`list_songs`**: Browse songs with filtering, sorting, and pagination
* **`list_albums`**: Browse albums with clean metadata
* **`list_artists`**: Browse artists with album/song counts
* **`list_genres`**: Browse all music genres
* **`get_song`**: Get detailed information about a specific song
* **`get_album`**: Get detailed information about a specific album
* **`get_artist`**: Get detailed information about a specific artist
* **`get_song_playlists`**: Find all playlists containing a specific song

### 🔍 Search Tools

* **`search_all`**: Search across artists, albums, and songs simultaneously with customizable result limits
* **`search_songs`**: Search specifically for songs by title, artist, or album
* **`search_albums`**: Search for albums by name or artist
* **`search_artists`**: Search for artists by name

### 🎵 Playlist Tools

* **`list_playlists`**: Browse all accessible playlists
* **`get_playlist`**: Get detailed playlist information
* **`create_playlist`**: Create new playlists with name, description, and visibility
* **`update_playlist`**: Update playlist metadata
* **`delete_playlist`**: Delete playlists (owner/admin only)
* **`get_playlist_tracks`**: Get all tracks in a playlist (JSON or M3U format)
* **`add_tracks_to_playlist`**: Add tracks by song/album/artist/disc IDs
* **`remove_tracks_from_playlist`**: Remove tracks by position IDs
* **`reorder_playlist_track`**: Reorder tracks within playlists

### ⭐ User Preferences & Rating Tools

* **`star_item`**: Star/favorite songs, albums, or artists
* **`unstar_item`**: Remove favorites from songs, albums, or artists
* **`set_rating`**: Set 0-5 star ratings for songs, albums, or artists
* **`list_starred_items`**: List starred songs, albums, or artists
* **`list_top_rated`**: List top-rated content with customizable minimum rating

### 🎵 Queue Management Tools

* **`get_queue`**: View current playback queue with track details
* **`set_queue`**: Set queue with specific songs and position
* **`clear_queue`**: Empty the playback queue

**⚠️ Queue Management Limitations:**

* **Works with**: Jukebox mode clients (DSub, play\:Sub, Ultrasonic, Tempo), multi-device scenarios
* **Doesn't control**: Direct playback (play/pause/skip) — handled by your music player app
* **Use case**: Set up playlists remotely, queue management across devices, automation scenarios
* **Currently playing**: Check `list_recently_played` — tracks appear after completion/skip

### 📊 Listening History Tools

* **`list_recently_played`**: Get recently played tracks with time filtering (today/week/month/all)
* **`list_most_played`**: Get most played songs, albums, or artists with play counts

### 📻 Internet Radio Tools

* **`list_radio_stations`**: List all internet radio stations
* **`create_radio_station`**: Create new radio station with name, stream URL, and optional homepage (admin only)
* **`delete_radio_station`**: Delete radio station by ID (admin only)
* **`get_radio_station`**: Get detailed information about a specific radio station
* **`play_radio_station`**: Prepare radio station for playback (returns stream URL)
* **`get_current_radio_info`**: Get current radio playback status and metadata

### 🏷️ Advanced Tag Management Tools

* **`list_tags`**: Browse all metadata tags with filtering by tag name and pagination
* **`get_tag`**: Get detailed information about a specific tag by ID
* **`search_by_tags`**: Search for tags by name and optionally filter by specific values
* **`get_tag_distribution`**: Analyze tag usage patterns across your music library
* **`list_unique_tags`**: Get all unique tag names with comprehensive usage statistics

**Tag Types Supported**: genre, composer, conductor, label, catalog, grouping, originalyear, musicbrainz IDs, technical metadata, and more

### 🎼 Music Discovery Tools (Last.fm)

* **`get_similar_artists`**: Find similar artists using Last.fm data
* **`get_similar_tracks`**: Find similar tracks using Last.fm data
* **`get_artist_info`**: Get detailed artist information, biography, and tags
* **`get_top_tracks_by_artist`**: Get an artist's top tracks from Last.fm
* **`get_trending_music`**: Get global trending charts (artists/tracks/tags)

### 📊 Resources

* **`navidrome://server/status`**: Real-time server connection status

## Security & Privacy

* **No data storage**: This server only proxies requests to your Navidrome instance
* **Local authentication**: Credentials are only used for Navidrome API authentication
* **Secure tokens**: JWT tokens are managed securely with automatic refresh

## Troubleshooting

### Common MCP Client Issues (Claude & ChatGPT)

* Use absolute paths in configuration/connector setup
* Restart the app after changes
* Ensure Node.js is installed and on your PATH
* Verify environment variables are set (in JSON or connector fields)
* If your client supports indicators, verify the MCP server is connected (e.g., plug icon)

### Claude Desktop

* Confirm the config file path for your OS (see above)
* Validate JSON syntax
* Check the Claude Desktop logs if the server fails to start

### ChatGPT Desktop

* Ensure **Connectors** are available in your build and that the connector is enabled
* If the connector won’t start, try re-saving environment variables and restarting the app

## License

### Code: AGPL-3.0

All source code is licensed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE) for details.

### Documentation: CC-BY-SA-4.0

All documentation in the `/docs` directory is licensed under Creative Commons Attribution-ShareAlike 4.0 International.

## Support

For issues and feature requests, please use the [GitHub issue tracker](https://github.com/Blakeem/Navidrome-MCP/issues).

## Development Roadmap

### 🚀 Next Priority Features (High Value for LLMs)

#### ✅ User Preferences & Ratings (COMPLETED)

* [x] **Star/Favorite Management**: `star_item`, `unstar_item` for songs, albums, and artists
* [x] **List Favorites**: `list_starred_items` for songs, albums, and artists
* [x] **Rating System**: `set_rating` for songs, albums, and artists (0-5 stars)
* [x] **Top Rated Content**: `list_top_rated` with customizable minimum rating

*Perfect for voice commands: "Star this song", "Rate this album 5 stars", "Show my favorite artists"*

#### ✅ Playback Queue Management (COMPLETED)

* [x] **Queue Operations**: `get_queue`, `set_queue`, `clear_queue`
* [x] **Queue Control**: Add specific songs to queue with position control
* [x] **Queue Status**: Real-time queue state with track information

*Essential for: "Add to queue", "Clear the queue", "Show current queue"*

#### ✅ Listening History & Analytics (COMPLETED)

* [x] **Recently Played**: `list_recently_played` with time filtering (today/week/month/all)
* [x] **Listening Stats**: `list_most_played` for songs, albums, and artists
* [x] **Play Statistics**: Track play counts and listening patterns

*Great for: "What did I listen to yesterday?", "Show my most played tracks this month"*

#### ✅ Music Discovery & Recommendations (Last.fm Integration) (COMPLETED)

* [x] **Similar Artists**: `get_similar_artists` with match scores and metadata
* [x] **Similar Tracks**: `get_similar_tracks` with artist and match information
* [x] **Discovery Features**: `get_top_tracks_by_artist`, `get_trending_music`
* [x] **Artist Information**: `get_artist_info` with biography, tags, and statistics

*Powerful discovery: "Find artists similar to Radiohead", "Get trending music", "Tell me about this artist"*

### 🎯 Medium Priority Features

#### ✅ Internet Radio Integration (COMPLETED)

* [x] **Radio Management**: `list_radio_stations`, `create_radio_station`, `delete_radio_station`
* [x] **Radio Playback**: `play_radio_station`, `get_current_radio_info`
* [x] **Radio Details**: `get_radio_station` for detailed station information

*Voice-friendly: "Play jazz radio", "Add this station to my radios", "List my radio stations"*

#### ✅ Advanced Tag Operations (COMPLETED - Read-Only)

* [x] **Tag Management**: `list_tags`, `get_tag` for browsing all metadata tags
* [x] **Tag Search**: `search_by_tags` for finding songs by composer, label, genre, etc.
* [x] **Tag Analysis**: `get_tag_distribution`, `list_unique_tags` for library metadata insights
* [x] **Rich Metadata**: Support for 20+ tag types (genre, composer, conductor, label, catalog, MusicBrainz IDs, etc.)
* [x] **Client-Side Filtering**: Workaround for broken server-side filtering in Navidrome API

*Advanced queries: "Show me all Bach compositions", "Find jazz from Blue Note Records", "What are my most common genres?"*

**⚠️ Note**: Tag modification operations (POST/PUT/DELETE) are documented in Navidrome API but not implemented in version 0.58.0. These return `405 Method Not Allowed`. Tag changes must be made through external metadata editors like Mp3tag or MusicBrainz Picard, followed by library rescanning.

#### 🔗 Content Sharing (Not Yet Implemented in Navidrome)

**⚠️ Note**: Sharing endpoints return `501 Not Implemented` with message "This endpoint is not implemented, but may be in future releases" (tested on Navidrome 0.58.0).

* [ ] **Share Management**: `create_share`, `list_my_shares`, `delete_share`
* [ ] **Quick Sharing**: `share_playlist`, `share_album`, `share_song`
* [ ] **Share Settings**: `set_share_expiry`, `toggle_share_downloads`

*Social features: "Share this playlist publicly", "Create a download link for this album"*

#### 👤 Multi-Device Support

* [ ] **Player Management**: `list_players`, `register_player`, `update_player_settings`
* [ ] **Device Control**: `set_active_player`, `sync_across_devices`

### 🗂️ File System Access Features (Future)

*These require local file system access and will be implemented as separate tools:*

#### 📁 Smart Playlists

* [ ] **Smart Playlist Management**: `create_smart_playlist`, `update_smart_playlist_rules`
* [ ] **Smart Playlist Operations**: `refresh_smart_playlist`, `list_smart_playlists`
* [ ] **Rule Builder**: `validate_smart_playlist_rules`, `preview_smart_playlist`

#### 📥 Import/Export

* [ ] **M3U Operations**: `import_m3u_playlist`, `export_playlist_as_m3u`
* [ ] **Playlist Sync**: `import_from_spotify`, `export_to_streaming_service`

### ❌ Features Not Planned

*These are not suitable for LLM integration:*

* Admin features (user management, server configuration)
* Direct streaming URLs (client-specific, security concerns)
* Transcoding controls (technical server settings)

## Development & Testing

### Developer Setup

For developers and contributors who want to test or modify the server:

#### 1. **Environment Configuration**

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your Navidrome credentials for testing
```

The `.env` file contains:

```env
NAVIDROME_URL=http://your-server:4533
NAVIDROME_USERNAME=your_username
NAVIDROME_PASSWORD=your_password
LASTFM_API_KEY=your_lastfm_api_key_here

# Optional settings
DEBUG=false
CACHE_TTL=300
TOKEN_EXPIRY=86400
```

**Note**: The `.env` file is only for development and testing with MCP Inspector. Production users should configure credentials in their MCP client (Claude JSON or ChatGPT connector settings).

#### 2. **Testing with MCP Inspector**

```bash
# Build the TypeScript code
pnpm build

# Test with web UI
npx @modelcontextprotocol/inspector node dist/index.js

# Test with CLI - list all tools
npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list

# Test connection
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call \
  --tool-name test_connection \
  --tool-arg includeServerInfo=true

# Search for music
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call \
  --tool-name search_all \
  --tool-arg query="rock"
```

#### 3. **Development Commands**

```bash
pnpm dev       # Development mode with hot reload
pnpm build     # Build TypeScript to JavaScript
pnpm test      # Run test suite
pnpm lint      # Check code style
pnpm typecheck # Type checking
pnpm format    # Auto-format code
```

### Project Structure

* **`src/`** - TypeScript source code
* **`dist/`** - Compiled JavaScript (generated by build, not in git)
* **`docs/`** - API documentation and specs
* **`tests/`** - Test files
* **`.env.example`** - Template for development environment
* **`CLAUDE.md`** - Instructions for AI assistants
