# Last.fm WS 2.0 — Unauthenticated (API-key only) Endpoints Spec

> Scope: This document covers **read-only API methods that do not require user authentication** (no session key or signature). An **API key is still required** for all methods. It focuses on discovery/recommendation (similar artists/tracks), entity metadata, charts, tags, geography, and public user data. ([Last.fm][1])

---

## 0) Base, Transport & Formats

* **Root**: `http://ws.audioscrobbler.com/2.0/`
  Required query params on **all** calls:

  * `method=<package.method>`
  * `api_key=<YOUR_API_KEY>` ([Last.fm][1])
* **HTTP verb**: `GET` for all read methods below. (Write methods use POST + auth; out of scope.) ([Last.fm][1])
* **Response format**:

  * Add `format=json` for JSON, optionally `callback=<fn>` for JSONP.
  * Without `format`, XML is returned and wrapped in `<lfm status="...">…</lfm>`. (You can strip wrapper via `raw=true`.)
  * **JSON error** shape: `{"error": <code>, "message": "<text>"}`. ([Last.fm][1])
* **Common query params** (appear across methods):

  * `limit` (default varies; often 50) and `page` for pagination.
  * `autocorrect` = `0|1` to normalize misspellings (artist/track endpoints).
  * `mbid` to prefer **MusicBrainz ID** instead of names (when available).
  * `lang` (ISO-639-1) where supported (e.g., tag/artist wikis).
    See method sections for exact support.

### Errors (typical codes)

`2,3,4,5,6,7,8,9,10,11,13,16,26,29` — as listed per method pages (e.g., invalid API key = `10`, rate-limited = `29`). ([Last.fm][2])

---

## 1) Terms, Quotas, Branding (Summary)

* **Non-commercial by default**; contact Last.fm for commercial use.
* **Credit + link back** required; follow brand guidelines.
* **Reasonable Usage Cap**: max **100 MB** of Last.fm data stored.
* **Rate limiting**: Last.fm sets/enforces request limits; do not circumvent (contact for higher limits). ([Last.fm][3])

---

## 2) Quickstart

```bash
curl -G 'http://ws.audioscrobbler.com/2.0/' \
  --data-urlencode 'method=artist.getSimilar' \
  --data-urlencode 'artist=Cher' \
  --data-urlencode 'api_key=YOUR_API_KEY' \
  --data-urlencode 'format=json'
```

---

## 3) Recommendation / Similarity

### 3.1 `artist.getSimilar`

**What**: Artists similar to a given artist (with `match` ∈ \[0,1]).
**Params**:

* `artist` *(required unless `mbid`)*, `mbid` *(optional)*
* `limit` *(optional)*, `autocorrect` *(0|1)*, `api_key` *(required)*
  **Auth**: Not required.
  **Notes**: `match` is a normalized similarity score; images/urls often included.
  **Example**:

```
GET /2.0/?method=artist.getsimilar&artist=Cher&limit=100&api_key=...&format=json
```

([Last.fm][4])

### 3.2 `track.getSimilar`

**What**: Tracks similar to a given track (based on listening data).
**Params**:

* `artist`, `track` *(both required unless `mbid`)*; `mbid` *(optional)*
* `limit` *(optional)*, `autocorrect` *(0|1)*, `api_key`
  **Auth**: Not required.
  **Example**:

```
GET /2.0/?method=track.getsimilar&artist=Cher&track=Believe&limit=50&api_key=...&format=json
```

([Last.fm][5])

### 3.3 `tag.getSimilar`

**What**: Tags similar to a given tag (ranked by similarity).
**Params**:

* `tag` *(required)*, `api_key`
  **Auth**: Not required.
  **Example**:

```
GET /2.0/?method=tag.getsimilar&tag=disco&api_key=...&format=json
```

([Last.fm][6])

---

## 4) Search (Discovery)

### 4.1 `artist.search`

**What**: Search artists by free-text name (relevance ranked).
**Params**:

* `artist` *(required)*, `limit`, `page`, `api_key`
  **Auth**: Not required.
  **Example**:

```
GET /2.0/?method=artist.search&artist=cher&limit=30&page=1&api_key=...&format=json
```

**Response**: OpenSearch-style `results` incl. `totalResults`, `startIndex`, `itemsPerPage`, and `artistmatches`. ([Last.fm][7])

### 4.2 `track.search`

**What**: Search tracks by free-text (artist/title query).
**Params**: `track` *(required)*, `limit`, `page`, `api_key`
**Auth**: Not required.
**Example**:

```
GET /2.0/?method=track.search&track=believe&limit=30&api_key=...&format=json
```

### 4.3 `album.search`

**What**: Search albums by free-text.
**Params**: `album` *(required)*, `limit`, `page`, `api_key`
**Auth**: Not required.
**Example**:

```
GET /2.0/?method=album.search&album=Believe&api_key=...&format=json
```

([Last.fm][8])

---

## 5) Entity Metadata (Lookups)

### 5.1 `artist.getInfo`

**What**: Artist metadata (incl. short bio); name or MBID.
**Params**: `artist` or `mbid`; `lang` *(optional wiki language)*; `autocorrect`; `api_key`
**Auth**: Not required.

```
GET /2.0/?method=artist.getinfo&artist=Cher&lang=en&api_key=...&format=json
```

([Last.fm][9])

### 5.2 `album.getInfo`

**What**: Album metadata + tracklist.
**Params**: `artist`+`album`, or `mbid`; `autocorrect`; `api_key`
**Auth**: Not required.

```
GET /2.0/?method=album.getinfo&artist=Cher&album=Believe&api_key=...&format=json
```

([Last.fm][10])

### 5.3 `track.getInfo`

**What**: Track metadata.
**Params**: `artist`+`track`, or `mbid`; `autocorrect`; `api_key`
**Auth**: Not required.

```
GET /2.0/?method=track.getinfo&artist=Cher&track=Believe&api_key=...&format=json
```

([Last.fm][11])

---

## 6) Artist Charts

### 6.1 `artist.getTopTracks`

**What**: An artist’s top tracks (popularity-ordered).
**Params**: `artist` *(or `mbid`)*; `limit`, `page`, `autocorrect`; `api_key`
**Auth**: Not required.

```
GET /2.0/?method=artist.gettoptracks&artist=Cher&limit=50&api_key=...&format=json
```

([Last.fm][2])

### 6.2 `artist.getTopAlbums`

**What**: An artist’s top albums (popularity-ordered).
**Params**: `artist` *(or `mbid`)*; `limit`, `page`, `autocorrect`; `api_key`
**Auth**: Not required.

```
GET /2.0/?method=artist.gettopalbums&artist=Cher&limit=50&api_key=...&format=json
```

([Last.fm][12])

### 6.3 `artist.getTopTags`

**What**: Most frequently applied tags for an artist.
**Params**: `artist` *(or `mbid`)*; `autocorrect`; `api_key`
**Auth**: Not required.

```
GET /2.0/?method=artist.gettoptags&artist=Cher&api_key=...&format=json
```

([Last.fm][2])

---

## 7) Global Charts

### 7.1 `chart.getTopArtists`

**Params**: `limit`, `page`, `api_key`
**Auth**: Not required.

```
GET /2.0/?method=chart.gettopartists&limit=100&page=1&api_key=...&format=json
```

([Last.fm][13])

### 7.2 `chart.getTopTracks`

**Params**: `limit`, `page`, `api_key`
**Auth**: Not required.

```
GET /2.0/?method=chart.gettoptracks&limit=100&page=1&api_key=...&format=json
```

([Last.fm][14])

### 7.3 `chart.getTopTags`

**Params**: `limit`, `page`, `api_key`
**Auth**: Not required.

```
GET /2.0/?method=chart.gettoptags&limit=100&page=1&api_key=...&format=json
```

([Last.fm][13])

---

## 8) Geography (By Country / Metro)

### 8.1 `geo.getTopArtists`

**What**: Most popular artists by **country**.
**Params**: `country` *(ISO-3166-1 country name)*; `limit`, `page`; `api_key`
**Auth**: Not required.

```
GET /2.0/?method=geo.gettopartists&country=Spain&limit=50&api_key=...&format=json
```

([Last.fm][15])

### 8.2 `geo.getTopTracks`

**What**: Most popular tracks by **country** (last week).
**Params**: `country` *(ISO-3166-1)*; optional `location` *(metro within country)*; `limit`, `page`; `api_key`
**Auth**: Not required.

```
GET /2.0/?method=geo.gettoptracks&country=Spain&limit=50&api_key=...&format=json
```

([Last.fm][16])

---

## 9) Tags

### 9.1 `tag.getInfo`

**What**: Tag metadata (includes wiki; supports `lang`).
**Params**: `tag` *(required)*; `lang` *(optional)*; `api_key`
**Auth**: Not required.

```
GET /2.0/?method=tag.getinfo&tag=disco&lang=en&api_key=...&format=json
```

([Last.fm][17])

### 9.2 `tag.getTopArtists`

**What**: Top artists for a tag.
**Params**: `tag`; `limit`, `page`; `api_key`
**Auth**: Not required.

```
GET /2.0/?method=tag.gettopartists&tag=disco&limit=50&api_key=...&format=json
```

([Last.fm][18])

### 9.3 `tag.getTopAlbums`

**What**: Top albums for a tag.
**Params**: `tag`; `limit`, `page`; `api_key`
**Auth**: Not required.

```
GET /2.0/?method=tag.gettopalbums&tag=disco&limit=50&api_key=...&format=json
```

([Last.fm][18])

### 9.4 `tag.getTopTracks`

**What**: Top tracks for a tag.
**Params**: `tag`; `limit`, `page`; `api_key`
**Auth**: Not required.

```
GET /2.0/?method=tag.gettoptracks&tag=disco&limit=50&api_key=...&format=json
```

([Last.fm][19])

### 9.5 `tag.getWeeklyChartList`

**What**: Available weekly charts for a tag.
**Params**: `tag`; `api_key`
**Auth**: Not required.

```
GET /2.0/?method=tag.getweeklychartlist&tag=disco&api_key=...&format=json
```

([Last.fm][18])

---

## 10) Public User Data (No Auth Required)

> These endpoints expose **public** listening data for a **username**; no session is required.

### 10.1 `user.getInfo`

**What**: Public profile info for a user.
**Params**: `user` *(optional; defaults to authenticated user, but you can pass any username when unauthenticated)*; `api_key`
**Example**:

```
GET /2.0/?method=user.getinfo&user=rj&api_key=...&format=json
```

([Last.fm][20])

### 10.2 `user.getRecentTracks`

**What**: Recent scrobbles; supports **time range** and **extended** mode.
**Params**:

* `user` *(required)*, `limit` *(<=200)*, `page`
* `from`, `to` *(UNIX seconds, UTC)*
* `extended` = `0|1` (adds richer artist data + loved flag)
* `api_key`
  **Auth**: Not required.

```
GET /2.0/?method=user.getrecenttracks&user=rj&limit=200&extended=1&from=1714521600&to=1715126400&api_key=...&format=json
```

([Last.fm][21])

### 10.3 `user.getTopArtists`

**What**: User’s top artists for a given **period**.
**Params**: `user` *(required)*; `period` ∈ {`overall`,`7day`,`1month`,`3month`,`6month`,`12month`}; `limit`, `page`; `api_key`
**Auth**: Not required.

```
GET /2.0/?method=user.gettopartists&user=rj&period=3month&limit=50&api_key=...&format=json
```

([Last.fm][22])

> Similar public “top” endpoints also exist for albums/tracks/tags and weekly charts; consult each method page to confirm parameters and defaults (they follow the same `limit/page/period` patterns). ([Last.fm][1])

---

## 11) Canonicalization, IDs & Disambiguation

* Prefer **MBIDs** (`mbid`) to avoid name collisions; otherwise pass `artist`, `album`, or `track` names.
* Use `autocorrect=1` to coerce common misspellings to canonical forms (many artist/track methods support it).
* Some responses include image arrays at multiple sizes and direct **Last.fm URLs** for entities. ([Last.fm][4])

---

## 12) Pagination Pattern

Unless specified otherwise by the method page, collection responses support:

* `limit` (default often **50**) and
* `page` (1-indexed).
  OpenSearch numerics are sometimes included (`totalResults`, `itemsPerPage`, etc.) on search endpoints. ([Last.fm][7])

---

## 13) Practical Recipes

### A) “If you like X, try Y” (artists)

1. Lookup canonical artist, then fetch similars:

```bash
curl -G 'http://ws.audioscrobbler.com/2.0/' \
  --data-urlencode 'method=artist.getInfo' \
  --data-urlencode 'artist=Cher' \
  --data-urlencode 'autocorrect=1' \
  --data-urlencode 'api_key=YOUR_API_KEY' \
  --data-urlencode 'format=json'

curl -G 'http://ws.audioscrobbler.com/2.0/' \
  --data-urlencode 'method=artist.getSimilar' \
  --data-urlencode 'artist=Cher' \
  --data-urlencode 'limit=100' \
  --data-urlencode 'api_key=YOUR_API_KEY' \
  --data-urlencode 'format=json'
```

([Last.fm][9])

### B) “Songs like this one”

```bash
curl -G 'http://ws.audioscrobbler.com/2.0/' \
  --data-urlencode 'method=track.getSimilar' \
  --data-urlencode 'artist=Cher' \
  --data-urlencode 'track=Believe' \
  --data-urlencode 'limit=50' \
  --data-urlencode 'api_key=YOUR_API_KEY' \
  --data-urlencode 'format=json'
```

([Last.fm][5])

### C) “Top tracks tagged #disco”

```bash
curl -G 'http://ws.audioscrobbler.com/2.0/' \
  --data-urlencode 'method=tag.getTopTracks' \
  --data-urlencode 'tag=disco' \
  --data-urlencode 'limit=50' \
  --data-urlencode 'api_key=YOUR_API_KEY' \
  --data-urlencode 'format=json'
```

([Last.fm][19])

### D) “What’s popular globally or by country”

```bash
# Global top artists
curl -G 'http://ws.audioscrobbler.com/2.0/' \
  --data-urlencode 'method=chart.getTopArtists' \
  --data-urlencode 'limit=100' \
  --data-urlencode 'api_key=YOUR_API_KEY' \
  --data-urlencode 'format=json'

# Country top tracks (last week)
curl -G 'http://ws.audioscrobbler.com/2.0/' \
  --data-urlencode 'method=geo.getTopTracks' \
  --data-urlencode 'country=Spain' \
  --data-urlencode 'limit=100' \
  --data-urlencode 'api_key=YOUR_API_KEY' \
  --data-urlencode 'format=json'
```

([Last.fm][13])

### E) “Recent scrobbles for a user (with time window)”

```bash
curl -G 'http://ws.audioscrobbler.com/2.0/' \
  --data-urlencode 'method=user.getRecentTracks' \
  --data-urlencode 'user=rj' \
  --data-urlencode 'from=1714521600' \
  --data-urlencode 'to=1715126400' \
  --data-urlencode 'extended=1' \
  --data-urlencode 'limit=200' \
  --data-urlencode 'api_key=YOUR_API_KEY' \
  --data-urlencode 'format=json'
```

([Last.fm][21])

---

## 14) Response Shape Hints (JSON)

> Shapes mirror the XML and vary by method; below are **representative** (trimmed) structures.

```jsonc
// artist.getSimilar
{
  "similarartists": {
    "artist": [
      {
        "name": "Sonny & Cher",
        "mbid": "3d6e4b6d-...",
        "match": "1",
        "url": "https://www.last.fm/music/Sonny+%26+Cher",
        "image": [{ "#text": "...", "size": "small" }, ...]
      }
    ],
    "@attr": { "artist": "Cher" }
  }
}
```

([Last.fm][4])

```jsonc
// track.getSimilar
{
  "similartracks": {
    "track": [
      {
        "name": "Ray of Light",
        "match": "10.95",
        "url": "https://www.last.fm/music/Madonna/_/Ray+of+Light",
        "artist": { "name": "Madonna", "mbid": "79239441-..." },
        "image": [...]
      }
    ],
    "@attr": { "artist": "Cher", "track": "Believe" }
  }
}
```

([Last.fm][5])

```jsonc
// user.getRecentTracks (extended=1 may add per-item flags/objects)
{
  "recenttracks": {
    "@attr": { "user":"RJ", "page":"1", "perPage":"200", "totalPages":"..." },
    "track": [
      {
        "artist": { "#text": "Aretha Franklin", "mbid": "2f9ecbed-..." },
        "name": "Sisters Are Doing It For Themselves",
        "date": { "uts": "1213031819", "#text": "9 Jun 2008, 17:16" },
        "loved": "0",
        "nowplaying": "true"
      }
    ]
  }
}
```

([Last.fm][21])

---

## 15) Production Notes & Gotchas

* **Name vs MBID**: Prefer `mbid` to avoid collisions; otherwise set `autocorrect=1` to normalize. ([Last.fm][2])
* **Time ranges**: When provided (e.g., `user.getRecentTracks`), **UNIX seconds, UTC**. ([Last.fm][21])
* **Pagination defaults**: Most “top” lists default to `limit=50`. Search often defaults to `20–30`. Always pass explicit `limit`/`page` when paginating. ([Last.fm][2])
* **Branding/links**: If you show Last.fm data publicly, **credit + link** back to the entity page(s). ([Last.fm][3])
* **Storage cap**: Cache responsibly and respect the **100 MB** storage cap unless explicitly approved. ([Last.fm][3])
* **Rate limits**: Expect throttling; implement backoff & caching. ([Last.fm][3])

---

## 16) Index of Unauthenticated Methods (covered above)

* **Similarity**: `artist.getSimilar`, `track.getSimilar`, `tag.getSimilar` ([Last.fm][4])
* **Search**: `artist.search`, `track.search`, `album.search` ([Last.fm][7])
* **Lookups**: `artist.getInfo`, `album.getInfo`, `track.getInfo` ([Last.fm][9])
* **Artist charts**: `artist.getTopTracks`, `artist.getTopAlbums`, `artist.getTopTags` ([Last.fm][2])
* **Global charts**: `chart.getTopArtists`, `chart.getTopTracks`, `chart.getTopTags` ([Last.fm][13])
* **Geo charts**: `geo.getTopArtists`, `geo.getTopTracks` ([Last.fm][15])
* **Tags**: `tag.getInfo`, `tag.getTopArtists`, `tag.getTopAlbums`, `tag.getTopTracks`, `tag.getWeeklyChartList` ([Last.fm][17])
* **Public user**: `user.getInfo`, `user.getRecentTracks`, `user.getTopArtists` (others similar) ([Last.fm][20])

---

## 17) Test Matrix (suggested)

| Area       | Minimal sanity check                                                            |
| ---------- | ------------------------------------------------------------------------------- |
| Similarity | Given `artist=A`, results list non-A artists with `match∈(0,1]`.                |
| Search     | For a unique string, top result contains that string in `name`.                 |
| Info       | `getInfo` with `mbid` returns same entity as name+`autocorrect=1`.              |
| Charts     | Paged queries change `page`/`@attr.page` monotonically; stable totals.          |
| User       | `getRecentTracks` with `extended=1` includes loved flag & richer artist object. |

---

### Appendix: Example Error Handling

```http
HTTP/1.1 200
Content-Type: application/json

{"error":10,"message":"Invalid API Key"}
```

* Treat any non-zero `error` as failure; implement **retry with jitter** for transient codes like `16`; halt on auth/limits (`10`, `29`). ([Last.fm][1])

---

*References*: Official Last.fm API docs for REST usage, individual method pages (each page states “This service does not require authentication” for the methods included), and API Terms of Service (rate limits, usage cap, attribution). ([Last.fm][1])

---

If you want, I can also generate a **typed client** (Go/TypeScript) around just these unauthenticated endpoints with paging helpers and backoff baked in.

[1]: https://www.last.fm/api/rest "API Docs | Last.fm"
[2]: https://www.last.fm/api/show/artist.getTopTracks "API Docs | Last.fm"
[3]: https://www.last.fm/api/tos "API Terms of Service | Last.fm"
[4]: https://www.last.fm/api/show/artist.getSimilar "API Docs | Last.fm"
[5]: https://www.last.fm/api/show/track.getSimilar "API Docs | Last.fm"
[6]: https://www.last.fm/api/show/tag.getSimilar "API Docs | Last.fm"
[7]: https://www.last.fm/api/show/artist.search "API Docs | Last.fm"
[8]: https://www.last.fm/api/show/user.getInfo "API Docs | Last.fm"
[9]: https://www.last.fm/api/show/artist.getInfo "API Docs | Last.fm"
[10]: https://www.last.fm/api/show/album.getInfo?utm_source=chatgpt.com "album.getInfo"
[11]: https://www.last.fm/api/show/track.getInfo?utm_source=chatgpt.com "track.getInfo - API Docs"
[12]: https://www.last.fm/api/show/artist.getTopAlbums "API Docs | Last.fm"
[13]: https://www.last.fm/api/show/chart.getTopArtists "API Docs | Last.fm"
[14]: https://www.last.fm/api/show/chart.getTopTracks?utm_source=chatgpt.com "chart.getTopTracks"
[15]: https://www.last.fm/api/show/geo.getTopArtists "API Docs | Last.fm"
[16]: https://www.last.fm/api/show/geo.getTopTracks "API Docs | Last.fm"
[17]: https://www.last.fm/api/show/tag.getInfo?utm_source=chatgpt.com "tag.getInfo"
[18]: https://www.last.fm/api/show/tag.getTopAlbums "API Docs | Last.fm"
[19]: https://www.last.fm/api/show/tag.getTopTracks "API Docs | Last.fm"
[20]: https://www.last.fm/api/show/user.getInfo?utm_source=chatgpt.com "user.getInfo"
[21]: https://www.last.fm/api/show/user.getRecentTracks "API Docs | Last.fm"
[22]: https://www.last.fm/api/show/user.getTopArtists "API Docs | Last.fm"
