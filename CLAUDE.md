# CLAUDE.md - Assistant Instructions for Navidrome MCP Server

## Project Overview

This is an MCP (Model Context Protocol) server that provides AI assistants with tools to interact with a Navidrome music server, and various other APIs.

**Package Manager**: pnpm (NOT npm or yarn)
**Language**: TypeScript with strict mode enabled
**Runtime**: Node.js with ES modules

## CRITICAL CODE QUALITY REQUIREMENTS

### Quality Gates (ALL must pass)
**AFTER EVERY CODE CHANGE:**
1. Run `pnpm test:run` - ALL tests must pass (runs once, exits)
2. Run `pnpm lint` - ZERO errors and warnings allowed  
3. Run `pnpm typecheck` - ZERO type errors allowed
4. **Unit Testing**: ALL new features must include unit tests following `docs/UNIT-TEST-STRATEGY.md`

### Test Commands
- `pnpm test:run` - Run tests once and exit (for CI/validation)
- `pnpm test` - Watch mode for development (stays running)
- `pnpm test:coverage` - Run with coverage report

## Established Architecture - USE THESE

### Schema System (NEW - Use This!)
```typescript
// Import from shared schemas instead of duplicating
import { 
  SongPaginationSchema,
  PlaylistPaginationSchema, 
  SearchAllSchema,
  StarItemSchema 
} from '../schemas/index.js';

// Schemas are organized by purpose:
// - src/schemas/common.ts - Reusable patterns
// - src/schemas/pagination.ts - All pagination schemas  
// - src/schemas/validation.ts - Input validation schemas
```

### Error Handling - USE ErrorFormatter
```typescript
import { ErrorFormatter } from '../utils/error-formatter.js';

// Standardized error messages
throw new Error(ErrorFormatter.toolExecution('myTool', error));
throw new Error(ErrorFormatter.httpRequest('Navidrome API', response));
throw new Error(ErrorFormatter.configMissing('Last.fm', 'LASTFM_API_KEY'));
```

### Logging - USE Logger Utility
```typescript
import { logger } from '../utils/logger.js';

logger.debug('Starting operation...');  // Only when debug enabled
logger.info('Operation completed successfully');
logger.error('Operation failed:', error);
// NEVER use console.log (breaks MCP protocol)
```

### Tool Organization (CURRENT STRUCTURE)
```typescript
// Tools are organized by category in src/tools/handlers/
// - playlist-handlers.ts - Playlist operations
// - search-handlers.ts - Search operations  
// - user-preferences-handlers.ts - Stars/ratings
// - queue-handlers.ts - Queue management
// - radio-handlers.ts - Radio stations
// - lastfm-handlers.ts - Last.fm integration (conditional)
// - lyrics-handlers.ts - Lyrics (conditional)
// - tag-handlers.ts - Tag management

// Main registry coordinates all tools
import { registerTools } from './handlers/registry.js';
```

## Unit Testing Requirements

**ALL new features must include unit tests** following `docs/UNIT-TEST-STRATEGY.md`:

### Test Categories
1. **Live Read Tests** - Test against real server, validate structure not content
2. **Mocked Write Tests** - Mock all write operations for safety
3. **Feature Detection** - Test configuration-based tool registration
4. **Tool Registration Verification** - Ensure no tools go missing with comprehensive validation

### Test Examples
```typescript
// Live read test (validates API structure)
const result = await listSongs(liveClient, { limit: 1 });
expect(result).toHaveProperty('songs');
expect(result.songs[0]).toHaveProperty('id');

// Mock write test (safe, no server changes)
mockClient.request.mockResolvedValue(mockPlaylistResponse);
await createPlaylist(mockClient, { name: 'Test' });
expect(mockClient.request).toHaveBeenCalledWith('/playlist', expectedArgs);
```

## Development Workflow

### Adding New Tools
1. **Study existing patterns** - Look at similar tools in `src/tools/handlers/`
2. **Use shared schemas** - Import from `src/schemas/` instead of duplicating
3. **Follow naming patterns** - Use existing DTO types from `src/types/`
4. **Add unit tests** - Required for all new functionality
5. **Quality gates** - All tests, lint, typecheck must pass

### Tool Registration Pattern
```typescript
// Add to appropriate handler file (e.g., playlist-handlers.ts)
export function createPlaylistToolCategory(client: NavidromeClient, config: Config): ToolCategory {
  return {
    tools: [
      {
        name: 'your_new_tool',
        description: 'Clear description for AI usage',
        inputSchema: YourToolSchema.schema, // Use shared schema
      },
    ],
    async handleToolCall(name: string, args: unknown) {
      if (name === 'your_new_tool') {
        return yourNewTool(client, config, args);
      }
      throw new Error(ErrorFormatter.toolUnknown(name));
    },
  };
}
```

## TypeScript Strict Mode (Enforced)

**Ultra-strict settings require careful type management:**

```typescript
// ✅ DO: Define interfaces first
export interface YourToolResult {
  success: boolean;
  data: YourDataType[];
}

// ✅ DO: Use existing DTO types  
import type { SongDTO, AlbumDTO } from '../types/index.js';

// ✅ DO: Type guards for external APIs
function isValidResponse(data: unknown): data is ExpectedType {
  return typeof data === 'object' && data !== null && 'field' in data;
}

// Run frequently during development
pnpm typecheck
```

## Environment Configuration

**Required:**
- `NAVIDROME_URL`: Server URL (e.g., http://192.168.86.100:4533)
- `NAVIDROME_USERNAME`: Username  
- `NAVIDROME_PASSWORD`: Password

**Optional (enable features):**
- `LASTFM_API_KEY`: Last.fm integration (enables music discovery features)
- `RADIO_BROWSER_USER_AGENT`: Radio discovery
- `LYRICS_PROVIDER=lrclib`: Lyrics support (enables song lyrics features)
- `DEBUG=true`: Enable debug logging

### For Testing and Development

**Server credentials and configuration are in `.env` files:**
- Check `.env` for main configuration
- Check `.env.test` for test environment settings
- Copy `.env.example` if needed to create your local `.env`

**Example .env setup:**
```bash
NAVIDROME_URL=http://your-server:4533
NAVIDROME_USERNAME=your-username  
NAVIDROME_PASSWORD=your-password
DEBUG=true
```

## Testing with MCP Inspector

```bash
# Build first
pnpm build

# List tools (count varies based on enabled features)
npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list

# Test specific tool
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call \
  --tool-name test_connection \
  --tool-arg includeServerInfo=true

# Web UI
npx @modelcontextprotocol/inspector node dist/index.js
```

## Testing Navidrome API with curl

**IMPORTANT: Use `/auth/login` endpoint (NOT `/auth` or `/api/login`)**

```bash
# 1. Get authentication token
TOKEN=$(curl -s -X POST http://nas.pixelmuse.ai:4533/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"claude","password":"anthropicuser"}' | jq -r '.token')

# 2. Use token with X-ND-Authorization header
curl -s "http://nas.pixelmuse.ai:4533/api/album?_start=0&_end=5&library_id=1" \
  -H "X-ND-Authorization: Bearer $TOKEN" | jq '.'

# 3. Test filters (use {type}_id parameters)
curl -s "http://nas.pixelmuse.ai:4533/api/album?genre_id=UUID&library_id=1" \
  -H "X-ND-Authorization: Bearer $TOKEN" | jq '.'

# 4. Test tag endpoint (for discovering filter values)
curl -s "http://nas.pixelmuse.ai:4533/api/tag?tag_name=genre&library_id=1" \
  -H "X-ND-Authorization: Bearer $TOKEN" | jq '.[] | {id, tagValue}'
```

## Dead Code Prevention

**Integrated Detection Tools:**
- `pnpm check:dead-code` - ts-unused-exports for systematic unused export detection
- `pnpm check:all` - Combined lint, typecheck, and dead code validation
- `tests/meta/dead-code-detection.test.ts` - Deterministic validation of critical patterns
- GitHub Actions CI - Automated dead code detection on pull requests

**Prevention Guidelines:**
- Verify all method calls exist before using (use TypeScript strict mode)
- Import services as singleton instances, not classes directly
- Remove unused exports immediately after refactoring
- Test all singleton initialization patterns for null safety

## Key Principles

1. **Follow Established Patterns** - The codebase has mature patterns, use them
2. **Schema Reuse** - Import from `src/schemas/` instead of duplicating
3. **Unit Test Everything** - Required for all new features
4. **Quality Gates** - Zero tolerance for lint/type/test failures
5. **MCP Compliance** - Use logger, proper JSON-RPC, stderr output
6. **Production Ready** - Every commit must be production-quality
7. **Dead Code Prevention** - Use automated detection tools and validate critical patterns