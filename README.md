# Navidrome MCP Server

A comprehensive MCP (Model Context Protocol) server that enables AI assistants to interact with Navidrome music servers through natural language. Browse your music library, manage playlists, and discover music with clean, LLM-friendly interfaces.

## Features

### 🎵 Music Library Management
- **Browse & Discover**: List songs, albums, artists, and genres with smart filtering and pagination
- **Powerful Search**: Full-text search across all content types or targeted searches for specific media
- **Detailed Lookups**: Get comprehensive information about specific tracks, albums, and artists
- **Clean Data**: All responses use optimized DTOs with essential fields (~10 key properties instead of 50+ raw fields)

### 🎶 Playlist Management
- **Full CRUD Operations**: Create, read, update, and delete playlists
- **Track Management**: Add tracks by song ID, album ID, artist ID, or specific disc
- **Advanced Controls**: Remove tracks and reorder playlist items

### 🔄 Real-time Resources
- **Server Status**: Monitor Navidrome connection and server health

## Installation

### Prerequisites

- **Node.js 20+** (required)
- **pnpm** package manager (NOT npm or yarn)
- **Running Navidrome server** (tested with v0.49+)

### Project Structure

This is a **TypeScript project** that compiles to JavaScript:
- **`src/`** - TypeScript source code (`.ts` files)
- **`dist/`** - Compiled JavaScript output (auto-generated, not in git)
- **Build required** - You must run `pnpm build` to generate the executable JavaScript files

### Setup

1. **Clone and install**:
```bash
git clone https://github.com/Blakeem/Navidrome-MCP.git
cd navidrome-mcp
pnpm install
```

2. **Configure environment**:
```bash
cp .env.example .env
```

3. **Edit `.env` with your Navidrome details**:
```env
NAVIDROME_URL=http://your-server:4533
NAVIDROME_USERNAME=your_username
NAVIDROME_PASSWORD=your_password

# Optional settings
DEBUG=false
CACHE_TTL=300
TOKEN_EXPIRY=86400
```

4. **Build the server** (compiles TypeScript to JavaScript):
```bash
pnpm build
```

**Important**: The `pnpm build` step is **required** - it compiles the TypeScript source code in `src/` into executable JavaScript in `dist/`. The `dist/` folder is auto-generated and not included in git.

## Claude Desktop Configuration

Add the server to your Claude Desktop config file:

**Windows**: `%APPDATA%/Claude/config.json`  
**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "navidrome": {
      "command": "node",
      "args": ["/absolute/path/to/navidrome-mcp/dist/index.js"],
      "env": {
        "NAVIDROME_URL": "http://your-server:4533",
        "NAVIDROME_USERNAME": "your_username",
        "NAVIDROME_PASSWORD": "your_password"
      }
    }
  }
}
```

**After saving the config**: Completely quit and restart Claude Desktop. You'll see an MCP indicator in the bottom-right of the chat input.

## Testing

Use the official MCP Inspector to test server functionality:

```bash
# Build first (required - compiles TypeScript to JavaScript)
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

# Create a test playlist
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call \
  --tool-name create_playlist \
  --tool-arg name="My Test Playlist" \
  --tool-arg comment="Created via MCP" \
  --tool-arg public=false

# Search for music
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call \
  --tool-name search_all \
  --tool-arg query="rock" \
  --tool-arg artistCount=5 \
  --tool-arg albumCount=5 \
  --tool-arg songCount=10
```

## Available Tools

### 🔧 System Tools
- **`test_connection`**: Test Navidrome server connectivity and optionally get server info

### 📚 Library Tools
- **`list_songs`**: Browse songs with filtering, sorting, and pagination
- **`list_albums`**: Browse albums with clean metadata
- **`list_artists`**: Browse artists with album/song counts
- **`list_genres`**: Browse all music genres
- **`get_song`**: Get detailed information about a specific song
- **`get_album`**: Get detailed information about a specific album  
- **`get_artist`**: Get detailed information about a specific artist
- **`get_song_playlists`**: Find all playlists containing a specific song

### 🔍 Search Tools
- **`search_all`**: Search across artists, albums, and songs simultaneously with customizable result limits
- **`search_songs`**: Search specifically for songs by title, artist, or album
- **`search_albums`**: Search for albums by name or artist
- **`search_artists`**: Search for artists by name

### 🎵 Playlist Tools
- **`list_playlists`**: Browse all accessible playlists
- **`get_playlist`**: Get detailed playlist information
- **`create_playlist`**: Create new playlists with name, description, and visibility
- **`update_playlist`**: Update playlist metadata
- **`delete_playlist`**: Delete playlists (owner/admin only)
- **`get_playlist_tracks`**: Get all tracks in a playlist (JSON or M3U format)
- **`add_tracks_to_playlist`**: Add tracks by song/album/artist/disc IDs
- **`remove_tracks_from_playlist`**: Remove tracks by position IDs
- **`reorder_playlist_track`**: Reorder tracks within playlists

### 📊 Resources
- **`navidrome://server/status`**: Real-time server connection status

## Security & Privacy

- **No data storage**: This server only proxies requests to your Navidrome instance
- **Local authentication**: Credentials are only used for Navidrome API authentication
- **Secure tokens**: JWT tokens are managed securely with automatic refresh

## Troubleshooting

### Claude Desktop Issues
- Ensure config file path is correct for your OS
- Use absolute paths in configuration
- Restart Claude Desktop completely after config changes
- Check for MCP indicator in bottom-right of chat input

## License

### Code: AGPL-3.0

All source code is licensed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE) for details.

### Documentation: CC-BY-SA-4.0  

All documentation in the `/docs` directory is licensed under Creative Commons Attribution-ShareAlike 4.0 International.


## Support

For issues and feature requests, please use the [GitHub issue tracker](https://github.com/Blakeem/Navidrome-MCP/issues).

## Development Roadmap

### 🚀 Next Priority Features (High Value for LLMs)

#### ⭐ User Preferences & Ratings
- [ ] **Star/Favorite Management**: `star_song`, `unstar_song`, `star_album`, `unstar_album`, `star_artist`, `unstar_artist`
- [ ] **List Favorites**: `list_starred_songs`, `list_starred_albums`, `list_starred_artists`  
- [ ] **Rating System**: `rate_song`, `rate_album`, `rate_artist` (1-5 stars)
- [ ] **Top Rated Content**: `list_top_rated_songs`, `list_top_rated_albums`
- [ ] **Get Ratings**: `get_song_rating`, `get_album_rating`, `get_artist_rating`

*Perfect for voice commands: "Star this song", "Rate this album 5 stars", "Show my favorite artists"*

#### 🎵 Playback Queue Management  
- [ ] **Queue Operations**: `get_queue`, `set_queue`, `add_to_queue`, `clear_queue`
- [ ] **Queue Control**: `play_next`, `shuffle_queue`, `reorder_queue`
- [ ] **Queue Status**: `get_queue_position`, `set_queue_position`

*Essential for: "Play this next", "Add to queue", "Shuffle my queue", "Clear the queue"*

#### 📊 Listening History & Analytics
- [ ] **Recently Played**: `list_recently_played`, `get_play_history`
- [ ] **Listening Stats**: `get_listening_stats`, `get_most_played_songs`
- [ ] **Discovery Tools**: `get_similar_artists`, `get_recommendations`

*Great for: "What did I listen to yesterday?", "Show my most played tracks this month"*

#### 🎼 Music Discovery & Recommendations (Last.fm Integration)
- [ ] **Similar Artists**: `get_similar_artists`, `get_artist_info`
- [ ] **Similar Tracks**: `get_similar_songs`, `get_track_recommendations`
- [ ] **Discovery Features**: `get_top_tracks_by_artist`, `get_trending_music`
- [ ] **Personalized Recommendations**: `get_recommendations_based_on_history`

*Powerful discovery: "Find artists similar to Radiohead", "Recommend music based on my favorites"*

### 🎯 Medium Priority Features

#### 📻 Internet Radio Integration
- [ ] **Radio Management**: `list_radio_stations`, `create_radio_station`, `delete_radio_station`
- [ ] **Radio Playback**: `play_radio_station`, `get_current_radio_info`

*Voice-friendly: "Play jazz radio", "Add this station to my radios"*

#### 🏷️ Advanced Tag Operations
- [ ] **Tag Search**: `search_by_tags`, `list_songs_by_composer`, `filter_by_label`
- [ ] **Tag Analysis**: `get_tag_distribution`, `list_unique_tags`

*Advanced queries: "Show me all Bach compositions", "Find jazz from Blue Note Records"*

#### 🔗 Content Sharing  
- [ ] **Share Management**: `create_share`, `list_my_shares`, `delete_share`
- [ ] **Quick Sharing**: `share_playlist`, `share_album`, `share_song`
- [ ] **Share Settings**: `set_share_expiry`, `toggle_share_downloads`

*Social features: "Share this playlist publicly", "Create a download link for this album"*

#### 👤 Multi-Device Support
- [ ] **Player Management**: `list_players`, `register_player`, `update_player_settings`
- [ ] **Device Control**: `set_active_player`, `sync_across_devices`

### 🗂️ File System Access Features (Future)
*These require local file system access and will be implemented as separate tools:*

#### 📁 Smart Playlists
- [ ] **Smart Playlist Management**: `create_smart_playlist`, `update_smart_playlist_rules`
- [ ] **Smart Playlist Operations**: `refresh_smart_playlist`, `list_smart_playlists`
- [ ] **Rule Builder**: `validate_smart_playlist_rules`, `preview_smart_playlist`

#### 📥 Import/Export
- [ ] **M3U Operations**: `import_m3u_playlist`, `export_playlist_as_m3u`
- [ ] **Playlist Sync**: `import_from_spotify`, `export_to_streaming_service`

### ❌ Features Not Planned
*These are not suitable for LLM integration:*
- Admin features (user management, server configuration)
- Direct streaming URLs (client-specific, security concerns)  
- Transcoding controls (technical server settings)
- Library scanning/management (admin-only operations)
