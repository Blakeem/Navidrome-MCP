# Navidrome MCP Server - Project Overview

## Purpose
An MCP (Model Context Protocol) server that enables AI assistants to interact with Navidrome music servers through natural language. The server provides tools for music discovery, library management, playlist operations, radio station discovery, lyrics lookup, and smart features like mood-based playlist generation.

## Tech Stack
- **Language**: TypeScript with strict mode enabled
- **Runtime**: Node.js 18+ with ES modules
- **Package Manager**: pnpm (NOT npm or yarn)
- **Protocol**: MCP (Model Context Protocol) using JSON-RPC over STDIO
- **API Client**: Custom Navidrome/Subsonic API client
- **External APIs**: Last.fm, Radio Browser, LRCLIB
- **Validation**: Zod schemas for input validation and configuration
- **Testing**: Vitest with coverage reporting
- **Linting**: ESLint with TypeScript and Prettier integration
- **Build**: TypeScript compiler (tsc)

## Key Features
- **Music Discovery**: Find similar artists, recommendations, browse by genre (Last.fm)
- **Library Management**: Search, browse, organize music collection
- **Playlist Operations**: Create, edit, manage playlists
- **Radio Discovery**: Find and manage internet radio stations worldwide (Radio Browser)
- **Lyrics & Timestamps**: Time-synchronized and plain text lyrics with millisecond precision (LRCLIB)
- **Playback Control**: Queue management and streaming controls
- **Smart Features**: Generate playlists, find music by mood
- **Sharing**: Create public shares for tracks and playlists

## Environment Configuration
Required environment variables:
- `NAVIDROME_URL`: Full URL to Navidrome server (e.g., http://192.168.86.100:4533)
- `NAVIDROME_USERNAME`: Username for authentication
- `NAVIDROME_PASSWORD`: Password for authentication

Optional environment variables (enable additional features):
- `LASTFM_API_KEY`: Last.fm API key for music discovery and recommendations
- `RADIO_BROWSER_USER_AGENT`: User agent for Radio Browser API (enables radio station discovery)
- `LYRICS_PROVIDER`: Lyrics provider (set to "lrclib" to enable lyrics)
- `LRCLIB_USER_AGENT`: User agent for LRCLIB API (enables synchronized lyrics)
- `DEBUG`: Enable debug logging (optional, default: false)
- `CACHE_TTL`: Cache time-to-live in seconds (optional, default: 300)
- `TOKEN_EXPIRY`: JWT token expiry in seconds (optional, default: 86400)

## License
- **Code**: AGPL-3.0 (GNU Affero General Public License v3.0)
- **Documentation**: CC-BY-SA-4.0 (Creative Commons Attribution-ShareAlike 4.0)