# Testing Strategy for Navidrome MCP Server

## Core Testing Principles - CRITICAL

### ✅ **ALWAYS DO**
- **Live reads**: Test API compatibility against real server, validate structure not content
- **Mock writes**: NEVER modify server data - mock all create/update/delete operations
- **Shared auth**: Use `getSharedLiveClient()` to prevent rate limiting
- **Structure validation**: Test response shapes, field types, never specific content

### ❌ **NEVER DO**
- **Real writes**: Never create/modify/delete server data in tests
- **Content testing**: Don't test specific song names, artists, album titles
- **Individual auth**: Don't use `createLiveClient()` (deprecated)
- **External API calls**: Always mock Last.fm, Radio Browser, LRCLIB

---

## Implementation Patterns

### Live Read Testing
Use for API compatibility validation. Test structure, not content:

**Key Elements:**
- `liveClient = await getSharedLiveClient()` in beforeAll
- Minimal parameters (`limit: 1`) to reduce response size
- Validate response properties exist with correct types
- If data exists, verify required DTO fields but not values
- Test edge cases like empty queries, special characters

### Mocked Write Testing
Use for all operations that modify data:

**Key Elements:**
- `mockClient = createMockClient()` in beforeEach
- `mockClient.request.mockResolvedValue(expectedResponse)`
- Verify correct API calls with `expect().toHaveBeenCalledWith()`
- Test both success and error scenarios
- Include input validation tests

### External API Testing
Always mock external services:

**Key Elements:**
- Mock fetch globally: `global.fetch = vi.fn()`
- Provide realistic mock responses
- Test error handling for API failures
- Never make real external API calls in unit tests

---

## Test Organization

### Directory Structure
```
tests/
├── unit/tools/           # Tool-specific tests (135 tests total)
├── unit/utils/           # Utility function tests
├── factories/            # Mock client & data factories
└── CLAUDE.md             # This file
```

### Current Test Coverage (135 tests)
1. **Playlist** - 22 tests (data modification safety)
2. **Search** - 22 tests (high user impact)
3. **User Preferences** - 31 tests (data integrity)
4. **Radio Validation** - 22 tests (stream validation)
5. **Tools Registry** - 6 tests (comprehensive tool validation)
6. **Message Manager** - 32 tests (utility testing)

---

## Common Patterns Reference

### Pagination Testing
Test limit/offset parameters are respected, verify response structure.

### Error Handling
Mock network failures, API errors, validation failures - ensure graceful handling.

### Input Validation
Test required fields, format validation, boundary conditions.

### Feature Detection
Test conditional tool registration based on configuration flags.

### Edge Cases
Empty results, special characters, unicode, oversized inputs.

---

## API-Specific Notes

### Navidrome APIs
- **REST API**: Use `request()` for CRUD operations
- **Subsonic API**: Use `subsonicRequest()` for stars/ratings
- **Response Types**: Paginated vs Search responses have different structures

### Mock Factories
```typescript
// Write operations
const mockClient = createMockClient();

// Read operations
const liveClient = await getSharedLiveClient();

// Mock data
import { mockSong, mockPlaylist } from '../../factories/mock-data.js';
```

---

## Quality Gates

**MUST pass before completion:**
```bash
pnpm test:run     # 135 tests pass
pnpm lint         # 0 errors/warnings
pnpm typecheck    # 0 type errors
```

---

## Environment Configuration

Test environment requires:
- `NAVIDROME_URL`, `NAVIDROME_USERNAME`, `NAVIDROME_PASSWORD` for live reads
- External API keys DISABLED by default for unit tests
- Use `.env.test` for test-specific configuration

---

## Key Anti-Patterns to Avoid

❌ Testing specific content: `expect(song.title).toBe('Bohemian Rhapsody')`
❌ Real server modifications: `await createPlaylist(liveClient, {...})`
❌ Unmocked external calls: Direct fetch to Last.fm/Radio Browser
❌ Individual auth sessions: Rate limiting and test interference

✅ Structure validation: `expect(song).toHaveProperty('title')`
✅ Mocked modifications: `mockClient.request.mockResolvedValue(...)`
✅ Mocked externals: `global.fetch = vi.fn()`
✅ Shared authentication: Prevents rate limiting

---

## Summary

**Test Philosophy**: Hybrid approach - live reads for API compatibility, mocked writes for safety. Always validate structure/behavior, never content/data. Use shared authentication and mock external services. Maintain 100% test pass rate with comprehensive coverage of critical operations.