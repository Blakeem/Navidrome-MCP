# Media Library API

## Overview
Endpoints for accessing and managing songs, albums, artists, genres, and tags in the media library. This API provides comprehensive search, filtering, and sorting capabilities across all media types with extensive tag-based filtering support.

## Base Architecture
- **Base URL**: `/api/`
- **Authentication**: JWT token via `X-ND-Authorization` header
- **Format**: JSON requests/responses
- **Pagination**: Uses `_start` and `_end` parameters
- **Library Support**: Multi-library filtering with `library_id` parameter

## Song Endpoints

### Base URL: `/api/song`

### GET /api/song
List songs with pagination and filtering.

**Standard Query Parameters:**
- `_start` (number): Starting index (default: 0)
- `_end` (number): Ending index (exclusive)
- `_sort` (string): Sort field - see [Song Sorting Options](#song-sorting-options)
- `_order` (string): "ASC" or "DESC" (default: ASC)
- `seed` (number): Random seed for consistent random ordering

**Filter Parameters:**
- `id` (string): Exact song ID match
- `title` (string): Full-text search in song titles (includes MusicBrainz IDs)
- `starred` (boolean): Filter starred songs
- `missing` (boolean): Filter missing files
- `library_id` (number): Filter by library ID (access controlled)
- `artists_id` (string): Filter by artist participant ID
- `genre_id` (string): Filter by genre tag ID

**Dynamic Tag-Based Filters:**
All tag fields support filtering using `{tag_name}_id` format:
- `mood_id` (string): Filter by mood tag
- `grouping_id` (string): Filter by grouping tag
- `media_id` (string): Filter by media type tag
- `recordlabel_id` (string): Filter by record label tag
- `releasecountry_id` (string): Filter by release country tag
- `composer_id` (string): Filter by composer role
- `producer_id` (string): Filter by producer role
- `conductor_id` (string): Filter by conductor role
- `arranger_id` (string): Filter by arranger role
- `lyricist_id` (string): Filter by lyricist role
- `engineer_id` (string): Filter by engineer role
- `mixer_id` (string): Filter by mixer role
- `remixer_id` (string): Filter by remixer role
- `djmixer_id` (string): Filter by DJ/mixer role
- `director_id` (string): Filter by director role
- `performer_id` (string): Filter by performer role (instrument-specific)

**Legacy Filter Support:**
- `filter` (string): JSON filter criteria (see [Legacy Filtering](#legacy-filtering))

**Response (200 OK):**
```json
[
  {
    "id": "string",
    "title": "string",
    "album": "string",
    "albumId": "string",
    "artist": "string",
    "artistId": "string",
    "albumArtist": "string",
    "albumArtistId": "string",
    "trackNumber": number,
    "discNumber": number,
    "year": number,
    "date": "string",
    "originalYear": number,
    "releaseYear": number,
    "genre": "string",
    "genres": ["string"],
    "duration": number,  // seconds
    "bitRate": number,   // kbps
    "sampleRate": number,
    "bitDepth": number,
    "channels": number,
    "path": "string",
    "suffix": "string",  // file extension
    "size": number,      // bytes
    "hasCoverArt": boolean,
    "compilation": boolean,
    "comment": "string",
    "lyrics": "string",
    "tags": {},
    "rgTrackGain": number,
    "rgTrackPeak": number,
    "rgAlbumGain": number,
    "rgAlbumPeak": number,
    "bookmarkPosition": number,
    "playCount": number,
    "playDate": "ISO-8601",
    "rating": number,    // 1-5
    "starred": boolean,
    "starredAt": "ISO-8601",
    "createdAt": "ISO-8601",
    "updatedAt": "ISO-8601"
  }
]
```

### GET /api/song/{id}
Get a specific song by ID.

### GET /api/song/{id}/playlists
Get all playlists containing this song.

**Response (200 OK):**
```json
[
  {
    "id": "string",
    "name": "string",
    "comment": "string",
    "public": boolean,
    "songCount": number,
    "duration": number,
    "owner": "string",
    "ownerId": "string"
  }
]
```

## Album Endpoints

### Base URL: `/api/album`

### GET /api/album
List albums with pagination and filtering.

**Standard Query Parameters:**
- `_start` (number): Starting index (default: 0)
- `_end` (number): Ending index (exclusive)
- `_sort` (string): Sort field - see [Album Sorting Options](#album-sorting-options)
- `_order` (string): "ASC" or "DESC" (default: ASC)
- `seed` (number): Random seed for consistent random ordering

**Core Filter Parameters:**
- `id` (string): Exact album ID match
- `name` (string): Full-text search in album names (includes MusicBrainz IDs)
- `compilation` (boolean): Filter compilation albums
- `artist_id` (string): Filter by artist ID (supports role-based artist filtering)
- `year` (number): Year range filter (matches min_year <= value <= max_year)
- `recently_played` (boolean): Albums with play_count > 0
- `starred` (boolean): Filter starred albums
- `has_rating` (boolean): Albums with rating > 0
- `missing` (boolean): Filter missing albums
- `library_id` (number): Filter by library ID (access controlled)

**Genre and Tag Filters:**
- `genre_id` (string): Filter by genre tag ID
- `mood_id` (string): Filter by mood tag
- `albumversion_id` (string): Filter by album version tag
- `releasetype_id` (string): Filter by release type (EP, LP, etc.)
- `grouping_id` (string): Filter by grouping/collection tag
- `media_id` (string): Filter by media type (CD, vinyl, etc.)
- `recordlabel_id` (string): Filter by record label tag
- `releasecountry_id` (string): Filter by release country tag

**Role-Based Filters:**
Filter albums by participant roles using `role_{role}_id` format:
- `role_composer_id` (string): Filter by composer
- `role_producer_id` (string): Filter by producer
- `role_conductor_id` (string): Filter by conductor
- `role_arranger_id` (string): Filter by arranger
- `role_lyricist_id` (string): Filter by lyricist
- `role_engineer_id` (string): Filter by engineer
- `role_mixer_id` (string): Filter by mixer
- `role_remixer_id` (string): Filter by remixer
- `role_djmixer_id` (string): Filter by DJ/mixer
- `role_director_id` (string): Filter by director
- `role_performer_id` (string): Filter by performer (instrument-specific)

**Aggregate Role Filter:**
- `role_total_id` (string): Filter by any role/participant ID

**Response (200 OK):**
```json
[
  {
    "id": "string",
    "name": "string",
    "artist": "string",
    "artistId": "string",
    "albumArtist": "string",
    "albumArtistId": "string",
    "maxYear": number,
    "minYear": number,
    "releaseYear": number,
    "originalDate": "string",
    "releaseDate": "string",
    "compilation": boolean,
    "songCount": number,
    "duration": number,
    "size": number,
    "genre": "string",
    "genres": ["string"],
    "fullText": "string",
    "sortAlbumName": "string",
    "sortArtistName": "string",
    "sortAlbumArtistName": "string",
    "orderAlbumName": "string",
    "orderAlbumArtistName": "string",
    "mbzAlbumId": "string",
    "mbzAlbumType": "string",
    "mbzAlbumComment": "string",
    "catalogNum": "string",
    "comment": "string",
    "allArtistIds": "string",
    "paths": "string",
    "imageUrl": "string",
    "thumbUrl": "string",
    "largeImageUrl": "string",
    "externalInfoUpdatedAt": "ISO-8601",
    "externalUrl": "string",
    "discs": {},
    "playCount": number,
    "playDate": "ISO-8601",
    "rating": number,
    "starred": boolean,
    "starredAt": "ISO-8601",
    "createdAt": "ISO-8601",
    "updatedAt": "ISO-8601"
  }
]
```

### GET /api/album/{id}
Get a specific album by ID.

## Artist Endpoints

### Base URL: `/api/artist`

### GET /api/artist
List artists with pagination and filtering.

**Standard Query Parameters:**
- `_start` (number): Starting index (default: 0)
- `_end` (number): Ending index (exclusive)
- `_sort` (string): Sort field
- `_order` (string): "ASC" or "DESC" (default: ASC)
- `seed` (number): Random seed for consistent random ordering

**Filter Parameters:**
- `id` (string): Exact artist ID match
- `name` (string): Full-text search in artist names (includes MusicBrainz IDs)
- `starred` (boolean): Filter starred artists
- `library_id` (number): Filter by library ID (via artist library associations)
- `role` (string): Filter by artist role participation

**Response (200 OK):**
```json
[
  {
    "id": "string",
    "name": "string",
    "albumCount": number,
    "songCount": number,
    "genres": ["string"],
    "fullText": "string",
    "sortArtistName": "string",
    "orderArtistName": "string",
    "size": number,
    "mbzArtistId": "string",
    "biography": "string",
    "smallImageUrl": "string",
    "mediumImageUrl": "string",
    "largeImageUrl": "string",
    "similarArtists": ["string"],
    "externalInfoUpdatedAt": "ISO-8601",
    "externalUrl": "string",
    "playCount": number,
    "playDate": "ISO-8601",
    "rating": number,
    "starred": boolean,
    "starredAt": "ISO-8601"
  }
]
```

### GET /api/artist/{id}
Get a specific artist by ID.

## Genre Endpoints

### Base URL: `/api/genre`

### GET /api/genre
List all genres with filtering support.

**Standard Query Parameters:**
- `_start` (number): Starting index (default: 0)
- `_end` (number): Ending index (exclusive)
- `_sort` (string): Sort field
- `_order` (string): "ASC" or "DESC" (default: ASC)

**Filter Parameters:**
- `name` (string): Substring search in genre names
- `library_id` (number): Filter by library access (via library_tag table)

**Response (200 OK):**
```json
[
  {
    "id": "string",
    "name": "string",
    "songCount": number,
    "albumCount": number
  }
]
```

### GET /api/genre/{id}
Get a specific genre by ID.

## Tag Endpoints

### Base URL: `/api/tag`

Generic tag endpoints for accessing any tag type in the system.

### GET /api/tag
List all tags with filtering support.

**Query Parameters:**
- `_start` (number): Starting index
- `_end` (number): Ending index
- `_sort` (string): Sort field
- `_order` (string): "ASC" or "DESC"
- `name` (string): Substring search in tag names
- `library_id` (number): Filter by library access

**Response (200 OK):**
```json
[
  {
    "id": "string",
    "name": "string",
    "tagType": "string",  // e.g., "genre", "mood", "composer"
    "songCount": number,
    "albumCount": number
  }
]
```

### GET /api/tag/{id}
Get a specific tag by ID.

## Available Tag Types

Navidrome supports extensive tag-based filtering through its comprehensive tag system:

### Main Tags
**Basic Metadata:**
- `genre` - Music genres
- `mood` - Musical moods/emotions
- `grouping` - Content groupings/collections

**Album-Level Tags:**
- `albumversion` - Album versions/releases
- `releasetype` - Release types (EP, LP, Single, etc.)
- `media` - Media types (CD, Vinyl, Digital, etc.)
- `recordlabel` - Record labels
- `releasecountry` - Release countries

**Role/Credit Tags:**
- `composer` - Music composers
- `lyricist` - Lyric writers
- `conductor` - Conductors
- `producer` - Producers
- `arranger` - Arrangers
- `engineer` - Audio engineers
- `mixer` - Mix engineers
- `remixer` - Remixers
- `djmixer` - DJ/Mixers
- `director` - Directors
- `performer` - Performers (instrument-specific)

### Additional Tags
**Extended Metadata (available for smart playlists):**
- `asin`, `barcode`, `copyright`, `encodedby`
- `key`, `isrc`, `language`, `license`
- `movementname`, `subtitle`, `website`, `work`
- And many more specialized metadata fields

**MusicBrainz Identifiers:**
- All MusicBrainz UUIDs for artists, albums, recordings, etc.

## Sorting Options

### Song Sorting Options
Supported values for `_sort` parameter on `/api/song`:
- `title` - Song title
- `artist` - Artist name + album + track info
- `album_artist` - Album artist + album + track info
- `album` - Album + disc + track order
- `random` - Seeded random order
- `created_at` - File creation date
- `recently_added` - Recently added sort
- `starred_at` - Star date

### Album Sorting Options
Supported values for `_sort` parameter on `/api/album`:
- `name` - Album name (uses sort tags if available)
- `artist` - Album artist name
- `album_artist` - Same as artist
- `max_year` - Release year/date
- `random` - Seeded random order
- `recently_added` - Creation/modification date
- `starred_at` - Star date

## Search Functionality

### Full-Text Search
Navidrome implements comprehensive full-text search across all media types:

**Search Behavior:**
- Supports multi-word search terms (split on spaces)
- Case-insensitive matching
- MusicBrainz ID exact matching
- Pattern matching in `full_text` columns
- Configurable full-string vs. partial word matching

**Usage:**
Use the `name` or `title` parameters for full-text search:
```
GET /api/album?name=dark side moon
GET /api/song?title=hotel california
GET /api/artist?name=pink floyd
```

### MusicBrainz Integration
All endpoints support MusicBrainz UUID lookup:
```
GET /api/album?name=83d91898-7763-47d7-b03b-b92132375c47
GET /api/artist?name=83d91898-7763-47d7-b03b-b92132375c47
```

## Library Support

### Multi-Library Filtering
Navidrome supports multiple music libraries with access control:

**Library Access:**
- Users have access to specific libraries via `user_library` associations
- Non-admin users automatically get library filters applied
- Admin users bypass library restrictions
- Complex entities use junction tables (e.g., `library_artist`, `library_tag`)

**Usage:**
```
GET /api/album?library_id=1
GET /api/song?library_id=2,3  // Multiple libraries
GET /api/genre?library_id=1   // Library-filtered genres
```

## Common Operations

### Starring/Rating
Use star/unstar and rating operations through:
- POST to add star: `/api/{type}/{id}/star`
- DELETE to remove star: `/api/{type}/{id}/star`
- PUT to set rating: `/api/{type}/{id}/rating` with body `{"rating": 1-5}`

Where `{type}` is one of: song, album, artist

### Legacy Filtering
All list endpoints also support the legacy `filter` query parameter with JSON criteria:
```json
{
  "starred": true,
  "genre": "Rock",
  "year": {"gte": 2020},
  "artist": "Artist Name"
}
```

**Note:** The direct parameter approach (e.g., `?starred=true&genre_id=123`) is preferred over JSON filtering for better performance and caching.

### Advanced Filtering Examples

**Filter by multiple criteria:**
```
GET /api/album?genre_id=abc123&releasetype_id=def456&library_id=1
```

**Filter by role participants:**
```
GET /api/album?role_producer_id=xyz789&role_composer_id=uvw456
```

**Filter with pagination and sorting:**
```
GET /api/album?_start=0&_end=50&_sort=recently_added&_order=DESC&genre_id=abc123
```

**Random order with seed:**
```
GET /api/album?_sort=random&seed=0.123456789&library_id=1
```

### Sorting
Use `_sort` and `_order` parameters:
- `_sort=name&_order=ASC`
- `_sort=playCount&_order=DESC`
- `_sort=random` for random order (use with `seed` parameter for consistency)
- `_sort=recently_added&_order=DESC` for newest first
- `_sort=starred_at&_order=DESC` for recently starred

## Example Usage

### Real-World Example
Based on the URL pattern: `http://localhost:4533/api/album?_end=36&_order=DESC&_sort=recently_added&_start=0&genre_id=5qDZoz1FBC36K73YeoJ2lF&library_id=1&seed=0.04960239551181811-0`

This request:
- **Pagination**: Gets 36 albums starting from index 0
- **Sorting**: Sorts by `recently_added` in descending order (newest first)
- **Genre Filter**: Filters by genre ID `5qDZoz1FBC36K73YeoJ2lF`
- **Library Filter**: Restricts to library ID 1
- **Random Seed**: Uses seed `0.04960239551181811-0` for consistent ordering

### Getting Filter Options

**Get all available genres for filtering:**
```
GET /api/genre?library_id=1
```
Returns genres with UUID-style IDs and names:
```json
[
  {"id": "2cyhOXjgBi8fBomSZvHKJ2", "name": "(18)"},
  {"id": "1D9BICMcbWhZwO3mch8kXU", "name": "Aggrotech"},
  {"id": "6EOcEWvIw6pLHNhCDXEmnr", "name": "Alt. Rock"}
]
```

**Get all available tags by type:**
```
GET /api/tag?_start=0&_end=100
```
Returns individual tag instances:
```json
[
  {"id": "00CEJjuTS4MaEexjzuRi1s", "tagName": "recordlabel", "tagValue": "Union Square Music"},
  {"id": "00V97R7Mhpn8SXDA3XeHKL", "tagName": "genre", "tagValue": "Industrial Rock", "albumCount": 2, "songCount": 14},
  {"id": "01p1Rn9jHRXAo3dDAWgVrC", "tagName": "recordlabel", "tagValue": "Woven Recordings"}
]
```

**Note**: Tag filtering requires individual tag IDs, not tag type filtering. Each tag value has its own unique ID.

### Complex Filtering Examples

**Albums by specific producer in a genre:**
```
GET /api/album?genre_id=abc123&role_producer_id=def456&library_id=1
```

**Recent rock albums on vinyl:**
```
GET /api/album?genre_id=rock123&media_id=vinyl456&_sort=recently_added&_order=DESC
```

**Songs by composer with high rating:**
```
GET /api/song?composer_id=bach123&has_rating=true&library_id=1
```

## Verified Testing Results

**✅ CONFIRMED WORKING (tested 2025-09-10):**

### Core Filtering
- ✅ `genre_id` filtering: `/api/album?genre_id={uuid}` 
- ✅ `role_composer_id` filtering: `/api/album?role_composer_id={uuid}`
- ✅ All role-based filters work with `role_{role}_id` pattern
- ✅ `library_id` filtering works across all endpoints

### Advanced Sorting
- ✅ `recently_added` sort: `_sort=recently_added&_order=DESC`
- ✅ Random with seed: `_sort=random&seed=0.12345`
- ✅ Standard pagination: `_start=0&_end=36`

### Rich Response Data
Albums include comprehensive metadata:
- ✅ `genres` array with both IDs and names
- ✅ `tags` object with detailed metadata
- ✅ `participants` object with role-based credits
- ✅ Library information embedded in responses

### API Endpoints
- ✅ `/api/genre` returns UUID-style IDs with names
- ✅ `/api/tag` returns individual tag instances
- ✅ `/api/album` supports all documented filtering parameters
- ✅ All endpoints respect library filtering
