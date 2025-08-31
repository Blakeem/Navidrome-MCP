# Sharing API

## ⚠️ Implementation Status

**NOT IMPLEMENTED IN NAVIDROME**: As of Navidrome v0.58.0, sharing endpoints return:
- **Status Code**: `501 Not Implemented`
- **Message**: "This endpoint is not implemented, but may be in future releases"

This documentation describes the planned API that will be available in future Navidrome releases.

## Overview
Create and manage public shares for songs, albums, and playlists. Sharing must be enabled in server configuration.

**Note**: Sharing may be disabled on some servers. Check for 404 responses.

## Base URL: `/api/share`

### GET /api/share
List all shares created by the user.

**Response (200 OK):**
```json
[
  {
    "id": "string",
    "userId": "string",
    "username": "string",
    "url": "string",           // Public share URL
    "description": "string",
    "contents": "string",      // JSON describing shared items
    "format": "string",        // "raw", "m3u", etc.
    "maxBitRate": number,      // Quality limit for streams
    "visitCount": number,      // Number of times accessed
    "lastVisitedAt": "ISO-8601",
    "downloadable": boolean,   // Allow downloads
    "expiresAt": "ISO-8601",   // Expiration date (null = no expiry)
    "createdAt": "ISO-8601",
    "updatedAt": "ISO-8601"
  }
]
```

### GET /api/share/{id}
Get a specific share by ID.

**Response (200 OK):**
Single share object

**Error Responses:**
- 404 Not Found: Share not found or not owned by user

### POST /api/share
Create a new share.

**Request Body:**
```json
{
  "description": "string",
  "downloadable": boolean,
  "expiresIn": number,       // Seconds until expiry (0 = no expiry)
  "maxBitRate": number,      // Max streaming quality
  "format": "raw|m3u",       // Share format
  "albums": ["albumId1"],    // Albums to share
  "songs": ["songId1"],      // Songs to share  
  "playlists": ["plId1"]     // Playlists to share
}
```

**Response (201 Created):**
```json
{
  "id": "string",
  "url": "string",    // Full public URL
  // ... other share properties
}
```

### PUT /api/share/{id}
Update an existing share.

**Request Body:**
```json
{
  "description": "string",
  "downloadable": boolean,
  "expiresIn": number,
  "maxBitRate": number
}
```

**Response (200 OK):**
Updated share object

### DELETE /api/share/{id}
Delete a share.

**Response (200 OK):**
```json
{
  "id": "string"
}
```

## Share Formats

### Raw Format
- Default format
- Provides JSON API access to shared content
- Streaming URLs for individual tracks
- Metadata for each item

### M3U Format
- Playlist format for media players
- Direct streaming URLs
- Compatible with most audio players

## Share Content Types

### Albums
```json
{
  "albums": ["album-id-1", "album-id-2"]
}
```
Shares all tracks from specified albums.

### Songs
```json
{
  "songs": ["song-id-1", "song-id-2"]
}
```
Shares individual tracks.

### Playlists
```json
{
  "playlists": ["playlist-id-1"]
}
```
Shares playlist contents (snapshot at creation time).

### Mixed Content
```json
{
  "albums": ["album1"],
  "songs": ["song1", "song2"],
  "playlists": ["playlist1"]
}
```
Combine different content types in single share.

## Public Access

### Share URLs
Format: `https://server.com/share/{shareId}?{params}`

### Parameters
- `player`: Player identifier
- `format`: Override share format
- `download`: Download instead of stream

### No Authentication Required
- Public shares don't require login
- Access controlled by share settings
- May have IP restrictions (server-configured)

## Usage Examples

### Create Album Share
```javascript
const share = await fetch('/api/share', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-ND-Authorization': 'Bearer ' + token
  },
  body: JSON.stringify({
    description: 'My favorite album',
    albums: ['album-123'],
    downloadable: true,
    expiresIn: 7 * 24 * 3600  // 7 days
  })
})
```

### Create Playlist Share (M3U)
```javascript
const share = await fetch('/api/share', {
  method: 'POST',
  body: JSON.stringify({
    description: 'Road trip playlist',
    playlists: ['playlist-456'],
    format: 'm3u',
    maxBitRate: 128
  })
})
```

## Security Considerations

- Shares are publicly accessible via URL
- No rate limiting on public access
- Consider expiration dates for sensitive content
- Downloads may consume significant bandwidth
- Server may log share access

## Configuration Requirements

Server must have sharing enabled:
```yaml
sharing:
  enabled: true
  # Optional restrictions
  allowDownloads: true
  maxBitrate: 0  # Unlimited
```