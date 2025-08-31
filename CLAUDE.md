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

### Adding New Tools - STRICT MODE WORKFLOW

**CRITICAL: Follow this exact workflow to avoid type errors:**

1. **Study Existing Patterns First**
   ```bash
   # Look at working examples
   cat src/tools/test.ts        # Simple pattern
   cat src/tools/library.ts     # Complex pattern with DTOs
   cat src/types/dto.ts         # Available interfaces
   ```

2. **Create Interfaces BEFORE Implementation**
   ```typescript
   // Start with interfaces in your tool file
   export interface YourToolResult {
     success: boolean;
     data: YourDataType[];
   }
   
   export interface YourDataType {
     id: string;
     name: string;
     // Use existing DTO types when possible
   }
   ```

3. **Implement Function with Proper Types**
   ```typescript
   export async function yourTool(
     client: NavidromeClient, 
     args: unknown
   ): Promise<YourToolResult> {
     // Implementation using the interfaces above
   }
   ```

4. **Test Types Every Few Lines**
   ```bash
   # Run this frequently during development
   pnpm typecheck
   ```

5. **Register in Tools Index**
   - Import the function in `src/tools/index.ts`
   - Add tool definition with proper schema
   - Add handler in CallToolRequestSchema

6. **Final Quality Checks**
   ```bash
   pnpm lint && pnpm typecheck && pnpm test
   ```

7. **Test with MCP Inspector**
   ```bash
   pnpm build && npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list
   ```

**If you get type errors during step 4, STOP and fix them immediately. Do not continue implementation until types are perfect.**

### Using Git for Reference
The project maintains working code in git branches:
```bash
# View previous working implementations
git log --oneline
git show <commit-hash>  # View specific commit
git diff HEAD~1 src/tools/  # Compare recent changes

# The docs folder contains API documentation for reference:
ls docs/api/  # Navidrome API specifications
```

### Adding New Resources
1. Add resource definition to `resources` array in `src/resources/index.ts`
2. Add URI handler in the `ReadResourceRequestSchema` handler
3. Run quality checks and test with CLI

## TypeScript Strict Mode Requirements

This project uses **ultra-strict TypeScript settings** that require careful type management from the start. **DO NOT use `any` types** - they will cause lint failures and make refactoring difficult later.

### Ultra-Strict Settings in `tsconfig.json`
- `noPropertyAccessFromIndexSignature: true` - Must use bracket notation for Record types
- `exactOptionalPropertyTypes: true` - Optional props cannot have explicit `undefined`
- `noUncheckedIndexedAccess: true` - Array/object access returns `T | undefined`
- `strict: true` - All strict type checking enabled

### Proper Type Patterns

#### ✅ DO: Define Proper Interfaces First
```typescript
// Define specific API response interfaces
export interface NavidromeArtist {
  id: string;
  name: string;
  albumCount: number;
  starred?: string;
}

export interface ArtistListResult {
  artists: NavidromeArtist[];
  total: number;
}

// Use in function signatures
export async function listArtists(client: NavidromeClient, args: unknown): Promise<ArtistListResult> {
  const response = await client.request<NavidromeArtist[]>('/artist');
  return { artists: response, total: response.length };
}
```

#### ❌ DON'T: Use `any` Types
```typescript
// This will cause lint failures
export async function listArtists(client: NavidromeClient, args: unknown): Promise<any> {
  const response = await client.request<any>('/artist');
  return response.map((artist: any) => ({ ... }));
}
```

#### ✅ DO: Handle External APIs with Type Guards
```typescript
// For unknown external APIs (like Last.fm)
interface LastFmResponse {
  artist?: {
    name: string;
    mbid?: string;
  };
}

function isLastFmArtist(data: unknown): data is LastFmResponse {
  return typeof data === 'object' && data !== null && 'artist' in data;
}

const data = await response.json();
if (isLastFmArtist(data)) {
  // Now safely typed
  return data.artist.name;
}
```

#### ❌ DON'T: Use Record<string, unknown> for Known APIs
```typescript
// This creates strict mode errors
const data = response as Record<string, unknown>;
data.artist  // Error: Property access from index signature
data['artist']  // Works but clunky
```

#### ✅ DO: Handle Optional Properties Correctly
```typescript
// With exactOptionalPropertyTypes: true
interface StarredItem {
  title?: string;  // Means string OR missing (not undefined)
}

// Correct approach
const item: StarredItem = {
  id: track.id,
  // Only include title if it exists and is truthy
  ...(track.title && { title: track.title }),
};

// Alternative approach
const item: StarredItem = {
  id: track.id,
};
if (track.title) {
  item.title = track.title;  // Safe assignment
}
```

#### ❌ DON'T: Assign undefined to Optional Properties
```typescript
// This fails with exactOptionalPropertyTypes
const item: StarredItem = {
  title: track.title || undefined,  // Error!
};
```

### Avoiding Common `any` Lint Failures

#### ✅ DO: Type API Responses Properly
```typescript
// Look at existing patterns in the codebase
const response = await client.request<SongDTO[]>('/song');
const songs = response.map((song: SongDTO) => ({
  id: song.id,
  title: song.title || 'Unknown',
}));
```

#### ✅ DO: Use Existing DTO Types
```typescript
// Import and use existing types from the codebase
import type { SongDTO, AlbumDTO } from '../types/dto.js';
```

#### ✅ DO: Follow Existing Patterns
```typescript
// Look at tools/test.ts, tools/library.ts for proper patterns
// Copy their interface and function signature patterns exactly
```

### Pre-Implementation Checklist

**Before writing ANY new tool function:**

1. ✅ **Study existing tools** - Copy their type patterns exactly
2. ✅ **Define interfaces first** - Create proper return types before implementation  
3. ✅ **Use existing DTO types** - Import from `../types/dto.js` when available
4. ✅ **Test with small examples** - Write minimal functions first to verify types work
5. ✅ **Avoid `any` completely** - Use `unknown` and type guards instead
6. ✅ **Run `pnpm typecheck`** after every few lines to catch issues early

**This approach prevents the need for extensive refactoring later!**

## Implementation Guidelines

### API Client Design
1. Use only **working endpoints**, if you have any issues test directly with curl (use username/password of claude/anthropicuser)
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

## Important Reminders

1. Always use pnpm, never npm or yarn
2. Follow TypeScript strict mode requirements
3. No placeholder code or TODOs in committed code
4. Test against the live server at 192.168.86.100:4533
5. Keep security as a top priority
6. Maintain production-quality code at all times
7. Use only working API endpoints
