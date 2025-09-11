# Subsonic API

## Overview
Navidrome implements the Subsonic API for compatibility with Subsonic-compatible clients. This API is widely supported by music player applications.

## Base URL: `/rest/`

## Authentication

### Parameters (all endpoints require):
- `u` (string): Username
- `p` (string): Password (plain text) or token
- `v` (string): API version (recommend "1.16.1")
- `c` (string): Client application name
- `f` (string): Response format ("json" or "xml", default: xml)

### Token Authentication (recommended):
Instead of plain password, use salted token:
- `t` (string): Auth token (MD5 hash)
- `s` (string): Random salt

Token calculation: `t = MD5(password + salt)`

### Example Authentication:
```
/rest/ping?u=user&p=password&v=1.16.1&c=MyApp&f=json
/rest/ping?u=user&t=abc123&s=xyz789&v=1.16.1&c=MyApp&f=json
```

## System Endpoints

### GET /rest/ping
Simple connectivity test.

**Response:**
```json
{
  "subsonic-response": {
    "status": "ok",
    "version": "1.16.1",
    "type": "navidrome",
    "serverVersion": "0.49.0"
  }
}
```

### GET /rest/getLicense
Get server license info (always returns valid for Navidrome).

**Response:**
```json
{
  "subsonic-response": {
    "status": "ok",
    "version": "1.16.1",
    "license": {
      "valid": true
    }
  }
}
```

### GET /rest/getOpenSubsonicExtensions
Get OpenSubsonic extensions supported by server.

**Response:**
```json
{
  "subsonic-response": {
    "status": "ok",
    "version": "1.16.1",
    "openSubsonicExtensions": [
      {
        "name": "transcodeOffset",
        "versions": [1]
      }
    ]
  }
}
```

## Library Browsing

### GET /rest/getMusicFolders
Get all top-level music folders.

**Response:**
```json
{
  "subsonic-response": {
    "status": "ok",
    "version": "1.16.1",
    "musicFolders": {
      "musicFolder": [
        {
          "id": "1",
          "name": "Music Library"
        }
      ]
    }
  }
}
```

### GET /rest/getIndexes
Get artist index (alphabetical grouping).

**Parameters:**
- `musicFolderId` (string): Optional folder ID
- `ifModifiedSince` (timestamp): Only return if modified since

**Response:**
```json
{
  "subsonic-response": {
    "status": "ok",
    "version": "1.16.1",
    "indexes": {
      "lastModified": 1234567890000,
      "index": [
        {
          "name": "A",
          "artist": [
            {
              "id": "artist1",
              "name": "ABBA"
            }
          ]
        }
      ]
    }
  }
}
```

### GET /rest/getMusicDirectory
Get contents of a music directory (artist albums or album tracks).

**Parameters:**
- `id` (string): Directory/artist/album ID

**Response:**
```json
{
  "subsonic-response": {
    "status": "ok",
    "version": "1.16.1",
    "directory": {
      "id": "artist1",
      "name": "Artist Name",
      "child": [
        {
          "id": "album1",
          "parent": "artist1",
          "title": "Album Title",
          "isDir": true,
          "coverArt": "album1",
          "created": "2023-01-01T00:00:00Z"
        }
      ]
    }
  }
}
```

### GET /rest/getGenres
List all music genres.

**Response:**
```json
{
  "subsonic-response": {
    "status": "ok",
    "version": "1.16.1",
    "genres": {
      "genre": [
        {
          "songCount": 100,
          "albumCount": 10,
          "value": "Rock"
        }
      ]
    }
  }
}
```

## Search

### GET /rest/search3
Search for artists, albums, and songs.

**Parameters:**
- `query` (string): Search terms
- `artistCount` (number): Max artists to return
- `artistOffset` (number): Artist result offset
- `albumCount` (number): Max albums to return
- `albumOffset` (number): Album result offset  
- `songCount` (number): Max songs to return
- `songOffset` (number): Song result offset
- `musicFolderId` (number/array): Optional library IDs to search within (can be repeated for multiple libraries)

**Response:**
```json
{
  "subsonic-response": {
    "status": "ok",
    "version": "1.16.1",
    "searchResult3": {
      "artist": [
        {
          "id": "artist1",
          "name": "Artist Name",
          "albumCount": 5
        }
      ],
      "album": [
        {
          "id": "album1",
          "name": "Album Name",
          "artist": "Artist Name",
          "artistId": "artist1"
        }
      ],
      "song": [
        {
          "id": "song1",
          "title": "Song Title",
          "album": "Album Name",
          "artist": "Artist Name",
          "track": 1,
          "duration": 240,
          "bitRate": 320,
          "path": "Artist/Album/01-Song.mp3",
          "suffix": "mp3",
          "size": 9600000,
          "contentType": "audio/mpeg"
        }
      ]
    }
  }
}
```

## Playlists

### GET /rest/getPlaylists
Get all playlists for user.

**Parameters:**
- `username` (string): Optional, get playlists for specific user

**Response:**
```json
{
  "subsonic-response": {
    "status": "ok",
    "version": "1.16.1",
    "playlists": {
      "playlist": [
        {
          "id": "playlist1",
          "name": "My Playlist",
          "songCount": 50,
          "duration": 3000,
          "public": false,
          "owner": "username",
          "created": "2023-01-01T00:00:00Z",
          "changed": "2023-01-02T00:00:00Z"
        }
      ]
    }
  }
}
```

### GET /rest/getPlaylist
Get playlist with tracks.

**Parameters:**
- `id` (string): Playlist ID

**Response:**
```json
{
  "subsonic-response": {
    "status": "ok",
    "version": "1.16.1",
    "playlist": {
      "id": "playlist1",
      "name": "My Playlist",
      "songCount": 2,
      "duration": 600,
      "public": false,
      "owner": "username",
      "entry": [
        {
          "id": "song1",
          "title": "Song Title",
          "artist": "Artist Name",
          "duration": 240,
          "track": 1
        }
      ]
    }
  }
}
```

### GET /rest/createPlaylist
Create or update a playlist.

**Parameters:**
- `name` (string): Playlist name (required for new)
- `playlistId` (string): Existing playlist ID (for update)
- `songId` (string/array): Song IDs to add

### GET /rest/updatePlaylist
Update playlist metadata.

**Parameters:**
- `playlistId` (string): Playlist ID
- `name` (string): New name
- `comment` (string): New comment
- `public` (boolean): Public visibility
- `songIdToAdd` (string/array): Songs to add
- `songIndexToRemove` (number/array): Track positions to remove

### GET /rest/deletePlaylist
Delete a playlist.

**Parameters:**
- `id` (string): Playlist ID

## Media Streaming

### GET /rest/stream
Stream a media file.

**Parameters:**
- `id` (string): Song ID
- `maxBitRate` (number): Max bitrate in kbps
- `format` (string): Target format (mp3, aac, etc.)
- `timeOffset` (number): Start time offset in seconds
- `size` (string): Requested size limit
- `estimateContentLength` (boolean): Estimate content length
- `converted` (boolean): Force transcoding

**Response:** Audio stream with appropriate Content-Type

### GET /rest/download
Download original file.

**Parameters:**
- `id` (string): Song ID

**Response:** Original audio file with download headers

### GET /rest/getCoverArt
Get cover art image.

**Parameters:**
- `id` (string): Cover art ID (usually album/artist ID)
- `size` (number): Image size in pixels

**Response:** Image file (JPEG, PNG, etc.)

## User Management

### GET /rest/getUser
Get user information.

**Parameters:**
- `username` (string): Username to query

**Response:**
```json
{
  "subsonic-response": {
    "status": "ok",
    "version": "1.16.1",
    "user": {
      "username": "user",
      "email": "user@example.com",
      "scrobblingEnabled": false,
      "adminRole": false,
      "settingsRole": true,
      "downloadRole": true,
      "uploadRole": false,
      "playlistRole": true,
      "coverArtRole": false,
      "commentRole": false,
      "podcastRole": false,
      "streamRole": true,
      "jukeboxRole": false,
      "shareRole": false,
      "videoConversionRole": false
    }
  }
}
```

## Internet Radio

### GET /rest/getInternetRadioStations
Get internet radio stations.

**Response:**
```json
{
  "subsonic-response": {
    "status": "ok",
    "version": "1.16.1",
    "internetRadioStations": {
      "internetRadioStation": [
        {
          "id": "radio1",
          "name": "Radio Station",
          "streamUrl": "http://stream.example.com/live.mp3",
          "homePageUrl": "http://station.example.com"
        }
      ]
    }
  }
}
```

## Error Responses

All errors return similar structure:
```json
{
  "subsonic-response": {
    "status": "failed",
    "version": "1.16.1",
    "error": {
      "code": 10,
      "message": "Required parameter is missing."
    }
  }
}
```

### Common Error Codes:
- 0: Generic error
- 10: Required parameter missing
- 20: API version not supported  
- 30: API version too old
- 40: Wrong username/password
- 50: User not authorized
- 60: Feature not supported
- 70: Data not found

## Implementation Notes

### Compatibility
- Navidrome supports Subsonic API v1.16.1
- Some endpoints may have limitations vs full Subsonic
- Use `/rest/getOpenSubsonicExtensions` to check supported features

### Performance
- Use `ifModifiedSince` parameters to avoid unnecessary transfers
- Implement proper caching based on response headers
- Consider using HEAD requests to check modification times

## Library Filtering

### Overview
Navidrome supports library filtering in the Subsonic API to restrict operations to specific music libraries. This allows users with access to multiple libraries to filter content based on their current selection.

### Library Filtering Parameters

#### `musicFolderId` Parameter
**Supported Endpoints:**
- `/rest/search3` - Search operations
- `/rest/search2` - Legacy search (also supported)

**Usage:**
- **Type**: Integer or array of integers
- **Required**: No
- **Default**: All libraries accessible to the user
- **Multiple Values**: Use repeated parameters: `musicFolderId=1&musicFolderId=2`

**Examples:**
```bash
# Search in specific library
/rest/search3?query=jazz&musicFolderId=1&u=user&p=pass&v=1.16.1&c=app&f=json

# Search in multiple libraries  
/rest/search3?query=jazz&musicFolderId=1&musicFolderId=2&u=user&p=pass&v=1.16.1&c=app&f=json

# Search in all accessible libraries (default behavior)
/rest/search3?query=jazz&u=user&p=pass&v=1.16.1&c=app&f=json
```

### Automatic Library Filtering

The following operations are **automatically filtered** by user library access and do not require explicit `musicFolderId` parameters:

#### User Preferences
- `/rest/star` - Star content (automatically scoped to accessible content)
- `/rest/unstar` - Unstar content (automatically scoped to accessible content)  
- `/rest/setRating` - Set ratings (automatically scoped to accessible content)

#### Library Browsing
- `/rest/getGenres` - List genres (automatically filtered by accessible libraries)
- `/rest/getIndexes` - Get artist index (respects user library access)
- `/rest/getMusicDirectory` - Browse directories (access-controlled by library permissions)

#### Global Operations (No Library Filtering)
- `/rest/getInternetRadioStations` - Radio stations are global resources
- `/rest/createInternetRadioStation` - Radio stations are global (admin-only)
- `/rest/deleteInternetRadioStation` - Radio stations are global (admin-only)

### Library Access Control

**User Library Access:**
- Users can only access libraries they have been granted access to
- Admin users have access to all libraries by default
- Library access is managed through the user management interface

**Parameter Validation:**
- Invalid library IDs return error code 70 (Data not found)
- Users cannot specify library IDs they don't have access to
- When omitted, defaults to all user-accessible libraries

### Implementation Differences: Subsonic vs REST API

| Aspect | Subsonic API | REST API |
|--------|-------------|----------|
| **Parameter Name** | `musicFolderId` | `library_id` |
| **Search Filtering** | ✅ Explicit via `musicFolderId` | ✅ Explicit via `library_id` |
| **User Preferences** | ✅ Automatic (no params needed) | ✅ Automatic (no params needed) |
| **Genres/Browsing** | ✅ Automatic (no params needed) | ✅ Automatic (no params needed) |
| **Radio Stations** | ❌ Global (no filtering) | ❌ Global (no filtering) |

### Best Practices
1. Always specify API version (`v` parameter)
2. Use token authentication instead of plain passwords
3. Handle errors gracefully with fallbacks
4. Implement proper offline caching
5. Test with multiple Subsonic API versions
6. **Use `musicFolderId` for search operations when library filtering is needed**
7. **Don't add `musicFolderId` to operations that handle library filtering automatically**