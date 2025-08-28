# Media Library API

## Overview
Endpoints for accessing and managing songs, albums, artists, and genres in the media library.

## Song Endpoints

### Base URL: `/api/song`

### GET /api/song
List songs with pagination and filtering.

**Query Parameters:**
- `_start` (number): Starting index
- `_end` (number): Ending index
- `_sort` (string): Sort field
- `_order` (string): ASC/DESC
- `filter` (string): JSON filter criteria
- `starred` (boolean): Filter starred songs

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
List all genres.

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

## Common Operations

### Starring/Rating
Use star/unstar and rating operations through:
- POST to add star: `/api/{type}/{id}/star`
- DELETE to remove star: `/api/{type}/{id}/star`
- PUT to set rating: `/api/{type}/{id}/rating` with body `{"rating": 1-5}`

Where `{type}` is one of: song, album, artist

### Filtering
All list endpoints support filtering via the `filter` query parameter:
```json
{
  "starred": true,
  "genre": "Rock",
  "year": {"gte": 2020},
  "artist": "Artist Name"
}
```

### Sorting
Use `_sort` and `_order` parameters:
- `_sort=name&_order=ASC`
- `_sort=playCount&_order=DESC`
- `_sort=random` for random order