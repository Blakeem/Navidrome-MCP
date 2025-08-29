# CLAUDE.md - Assistant Instructions for Navidrome MCP Server

## Project Overview

This is an MCP (Model Context Protocol) server that provides AI assistants with tools to interact with a Navidrome music server. The project enables sophisticated music library operations through natural language, including discovery, playlist management, and playback control.

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

### Key Commands (ALWAYS USE PNPM)
- `pnpm dev` - Development mode with hot reload
- `pnpm build` - Build TypeScript to JavaScript
- `pnpm test` - Run tests (MUST pass before any commit)
- `pnpm lint` - Check code style (MUST have zero issues)
- `pnpm typecheck` - Type checking (MUST have zero errors)
- `pnpm format` - Auto-format code

## Project Philosophy

1. **Navidrome-First**: This server specifically targets Navidrome, not generic Subsonic servers
2. **Type Safety**: Leverage TypeScript's strict mode for all implementations
3. **Clean Architecture**: Separate concerns clearly between API client, MCP tools, and utilities
4. **User Experience**: Provide intuitive tool descriptions that guide natural language usage
5. **Performance**: Implement intelligent caching to minimize API calls
6. **Security**: Never log or expose credentials, use secure token management
7. **Quality First**: Every line of code must meet the highest standards

## Environment Configuration

Required environment variables:
- `NAVIDROME_URL`: Full URL to Navidrome server (e.g., http://192.168.86.100:4533)
- `NAVIDROME_USERNAME`: Username for authentication
- `NAVIDROME_PASSWORD`: Password for authentication
- `DEBUG`: Enable debug logging (optional, default: false)
- `CACHE_TTL`: Cache time-to-live in seconds (optional, default: 300)
- `TOKEN_EXPIRY`: JWT token expiry in seconds (optional, default: 86400)

## Testing with MCP Inspector

### What is MCP Inspector?

The MCP Inspector is the **official testing tool** for MCP servers. It provides both CLI and web UI modes for testing MCP protocol functionality.

### MCP Protocol Overview

MCP servers use **JSON-RPC over STDIO** (not REST APIs):
- Server runs as a subprocess
- Communicates via standard input/output  
- Uses JSON-RPC 2.0 protocol

### MCP Resources vs Tools

**Resources** are read-only data that provide context to LLMs:
- Examples: Server status, library statistics, recent songs
- Identified by unique URIs (e.g., `navidrome://server/status`)

**Tools** are executable functions with side effects:
- Examples: Search songs, test connection, list songs
- Take parameters and return results

### CLI Testing Commands

#### Basic Testing
```bash
# Build first
pnpm build

# List all tools
npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list

# Test connection
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call \
  --tool-name test_connection \
  --tool-arg includeServerInfo=true

# List songs
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call \
  --tool-name list_songs \
  --tool-arg limit=5
```

#### Resource Testing
```bash
# List all resources
npx @modelcontextprotocol/inspector --cli node dist/index.js --method resources/list

# Read server status
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method resources/read \
  --uri "navidrome://server/status"

# Read recent songs
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method resources/read \
  --uri "navidrome://library/recent-songs"
```

### Web UI Testing

```bash
# Open Inspector in browser
npx @modelcontextprotocol/inspector node dist/index.js
```

## Development Workflow

### Before ANY Code Changes
1. Understand the existing codebase and patterns
2. Plan changes to maintain zero errors/warnings

### After EVERY Code Change
1. Run `pnpm test` - Must pass 100%
2. Run `pnpm lint` - Must have ZERO issues
3. Run `pnpm typecheck` - Must have ZERO errors
4. Fix ALL issues before moving on

### Adding New Tools
1. Create tool function in `src/tools/[category].ts`
2. Import and register in `src/tools/index.ts`
3. Run quality checks: `pnpm lint && pnpm typecheck && pnpm test`
4. Build and test with CLI: `pnpm build && npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list`

### Adding New Resources
1. Add resource definition to `resources` array in `src/resources/index.ts`
2. Add URI handler in the `ReadResourceRequestSchema` handler
3. Run quality checks and test with CLI

## Implementation Guidelines

### API Client Design
1. Use only **working endpoints** - replace any broken ones with `/song` endpoint
2. Implement automatic token refresh in the AuthManager
3. Use TypeScript interfaces for all API responses
4. Handle rate limiting gracefully
5. Never expose sensitive data in errors or logs

### Tool Implementation
1. Each tool should have a clear, specific purpose
2. Use descriptive names that reflect the action
3. Provide comprehensive descriptions for natural language usage
4. Implement robust error handling with helpful error messages
5. Use zod schemas for all input validation
6. Cache appropriate responses to reduce API load

### Error Handling
1. Create custom error classes for different error types
2. Preserve Navidrome error messages and codes
3. Add context to errors without exposing sensitive data
4. Implement retry logic for transient failures
5. Provide actionable error messages for users

## Security Notes

1. Never commit real credentials
2. Use environment variables for all sensitive data
3. Validate and sanitize all inputs
4. Use HTTPS for production deployments
5. Implement token refresh before expiration

## Important Reminders

1. This is specifically for Navidrome, not generic Subsonic
2. Always use pnpm, never npm or yarn
3. Follow TypeScript strict mode requirements
4. No placeholder code or TODOs in committed code
5. Test against the live server at 192.168.86.100:4533
6. Keep security as a top priority
7. Maintain production-quality code at all times
8. Use only working API endpoints (primarily `/song` endpoint)
