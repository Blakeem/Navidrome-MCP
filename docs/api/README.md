# Navidrome API Documentation

Complete documentation for all Navidrome APIs including Native REST API and Subsonic-compatible API.

## Quick Start

### Authentication
1. **Login**: `POST /auth/login` with username/password
2. **Get Token**: Response includes JWT token
3. **Use Token**: Include `X-ND-Authorization: Bearer <token>` header

### Basic Example
```javascript
// Login and get token
const response = await fetch('/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'user', password: 'pass' })
})
const { token } = await response.json()

// Use token for API calls
const songs = await fetch('/api/song?_start=0&_end=10', {
  headers: { 'X-ND-Authorization': `Bearer ${token}` }
}).then(r => r.json())
```

## API Documentation

### Core APIs
1. **[Authentication](01-authentication.md)** - Login, tokens, session management
2. **[Users](02-users.md)** - User management and permissions
3. **[Media Library](03-media-library.md)** - Songs, albums, artists, genres with comprehensive filtering
4. **[Playlists](04-playlists.md)** - Playlist CRUD, track management, M3U import/export
5. **[Playback Queue](05-playback-queue.md)** - Cross-device queue synchronization
6. **[Players](06-players.md)** - Player/client registration and settings

### Advanced Features
7. **[Sharing](07-sharing.md)** - Public shares for albums, playlists, songs
8. **[Internet Radio](08-radio.md)** - Internet radio station management
9. **[Transcoding](09-transcoding.md)** - Audio format conversion settings
10. **[Streaming & Downloads](10-streaming-downloads.md)** - Media streaming and download
11. **[Tags](11-tags.md)** - Metadata tag management and filtering

### Administration
12. **[Library Management](12-library-management.md)** - Library admin, user access, cleanup
13. **[Subsonic API](13-subsonic-api.md)** - Full Subsonic API compatibility
14. **[List & Tag Endpoints](14-list-endpoints.md)** - Comprehensive tag system and filter options

## API Overview

### Native API (`/api/`)
- **Base URL**: `/api/`
- **Authentication**: JWT token via `X-ND-Authorization` header
- **Format**: JSON requests/responses
- **Features**: Full Navidrome feature set, modern REST API

### Subsonic API (`/rest/`)
- **Base URL**: `/rest/`
- **Authentication**: Username/password or token in URL parameters
- **Format**: JSON or XML responses
- **Features**: Compatible with Subsonic clients

## Common Patterns

### REST Operations
Most resources support standard REST operations:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/{resource}` | List all items |
| GET | `/api/{resource}/{id}` | Get single item |
| POST | `/api/{resource}` | Create new item |
| PUT | `/api/{resource}/{id}` | Update item |
| DELETE | `/api/{resource}/{id}` | Delete item |

### Pagination
List endpoints support pagination:
- `_start` (number): Starting index (0-based)
- `_end` (number): Ending index (exclusive)
- `_sort` (string): Sort field name
- `_order` (string): "ASC" or "DESC"
- `seed` (number): Random seed for consistent random ordering

### Filtering
Navidrome supports multiple filtering approaches:

**Direct Parameter Filtering (Recommended):**
```javascript
// Filter by genre and library
const url = `/api/album?genre_id=abc123&library_id=1&_sort=recently_added&_order=DESC`

// Multiple filters with role-based filtering
const url = `/api/album?role_producer_id=xyz789&media_id=vinyl456&starred=true`
```

**Legacy JSON Filtering:**
```javascript
const filter = {
  "genre": "Rock",
  "year": {"gte": 2000},
  "starred": true
}
const url = `/api/song?filter=${encodeURIComponent(JSON.stringify(filter))}`
```

**Available Filter Types:**
- `library_id` - Filter by music library
- `genre_id` - Filter by genre
- `mood_id` - Filter by mood
- `{tag_name}_id` - Filter by any tag type
- `role_{role}_id` - Filter by participant roles
- `starred` - Boolean filters
- `has_rating` - Content with ratings
- Standard field filters (name, title, etc.)

### Error Handling
All APIs return consistent error formats:

**Native API:**
```json
{
  "error": "Error message"
}
```

**Subsonic API:**
```json
{
  "subsonic-response": {
    "status": "failed",
    "error": {
      "code": 10,
      "message": "Error message"
    }
  }
}
```

## Security

### Token Management
- JWT tokens expire (default: 48 hours)
- Tokens are refreshed automatically on each request
- New tokens returned in `X-ND-Authorization` response header

### Permissions
- **Admin**: Full access to all APIs and user management
- **Regular User**: Access to own content and public content
- **Resource Ownership**: Users can only modify their own playlists, players, etc.

### Rate Limiting
- Login endpoint has rate limiting (default: 5 attempts per minute)
- Some endpoints may have additional throttling
- Check response headers for rate limit status

## Client Implementation Guide

### 1. Authentication Flow
```javascript
class NavidromeAPI {
  constructor(baseUrl) {
    this.baseUrl = baseUrl
    this.token = localStorage.getItem('navidrome_token')
  }

  async login(username, password) {
    const response = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
    
    if (response.ok) {
      const data = await response.json()
      this.token = data.token
      localStorage.setItem('navidrome_token', this.token)
      return data
    }
    throw new Error('Login failed')
  }
}
```

### 2. API Request Helper
```javascript
async apiRequest(endpoint, options = {}) {
  const url = `${this.baseUrl}/api${endpoint}`
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  }
  
  if (this.token) {
    headers['X-ND-Authorization'] = `Bearer ${this.token}`
  }

  const response = await fetch(url, { ...options, headers })
  
  // Update token if provided
  const newToken = response.headers.get('X-ND-Authorization')
  if (newToken) {
    this.token = newToken
    localStorage.setItem('navidrome_token', newToken)
  }

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`)
  }

  return response.json()
}
```

### 3. Resource Methods
```javascript
// Get songs with pagination
async getSongs(start = 0, end = 50, sort = 'title', order = 'ASC') {
  return this.apiRequest(`/song?_start=${start}&_end=${end}&_sort=${sort}&_order=${order}`)
}

// Search using full-text search
async search(query, type = 'song', libraryId = null) {
  const params = new URLSearchParams()
  if (type === 'song') params.set('title', query)
  else if (type === 'album') params.set('name', query)
  else if (type === 'artist') params.set('name', query)
  
  if (libraryId) params.set('library_id', libraryId)
  
  return this.apiRequest(`/${type}?${params}`)
}

// Advanced filtering
async getAlbumsByGenreAndMood(genreId, moodId, libraryId) {
  const params = new URLSearchParams({
    genre_id: genreId,
    mood_id: moodId,
    library_id: libraryId,
    _sort: 'recently_added',
    _order: 'DESC'
  })
  return this.apiRequest(`/album?${params}`)
}

// Stream URL
getStreamUrl(songId, maxBitRate = null) {
  const params = new URLSearchParams({
    id: songId,
    u: this.username,
    p: this.password,
    v: '1.16.1',
    c: 'MyClient'
  })
  if (maxBitRate) params.set('maxBitRate', maxBitRate)
  
  return `${this.baseUrl}/rest/stream?${params}`
}
```

## Testing

### Using curl
```bash
# Login
TOKEN=$(curl -s -X POST http://localhost:4533/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' | jq -r .token)

# Get songs
curl -H "X-ND-Authorization: Bearer $TOKEN" \
  "http://localhost:4533/api/song?_start=0&_end=5"

# Get albums by genre with library filtering
curl -H "X-ND-Authorization: Bearer $TOKEN" \
  "http://localhost:4533/api/album?genre_id=abc123&library_id=1&_sort=recently_added&_order=DESC"

# Get available genres for filtering
curl -H "X-ND-Authorization: Bearer $TOKEN" \
  "http://localhost:4533/api/genre?library_id=1"

# Subsonic ping
curl "http://localhost:4533/rest/ping?u=admin&p=admin&v=1.16.1&c=test&f=json"
```

### Postman Collection
Consider creating a Postman collection with:
1. Environment variables for server URL and credentials
2. Pre-request scripts for token management
3. Test scripts for response validation

## Resources

- **Official Documentation**: [navidrome.org](https://navidrome.org)
- **GitHub Repository**: [navidrome/navidrome](https://github.com/navidrome/navidrome)
- **Subsonic API Docs**: [subsonic.org/pages/api.jsp](http://subsonic.org/pages/api.jsp)
- **OpenSubsonic**: [opensubsonic.netlify.app](https://opensubsonic.netlify.app)

## Support

For questions and issues:
1. Check this documentation
2. Search GitHub issues
3. Join the Discord community
4. Create a GitHub issue with detailed information