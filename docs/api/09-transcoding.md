# Transcoding API

## Overview
Manage audio transcoding configurations for converting between audio formats and qualities. Transcoding is used for streaming optimization.

**Note**: Transcoding management may be admin-only or disabled based on server configuration.

## Base URL: `/api/transcoding`

### GET /api/transcoding
List all available transcoding configurations.

**Response (200 OK):**
```json
[
  {
    "id": "string",
    "name": "string",           // Human-readable name
    "targetFormat": "string",   // Output format (mp3, opus, aac, etc.)
    "command": "string",        // FFmpeg command template
    "defaultBitRate": number    // Default bitrate in kbps
  }
]
```

### GET /api/transcoding/{id}
Get a specific transcoding configuration.

**Response (200 OK):**
Single transcoding configuration object

### POST /api/transcoding
Create a new transcoding configuration (admin-only).

**Request Body:**
```json
{
  "name": "string (required)",
  "targetFormat": "string (required)",
  "command": "string (required)",
  "defaultBitRate": number
}
```

**Response (201 Created):**
Created transcoding configuration

### PUT /api/transcoding/{id}
Update a transcoding configuration (admin-only).

**Request Body:**
```json
{
  "name": "string",
  "targetFormat": "string",
  "command": "string",
  "defaultBitRate": number
}
```

**Response (200 OK):**
Updated configuration

### DELETE /api/transcoding/{id}
Delete a transcoding configuration (admin-only).

**Response (200 OK):**
```json
{
  "id": "string"
}
```

## Command Templates

FFmpeg commands use placeholder variables:

| Placeholder | Description | Example |
|-------------|-------------|---------|
| `%s` | Input file path | `/music/song.flac` |
| `%t` | Start time offset | `30` (seconds) |
| `%bk` | Target bitrate | `192` |
| `%b` | Target bitrate (no 'k') | `192` |

### Example Commands

**MP3 Transcoding:**
```bash
ffmpeg -i %s -ss %t -map 0:a:0 -b:a %bk -v 0 -f mp3 -
```

**AAC Transcoding:**
```bash
ffmpeg -i %s -ss %t -map 0:a:0 -b:a %bk -v 0 -c:a aac -f adts -
```

**Opus Transcoding:**
```bash
ffmpeg -i %s -ss %t -map 0:a:0 -b:a %bk -v 0 -c:a libopus -f opus -
```

**High-Quality MP3:**
```bash
ffmpeg -i %s -ss %t -map 0:a:0 -q:a 0 -v 0 -f mp3 -
```

## Supported Formats

### Input Formats
Navidrome supports transcoding from:
- FLAC
- ALAC
- WAV
- AIFF
- MP3
- AAC
- OGG
- Opus
- WMA
- And many others (FFmpeg-dependent)

### Output Formats
Common target formats:
- **MP3**: Universal compatibility
- **AAC**: Good compression, iOS/macOS native
- **Opus**: Best compression ratio
- **OGG**: Open standard
- **WAV**: Uncompressed (rarely used for streaming)

## Usage in Streaming

### Player Configuration
Players can request transcoding by setting:
- `maxBitRate`: Maximum acceptable bitrate
- `format`: Preferred output format
- `transcoding`: Enable/disable transcoding

### Automatic Selection
Server selects transcoding based on:
1. Original file format/bitrate
2. Player's max bitrate setting
3. Available transcoding profiles
4. Network conditions (if configured)

### Stream URLs
Transcoded streams use format:
```
/stream/{songId}?format={format}&maxBitRate={bitrate}
```

## Performance Considerations

### CPU Usage
- Transcoding is CPU-intensive
- Real-time encoding required for streaming
- Consider server capacity when adding profiles

### Caching
- Some servers cache transcoded segments
- First-time transcoding may have delay
- Popular songs may be pre-transcoded

### Quality vs Size
| Format | Quality | Size | CPU Load |
|--------|---------|------|----------|
| WAV | Perfect | Huge | None |
| FLAC | Perfect | Large | Low |
| MP3 320k | Excellent | Medium | Medium |
| AAC 256k | Excellent | Small | Medium |
| Opus 128k | Very Good | Tiny | High |

## Configuration Requirements

### Server Setup
Transcoding requires:
- FFmpeg installed and accessible
- Sufficient CPU resources
- Transcoding enabled in configuration

### FFmpeg Dependencies
Common codec requirements:
```bash
# For MP3
apt-get install libmp3lame

# For AAC  
apt-get install libfdk-aac

# For Opus
apt-get install libopus
```

### Security Considerations
- Command templates executed as shell commands
- Validate commands before saving
- Restrict access to admin users only
- Consider sandboxing FFmpeg execution

## Troubleshooting

### Common Issues
1. **FFmpeg not found**: Check PATH and installation
2. **Codec missing**: Install required codec libraries
3. **High CPU usage**: Reduce concurrent transcodings
4. **Playback stuttering**: Increase buffer sizes

### Testing Commands
Verify FFmpeg commands manually:
```bash
# Test MP3 transcoding
ffmpeg -i input.flac -b:a 192k -f mp3 output.mp3

# Test with time offset
ffmpeg -i input.flac -ss 30 -b:a 192k -f mp3 output.mp3
```