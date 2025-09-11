# List and Tag Endpoints API

## Overview
Comprehensive documentation for all list-based endpoints that provide filter options and tag data for use in media library searches and smart playlists.

## Tag System Overview

Navidrome's tag system provides extensive metadata filtering capabilities through a unified tag architecture. All tags can be used as filters using the `{tag_name}_id` parameter format.

### Base URL: `/api/tag`

## Generic Tag Endpoints

### GET /api/tag
List all tags across all tag types with filtering support.

**Query Parameters:**
- `_start` (number): Starting index (default: 0)
- `_end` (number): Ending index (exclusive)
- `_sort` (string): Sort field ("name", "songCount", "albumCount")
- `_order` (string): "ASC" or "DESC" (default: ASC)
- `name` (string): Substring search in tag names
- `library_id` (number): Filter by library access (via library_tag table)
- `tagType` (string): Filter by specific tag type

**Response (200 OK):**
```json
[
  {
    "id": "string",
    "name": "string",
    "tagType": "string",
    "songCount": number,
    "albumCount": number,
    "createdAt": "ISO-8601",
    "updatedAt": "ISO-8601"
  }
]
```

### GET /api/tag/{id}
Get a specific tag by ID.

**Response (200 OK):**
```json
{
  "id": "string",
  "name": "string",
  "tagType": "string",
  "songCount": number,
  "albumCount": number,
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

## Specialized Tag Endpoints

### Genre Endpoints
**Base URL:** `/api/genre`

Genres are implemented as a specialized tag type filtering on `TagGenre`.

#### GET /api/genre
List all music genres.

**Query Parameters:**
- `_start`, `_end`, `_sort`, `_order` (standard pagination)
- `name` (string): Substring search in genre names
- `library_id` (number): Filter by library access

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

#### GET /api/genre/{id}
Get a specific genre by ID with detailed statistics.

## Available Tag Types

### Main Content Tags

#### Music Genres
- **Endpoint**: `/api/genre` or `/api/tag?tagType=genre`
- **Filter Usage**: `genre_id={id}`
- **Description**: Music genres (Rock, Jazz, Classical, etc.)

#### Mood Tags
- **Endpoint**: `/api/tag?tagType=mood`
- **Filter Usage**: `mood_id={id}`
- **Description**: Musical moods and emotions (Happy, Sad, Energetic, etc.)

#### Grouping/Collection Tags
- **Endpoint**: `/api/tag?tagType=grouping`
- **Filter Usage**: `grouping_id={id}`
- **Description**: Content groupings and collections

### Album-Level Tags

#### Release Type Tags
- **Endpoint**: `/api/tag?tagType=releasetype`
- **Filter Usage**: `releasetype_id={id}`
- **Description**: Album release types
- **Common Values**: EP, LP, Single, Compilation, Soundtrack, Live

#### Album Version Tags
- **Endpoint**: `/api/tag?tagType=albumversion`
- **Filter Usage**: `albumversion_id={id}`
- **Description**: Album versions and releases
- **Common Values**: Remaster, Deluxe Edition, Anniversary Edition, Director's Cut

#### Media Type Tags
- **Endpoint**: `/api/tag?tagType=media`
- **Filter Usage**: `media_id={id}`
- **Description**: Physical and digital media types
- **Common Values**: CD, Vinyl, Digital, Cassette, DVD, Blu-ray

#### Record Label Tags
- **Endpoint**: `/api/tag?tagType=recordlabel`
- **Filter Usage**: `recordlabel_id={id}`
- **Description**: Record labels and publishers

#### Release Country Tags
- **Endpoint**: `/api/tag?tagType=releasecountry`
- **Filter Usage**: `releasecountry_id={id}`
- **Description**: Countries of release
- **Common Values**: US, UK, DE, JP, etc. (ISO country codes)

### Role/Credit Tags

#### Composer Tags
- **Endpoint**: `/api/tag?tagType=composer`
- **Filter Usage**: `composer_id={id}` or `role_composer_id={id}`
- **Description**: Music composers and songwriters

#### Producer Tags
- **Endpoint**: `/api/tag?tagType=producer`
- **Filter Usage**: `producer_id={id}` or `role_producer_id={id}`
- **Description**: Music producers

#### Conductor Tags
- **Endpoint**: `/api/tag?tagType=conductor`
- **Filter Usage**: `conductor_id={id}` or `role_conductor_id={id}`
- **Description**: Orchestra and ensemble conductors

#### Engineer Tags
- **Endpoint**: `/api/tag?tagType=engineer`
- **Filter Usage**: `engineer_id={id}` or `role_engineer_id={id}`
- **Description**: Audio engineers and technical staff

#### Mixer Tags
- **Endpoint**: `/api/tag?tagType=mixer`
- **Filter Usage**: `mixer_id={id}` or `role_mixer_id={id}`
- **Description**: Mix engineers

#### Additional Role Tags
All following roles follow the same pattern:
- **Lyricist**: `lyricist_id` / `role_lyricist_id`
- **Arranger**: `arranger_id` / `role_arranger_id`
- **Remixer**: `remixer_id` / `role_remixer_id`
- **DJ/Mixer**: `djmixer_id` / `role_djmixer_id`
- **Director**: `director_id` / `role_director_id`
- **Performer**: `performer_id` / `role_performer_id` (instrument-specific)

## Extended Metadata Tags

### Additional Tags (Smart Playlist Support)
These tags are available for advanced filtering and smart playlists:

#### Catalog and Identification
- **ASIN**: `asin_id` - Amazon Standard Identification Number
- **Barcode**: `barcode_id` - Product barcodes
- **ISRC**: `isrc_id` - International Standard Recording Code
- **Catalog Number**: `catalognumber_id` - Catalog numbers

#### Content Description
- **Key**: `key_id` - Musical key signatures
- **Language**: `language_id` - Content language
- **Movement Name**: `movementname_id` - Classical movement names
- **Subtitle**: `subtitle_id` - Track subtitles
- **Work**: `work_id` - Musical work titles

#### Technical and Legal
- **Copyright**: `copyright_id` - Copyright information
- **License**: `license_id` - License information
- **Encoded By**: `encodedby_id` - Encoding software/person
- **Website**: `website_id` - Related websites

### MusicBrainz Identifier Tags
All MusicBrainz UUIDs are available as tags:

- **Artist MBID**: `mbzartistid_id`
- **Album MBID**: `mbzalbumid_id`
- **Recording MBID**: `mbzrecordingid_id`
- **Track MBID**: `mbztrackid_id`
- **Release Group MBID**: `mbzreleasegroupid_id`
- **Work MBID**: `mbzworkid_id`

## Library Management

### Library-Filtered Tag Lists
All tag endpoints support library filtering to show only tags relevant to the user's accessible libraries:

```
GET /api/genre?library_id=1
GET /api/tag?tagType=mood&library_id=2
GET /api/tag?tagType=recordlabel&library_id=1,3
```

### Multi-Library Support
Users can access multiple libraries simultaneously:

```
GET /api/tag?library_id=1,2,3&tagType=genre
```

## Usage Examples

### Getting Filter Options for UI

**Get all genres for dropdown:**
```
GET /api/genre?library_id=1&_sort=name&_order=ASC
```

**Get top moods by usage:**
```
GET /api/tag?tagType=mood&library_id=1&_sort=songCount&_order=DESC&_end=20
```

**Get all record labels with content:**
```
GET /api/tag?tagType=recordlabel&library_id=1&_sort=albumCount&_order=DESC
```

### Advanced Tag Queries

**Search for specific mood:**
```
GET /api/tag?tagType=mood&name=happy&library_id=1
```

**Get classical composers:**
```
GET /api/tag?tagType=composer&library_id=1&_sort=name
```

**Find electronic music labels:**
```
GET /api/tag?tagType=recordlabel&name=electronic&library_id=1
```

### Using Tags in Media Queries

**Albums by mood and genre:**
```
GET /api/album?genre_id=rock123&mood_id=energetic456&library_id=1
```

**Albums by specific producer and label:**
```
GET /api/album?role_producer_id=quincy789&recordlabel_id=motown123&library_id=1
```

**Classical works by composer and conductor:**
```
GET /api/album?role_composer_id=bach123&role_conductor_id=karajan456&library_id=1
```

## Tag Management

### Tag Relationships
Tags maintain relationships with media items through junction tables:
- `library_tag` - Library access control
- Album and song associations tracked automatically
- Count statistics updated on library scan

### Tag Lifecycle
- Tags are created automatically during library scanning
- Unused tags are cleaned up during library maintenance
- Tag statistics are updated in real-time
- Library associations managed through access control

## Performance Considerations

### Caching
- Tag lists are cached for performance
- Library-filtered results are cached separately
- Statistics are updated asynchronously during scans

### Query Optimization
- Use specific tag type filtering when possible
- Combine library filtering with other parameters for best performance
- Pagination recommended for large tag lists

### Index Usage
- Tag searches use full-text indexes
- Library filtering uses optimized junction table indexes
- Count statistics use materialized view patterns