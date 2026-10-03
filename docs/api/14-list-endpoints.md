# List and Tag Endpoints API

## Overview
Comprehensive documentation for all list-based endpoints that provide filter options and tag data for use in media library searches and smart playlists.

## Tag System Overview

Navidrome's tag system provides extensive metadata filtering capabilities through a unified tag architecture. Genre filters with `genre_id`. Every other tag filters with its bare tag name and the tag UUID, such as `mood=<UUID>`.

### Base URL: `/api/tag`

## Generic Tag Endpoints

### GET /api/tag
List all tags across all tag types with filtering support.

**Query Parameters:**
- `_start` (number): Starting index (default: 0)
- `_end` (number): Ending index (exclusive)
- `_sort` (string): Sort field ("tagValue", "songCount", "albumCount")
- `_order` (string): "ASC" or "DESC" (default: ASC)
- `tag_name` (string): Filter by tag name, such as `genre` or `mood`. Navidrome ignores `tagType`.
- `tag_value` or `name` (string): Substring search in tag values
- `library_id` (number): Filter by library access (via library_tag table)

**Response (200 OK):**
```json
[
  {
    "id": "string",
    "tagName": "string",   // e.g. "genre", "mood"
    "tagValue": "string",
    "albumCount": number,
    "songCount": number
  }
]
```

### GET /api/tag/{id}
Get a specific tag by ID.

**Response (200 OK):**
```json
{
  "id": "string",
  "tagName": "string",   // e.g. "genre", "mood"
  "tagValue": "string",
  "albumCount": number,
  "songCount": number
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
- **Endpoint**: `/api/genre` or `/api/tag?tag_name=genre`
- **Filter Usage**: `genre_id={id}`
- **Description**: Music genres (Rock, Jazz, Classical, etc.)

#### Mood Tags
- **Endpoint**: `/api/tag?tag_name=mood`
- **Filter Usage**: `mood={id}`
- **Description**: Musical moods and emotions (Happy, Sad, Energetic, etc.)

#### Grouping/Collection Tags
- **Endpoint**: `/api/tag?tag_name=grouping`
- **Filter Usage**: `grouping={id}`
- **Description**: Content groupings and collections

### Album-Level Tags

#### Release Type Tags
- **Endpoint**: `/api/tag?tag_name=releasetype`
- **Filter Usage**: `releasetype={id}`
- **Description**: Album release types
- **Common Values**: EP, LP, Single, Compilation, Soundtrack, Live

#### Album Version Tags
- **Endpoint**: `/api/tag?tag_name=albumversion`
- **Filter Usage**: `albumversion={id}`
- **Description**: Album versions and releases
- **Common Values**: Remaster, Deluxe Edition, Anniversary Edition, Director's Cut

#### Media Type Tags
- **Endpoint**: `/api/tag?tag_name=media`
- **Filter Usage**: `media={id}`
- **Description**: Physical and digital media types
- **Common Values**: CD, Vinyl, Digital, Cassette, DVD, Blu-ray

#### Record Label Tags
- **Endpoint**: `/api/tag?tag_name=recordlabel`
- **Filter Usage**: `recordlabel={id}`
- **Description**: Record labels and publishers

#### Release Country Tags
- **Endpoint**: `/api/tag?tag_name=releasecountry`
- **Filter Usage**: `releasecountry={id}`
- **Description**: Countries of release
- **Common Values**: US, UK, DE, JP, etc. (ISO country codes)

### Role/Credit Filters

Roles are artist credits, not tags, so `/api/tag` does not list them.

- **List the artists in a role**: `/api/artist?role={role}`, such as `role=composer`
- **Filter albums by a role**: `/api/album?role_{role}_id={artistId}`
- **Filter albums by any role**: `/api/album?role_total_id={artistId}`
- `/api/song` has no role filter. It ignores `role_{role}_id`, and both endpoints ignore the `{role}_id` form.

Roles: `composer`, `producer`, `conductor`, `engineer`, `mixer`, `lyricist`, `arranger`, `remixer`, `djmixer`, `director`, `performer` (instrument-specific).

## Extended Metadata Tags

### Additional Tags (Smart Playlist Support)
These tags filter with their bare tag name. Song-level tags such as `isrc` and `asin` filter `/api/song` only.

#### Catalog and Identification
- **ASIN**: `asin` - Amazon Standard Identification Number
- **Barcode**: `barcode` - Product barcodes
- **ISRC**: `isrc` - International Standard Recording Code
- **Catalog Number**: `catalognumber` - Catalog numbers

#### Content Description
- **Key**: `key` - Musical key signatures
- **Language**: `language` - Content language
- **Movement Name**: `movementname` - Classical movement names
- **Subtitle**: `subtitle` - Track subtitles
- **Work**: `work` - Musical work titles

#### Technical and Legal
- **Copyright**: `copyright` - Copyright information
- **License**: `license` - License information
- **Encoded By**: `encodedby` - Encoding software/person
- **Website**: `website` - Related websites

### MusicBrainz Identifiers
MusicBrainz IDs are album and song fields, not tags. `/api/tag` does not list them.

## Library Management

### Library-Filtered Tag Lists
All tag endpoints support library filtering to show only tags relevant to the user's accessible libraries:

```
GET /api/genre?library_id=1
GET /api/tag?tag_name=mood&library_id=2
GET /api/tag?tag_name=recordlabel&library_id=1,3
```

### Multi-Library Support
Users can access multiple libraries simultaneously:

```
GET /api/tag?library_id=1,2,3&tag_name=genre
```

## Usage Examples

### Getting Filter Options for UI

**Get all genres for dropdown:**
```
GET /api/genre?library_id=1&_sort=name&_order=ASC
```

**Get top moods by usage:**
```
GET /api/tag?tag_name=mood&library_id=1&_sort=songCount&_order=DESC&_end=20
```

**Get all record labels with content:**
```
GET /api/tag?tag_name=recordlabel&library_id=1&_sort=albumCount&_order=DESC
```

### Advanced Tag Queries

**Search for specific mood:**
```
GET /api/tag?tag_name=mood&name=happy&library_id=1
```

**Get composers:**
```
GET /api/artist?role=composer&_sort=name
```

**Find electronic music labels:**
```
GET /api/tag?tag_name=recordlabel&name=electronic&library_id=1
```

### Using Tags in Media Queries

**Albums by mood and genre:**
```
GET /api/album?genre_id=rock123&mood=energetic456&library_id=1
```

**Albums by specific producer and label:**
```
GET /api/album?role_producer_id=quincy789&recordlabel=motown123&library_id=1
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