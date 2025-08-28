# Internet Radio API

## Overview
Manage internet radio stations for streaming live audio from external sources.

## Base URL: `/api/radio`

### GET /api/radio
List all internet radio stations.

**Response (200 OK):**
```json
[
  {
    "id": "string",
    "streamUrl": "string",      // Radio stream URL
    "name": "string",           // Station name
    "homePageUrl": "string",    // Optional: Station website
    "createdAt": "ISO-8601",
    "updatedAt": "ISO-8601"
  }
]
```

### GET /api/radio/{id}
Get a specific radio station by ID.

**Response (200 OK):**
Single radio station object

### POST /api/radio
Create a new radio station.

**Request Body:**
```json
{
  "name": "string (required)",
  "streamUrl": "string (required)",
  "homePageUrl": "string"
}
```

**Response (201 Created):**
Created radio station object

**Validation:**
- `streamUrl` must be valid HTTP/HTTPS URL
- `name` cannot be empty
- Duplicate stream URLs may be rejected

### PUT /api/radio/{id}
Update an existing radio station.

**Request Body:**
```json
{
  "name": "string",
  "streamUrl": "string",
  "homePageUrl": "string"
}
```

**Response (200 OK):**
Updated radio station object

### DELETE /api/radio/{id}
Delete a radio station.

**Response (200 OK):**
```json
{
  "id": "string"
}
```

## Stream URL Requirements

### Supported Protocols
- HTTP/HTTPS direct streams
- M3U/M3U8 playlists
- PLS playlists

### Supported Formats
- MP3
- AAC
- OGG
- FLAC (depending on server configuration)

### Examples
```
Direct Stream: https://stream.example.com:8000/live.mp3
M3U Playlist: https://radio.example.com/playlist.m3u8
PLS Playlist: https://station.example.com/stream.pls
```

## Usage Patterns

### Adding Popular Stations
```javascript
const stations = [
  {
    name: "BBC Radio 1",
    streamUrl: "http://stream.live.vc.bbcmedia.co.uk/bbc_radio_one",
    homePageUrl: "https://www.bbc.co.uk/radio1"
  },
  {
    name: "Classical FM",
    streamUrl: "https://media-ssl.musicradio.com/ClassicFM",
    homePageUrl: "https://www.classicfm.com"
  }
]

for (const station of stations) {
  await fetch('/api/radio', {
    method: 'POST',
    body: JSON.stringify(station)
  })
}
```

### Stream Validation
```javascript
// Test stream before adding
const testStream = async (url) => {
  try {
    const response = await fetch(url, { method: 'HEAD' })
    return response.ok
  } catch {
    return false
  }
}

const streamUrl = "https://example.com/stream.mp3"
if (await testStream(streamUrl)) {
  // Add to Navidrome
}
```

## Integration with Players

### Web Player
Radio stations appear in station list and can be played like regular tracks.

### Subsonic Clients
Accessible via Subsonic API `getInternetRadioStations` endpoint.

### Streaming URLs
Radio stations use their original stream URLs - no transcoding applied.

## Server Requirements

### Network Access
Server must be able to reach internet radio streams:
- Outbound HTTP/HTTPS access
- DNS resolution for stream domains
- Firewall rules allowing radio streaming

### Resource Usage
- Radio streams don't count against storage quotas
- Bandwidth usage depends on concurrent listeners
- No local caching of radio content

## Common Issues

### Stream Reliability
- Radio streams may go offline temporarily
- URLs may change without notice
- Use reliable, well-known stations

### Format Compatibility
- Some exotic formats may not work
- Browser compatibility varies
- Test with target client applications

### Legal Considerations
- Respect radio station terms of service
- Some streams may have geographic restrictions
- Commercial use may require licensing

## Import/Export

### Export Stations
```javascript
const stations = await fetch('/api/radio').then(r => r.json())
const exported = {
  version: 1,
  stations: stations.map(s => ({
    name: s.name,
    streamUrl: s.streamUrl,
    homePageUrl: s.homePageUrl
  }))
}
```

### Import from M3U
Parse M3U files containing radio station URLs:
```
#EXTM3U
#EXTINF:-1,BBC Radio 1
http://stream.live.vc.bbcmedia.co.uk/bbc_radio_one
#EXTINF:-1,Classical FM  
https://media-ssl.musicradio.com/ClassicFM
```