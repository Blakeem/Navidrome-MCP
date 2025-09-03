# Unit Testing Strategy

## Overview

This document outlines the comprehensive unit testing strategy for the Navidrome MCP Server, using a hybrid approach that maximizes safety while ensuring real-world API compatibility.

## Core Philosophy

**Hybrid Testing Strategy**: Live data for read operations, mocked data for write operations.

### Why This Approach?

- ✅ **API Compatibility**: Catch Navidrome API changes in GET endpoints
- ✅ **Data Safety**: No test records created on production Navidrome server  
- ✅ **Field Validation**: Verify response structure without music-specific data
- ✅ **Feature Detection**: Test environment configuration and feature flags
- ✅ **External API Testing**: Direct validation of Last.fm, Radio Browser, LRCLIB APIs

---

## Testing Categories

### **Category 1: Live Read-Only Tests**
**Purpose**: Validate API compatibility and response structure

**What to Test LIVE**:
- `GET` operations (list_songs, get_album, etc.)
- Connection testing
- Server info and feature detection
- Search operations
- Recently played / most played data

**Testing Approach**:
```typescript
describe('Live Read Operations', () => {
  it('should return valid song structure', async () => {
    const result = await listSongs(mockClient, { limit: 1 });
    
    // Test structure, not specific data
    expect(result.songs[0]).toHaveProperty('id');
    expect(result.songs[0]).toHaveProperty('title');
    expect(result.songs[0]).toHaveProperty('artist');
    // Don't test specific song names/artists
  });
});
```

### **Category 2: Mocked Write Operations**  
**Purpose**: Test logic without modifying server data

**What to Mock**:
- Playlist creation/modification/deletion
- Rating and starring operations
- Queue management
- Radio station creation
- Any `POST`, `PUT`, `DELETE` operations

**Testing Approach**:
```typescript
describe('Mocked Write Operations', () => {
  it('should create playlist with valid parameters', async () => {
    const mockClient = createMockClient();
    mockClient.request.mockResolvedValue({ id: 'test-123', name: 'Test Playlist' });
    
    const result = await createPlaylist(mockClient, { name: 'Test Playlist' });
    
    expect(mockClient.request).toHaveBeenCalledWith('/playlist', {
      method: 'POST',
      body: expect.objectContaining({ name: 'Test Playlist' })
    });
  });
});
```

### **Category 3: External API Direct Tests**
**Purpose**: Validate third-party API compatibility

**What to Test DIRECTLY**:
- Last.fm API endpoints (when enabled)
- Radio Browser API endpoints (when enabled)  
- LRCLIB API endpoints (when enabled)

**Testing Approach**:
```typescript
describe('External API Integration', () => {
  it('should fetch similar artists from Last.fm', async () => {
    // Test real Last.fm API directly
    const response = await fetch(`${LASTFM_BASE_URL}/2.0/?method=artist.getSimilar&api_key=${API_KEY}&artist=TestArtist`);
    const data = await response.json();
    
    expect(data).toHaveProperty('similarartists');
    expect(data.similarartists).toHaveProperty('artist');
  });
});
```

### **Category 4: Configuration & Feature Tests**
**Purpose**: Validate environment configuration and feature detection

**What to Test**:
- Feature flag detection based on environment variables
- Server info output accuracy
- Configuration loading
- Disabled feature handling

**Testing Approach**:
```typescript
describe('Configuration Tests', () => {
  it('should detect disabled features when env vars missing', async () => {
    // Test with minimal env config
    const testConfig = await loadConfig({
      NAVIDROME_URL: 'http://test',
      NAVIDROME_USERNAME: 'test', 
      NAVIDROME_PASSWORD: 'test'
      // Omit LASTFM_API_KEY, etc.
    });
    
    expect(testConfig.features.lastfm).toBe(false);
    expect(testConfig.features.radioBrowser).toBe(false);
    expect(testConfig.features.lyrics).toBe(false);
  });
});
```

---

## Implementation Guidelines

### **Environment Setup**

Use `.env.test` file for test configuration:
```bash
# Test environment variables
NAVIDROME_URL=http://your-test-server:4533
NAVIDROME_USERNAME=test_user
NAVIDROME_PASSWORD=test_password

# Optional: Enable external API testing
LASTFM_API_KEY=your_test_key
RADIO_BROWSER_USER_AGENT=Navidrome-MCP-Test/1.0
LYRICS_PROVIDER=lrclib
LRCLIB_USER_AGENT=Navidrome-MCP-Test/1.0

# Test-specific flags
INTEGRATION_TESTS=true
```

### **Mock Factory Pattern**

Create reusable mock factories:
```typescript
// tests/factories/mock-client.ts
export function createMockClient(): MockNavidromeClient {
  return {
    request: vi.fn(),
    initialize: vi.fn(),
    // ... other client methods
  };
}

// tests/factories/mock-data.ts  
export const mockSong = {
  id: 'mock-song-id',
  title: 'Mock Song Title',
  artist: 'Mock Artist',
  // ... complete mock structure
};
```

---

## Test Organization

### **Directory Structure**
```
tests/
├── unit/
│   ├── tools/
│   │   ├── library.test.ts          # Live read tests
│   │   ├── playlist.test.ts         # Mocked write tests  
│   │   ├── search.test.ts           # Live read tests
│   │   └── user-preferences.test.ts # Mocked write tests
│   ├── external/
│   │   ├── lastfm.test.ts           # Direct API tests
│   │   ├── radio-browser.test.ts    # Direct API tests
│   │   └── lrclib.test.ts           # Direct API tests
│   └── config/
│       ├── features.test.ts         # Feature detection tests
│       └── environment.test.ts      # Configuration tests
├── factories/
│   ├── mock-client.ts               # Client mocks
│   └── mock-data.ts                 # Data mocks
└── helpers/
    ├── test-config.ts               # Test configuration utilities
    └── api-helpers.ts               # External API test utilities
```

---

## Adding New Tests

### **For Live Read Operations**

1. **Identify the operation type** (GET/list/search)
2. **Create test with minimal parameters**
3. **Validate structure, not content**
4. **Test edge cases with mocked error responses**

```typescript
describe('New Read Operation', () => {
  it('should return expected structure', async () => {
    const result = await newOperation(realClient, { limit: 1 });
    
    // Test structure
    expect(result).toHaveProperty('expectedField');
    expect(Array.isArray(result.items)).toBe(true);
    
    // Test pagination
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('limit');
  });
  
  it('should handle errors gracefully', async () => {
    const mockClient = createMockClient();
    mockClient.request.mockRejectedValue(new Error('API Error'));
    
    await expect(newOperation(mockClient, {})).rejects.toThrow('API Error');
  });
});
```

### **For Mocked Write Operations**

1. **Create mock client**
2. **Mock expected response**
3. **Test function calls and parameters** 
4. **Verify request structure**

```typescript
describe('New Write Operation', () => {
  it('should make correct API call', async () => {
    const mockClient = createMockClient();
    mockClient.request.mockResolvedValue(mockSuccessResponse);
    
    await newWriteOperation(mockClient, testParams);
    
    expect(mockClient.request).toHaveBeenCalledWith(
      expectedEndpoint,
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining(expectedBody)
      })
    );
  });
});
```

### **For External API Tests**

1. **Test API endpoint directly**
2. **Validate response structure**
3. **Handle API key requirements**
4. **Skip tests if API unavailable**

```typescript
describe('New External API', () => {
  it('should fetch data from external API', async () => {
    if (!process.env.EXTERNAL_API_KEY) {
      console.warn('Skipping external API test - no API key');
      return;
    }
    
    const response = await fetch(apiEndpoint);
    const data = await response.json();
    
    expect(response.ok).toBe(true);
    expect(data).toHaveProperty('expectedField');
  });
});
```

### **For Configuration Tests**

1. **Test different environment variable combinations**
2. **Validate feature flag behavior**
3. **Test configuration loading**
4. **Verify error handling**

```typescript
describe('New Configuration Feature', () => {
  it('should enable feature when configured', () => {
    const config = loadConfig({
      FEATURE_CONFIG: 'enabled_value'
    });
    
    expect(config.features.newFeature).toBe(true);
  });
  
  it('should disable feature when not configured', () => {
    const config = loadConfig({
      // Omit FEATURE_CONFIG
    });
    
    expect(config.features.newFeature).toBe(false);
  });
});
```

---

## Test Execution

### **Running Tests**
```bash
# All tests
pnpm test

# Specific categories  
pnpm test tests/unit/tools/
pnpm test tests/external/
pnpm test tests/config/

# Live integration tests only
INTEGRATION_TESTS=true pnpm test

# Skip external API tests
SKIP_EXTERNAL_TESTS=true pnpm test
```

### **CI/CD Integration**
```bash
# In CI pipeline - skip external APIs unless keys provided
if [ -z "$LASTFM_API_KEY" ]; then
  export SKIP_EXTERNAL_TESTS=true
fi

pnpm test
```

---

## Best Practices

### **Data Independence**
- ❌ **Never test specific song names, artists, or album titles**
- ❌ **Never assume specific library content**  
- ✅ **Test response structure and data types**
- ✅ **Use generic validation patterns**

### **API Safety**
- ❌ **Never create test data on production Navidrome server**
- ❌ **Never modify existing playlists or ratings during tests**
- ✅ **Use mocks for all write operations**
- ✅ **Test read operations with minimal impact (limit: 1)**

### **Environment Isolation**
- ✅ **Use separate test configuration**
- ✅ **Make external API tests optional**
- ✅ **Provide clear test setup documentation**
- ✅ **Handle missing test dependencies gracefully**

### **Coverage Goals**
- **Target**: 80%+ coverage on core tool functions
- **Focus**: Business logic, error handling, edge cases
- **Validate**: Request structure, response parsing, error propagation

---

## Maintenance

### **When APIs Change**
1. **Live read tests will fail** → Update response structure expectations
2. **External API tests will fail** → Update endpoint or response format
3. **Mock tests remain stable** → Only update if our implementation changes

### **Adding New Tools**
1. **Determine read vs write operation**
2. **Follow appropriate testing pattern**
3. **Add to relevant test suite**
4. **Update mock factories if needed**

This strategy provides comprehensive coverage while maintaining safety and real-world validation.