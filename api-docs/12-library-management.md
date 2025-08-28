# Library Management API

## Overview
Manage music libraries and user access permissions. These endpoints are primarily admin-only.

## Library Endpoints

### Base URL: `/api/library` (Admin-only)

### GET /api/library
List all music libraries configured on the server.

**Response (200 OK):**
```json
[
  {
    "id": "string",
    "name": "string",
    "path": "string",        // File system path
    "scanActive": boolean,   // Currently scanning
    "lastScanTime": "ISO-8601",
    "songCount": number,
    "duration": number,
    "size": number,
    "createdAt": "ISO-8601",
    "updatedAt": "ISO-8601"
  }
]
```

### GET /api/library/{id}
Get a specific library by ID.

### POST /api/library
Create a new music library.

**Request Body:**
```json
{
  "name": "string (required)",
  "path": "string (required)",  // Must be accessible file path
  "scanOptions": {
    "recursive": boolean,
    "followSymlinks": boolean,
    "excludePatterns": ["string"]
  }
}
```

### PUT /api/library/{id}
Update library configuration.

**Request Body:**
```json
{
  "name": "string",
  "path": "string",
  "scanOptions": {
    "recursive": boolean,
    "followSymlinks": boolean,
    "excludePatterns": ["string"]
  }
}
```

### DELETE /api/library/{id}
Remove a library (admin-only, removes all associated music).

## User-Library Association

### GET /api/user/{userId}/library
Get libraries accessible to a specific user (admin-only).

**Response (200 OK):**
```json
[
  {
    "id": "string",
    "name": "string",
    "path": "string",
    "hasAccess": boolean
  }
]
```

### PUT /api/user/{userId}/library
Set which libraries a user can access (admin-only).

**Request Body:**
```json
{
  "libraryIds": [1, 2, 3]  // Array of library IDs
}
```

**Response (200 OK):**
Updated user library access list

## Missing Files Management

### GET /api/missing
List files that exist in database but are missing from filesystem.

**Response (200 OK):**
```json
[
  {
    "id": "string",
    "path": "string",
    "title": "string",
    "album": "string", 
    "artist": "string",
    "missingFileCount": number,
    "lastSeen": "ISO-8601"
  }
]
```

### DELETE /api/missing
Clean up database entries for missing files.

**Query Parameters:**
- `id` (string/array): Specific missing file IDs to remove
- Empty: Remove all missing files

**Response (200 OK):**
```json
{
  "removed": number
}
```

## Library Operations

### Scanning
Libraries are scanned to discover new/changed files:

**Manual Scan Trigger** (via Subsonic API):
```
GET /rest/startScan?u=user&p=pass&v=1.16.1&c=client
```

**Check Scan Status**:
```
GET /rest/getScanStatus?u=user&p=pass&v=1.16.1&c=client
```

### Health Checks

#### GET /api/keepalive/
Simple health check endpoint.

**Response (200 OK):**
```json
{
  "response": "ok",
  "id": "keepalive"
}
```

#### GET /api/insights/
Get insights and statistics about the library.

**Response (200 OK):**
```json
{
  "id": "insights_status",
  "lastRun": "2024-01-01 12:00:00",
  "success": true
}
```

If insights collection is disabled:
```json
{
  "id": "insights_status", 
  "lastRun": "disabled",
  "success": false
}
```

## Configuration Endpoints (Admin-only, Development)

### GET /api/config/*
Get server configuration (only available if `DevUIShowConfig` is enabled).

**Response (200 OK):**
Server configuration object (varies based on server setup).

### GET /api/inspect (Admin-only, Development)
Server inspection endpoint for debugging (requires `Inspect.Enabled`).

**Note**: This endpoint may be throttled and is intended for development/debugging.

## Best Practices

### Library Setup
1. **Path Accessibility**: Ensure library paths are accessible to Navidrome process
2. **Permissions**: Set appropriate file system permissions
3. **Storage**: Use fast storage for database, network storage OK for music files
4. **Backup**: Regular backups of library configuration and database

### User Management
1. **Access Control**: Limit users to relevant libraries only
2. **Performance**: Large libraries may impact performance for users
3. **Quotas**: Consider disk usage per user/library

### Maintenance
1. **Regular Cleanup**: Remove missing files periodically
2. **Monitoring**: Check scan status and library health
3. **Updates**: Rescan after bulk file operations

## Integration Examples

### Library Status Dashboard
```javascript
const getLibraryStats = async () => {
  const libraries = await fetch('/api/library').then(r => r.json())
  
  return libraries.map(lib => ({
    name: lib.name,
    songCount: lib.songCount,
    size: formatBytes(lib.size),
    lastScan: lib.lastScanTime ? new Date(lib.lastScanTime) : null,
    isScanning: lib.scanActive
  }))
}
```

### Missing Files Cleanup
```javascript
const cleanupMissingFiles = async () => {
  const missing = await fetch('/api/missing').then(r => r.json())
  
  if (missing.length > 0) {
    console.log(`Found ${missing.length} missing files`)
    const result = await fetch('/api/missing', { method: 'DELETE' })
      .then(r => r.json())
    console.log(`Removed ${result.removed} entries`)
  }
}
```

### User Library Assignment
```javascript
const assignUserToLibrary = async (userId, libraryIds) => {
  const response = await fetch(`/api/user/${userId}/library`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ libraryIds })
  })
  
  return response.json()
}
```