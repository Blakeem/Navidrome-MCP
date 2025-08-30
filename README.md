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

4. **Build the server**:
```bash
pnpm build
```

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
# Build first
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
