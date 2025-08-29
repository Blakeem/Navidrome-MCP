# CLAUDE.md - Assistant Instructions for Navidrome MCP Server

## Project Overview

This is an MCP (Model Context Protocol) server that provides AI assistants with tools to interact with a Navidrome music server. The project enables sophisticated music library operations through natural language, including discovery, playlist management, and playback control.

**Project Location**: `/home/blake/Projects/apps/Navidrome-MCP`
**Package Manager**: pnpm (NOT npm or yarn)
**Language**: TypeScript with strict mode enabled
**Runtime**: Node.js with ES modules

## CRITICAL CODE QUALITY REQUIREMENTS

### Mandatory Quality Checks
**AFTER EVERY CODE CHANGE, YOU MUST:**
1. Run `pnpm test` - ALL tests must pass
2. Run `pnpm lint` - ZERO errors and warnings allowed
3. Run `pnpm typecheck` - ZERO type errors allowed
4. Fix ALL issues before considering the task complete

### Code Standards
- **Zero Tolerance Policy**: No lint errors, no warnings, no type errors
- **Clean Commits**: Every commit must pass all quality checks
- **No Placeholder Code**: Remove all TODOs and placeholder comments
- **Production Ready**: Every file must be production-quality at all times
- **Test Coverage**: All new code must have corresponding tests

## Project Philosophy

1. **Navidrome-First**: This server specifically targets Navidrome, not generic Subsonic servers
2. **Type Safety**: Leverage TypeScript's strict mode for all implementations
3. **Clean Architecture**: Separate concerns clearly between API client, MCP tools, and utilities
4. **User Experience**: Provide intuitive tool descriptions that guide natural language usage
5. **Performance**: Implement intelligent caching to minimize API calls
6. **Security**: Never log or expose credentials, use secure token management
7. **Quality First**: Every line of code must meet the highest standards

## Current Project Structure

The project has been initialized with the following structure:

```
/home/blake/Projects/apps/Navidrome-MCP/
├── src/                          # TypeScript source code
│   ├── index.ts                  # MCP server entry point
│   ├── config.ts                 # Configuration management with zod
│   ├── client/                   # Navidrome API client
│   │   ├── navidrome-client.ts  # Main API client class
│   │   └── auth-manager.ts      # JWT token management
│   ├── tools/                    # MCP tool implementations
│   │   └── index.ts              # Tool registry (to be implemented)
│   ├── resources/                # MCP resources
│   │   └── index.ts              # Resource registry (to be implemented)
│   └── utils/                    # Utility functions
│       ├── cache.ts              # In-memory cache implementation
│       └── logger.ts             # Logging utility
├── docs/                         
│   ├── api/                      # Complete Navidrome API documentation
│   └── LICENSE-CC-BY-SA-4.0.txt # Documentation license
├── tests/                        
│   └── unit/                     
│       └── utils/                
│           └── cache.test.ts     # Cache utility tests
├── .env.example                  # Environment variable template
├── .gitignore                    # Git ignore configuration
├── package.json                  # Project configuration
├── tsconfig.json                 # TypeScript configuration
├── eslint.config.js              # ESLint v9 configuration
├── .prettierrc.json              # Prettier configuration
├── vitest.config.ts              # Test configuration
├── LICENSE                       # AGPL-3.0 license
└── README.md                     # User documentation
```

## Technology Stack

### Core Dependencies
- **@modelcontextprotocol/sdk**: Official MCP SDK for TypeScript
- **zod**: Schema validation for configuration and tool inputs
- **dotenv**: Environment variable management

### Development Dependencies
- **typescript**: Type safety and modern JavaScript features
- **tsx**: TypeScript execution for development
- **vitest**: Fast unit testing framework
- **nodemon**: Auto-restart during development
- **prettier**: Code formatting
- **eslint**: Code linting with TypeScript rules

### Key Commands (ALWAYS USE PNPM)
- `pnpm dev` - Development mode with hot reload
- `pnpm build` - Build TypeScript to JavaScript
- `pnpm test` - Run tests (MUST pass before any commit)
- `pnpm lint` - Check code style (MUST have zero issues)
- `pnpm typecheck` - Type checking (MUST have zero errors)
- `pnpm format` - Auto-format code
- `pnpm format:check` - Check formatting

## Implementation Guidelines

### When Creating New Tools

1. Each tool should have a clear, specific purpose
2. Use descriptive names that reflect the action (e.g., `create_playlist`, not just `playlist`)
3. Provide comprehensive descriptions that guide natural language usage
4. Implement robust error handling with helpful error messages
5. Use zod schemas for all input validation
6. Cache appropriate responses to reduce API load

### API Client Design

1. The NavidromeClient should abstract all HTTP details
2. Implement automatic token refresh in the AuthManager
3. Use TypeScript interfaces for all API responses
4. Handle rate limiting gracefully
5. Log API calls only in debug mode
6. Never expose sensitive data in errors or logs

### Type Definitions

1. Generate types from the documented API responses
2. Use strict TypeScript settings
3. Prefer interfaces over types for API contracts
4. Use enums for constant values (e.g., TranscodeFormat)
5. Document complex types with JSDoc comments

### Error Handling

1. Create custom error classes for different error types
2. Preserve Navidrome error messages and codes
3. Add context to errors without exposing sensitive data
4. Implement retry logic for transient failures
5. Provide actionable error messages for users

## Licensing

### Code License: AGPL-3.0
- All source code is licensed under AGPL-3.0
- License headers are already included in all source files
- Contributions must be compatible with AGPL-3.0

### Documentation License: CC-BY-SA-4.0
- All documentation in /docs is CC-BY-SA-4.0
- License file included at docs/LICENSE-CC-BY-SA-4.0.txt

## Environment Configuration

Required environment variables:
- `NAVIDROME_URL`: Full URL to Navidrome server (e.g., http://192.168.86.100:4533)
- `NAVIDROME_USERNAME`: Username for authentication
- `NAVIDROME_PASSWORD`: Password for authentication
- `DEBUG`: Enable debug logging (optional, default: false)
- `CACHE_TTL`: Cache time-to-live in seconds (optional, default: 300)

## MCP Tool Categories

### Discovery Tools
- Find similar artists
- Get recommendations based on listening history
- Discover music by genre/mood
- Find random songs/albums

### Search Tools
- Search songs by title/artist/album
- Search with filters (year, genre, rating)
- Quick search across all media types
- Advanced search with multiple criteria

### Playlist Tools
- Create/edit/delete playlists
- Add/remove/reorder tracks
- Import/export M3U playlists
- Generate smart playlists

### Playback Tools
- Control playback queue
- Add to queue (next/last)
- Clear queue
- Sync queue across devices

### Library Tools
- Browse artists/albums/songs
- Get album/artist information
- View recent additions
- Get library statistics

### Sharing Tools
- Create public shares
- Manage share expiration
- Get share links

### Admin Tools (when applicable)
- Trigger library scans
- Manage transcoding settings
- View system status

## Testing Strategy

1. Unit tests for all utility functions
2. Integration tests for API client methods
3. Mock Navidrome responses for offline testing
4. Test against real Navidrome instance when possible
5. Test error scenarios and edge cases

## Performance Considerations

1. Implement intelligent caching for frequently accessed data
2. Batch API requests where possible
3. Use pagination for large result sets
4. Implement request debouncing for search
5. Monitor memory usage of cache

## Security Notes

1. Never commit real credentials
2. Use environment variables for all sensitive data
3. Implement rate limiting to prevent abuse
4. Validate and sanitize all inputs
5. Use HTTPS for production deployments
6. Implement token refresh before expiration

## Common Patterns

### Tool Implementation Pattern
Each tool should follow the pattern established in the tools directory, with clear input schemas and comprehensive error handling.

### Resource Implementation Pattern
Resources should provide read-only access to data, with automatic caching and refresh capabilities.

### Client Method Pattern
Client methods should handle authentication, request formatting, and response parsing consistently.

## Development Workflow

### Before ANY Code Changes
1. Understand the existing codebase and patterns
2. Plan changes to maintain zero errors/warnings

### After EVERY Code Change
1. Run `pnpm test` - Must pass 100%
2. Run `pnpm lint` - Must have ZERO issues
3. Run `pnpm typecheck` - Must have ZERO errors
4. Fix ALL issues before moving on

### Important Reminders
1. This is specifically for Navidrome, not generic Subsonic
2. Always use pnpm, never npm or yarn
3. Follow TypeScript strict mode requirements
4. No placeholder code or TODOs in committed code
5. Test against the live server at 192.168.86.100:4533
6. Keep security as a top priority
7. Maintain production-quality code at all times

## Version Information

- Target Navidrome Version: Latest (supports OpenSubsonic extensions)
- Node.js Version: 18+ (for native fetch API)
- TypeScript Version: 5.0+
- MCP SDK Version: Latest
