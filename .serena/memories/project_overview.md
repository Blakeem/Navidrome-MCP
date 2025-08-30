# Navidrome MCP Server - Project Overview

## Purpose
An MCP (Model Context Protocol) server that enables AI assistants to interact with Navidrome music servers through natural language. The server provides tools for music discovery, library management, playlist operations, playback control, and smart features like mood-based playlist generation.

## Tech Stack
- **Language**: TypeScript with strict mode enabled
- **Runtime**: Node.js 18+ with ES modules
- **Package Manager**: pnpm (NOT npm or yarn)
- **Protocol**: MCP (Model Context Protocol) using JSON-RPC over STDIO
- **API Client**: Custom Navidrome/Subsonic API client
- **Validation**: Zod schemas for input validation and configuration
- **Testing**: Vitest with coverage reporting
- **Linting**: ESLint with TypeScript and Prettier integration
- **Build**: TypeScript compiler (tsc)

## Key Features
- **Music Discovery**: Find similar artists, recommendations, browse by genre
- **Library Management**: Search, browse, organize music collection
- **Playlist Operations**: Create, edit, manage playlists
- **Playback Control**: Queue management and streaming controls
- **Smart Features**: Generate playlists, find music by mood
- **Sharing**: Create public shares for tracks and playlists

## Environment Configuration
Required environment variables:
- `NAVIDROME_URL`: Full URL to Navidrome server (e.g., http://192.168.86.100:4533)
- `NAVIDROME_USERNAME`: Username for authentication
- `NAVIDROME_PASSWORD`: Password for authentication
- `DEBUG`: Enable debug logging (optional, default: false)
- `CACHE_TTL`: Cache time-to-live in seconds (optional, default: 300)
- `TOKEN_EXPIRY`: JWT token expiry in seconds (optional, default: 86400)

## License
- **Code**: AGPL-3.0 (GNU Affero General Public License v3.0)
- **Documentation**: CC-BY-SA-4.0 (Creative Commons Attribution-ShareAlike 4.0)