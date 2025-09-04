# LLM Assistant Instructions - Testing Strategy for Navidrome MCP Server

## Overview for AI Assistants

You are working on a Navidrome MCP (Model Context Protocol) Server with comprehensive unit testing. This document provides complete testing patterns, strategies, and implementation guidelines that you MUST follow when creating or maintaining tests.

**Key Context:**
- **Testing Strategy**: Hybrid approach (live reads + mocked writes)
- **Architecture**: TypeScript with strict mode, Vitest testing framework
- **Rate Limiting Solution**: Shared authentication singleton prevents rate limiting errors

---

## CRITICAL: Testing Philosophy & Safety

### ✅ **ALWAYS DO - Safe Testing Practices**
- **Live Read Operations**: Test against real Navidrome server for API compatibility
- **Mock Write Operations**: NEVER modify server data during tests
- **Structure Validation**: Test response shapes, not specific content
- **Shared Authentication**: Use `getSharedLiveClient()` to prevent rate limiting

### ❌ **NEVER DO - Unsafe Testing Practices**  
- **NO Real Write Operations**: Never create/modify/delete server data in tests
- **NO Content Assumptions**: Don't test specific song names, artists, or album titles
- **NO Individual Auth Sessions**: Don't use `createLiveClient()` (deprecated)
- **NO External API Hammering**: Always mock external APIs (Last.fm, Radio Browser, LRCLIB)

---

## Implementation Patterns - FOLLOW THESE EXACTLY

### **Pattern 1: Live Read Operations (API Compatibility)**

```typescript
// ✅ CORRECT PATTERN - Test structure, not content
describe('Live Read Operations - API Compatibility', () => {
  let liveClient: NavidromeClient;

  beforeAll(async () => {
    // ALWAYS use shared client to prevent rate limiting
    liveClient = await getSharedLiveClient();
  });

  it('should return valid song structure from live server', async () => {
    // Use minimal parameters to reduce response size
    const result = await listSongs(liveClient, { limit: 1 });

    // Validate response structure (not specific content)
    expect(result).toHaveProperty('songs');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('offset');
    expect(result).toHaveProperty('limit');

    // Ensure correct types
    expect(Array.isArray(result.songs)).toBe(true);
    expect(typeof result.total).toBe('number');
    expect(typeof result.offset).toBe('number');
    expect(typeof result.limit).toBe('number');

    // If data exists, verify structure (not content)
    if (result.songs.length > 0) {
      const song = result.songs[0];
      
      // Required fields from DTO
      expect(song).toHaveProperty('id');
      expect(song).toHaveProperty('title');
      expect(song).toHaveProperty('artist');
      expect(song).toHaveProperty('album');
      
      // Verify field types
      expect(typeof song.id).toBe('string');
      expect(typeof song.title).toBe('string');
      expect(typeof song.artist).toBe('string');
      expect(typeof song.album).toBe('string');
    }

    // Verify pagination parameters were respected
    expect(result.limit).toBe(1);
    expect(result.offset).toBe(0);
  });
});
```

### **Pattern 2: Mocked Write Operations (Data Safety)**

```typescript
// ✅ CORRECT PATTERN - Mock all write operations
describe('Mocked Write Operations - Business Logic Safety', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    // Create fresh mock for each test
    mockClient = createMockClient();
  });

  it('should create playlist with correct API call structure', async () => {
    // Setup mock response
    const mockResponse = { 
      id: 'new-playlist-123', 
      name: 'Test Playlist',
      owner: 'test-user',
      public: false,
      songCount: 0,
      duration: 0,
      created: '2023-01-01T12:00:00Z',
      changed: '2023-01-01T12:00:00Z'
    };
    
    mockClient.request.mockResolvedValue(mockResponse);
    
    const result = await createPlaylist(mockClient, { 
      name: 'Test Playlist',
      comment: 'A test playlist',
      public: false 
    });

    // Verify correct API call was made
    expect(mockClient.request).toHaveBeenCalledWith(
      '/playlist',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: expect.stringContaining('Test Playlist')
      })
    );

    // Verify response structure
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('name');
    expect(result.name).toBe('Test Playlist');
  });
});
```

### **Pattern 3: External API Testing (Mocked by Default)**

```typescript
// ✅ CORRECT PATTERN - Mock external APIs
describe('External API Integration - Mocked', () => {
  let mockFetch: MockedFunction<typeof fetch>;
  
  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  it('should get similar artists with mocked Last.fm response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        similarartists: {
          artist: [
            { name: 'Mock Artist 1', match: '0.95', mbid: 'mock-mbid-1' },
            { name: 'Mock Artist 2', match: '0.85', mbid: 'mock-mbid-2' }
          ]
        }
      })
    } as Response);
    
    const result = await getSimilarArtists(config, { artist: 'Test Artist' });
    
    expect(result.artists).toHaveLength(2);
    expect(result.artists[0]).toHaveProperty('name');
    expect(result.artists[0]).toHaveProperty('match');
  });

  it('should handle external API errors gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found'
    } as Response);

    await expect(
      getSimilarArtists(config, { artist: 'NonexistentArtist' })
    ).rejects.toThrow();
  });
});
```

### **Pattern 4: Error Handling Testing**

```typescript
// ✅ CORRECT PATTERN - Comprehensive error handling
describe('Error Handling', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('should handle network errors gracefully', async () => {
    mockClient.request.mockRejectedValue(new Error('Network connection failed'));
    
    await expect(
      createPlaylist(mockClient, { name: 'Test' })
    ).rejects.toThrow('Network connection failed');
  });

  it('should handle API errors for invalid playlist IDs', async () => {
    mockClient.request.mockRejectedValue(new Error('Playlist not found'));
    
    await expect(
      getPlaylist(mockClient, { id: 'non-existent-id' })
    ).rejects.toThrow('Playlist not found');
  });

  it('should handle permission errors for unauthorized operations', async () => {
    mockClient.request.mockRejectedValue(new Error('Insufficient permissions'));
    
    await expect(
      deletePlaylist(mockClient, { id: 'protected-playlist' })
    ).rejects.toThrow('Insufficient permissions');
  });
});
```

### **Pattern 5: Input Validation Testing**

```typescript
// ✅ CORRECT PATTERN - Test validation logic
describe('Input Validation', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    mockClient = createMockClient();
    mockClient.request.mockResolvedValue(mockSuccessResponse);
  });

  it('should validate required playlist name for creation', async () => {
    await expect(
      createPlaylist(mockClient, { name: '' })
    ).rejects.toThrow();
  });

  it('should validate playlist ID format', async () => {
    await expect(
      getPlaylist(mockClient, { id: '' })
    ).rejects.toThrow();
  });

  it('should validate track IDs array for removal', async () => {
    await expect(
      removeTracksFromPlaylist(mockClient, { 
        playlistId: 'playlist-123', 
        trackIds: [] 
      })
    ).rejects.toThrow();
  });

  it('should validate position parameters for reordering', async () => {
    await expect(
      reorderPlaylistTrack(mockClient, { 
        playlistId: 'playlist-123',
        trackId: '1',
        insert_before: -1 
      })
    ).rejects.toThrow();
  });
});
```

---

## Test Organization Structure

### **Directory Structure (Follow This)**
```
tests/
├── unit/
│   ├── tools/
│   │   ├── playlist.test.ts         # ✅ COMPLETED (22 tests)
│   │   ├── search.test.ts           # ✅ COMPLETED (22 tests)
│   │   ├── user-preferences.test.ts # ✅ COMPLETED (31 tests)
│   │   ├── library.test.ts          # ✅ COMPLETED (5 tests)
│   │   ├── radio-validation.test.ts # ✅ COMPLETED (22 tests)
│   │   └── tools-registry.test.ts   # ✅ COMPLETED (6 tests)
│   └── utils/
│       ├── message-manager.test.ts  # ✅ COMPLETED (32 tests)
│       └── [other utils tests]
├── factories/
│   ├── mock-client.ts               # Mock client factory
│   ├── mock-data.ts                 # Mock data objects
│   └── shared-client.ts             # ✅ Shared auth client
└── CLAUDE.md                        # This file - LLM instructions
```

---

## Mock Factories - Use These

### **Mock Client Factory**
```typescript
// Import from tests/factories/mock-client.ts
import { createMockClient, getSharedLiveClient } from '../../factories/mock-client.js';

// ✅ For write operations
const mockClient = createMockClient();
mockClient.request.mockResolvedValue(expectedResponse);

// ✅ For read operations (shared auth - prevents rate limiting)
const liveClient = await getSharedLiveClient();
```

### **Mock Data Objects**
```typescript
// Import from tests/factories/mock-data.ts
import { mockSong, mockAlbum, mockPlaylist, mockResponses } from '../../factories/mock-data.js';

// Use in tests
mockClient.request.mockResolvedValue(mockPlaylist);
```

---

## Common Test Scenarios & Solutions

### **Testing Pagination**
```typescript
it('should handle pagination parameters correctly', async () => {
  const result = await listSongs(liveClient, { 
    limit: 5, 
    offset: 0,
    sort: 'title',
    order: 'ASC' 
  });

  expect(result.limit).toBe(5);
  expect(result.offset).toBe(0);
  
  // Should not return more than requested
  expect(result.songs.length).toBeLessThanOrEqual(5);
});
```

### **Testing Edge Cases**
```typescript
it('should return empty results gracefully when no matches', async () => {
  const result = await searchSongs(liveClient, { 
    query: 'XyZqWvRtPlMnBc123NonexistentQuery456',
    limit: 1
  });

  expect(result).toHaveProperty('searchResult');
  expect(result.searchResult).toHaveProperty('songs');
  expect(Array.isArray(result.searchResult.songs)).toBe(true);
  expect(typeof result.totalResults).toBe('number');
});
```

### **Testing Special Characters**
```typescript
it('should handle special character searches', async () => {
  const specialQueries = [
    'C++', 
    'AT&T',
    'Sigur Rós',
    'Motörhead',
    '東京事変'  // Japanese characters
  ];

  for (const query of specialQueries) {
    const result = await searchAll(liveClient, { 
      query, 
      songCount: 1, 
      albumCount: 1, 
      artistCount: 1 
    });
    
    // Should not throw, structure should be consistent
    expect(result).toHaveProperty('searchResult');
  }
});
```

---

## Configuration Testing

### **Feature Detection Pattern**
```typescript
describe('Feature Detection', () => {
  it('should conditionally register Last.fm tools based on feature flag', async () => {
    const registry = new ToolRegistry();
    
    // Register core categories
    registry.register('search', createSearchToolCategory(liveClient, config));
    
    // Conditionally add Last.fm based on config
    if (config.features.lastfm) {
      registry.register('lastfm-discovery', createLastFmToolCategory(liveClient, config));
    }

    const allTools = registry.getAllTools();
    const toolNames = allTools.map(tool => tool.name);

    // Last.fm tools that should be present only when enabled
    const lastfmTools = [
      'get_similar_artists',
      'get_similar_tracks',
      'get_artist_info',
      'get_top_tracks_by_artist',
      'get_trending_music'
    ];

    if (config.features.lastfm) {
      lastfmTools.forEach(tool => {
        expect(toolNames).toContain(tool);
      });
    } else {
      lastfmTools.forEach(tool => {
        expect(toolNames).not.toContain(tool);
      });
    }
  });
});
```

---

## Quality Gates - MUST PASS ALL

### **Pre-Implementation Checklist**
- [ ] Use `getSharedLiveClient()` for all live read operations
- [ ] Use `createMockClient()` for all write operations
- [ ] Mock all external API calls (Last.fm, Radio Browser, LRCLIB)
- [ ] Test structure validation, not specific content
- [ ] Include error handling scenarios
- [ ] Add input validation tests

### **Post-Implementation Validation**
```bash
# ALL must pass before completion
pnpm test:run     # All tests must pass (currently 140)
pnpm lint         # ZERO errors/warnings allowed  
pnpm typecheck    # ZERO type errors allowed
```

---

## API-Specific Testing Notes

### **Navidrome API Patterns**
- **Subsonic API**: Use `subsonicRequest()` method for star/unstar operations
- **REST API**: Use `request()` method for CRUD operations
- **URL Patterns**: Test actual URL paths (`/playlist`, `/search`) not method names

### **Expected Response Structures**
```typescript
// Pagination responses
interface PaginatedResponse<T> {
  items: T[];           // Can be songs, albums, artists, etc.
  total: number;        // Total count (not totalResults)
  offset: number;       // Starting position
  limit: number;        // Page size
}

// Search responses  
interface SearchResponse {
  searchResult: {
    songs: SongDTO[];
    albums: AlbumDTO[];
    artists: ArtistDTO[];
  };
  totalResults: number;  // Note: different from pagination total
}
```

### **Common API Call Expectations**
```typescript
// Playlist operations
expect(mockClient.request).toHaveBeenCalledWith(
  '/playlist',
  expect.objectContaining({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: expect.stringContaining('playlist-name')
  })
);

// User preference operations (Subsonic API)
expect(mockClient.subsonicRequest).toHaveBeenCalledWith(
  '/star',
  { id: 'song-123' }
);
```

---

## Current Test Coverage Status

### ✅ **Completed Test Suites (140 tests total)**
1. **Playlist Operations** - 22 tests (highest risk - data modification)
2. **Search Operations** - 22 tests (high user impact)  
3. **User Preferences** - 31 tests (data integrity)
4. **Library Operations** - 5 tests (API compatibility)
5. **Radio Validation** - 22 tests (stream validation)
6. **Tools Registry** - 6 tests (tool count verification)
7. **Message Manager** - 32 tests (utility testing)

### 🔄 **Next Priority Areas (when extending tests)**
- Queue Management (playback control)
- Radio CRUD Operations (station management)
- Tag Management (metadata operations)
- External API Integration Tests (optional, integration-only)

---

## Success Patterns & Anti-Patterns

### ✅ **Success Patterns**
```typescript
// ✅ Descriptive test names
it('should create playlist with valid metadata and return correct structure', async () => {

// ✅ Structure validation without content assumptions
expect(result.songs[0]).toHaveProperty('id');
expect(typeof result.songs[0].id).toBe('string');

// ✅ Proper error testing
await expect(invalidOperation()).rejects.toThrow('Expected error message');

// ✅ Shared client usage
const liveClient = await getSharedLiveClient();
```

### ❌ **Anti-Patterns to Avoid**
```typescript
// ❌ Testing specific content
expect(result.songs[0].title).toBe('Bohemian Rhapsody');

// ❌ Individual authentication
const client = await createLiveClient(); // DEPRECATED

// ❌ Real write operations
await createPlaylist(liveClient, { name: 'Test' }); // DANGEROUS

// ❌ Unmocked external APIs
const result = await fetch('https://ws.audioscrobbler.com/...'); // RATE LIMITED
```

---

## Environment Configuration

### **Test Environment Variables (.env.test)**
```bash
# Navidrome connection (required)
NAVIDROME_URL=http://test-server:4533
NAVIDROME_USERNAME=test_user
NAVIDROME_PASSWORD=test_password

# External APIs - DISABLED by default for unit tests
# LASTFM_API_KEY=only_for_integration_tests
# RADIO_BROWSER_USER_AGENT=Test-Agent/1.0
# LYRICS_PROVIDER=lrclib

# Test control flags
MOCK_EXTERNAL_APIS=true      # Force mocking even if API keys present
INTEGRATION_TESTS=false      # Only enable for integration test runs
DEBUG=false                  # Reduce test output noise
```

---

## Summary for AI Assistants

When implementing tests in this codebase:

1. **ALWAYS** use the hybrid strategy (live reads + mocked writes)
2. **ALWAYS** use `getSharedLiveClient()` to prevent rate limiting  
3. **ALWAYS** mock external APIs in unit tests
4. **ALWAYS** test structure, never specific content
5. **ALWAYS** include error handling and input validation tests
6. **NEVER** perform real write operations against the server
7. **NEVER** test specific song names, artists, or albums
8. **FOLLOW** the exact patterns provided above

The current test suite has 140 passing tests with comprehensive coverage of critical operations. When extending tests, maintain these patterns and quality standards to ensure reliable, safe, and maintainable test coverage.
