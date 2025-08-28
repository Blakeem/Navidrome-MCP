# Player API

## Overview
Manage audio players/clients that connect to Navidrome for music playback.

## Base URL: `/api/player`

### GET /api/player
List all players registered for the user.

**Response (200 OK):**
```json
[
  {
    "id": "string",
    "name": "string",
    "type": "string",         // Player type (e.g., "Subsonic", "Web")
    "userName": "string",     // User who owns the player
    "userId": "string",
    "client": "string",       // Client application name
    "ipAddress": "string",    // Last known IP address
    "lastSeen": "ISO-8601",   // Last activity timestamp
    "transcoding": boolean,   // Whether transcoding is enabled
    "maxBitRate": number,     // Max bitrate setting
    "scrobbleEnabled": boolean, // Last.fm scrobbling enabled
    "reportRealPath": boolean,  // Report real file paths vs stream URLs
    "createdAt": "ISO-8601",
    "updatedAt": "ISO-8601"
  }
]
```

### GET /api/player/{id}
Get a specific player by ID.

**Response (200 OK):**
Single player object with same structure as list

**Error Responses:**
- 404 Not Found: Player not found or not owned by user

### POST /api/player
Create/register a new player.

**Request Body:**
```json
{
  "name": "string (required)",
  "type": "string",
  "client": "string",
  "transcoding": boolean,
  "maxBitRate": number,
  "scrobbleEnabled": boolean,
  "reportRealPath": boolean
}
```

**Response (201 Created):**
Created player object

### PUT /api/player/{id}
Update player settings.

**Request Body:**
```json
{
  "name": "string",
  "transcoding": boolean,
  "maxBitRate": number,
  "scrobbleEnabled": boolean,
  "reportRealPath": boolean
}
```

**Response (200 OK):**
Updated player object

### DELETE /api/player/{id}
Remove a player registration.

**Response (200 OK):**
```json
{
  "id": "string"
}
```

## Player Types

| Type | Description | Auto-Created |
|------|-------------|--------------|
| "Web" | Web-based players | Yes |
| "Subsonic" | Subsonic API clients | Yes |
| "DLNA" | DLNA/UPnP players | No |
| "MPD" | MPD clients | No |

## Player Settings

### Transcoding
- **Purpose**: Convert audio format/quality for streaming
- **Options**: boolean (enabled/disabled)
- **Affects**: Stream endpoint behavior

### Max Bit Rate
- **Purpose**: Quality limit for streaming
- **Values**: Number in kbps (e.g., 128, 320)
- **Default**: Unlimited (0)

### Scrobble Enabled
- **Purpose**: Enable Last.fm/ListenBrainz integration
- **Default**: false
- **Requires**: Server-level scrobble configuration

### Report Real Path
- **Purpose**: Return file paths instead of stream URLs
- **Use Case**: Local network players with file access
- **Default**: false

## Auto-Registration

Players are often auto-registered on first API access:

1. **Subsonic API**: Creates player on authentication
2. **Web Interface**: Creates player on first load
3. **Manual Registration**: Via POST /api/player

## Player Context

Many endpoints accept a player context via headers:
- `X-ND-Player-ID`: Player ID for request context
- `X-ND-Client-Name`: Client name for auto-registration

## Activity Tracking

- `lastSeen` updated on each API request
- `ipAddress` updated on IP changes
- Used for player management and cleanup

## Cleanup

Inactive players may be automatically removed based on server configuration:
- Default: Keep players active within last 30 days
- Configurable via server settings