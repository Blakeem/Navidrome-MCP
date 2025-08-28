# Playback Queue API

## Overview
Manage the play queue for continuous playback across sessions. The queue persists between sessions and syncs across devices.

## Queue Endpoints

### GET /api/queue
Get the current play queue for the authenticated user.

**Response (200 OK):**
```json
{
  "userId": "string",
  "current": number,        // Index of current track (0-based)
  "position": number,       // Playback position in ms
  "changedBy": "string",    // Client that last modified
  "items": [               // Array of tracks in queue
    {
      "id": "string",
      "title": "string",
      "album": "string",
      "artist": "string",
      "albumId": "string",
      "artistId": "string",
      "albumArtist": "string",
      "albumArtistId": "string",
      "duration": number,
      "bitRate": number,
      "path": "string",
      // ... all song fields
    }
  ],
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

**Empty Queue Response:**
If no queue exists, returns empty object:
```json
{}
```

### POST /api/queue
Replace the entire play queue.

**Request Body:**
```json
{
  "ids": ["songId1", "songId2", ...],  // Track IDs
  "current": number,                    // Current track index (0-based)
  "position": number                    // Playback position in ms
}
```

**Response:**
- 204 No Content on success

**Validation:**
- `current` must be valid index within `ids` array
- `position` must be >= 0
- Empty `ids` array is allowed

### PUT /api/queue
Partially update the play queue.

**Request Body (all fields optional):**
```json
{
  "ids": ["songId1", "songId2", ...],  // New track list
  "current": number,                    // New current track index
  "position": number                    // New playback position
}
```

**Response:**
- 204 No Content on success

**Update Behavior:**
- Only provided fields are updated
- If updating `ids` without `current`, validates existing `current` is still valid
- If updating `current` without `ids`, validates against existing queue
- Position is clamped to >= 0

### DELETE /api/queue
Clear the play queue.

**Response:**
- 204 No Content on success

## Queue Synchronization

### Cross-Device Sync
- Queue is stored per user, not per device
- Changes from any client update the shared queue
- `changedBy` field indicates which client last modified

### Client Implementation
1. **Load queue on startup:**
   ```
   GET /api/queue
   ```

2. **Save queue on changes:**
   ```
   POST /api/queue (full replacement)
   PUT /api/queue (partial update)
   ```

3. **Update position periodically:**
   ```
   PUT /api/queue
   {
     "position": 125000
   }
   ```

4. **Clear when stopping:**
   ```
   DELETE /api/queue
   ```

## Queue Management Patterns

### Adding to Queue
```javascript
// Get current queue
const queue = await fetch('/api/queue')
const current = await queue.json()

// Add tracks
const newIds = [...current.items.map(i => i.id), ...tracksToAdd]

// Update queue
await fetch('/api/queue', {
  method: 'PUT',
  body: JSON.stringify({ ids: newIds })
})
```

### Play Next
```javascript
// Insert after current track
const newIds = [
  ...items.slice(0, current + 1),
  trackToPlayNext,
  ...items.slice(current + 1)
]

await fetch('/api/queue', {
  method: 'PUT',
  body: JSON.stringify({ ids: newIds })
})
```

### Shuffle Queue
```javascript
// Shuffle remaining tracks
const played = items.slice(0, current + 1)
const remaining = items.slice(current + 1)
const shuffled = [...played, ...shuffle(remaining)]

await fetch('/api/queue', {
  method: 'PUT',
  body: JSON.stringify({ ids: shuffled })
})
```

## Error Handling

| Error | Status | Description |
|-------|--------|-------------|
| Invalid current index | 400 | Current index out of bounds |
| Invalid position | 400 | Position is negative |
| Invalid JSON | 400 | Malformed request body |
| Not authenticated | 401 | Missing or invalid auth token |
| Server error | 500 | Database or internal error |

## Best Practices

1. **Minimize Updates**: Use PUT for partial updates instead of POST
2. **Batch Operations**: Update multiple fields in single request
3. **Position Updates**: Limit position updates to every 5-10 seconds
4. **Error Recovery**: Store queue locally and retry on network errors
5. **Queue Limits**: Keep queue size reasonable (< 1000 tracks)