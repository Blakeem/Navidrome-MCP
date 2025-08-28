# Streaming & Download API

## Overview
Stream and download audio files from the Navidrome server. These endpoints are primarily accessed through the Subsonic API.

## Streaming Endpoints

### GET /rest/stream
Stream an audio file with optional transcoding.

**Parameters:**
- `id` (required): Song/track ID
- `u` (required): Username
- `p` (required): Password (plain text or token)
- `v` (required): API version (e.g., "1.16.1")
- `c` (required): Client application name
- `maxBitRate` (optional): Maximum bitrate in kbps
- `format` (optional): Target format (mp3, aac, opus, etc.)
- `timeOffset` (optional): Start time in seconds
- `size` (optional): Requested file size limit

**Example:**
```
GET /rest/stream?id=123&u=user&p=pass&v=1.16.1&c=MyApp
GET /rest/stream?id=123&u=user&p=pass&v=1.16.1&c=MyApp&maxBitRate=192&format=mp3
```

**Response:**
- Content-Type: `audio/mpeg`, `audio/aac`, `audio/ogg`, etc.
- Stream headers:
  - `Content-Length`: File size in bytes
  - `Accept-Ranges: bytes`: Supports range requests
  - `X-Content-Duration`: Duration in seconds
  - `Last-Modified`: File modification time

**Range Support:**
```
Range: bytes=0-1023
```
Returns partial content for seeking/resuming.

### GET /rest/download
Download original audio file without transcoding.

**Parameters:**
Same as `/rest/stream` but:
- No transcoding applied
- Always returns original file format
- Sets download disposition header

**Response Headers:**
- `Content-Disposition: attachment; filename="song.mp3"`
- `Content-Type`: Original file MIME type

## Native API Streaming

### Pattern Recognition
While streaming primarily uses Subsonic API, the native API follows patterns:

**Potential Endpoints** (verify with server):
- `/api/stream/{id}`: Direct streaming
- `/api/download/{id}`: Direct download
- `/api/song/{id}/stream`: Song streaming
- `/api/song/{id}/download`: Song download

## Stream URL Generation

### For Subsonic API
```javascript
const streamUrl = `/rest/stream?` + new URLSearchParams({
  id: songId,
  u: username,
  p: password,  // or token
  v: '1.16.1',
  c: 'MyClient',
  maxBitRate: maxBitRate || '',
  format: format || ''
}).toString()
```

### For Native API (with auth token)
```javascript
const streamUrl = `/api/stream/${songId}?maxBitRate=${maxBitRate}&format=${format}`
// Include X-ND-Authorization header
```

## Transcoding Parameters

### Quality Selection
| Bitrate | Quality | Use Case |
|---------|---------|----------|
| 64-96k | Low | Mobile data |
| 128k | Standard | General streaming |
| 192k | Good | WiFi streaming |
| 320k | High | High-quality playback |
| 0 | Original | No transcoding |

### Format Options
- `mp3`: Universal compatibility
- `aac`: iOS/Safari optimized  
- `opus`: Best compression
- `ogg`: Open standard
- Empty: Server decides

## Range Requests

### Seeking Support
```http
Range: bytes=1024000-2048000
```
Returns:
```http
206 Partial Content
Content-Range: bytes 1024000-2048000/5086594
Content-Length: 1024000
```

### Progressive Loading
```javascript
// Load first 64KB for fast start
fetch(streamUrl, {
  headers: { 'Range': 'bytes=0-65535' }
})

// Continue loading in chunks
fetch(streamUrl, {
  headers: { 'Range': 'bytes=65536-131071' }
})
```

## Audio Formats Support

### Input Formats
- **FLAC**: Lossless, high quality
- **MP3**: Universal support
- **AAC**: Apple ecosystem
- **OGG/Vorbis**: Open standard
- **Opus**: Modern codec
- **ALAC**: Apple lossless
- **WMA**: Windows Media
- **WAV**: Uncompressed

### Browser Compatibility
| Format | Chrome | Firefox | Safari | Edge |
|--------|--------|---------|--------|------|
| MP3 | ✓ | ✓ | ✓ | ✓ |
| AAC | ✓ | ✓ | ✓ | ✓ |
| OGG | ✓ | ✓ | ✗ | ✓ |
| Opus | ✓ | ✓ | ✗ | ✓ |
| FLAC | ✓ | ✓ | ✓ | ✓ |

## Performance Optimization

### Client-Side
```javascript
// Preload next track
const preloadUrl = generateStreamUrl(nextSongId)
const audio = new Audio()
audio.preload = 'metadata'
audio.src = preloadUrl

// Use appropriate bitrate for connection
const maxBitRate = navigator.connection?.effectiveType === '4g' ? 320 : 128
```

### Caching Headers
Response includes cache headers:
- `Last-Modified`: File timestamp
- `ETag`: File hash/version
- `Cache-Control`: Caching policy

Use conditional requests:
```http
If-Modified-Since: Mon, 02 Nov 2015 02:06:44 GMT
If-None-Match: "abc123def456"
```

## Error Handling

### Common HTTP Status Codes
- `200 OK`: Successful stream
- `206 Partial Content`: Range request
- `304 Not Modified`: Cached version current
- `401 Unauthorized`: Invalid credentials
- `404 Not Found`: Song not found
- `416 Range Not Satisfiable`: Invalid range
- `500 Internal Server Error`: Transcoding failed

### Retry Logic
```javascript
const streamWithRetry = async (url, attempts = 3) => {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
      if (response.status === 404) break // Don't retry 404
    } catch (error) {
      if (i === attempts - 1) throw error
      await new Promise(resolve => setTimeout(resolve, 1000 * i))
    }
  }
  throw new Error('Stream failed after retries')
}
```

## Security Considerations

### Authentication
- Subsonic API: Username/password in URL parameters
- Native API: JWT token in headers (more secure)
- Consider HTTPS for credential protection

### Access Control
- Users can only stream their accessible music
- Sharing links bypass user authentication
- Server may log streaming activity

### Rate Limiting
- Servers may limit concurrent streams per user
- Bandwidth throttling based on server configuration
- Consider user's subscription limits