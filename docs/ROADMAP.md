## Development Roadmap

### 🚀 Next Priority Features (High Value for LLMs)

#### ✅ User Preferences & Ratings (COMPLETED)

* [x] **Star/Favorite Management**: `star_item`, `unstar_item` for songs, albums, and artists
* [x] **List Favorites**: `list_starred_items` for songs, albums, and artists
* [x] **Rating System**: `set_rating` for songs, albums, and artists (0-5 stars)
* [x] **Top Rated Content**: `list_top_rated` with customizable minimum rating

*Perfect for voice commands: "Star this song", "Rate this album 5 stars", "Show my favorite artists"*

#### ✅ Playback Queue Management (COMPLETED)

* [x] **Saved Queue Operations**: `get_saved_queue`, `save_queue`, `clear_saved_queue` (Navidrome cross-device sync, not live playback)
* [x] **Queue Control**: Add specific songs to queue with position control
* [x] **Queue Status**: Real-time queue state with track information

*Essential for: "Add to queue", "Clear the queue", "Show current queue"*

#### ✅ Listening History & Analytics (COMPLETED)

* [x] **Recently Played**: `list_recently_played` with time filtering (today/week/month/all)
* [x] **Listening Stats**: `list_most_played` for songs, albums, and artists
* [x] **Play Statistics**: Track play counts and listening patterns

*Great for: "What did I listen to yesterday?", "Show my most played tracks this month"*

#### ✅ Music Discovery & Recommendations (Last.fm Integration) (COMPLETED)

* [x] **Similar Artists**: `get_similar_artists` with match scores and metadata
* [x] **Similar Tracks**: `get_similar_tracks` with artist and match information
* [x] **Discovery Features**: `get_top_tracks_by_artist`, `get_trending_music`
* [x] **Artist Information**: `get_artist_info` with biography, tags, and statistics

*Powerful discovery: "Find artists similar to Radiohead", "Get trending music", "Tell me about this artist"*

### 🎯 Medium Priority Features

#### ✅ Internet Radio Integration (COMPLETED)

* [x] **Radio Management**: `list_radio_stations`, `create_radio_station`, `delete_radio_station`
* [x] **Radio Playback**: `play_radio_station`, `get_current_radio_info`
* [x] **Radio Details**: `get_radio_station` for detailed station information

*Voice-friendly: "Play jazz radio", "Add this station to my radios", "List my radio stations"*

#### ✅ Advanced Tag Operations (COMPLETED - Read-Only)

* [x] **Tag Management**: `list_tags`, `get_tag` for browsing all metadata tags
* [x] **Tag Search**: `search_by_tags` for finding songs by composer, label, genre, etc.
* [x] **Tag Analysis**: `get_tag_distribution`, `list_unique_tags` for library metadata insights
* [x] **Rich Metadata**: Support for 20+ tag types (genre, composer, conductor, label, catalog, MusicBrainz IDs, etc.)
* [x] **Client-Side Filtering**: Workaround for broken server-side filtering in Navidrome API

*Advanced queries: "Show me all Bach compositions", "Find jazz from Blue Note Records", "What are my most common genres?"*

**⚠️ Note**: Tag modification operations (POST/PUT/DELETE) are documented in Navidrome API but not implemented in version 0.58.0. These return `405 Method Not Allowed`. Tag changes must be made through external metadata editors like Mp3tag or MusicBrainz Picard, followed by library rescanning.

#### 🔗 Content Sharing (Not Yet Implemented in Navidrome)

**⚠️ Note**: Sharing endpoints return `501 Not Implemented` with message "This endpoint is not implemented, but may be in future releases" (tested on Navidrome 0.58.0).

* [ ] **Share Management**: `create_share`, `list_my_shares`, `delete_share`
* [ ] **Quick Sharing**: `share_playlist`, `share_album`, `share_song`
* [ ] **Share Settings**: `set_share_expiry`, `toggle_share_downloads`

*Social features: "Share this playlist publicly", "Create a download link for this album"*

#### 👤 Multi-Device Support (Future?)

* [ ] **Player Management**: `list_players`, `register_player`, `update_player_settings`
* [ ] **Device Control**: `set_active_player`, `sync_across_devices`

### 🗂️ File System Access Features (Future?)

*These require local file system access and may be implemented at some point if requested:*

#### 📁 Smart Playlists

* [ ] **Smart Playlist Management**: `create_smart_playlist`, `update_smart_playlist_rules`
* [ ] **Smart Playlist Operations**: `refresh_smart_playlist`, `list_smart_playlists`
* [ ] **Rule Builder**: `validate_smart_playlist_rules`, `preview_smart_playlist`

#### 📥 Import/Export

* [ ] **M3U Operations**: `import_m3u_playlist`, `export_playlist_as_m3u`
* [ ] **Playlist Sync**: `import_from_spotify`, `export_to_streaming_service`

### ❌ Features Not Planned

*These are not suitable for LLM integration:*

* Admin features (user management, server configuration)
* Direct streaming URLs
* Transcoding controls (technical server settings)
