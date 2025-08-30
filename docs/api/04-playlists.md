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

Smart playlists in Navidrome are dynamic playlists that automatically update based on specified criteria. They are created using `.nsp` (Navidrome Smart Playlist) files and follow a specific JSON structure.

### Creating Smart Playlists

Smart playlists are created by placing `.nsp` files in your music library or playlist folder. These files contain JSON objects with rules that define which tracks should be included.

### Basic Structure

```json
{
  "name": "My Smart Playlist",
  "comment": "Description of the playlist",
  "all": [
    // Rules that ALL must be true
  ],
  "any": [
    // Rules where ANY can be true
  ],
  "sort": "field_name",
  "order": "asc|desc",
  "limit": number,
  "offset": number
}
```

### Available Fields

**Media Information:**
- `title`, `album`, `artist`, `albumartist`
- `year`, `originalyear`, `releaseyear`
- `date`, `originaldate`, `releasedate` (format: "YYYY-MM-DD")
- `tracknumber`, `discnumber`, `discsubtitle`
- `genre`, `comment`, `lyrics`
- `compilation` (boolean)
- `albumtype`, `albumcomment`, `catalognumber`

**File Properties:**
- `filepath` (relative to music library)
- `filetype` (file extension)
- `duration` (seconds)
- `bitrate`, `bitdepth`, `bpm`, `channels`
- `size` (bytes)
- `dateadded`, `datemodified`

**User Data:**
- `loved` (boolean)
- `dateloved`
- `lastplayed`
- `playcount`
- `rating` (0-5)

**MusicBrainz IDs:**
- `mbz_album_id`, `mbz_artist_id`, `mbz_recording_id`
- `mbz_album_artist_id`, `mbz_release_track_id`, `mbz_release_group_id`

**System:**
- `library_id`

### Operators

**Equality/Comparison:**
- `is`: Exact match
- `isNot`: Not equal
- `gt`: Greater than
- `lt`: Less than
- `gte`: Greater than or equal
- `lte`: Less than or equal

**Text Matching:**
- `contains`: Contains substring
- `notContains`: Does not contain
- `startsWith`: Starts with
- `endsWith`: Ends with

**Range/Date:**
- `inTheRange`: Within range [min, max]
- `notInTheRange`: Outside range
- `inTheLast`: Within last N days
- `notInTheLast`: Not in last N days
- `before`: Before date
- `after`: After date
- `today`: Today
- `yesterday`: Yesterday
- `thisWeek`: This week
- `lastWeek`: Last week
- `thisMonth`: This month
- `lastMonth`: Last month
- `thisYear`: This year
- `lastYear`: Last year

**Playlist References:**
- `inPlaylist`: Track is in specified playlist
- `notInPlaylist`: Track is not in specified playlist

### Example Smart Playlists

**Recently Played:**
```json
{
  "name": "Recently Played",
  "comment": "Tracks played in the last 30 days",
  "all": [
    {"inTheLast": {"lastplayed": 30}}
  ],
  "sort": "lastplayed",
  "order": "desc",
  "limit": 100
}
```

**High Rated 80s Music:**
```json
{
  "name": "80s Favorites",
  "all": [
    {"inTheRange": {"year": [1980, 1989]}},
    {"gte": {"rating": 4}}
  ],
  "sort": "rating,year",
  "order": "desc",
  "limit": 50
}
```

**Complex Multi-Condition:**
```json
{
  "name": "Discovery Mix",
  "all": [
    {
      "any": [
        {"is": {"loved": true}},
        {"gte": {"rating": 4}}
      ]
    },
    {"lte": {"playcount": 2}},
    {"inTheLast": {"dateadded": 90}}
  ],
  "sort": "random",
  "limit": 25
}
```

### File Management

1. **Location**: Place `.nsp` files in your music library or the path specified by `PlaylistsPath` configuration
2. **Import**: Smart playlists are imported during library scans
3. **Updates**: Edit the `.nsp` file and rescan to update rules
4. **Permissions**: Set `public: true` to make accessible to all users

### API Integration

Smart playlists appear in regular playlist API endpoints with:
- `rules` field contains the criteria object
- `evaluatedAt` timestamp shows last refresh
- Tracks are read-only (cannot be manually modified)
- Use `refreshSmartPlaylist=true` parameter to force re-evaluation

### Important Notes

- Dates must use "YYYY-MM-DD" format
- Boolean values must not be in quotes: `{"is": {"loved": true}}`
- File paths are relative to music library root
- Smart playlists refresh automatically based on `SmartPlaylistRefreshDelay` config
- Only publicly visible smart playlists can be referenced by other smart playlists
- Currently requires manual `.nsp` file creation (UI planned for future releases)