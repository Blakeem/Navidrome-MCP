# Tags API

## Overview
Manage metadata tags from audio files. Tags represent key-value pairs extracted from file metadata and can be used for advanced filtering and organization.

## Base URL: `/api/tag`

### GET /api/tag
List all unique tags with their usage statistics.

**Query Parameters:**
- `_start` (number): Starting index
- `_end` (number): Ending index
- `_sort` (string): Sort field
- `_order` (string): ASC/DESC
- `filter` (string): JSON filter criteria **⚠️ BROKEN - See Known Issues below**

**Response (200 OK):**
```json
[
  {
    "id": "string",
    "tagName": "string",      // Tag name (e.g., "genre", "year", "composer")
    "tagValue": "string",     // Tag value
    "albumCount": number,     // Number of albums with this tag
    "songCount": number       // Number of songs with this tag
  }
]
```

### GET /api/tag/{id}
Get a specific tag by ID.

**Response (200 OK):**
Single tag object with usage statistics

### POST /api/tag ⚠️ NOT IMPLEMENTED
Create a new tag (admin-only, typically not needed).

**Status**: Returns `405 Method Not Allowed` - endpoint documented but not implemented in Navidrome 0.58.0

**Request Body:**
```json
{
  "tagName": "string (required)",
  "tagValue": "string (required)"
}
```

### PUT /api/tag/{id} ⚠️ NOT IMPLEMENTED
Update a tag (admin-only, use with caution).

**Status**: Returns `405 Method Not Allowed` - endpoint documented but not implemented in Navidrome 0.58.0

**Request Body:**
```json
{
  "tagName": "string",
  "tagValue": "string"
}
```

### DELETE /api/tag/{id} ⚠️ NOT IMPLEMENTED
Delete a tag (admin-only, removes from all associated files).

**Status**: Returns `405 Method Not Allowed` - endpoint documented but not implemented in Navidrome 0.58.0

## Known Issues

### ⚠️ Tag Modification Operations Not Implemented

**Issue**: POST, PUT, and DELETE operations for tags are documented but return `405 Method Not Allowed`.

**Affected Operations**: 
- `POST /api/tag` - Create new tag
- `PUT /api/tag/{id}` - Update existing tag  
- `DELETE /api/tag/{id}` - Delete tag

**Root Cause**: The Navidrome codebase (version 0.58.0) includes API documentation for these endpoints but the actual HTTP handlers are not implemented in the routing layer.

**Evidence**:
- CORS preflight (OPTIONS) correctly shows `Access-Control-Allow-Methods: POST`
- Admin authentication works fine for other operations (playlist creation)
- All modification attempts return identical `405 Method Not Allowed` responses
- File permissions are not the issue (verified 777 permissions)

**Status**: This is a gap between API documentation and actual implementation in Navidrome that needs to be addressed upstream.

**Workaround**: Tag modification is currently only possible through:
1. **File metadata editing**: Use external tools like Mp3tag, Picard, or similar
2. **Library rescanning**: After editing files, rescan the library to update tags
3. **Direct database manipulation**: Advanced users can modify the database directly (not recommended)

### ⚠️ Filter Parameter Non-Functional

**Issue**: The `filter` query parameter is documented but completely broken. All filter criteria are ignored.

**Expected Behavior**: 
```bash
# Should return only genre tags
curl "/api/tag?filter=%7B%22tagName%22%3A%22genre%22%7D"
```

**Actual Behavior**: Returns all tags (no filtering applied)

**Root Cause**: The tag repository's filter mappings in `/persistence/sql_tags.go` only include:
- `name` - filters by tag value (not tag name)  
- `library_id` - filters by library access

Missing filter mapping for `tagName` field.

**Workaround**: Use client-side filtering after fetching all tags:
```javascript
const allTags = await fetch('/api/tag').then(r => r.json())
const genreTags = allTags.filter(tag => tag.tagName === 'genre')
```

**Status**: This is a bug in the Navidrome codebase that needs to be fixed upstream.

## Common Tag Names

### Standard Audio Tags
| Tag Name | Description | Example Values |
|----------|-------------|----------------|
| `genre` | Music genre | "Rock", "Jazz", "Classical" |
| `year` | Release year | "2023", "1977" |
| `albumartist` | Album artist | "The Beatles" |
| `composer` | Music composer | "John Lennon" |
| `conductor` | Orchestra conductor | "Herbert von Karajan" |
| `label` | Record label | "EMI", "Sony Music" |
| `catalog` | Catalog number | "CDP 7243 8" |
| `grouping` | Custom grouping | "Favorites", "Workout" |

### Extended Metadata
| Tag Name | Description | Example Values |
|----------|-------------|----------------|
| `originalyear` | Original release year | "1967" |
| `originalalbum` | Original album name | "Sgt. Pepper's" |
| `musicbrainz_*` | MusicBrainz IDs | Various UUID values |
| `discogs_*` | Discogs identifiers | Discogs release IDs |
| `asin` | Amazon identifier | "B000WUB6TW" |
| `barcode` | UPC/EAN barcode | "5099750442227" |

### Technical Tags
| Tag Name | Description | Example Values |
|----------|-------------|----------------|
| `replaygain_*` | Volume normalization | "-2.3 dB" |
| `encoder` | Encoding software | "LAME 3.100" |
| `encoding` | Encoding settings | "VBR V0" |

## Usage in Filtering

### Advanced Search
Tags enable sophisticated filtering:
```json
{
  "tags.composer": "Bach",
  "tags.genre": "Classical",
  "tags.year": {"gte": "2000"}
}
```

### Custom Collections
Create smart playlists based on tags:
```json
{
  "rules": {
    "conditions": "all",
    "rules": [
      {
        "field": "tags.label",
        "operator": "is",
        "value": "Blue Note Records"
      },
      {
        "field": "tags.genre",
        "operator": "contains",
        "value": "Jazz"
      }
    ]
  }
}
```

## Tag Management

### Bulk Operations
Tags are typically managed through:
1. **File scanning**: Automatic extraction during library scan
2. **Metadata editors**: External tools like Mp3tag, Picard
3. **API updates**: Programmatic tag management

### Tag Normalization
Consider normalizing tag values:
```javascript
// Normalize genre tags
const normalizeGenre = (genre) => {
  const mapping = {
    'rock': 'Rock',
    'pop': 'Pop',
    'classical': 'Classical',
    'hip-hop': 'Hip-Hop',
    'r&b': 'R&B'
  }
  return mapping[genre.toLowerCase()] || genre
}
```

### Duplicate Detection
Find and merge similar tags:
```javascript
// Find similar tag values
const findSimilar = (tags, threshold = 0.8) => {
  return tags.filter(tag => 
    tag.tagName === 'genre' && 
    levenshteinDistance(tag.tagValue, 'Rock') < threshold
  )
}
```

## Integration Examples

### Genre Cloud
Generate a tag cloud from genre tags:
```javascript
// ⚠️ Note: Using client-side filtering due to broken server-side filter
const allTags = await fetch('/api/tag').then(r => r.json())
const genreTags = allTags.filter(tag => tag.tagName === 'genre')

const tagCloud = genreTags.map(tag => ({
  text: tag.tagValue,
  size: Math.log(tag.songCount) * 10
}))
```

### Metadata Export
Export all tags for external processing:
```javascript
const exportTags = async () => {
  let start = 0
  const batchSize = 1000
  const allTags = []
  
  while (true) {
    const batch = await fetch(`/api/tag?_start=${start}&_end=${start + batchSize}`)
      .then(r => r.json())
    
    if (batch.length === 0) break
    allTags.push(...batch)
    start += batchSize
  }
  
  return allTags
}
```

### Custom Tag Analysis
Analyze tag distribution:
```javascript
const analyzeTagUsage = (tags) => {
  const byName = tags.reduce((acc, tag) => {
    if (!acc[tag.tagName]) acc[tag.tagName] = []
    acc[tag.tagName].push(tag)
    return acc
  }, {})
  
  return Object.entries(byName).map(([name, tags]) => ({
    tagName: name,
    uniqueValues: tags.length,
    totalSongs: tags.reduce((sum, t) => sum + t.songCount, 0),
    mostCommon: tags.sort((a, b) => b.songCount - a.songCount)[0]
  }))
}
```

## Best Practices

### Performance
- Tags are indexed for fast searching
- Use specific tag names in filters
- Combine with other filters for efficiency

### Data Quality
- Standardize tag values during import
- Use consistent capitalization
- Avoid duplicate/similar tags
- Validate tag data before bulk operations

### Privacy
- Some tags may contain personal information
- Review tags before sharing music collections
- Consider removing private tags from shared content