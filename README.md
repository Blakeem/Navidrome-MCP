# Navidrome MCP Server

An MCP (Model Context Protocol) server that enables AI assistants to interact with Navidrome music servers through natural language.

## Features

- **Music Discovery**: Find similar artists, get recommendations, browse by genre
- **Library Management**: Search, browse, and organize your music collection
- **Playlist Operations**: Create, edit, and manage playlists
- **Playback Control**: Queue management and streaming controls
- **Smart Features**: Generate playlists, find music by mood
- **Sharing**: Create public shares for tracks and playlists

## Installation

### Prerequisites

- Node.js 18+ 
- pnpm package manager
- A running Navidrome server

### Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/navidrome-mcp.git
cd navidrome-mcp
```

2. Install dependencies with pnpm:
```bash
pnpm install
```

3. Copy `.env.example` to `.env` and configure:
```bash
cp .env.example .env
```

4. Edit `.env` with your Navidrome server details:
```env
NAVIDROME_URL=http://your-navidrome-server:4533
NAVIDROME_USERNAME=your_username
NAVIDROME_PASSWORD=your_password
```

## Usage with Claude Desktop

Add the server to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "navidrome": {
      "command": "node",
      "args": ["/path/to/navidrome-mcp/dist/index.js"],
      "env": {
        "NAVIDROME_URL": "http://your-server:4533",
        "NAVIDROME_USERNAME": "username",
        "NAVIDROME_PASSWORD": "password"
      }
    }
  }
}
```

## Development

```bash
# Run in development mode with hot reload
pnpm dev

# Build for production
pnpm build

# Run tests
pnpm test

# Check code quality
pnpm lint
pnpm typecheck
```

## Project Structure

- `/src` - TypeScript source code
  - `/client` - Navidrome API client
  - `/tools` - MCP tool implementations
  - `/resources` - MCP resource providers
  - `/utils` - Utility functions
- `/docs` - Documentation and API reference
- `/tests` - Test files

## License

### Code: AGPL-3.0

All source code is licensed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE) for details.

### Documentation: CC-BY-SA-4.0

All documentation in the `/docs` directory is licensed under Creative Commons Attribution-ShareAlike 4.0 International.

## Contributing

Contributions are welcome! Please ensure:
- All code follows the established TypeScript patterns
- Tests are included for new features
- Documentation is updated as needed
- Code passes linting and type checking

## Support

For issues and feature requests, please use the [GitHub issue tracker](https://github.com/yourusername/navidrome-mcp/issues).