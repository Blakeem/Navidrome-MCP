# Playlist API

## Overview
Complete playlist management including creation, modification, track management, and import/export.

## Playlist Endpoints

### Base URL: `/api/playlist`

### GET /api/playlist
List all playlists accessible to the user.

**Query Parameters:**
- `_start` (number): Starting index
- `_end` (number): Ending index
- `_sort` (string): Sort field
- `_order` (string): ASC/DESC
- `filter` (string): JSON filter criteria

**Response (200 OK):**
```json
[
  {
    "id": "string",
    "name": "string",
    "comment": "string",
    "duration": number,      // Total duration in seconds
    "owner": "string",       // Owner display name
    "ownerId": "string",     // Owner user ID
    "public": boolean,       // Public visibility
    "songCount": number,     // Number of tracks
    "createdAt": "ISO-8601",
    "updatedAt": "ISO-8601",
    "tracks": [],           // Optional: included if requested
    "rules": {}             // Smart playlist rules (if applicable)
  }
]
```

### GET /api/playlist/{id}
Get a specific playlist by ID.

### POST /api/playlist
Create a new playlist.

**Request Body (JSON):**
```json
{
  "name": "string (required)",
  "comment": "string",
  "public": boolean,
  "rules": {}  // Optional: for smart playlists
}
```

**Request Body (M3U file):**
- Content-Type: `audio/x-mpegurl` or `application/x-mpegurl`
- Body: M3U/M3U8 playlist file content

**Response (201 Created):**
Created playlist object or M3U content (if uploaded)

### PUT /api/playlist/{id}
Update playlist metadata.

**Request Body:**
```json
{
  "name": "string",
  "comment": "string",
  "public": boolean,
  "rules": {}
}
```

### DELETE /api/playlist/{id}
Delete a playlist (owner or admin only).

## Playlist Track Management

### GET /api/playlist/{playlistId}/tracks
Get all tracks in a playlist.

**Query Parameters:**
- `_start` (number): Starting index
- `_end` (number): Ending index

**Response Headers:**
- Content-Type: `application/json` or `audio/x-mpegurl` (based on Accept header)

**Response (200 OK) - JSON:**
```json
[
  {
    "id": number,           // Track position ID in playlist
    "mediaFileId": "string", // Song ID
    "playlistId": "string",
    "title": "string",
    "album": "string",
    "artist": "string",
    "albumArtist": "string",
    "duration": number,
    "bitRate": number,
    "path": "string",
    // ... all song fields
  }
]
```

**Response (200 OK) - M3U:**
When Accept header is `audio/x-mpegurl`, returns M3U8 playlist file for export.

### GET /api/playlist/{playlistId}/tracks/{id}
Get a specific track in a playlist by position.

### POST /api/playlist/{playlistId}/tracks
Add tracks to a playlist.

**Request Body:**
```json
{
  "ids": ["songId1", "songId2"],        // Song IDs to add
  "albumIds": ["albumId1"],             // Album IDs to add (all tracks)
  "artistIds": ["artistId1"],           // Artist IDs to add (all tracks)
  "discs": [                            // Specific discs to add
    {
      "albumId": "string",
      "discNumber": number
    }
  ]
}
```

**Response (200 OK):**
```json
{
  "added": number  // Number of tracks added
}
```

### DELETE /api/playlist/{playlistId}/tracks
Remove tracks from a playlist.

**Query Parameters:**
- `id` (string/array): Track position ID(s) to remove

**Response (200 OK):**
```json
{
  "ids": ["id1", "id2"]  // Removed track IDs
}
```

### DELETE /api/playlist/{playlistId}/tracks/{id}
Remove a specific track by position.

### PUT /api/playlist/{playlistId}/tracks/{id}
Reorder a track in the playlist.

**Request Body:**
```json
{
  "insert_before": "number"  // New position (0-based index)
}
```

**Response (200 OK):**
```json
{
  "id": "number"  // Track position ID
}
```

## Playlist Import/Export

### Import M3U/M3U8
POST to `/api/playlist` with Content-Type `audio/x-mpegurl`:
- Automatically matches tracks by path or search
- Creates playlist with matched tracks
- Returns created playlist in M3U format

### Export M3U/M3U8
GET `/api/playlist/{playlistId}/tracks` with Accept header `audio/x-mpegurl`:
- Returns playlist in M3U8 format
- Includes #EXTM3U header
- Includes #EXTINF metadata for each track
- Uses absolute paths or streaming URLs

## Permissions

| Action | Own Playlists | Public Playlists | Private Playlists | Admin |
|--------|---------------|------------------|-------------------|-------|
| View | Yes | Yes | Owner only | All |
| Create | Yes | - | - | Yes |
| Update | Yes | No | No | All |
| Delete | Yes | No | No | All |
| Add tracks | Yes | No | No | Owner |
| Remove tracks | Yes | No | No | Owner |
| Reorder tracks | Yes | No | No | Owner |

## Smart Playlists

Smart playlists use rules to dynamically generate track lists:

**Rule Structure:**
```json
{
  "rules": {
    "conditions": "all|any",
    "rules": [
      {
        "field": "genre|year|playCount|rating|etc",
        "operator": "is|contains|gt|lt|between",
        "value": "value"
      }
    ],
    "limit": number,
    "order": "random|name|playCount|etc"
  }
}
```