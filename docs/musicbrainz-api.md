# MusicBrainz API (Web Service v2) — Developer Reference

A working reference for the MusicBrainz XML/JSON Web Service v2, compiled for use
during development. Covers the base URL, the three request types (lookup, browse,
search), all entities and their `inc` subqueries, browseable links, search fields
per entity, data submission, and the operational rules (rate limiting, User-Agent,
auth) you must respect.

> **Source & license:** Adapted from the official MusicBrainz documentation
> ([MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API) and
> [MusicBrainz API/Search](https://musicbrainz.org/doc/MusicBrainz_API/Search)),
> which is published under
> [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/).
> Always cross-check against the live docs before relying on edge-case behavior.

---

## 1. Base URL & conventions

```
https://musicbrainz.org/ws/2/
```

- All endpoints are under `/ws/2/`.
- Default response format is **XML**. Request JSON with `?fmt=json` or an
  `Accept: application/json` header.
- MBIDs are 36-char UUIDs. Always validate/format them before use.
- HTTPS only for authenticated calls; HTTPS recommended for everything.

### Operational rules (must follow)

| Rule | Detail |
|---|---|
| **Rate limit** | No more than **1 request per second** per client application. Exceeding this can get your IP **blocked**. Throttle/queue your requests. |
| **User-Agent** | A meaningful `User-Agent` header is **required** (e.g. `MyApp/1.0 (contact@example.com)`). Generic/default agents may be blocked. No API key is currently required. |
| **Mirror** | For heavy use, run a local mirror or use a higher-limit mirror rather than hammering the main server. |

### Authentication

Required for: data submission (tags, ratings, ISRCs, barcodes, collections),
user-specific info, and private collection access.

- **OAuth 2.0** (recommended), or
- **HTTP Digest authentication** over HTTPS using musicbrainz.org credentials.

---

## 2. Core entities

These 13 entity types support lookup/browse/search:

`area`, `artist`, `event`, `genre`, `instrument`, `label`, `place`,
`recording`, `release`, `release-group`, `series`, `work`, `url`

Non-core resources: `rating`, `tag`, `collection`.

Identifier-based lookups (not MBID): `discid`, `isrc`, `iswc`.

---

## 3. Request type: LOOKUP

Fetch a single entity by its MBID (or by a unique identifier).

```
GET /ws/2/<ENTITY_TYPE>/<MBID>?inc=<INC1>+<INC2>&fmt=json
```

Examples:

```
GET /ws/2/artist/5b11f4ce-a62d-471e-81fc-a69a8278c7da?inc=release-groups&fmt=json
GET /ws/2/release/<MBID>?inc=recordings+artist-credits+labels&fmt=json
```

### Identifier lookups

| Identifier | Endpoint | Notes |
|---|---|---|
| Disc ID | `GET /ws/2/discid/<discid>` | Use `?toc=<toc>` for fuzzy TOC matching; `&cdstubs=no` to skip CD stubs; `&media-format=all` for all formats. |
| ISRC | `GET /ws/2/isrc/<isrc>` | Returns recordings carrying that ISRC. |
| ISWC | `GET /ws/2/iswc/<iswc>` | Returns works carrying that ISWC. |
| URL | `GET /ws/2/url?resource=<URL>` | Direct lookup by resource URL. Accepts multiple `resource=` params (up to 100); URL-escape each. |

### Genre (special)

```
GET /ws/2/genre/all?limit=<LIMIT>&offset=<OFFSET>          # paginated, alphabetical
GET /ws/2/genre/all?fmt=txt                                # newline-separated names (txt only here)
```

---

## 4. Request type: BROWSE

List all entities **directly linked** to one other entity. Supports paging via
`limit`/`offset`. Not available for `genre`. Browse is the way to page past the
**25-item cap** that lookup `inc` subqueries return.

```
GET /ws/2/<RESULT_ENTITY>?<LINKED_ENTITY>=<MBID>&limit=<LIMIT>&offset=<OFFSET>&inc=<INC>&fmt=json
```

Example — all release-groups for an artist, 100 at a time:

```
GET /ws/2/release-group?artist=<MBID>&type=album&limit=100&offset=0&fmt=json
```

### Browse link map (result entity → which linked entities you may browse by)

| Result entity | Browseable by |
|---|---|
| `area` | collection |
| `artist` | area, collection, recording, release, release-group, work |
| `collection` | area, artist, editor, event, label, place, recording, release, release-group, work |
| `event` | area, artist, collection, place |
| `instrument` | collection |
| `label` | area, collection, release |
| `place` | area, collection |
| `recording` | artist, collection, release, work |
| `release` | area, artist, collection, label, track, track_artist, recording, release-group |
| `release-group` | artist, collection, release |
| `series` | collection |
| `work` | artist, collection |

Browse-only filters:

- `release` / `release-group`: `type=<primary/secondary>` and `status=<status>`.
- Collections by user: `editor=<username>`.

---

## 5. `inc` subqueries (lookup & browse)

Combine multiple with `+` (or space). Availability depends on entity.

### Entity-specific relationships (which sub-entities you can pull in)

| Entity | Available `inc` (entity data) |
|---|---|
| `artist` | recordings, releases, release-groups, works |
| `label` | releases |
| `recording` | releases, release-groups |
| `release` | artists, collections, labels, recordings, release-groups |
| `release-group` | releases |

### Common misc `inc` (most entities)

`aliases`, `annotation`, `tags`, `ratings`, `user-tags`, `user-ratings`,
`genres`, `user-genres`

### Relationship `inc` (all entities except `genre`)

`area-rels`, `artist-rels`, `event-rels`, `instrument-rels`, `label-rels`,
`place-rels`, `recording-rels`, `release-rels`, `release-group-rels`,
`series-rels`, `url-rels`, `work-rels`

### Sub-relationship / detail `inc`

| `inc` value | Effect |
|---|---|
| `discids` | Disc IDs for each release medium. |
| `media` | Medium details (track count, format, position). |
| `isrcs` | ISRC codes on recordings. |
| `artist-credits` | Artist credits on results. |
| `various-artists` | (artist browse on releases) include releases where the artist appears on tracks but isn't the release artist. |
| `recording-level-rels` | Pull recording-level relationships (when browsing releases). |
| `release-group-level-rels` | Pull release-group-level relationships. |
| `work-level-rels` | Pull work-level relationships. |

---

## 6. Request type: SEARCH

The only request type that needs no MBID. Uses a Lucene/Solr query syntax.

```
GET /ws/2/<ENTITY_TYPE>?query=<LUCENE_QUERY>&limit=<1-100>&offset=<N>&fmt=json
```

### Query parameters

| Param | Meaning |
|---|---|
| `query` | Lucene query string (URL-encode it). |
| `limit` | 1–100, default 25. |
| `offset` | Pagination offset. |
| `fmt` | `xml` (default) or `json`. |
| `dismax` | `true` switches the parser from edismax to dismax, which auto-escapes special characters (easier for naive user input). |
| `version` | MMD schema version (default 2). |

### Query syntax notes

- Full Lucene: `AND`, `OR`, `NOT`, grouping `()`, phrases `"..."`, wildcards `*`/`?`,
  fuzzy `~`, boosting `^`, ranges `[a TO b]`.
- Field search: `field:value` (e.g. `artist:Radiohead AND type:group`).
- Null/unknown: `-field:*` matches entities where the field is empty.
- Escape Lucene special characters: `+ - && || ! ( ) { } [ ] ^ " ~ * ? : \ /`
  (or pass `dismax=true` to escape for you).

### Searchable entity types

`annotation`, `area`, `artist`, `cdstub`, `event`, `instrument`, `label`,
`place`, `recording`, `release`, `release-group`, `series`, `tag`, `work`, `url`

---

## 7. Search fields by entity

Fields marked **(default)** are searched when no field qualifier is given.
"diacritics ignored" fields have an `…accent` twin that matches the exact diacritics.

### annotation
| Field | Meaning |
|---|---|
| `entity` | MBID of the annotated entity |
| `id` | numeric annotation ID |
| `name` *(default)* | name/title of the annotated entity |
| `text` *(default)* | annotation body text |
| `type` *(default)* | type of the annotated entity |

### area
| Field | Meaning |
|---|---|
| `aid` | area MBID |
| `alias` | any attached alias (diacritics ignored) |
| `area` *(default)* | area name (diacritics ignored) |
| `areaaccent` | area name with diacritics |
| `begin` | begin date |
| `comment` | disambiguation comment |
| `end` | end date |
| `ended` | boolean — has ended |
| `iso` | ISO 3166-1/-2/-3 code |
| `iso1` / `iso2` / `iso3` | specific ISO code version |
| `sortname` | sort name (equivalent to name) |
| `tag` | attached tag |
| `type` | area type |

### artist
| Field | Meaning |
|---|---|
| `alias` *(default)* | attached alias (diacritics ignored) |
| `primary_alias` | primary aliases |
| `area` | main associated area name |
| `arid` | artist MBID |
| `artist` *(default)* | artist name (diacritics ignored) |
| `artistaccent` | artist name with diacritics |
| `begin` | begin date |
| `beginarea` | begin-area name |
| `comment` | disambiguation comment |
| `country` | 2-letter ISO 3166-1 country code |
| `end` | end date |
| `endarea` | end-area name |
| `ended` | boolean — has ended |
| `gender` | male / female / other / not applicable |
| `ipi` | IPI code |
| `isni` | ISNI code |
| `sortname` *(default)* | sort name |
| `tag` | attached tag |
| `type` | artist type (person, group, …) |

### cdstub
| Field | Meaning |
|---|---|
| `added` | date the CD stub was added |
| `artist` *(default)* | artist name on the stub |
| `barcode` | barcode |
| `comment` | comment |
| `discid` | Disc ID |
| `title` *(default)* | release title |
| `tracks` | number of tracks |

### event
| Field | Meaning |
|---|---|
| `alias` *(default)* | attached alias (diacritics ignored) |
| `aid` | related area MBID |
| `area` | related area name |
| `arid` | related artist MBID |
| `artist` *(default)* | related artist name |
| `begin` | begin date |
| `comment` | disambiguation comment |
| `end` | end date |
| `ended` | boolean — has ended |
| `eid` | event MBID |
| `event` *(default)* | event name (diacritics ignored) |
| `eventaccent` | event name with diacritics |
| `pid` | related place MBID |
| `place` | related place name |
| `tag` | attached tag |
| `type` | event type |

### instrument
| Field | Meaning |
|---|---|
| `alias` *(default)* | attached alias (diacritics ignored) |
| `comment` | disambiguation comment |
| `description` *(default)* | English description |
| `iid` | instrument MBID |
| `instrument` *(default)* | instrument name (diacritics ignored) |
| `instrumentaccent` | instrument name with diacritics |
| `tag` | attached tag |
| `type` | instrument type |

### label
| Field | Meaning |
|---|---|
| `alias` *(default)* | attached alias (diacritics ignored) |
| `area` | main associated area name |
| `begin` | begin date |
| `code` | label code (numbers only) |
| `comment` | disambiguation comment |
| `country` | 2-letter ISO country code |
| `end` | end date |
| `ended` | boolean — has ended |
| `ipi` | IPI code |
| `isni` | ISNI code |
| `label` *(default)* | label name (diacritics ignored) |
| `labelaccent` | label name with diacritics |
| `laid` | label MBID |
| `release_count` | number of related releases |
| `sortname` | sort name (equivalent to name) |
| `tag` | attached tag |
| `type` | label type |

### place
| Field | Meaning |
|---|---|
| `address` *(default)* | physical address |
| `alias` *(default)* | attached alias (diacritics ignored) |
| `area` *(default)* | associated area name |
| `begin` | begin date |
| `comment` | disambiguation comment |
| `end` | end date |
| `ended` | boolean — has ended |
| `lat` | WGS 84 latitude |
| `long` | WGS 84 longitude |
| `place` *(default)* | place name (diacritics ignored) |
| `placeaccent` | place name with diacritics |
| `pid` | place MBID |
| `type` | place type |

### recording
| Field | Meaning |
|---|---|
| `alias` | attached alias (diacritics ignored) |
| `arid` | recording-artist MBID |
| `artist` | combined credited artist name |
| `artistname` | any single recording-artist name |
| `comment` | disambiguation comment |
| `country` | 2-letter ISO release-country code |
| `creditname` | credited artist name |
| `date` | release date |
| `dur` | duration in milliseconds |
| `firstreleasedate` | earliest release date |
| `format` | medium format |
| `isrc` | ISRC code |
| `number` | track number (free text) |
| `position` | medium position |
| `primarytype` | release-group primary type |
| `qdur` | quantized duration (ms / 2000) |
| `recording` *(default)* | recording name (diacritics ignored) |
| `recordingaccent` | recording name with diacritics |
| `reid` | release MBID |
| `release` | release name |
| `rgid` | release-group MBID |
| `rid` | recording MBID |
| `secondarytype` | release-group secondary type |
| `status` | release status |
| `tag` | attached tag |
| `tid` | track MBID |
| `tnum` | track position |
| `tracks` | tracks on the medium |
| `tracksrelease` | total tracks on the release |
| `type` | legacy release-group type |
| `video` | boolean — is a video |

### release
| Field | Meaning |
|---|---|
| `alias` | attached alias (diacritics ignored) |
| `arid` | artist MBID |
| `artist` | combined credited artist name |
| `artistname` | any single artist name |
| `asin` | Amazon ASIN |
| `barcode` | barcode |
| `catno` | catalog number |
| `comment` | disambiguation comment |
| `country` | 2-letter ISO country code |
| `creditname` | credited artist name |
| `date` | release date |
| `discids` | total disc-ID count |
| `discidsmedium` | disc-IDs per medium |
| `format` | medium format |
| `laid` | label MBID |
| `label` | label name |
| `lang` | ISO 639-3 language code |
| `mediumid` | medium MBID |
| `mediums` | number of mediums |
| `packaging` | packaging format |
| `primarytype` | release-group primary type |
| `quality` | data quality (2=high, 1=normal) |
| `reid` | release MBID |
| `release` *(default)* | release title (diacritics ignored) |
| `releaseaccent` *(default)* | release title with diacritics |
| `releasegroup` | release-group title |
| `releasegroupaccent` | release-group title with diacritics |
| `rgid` | release-group MBID |
| `secondarytype` | release-group secondary type |
| `status` | release status |
| `tag` | attached tag |
| `type` | legacy type field |

### release-group
| Field | Meaning |
|---|---|
| `alias` | attached alias (diacritics ignored) |
| `arid` | artist MBID |
| `artist` | combined credited artist name |
| `artistname` | any single artist name |
| `comment` | disambiguation comment |
| `creditname` | credited artist name |
| `firstreleasedate` | earliest release date |
| `primarytype` | primary type |
| `reid` | release MBID |
| `release` | release title |
| `releasegroup` *(default)* | release-group title (diacritics ignored) |
| `releasegroupaccent` | release-group title with diacritics |
| `releases` | number of releases |
| `rgid` | release-group MBID |
| `secondarytype` | secondary type |
| `status` | release status |
| `tag` | attached tag |
| `type` | legacy type field |

### series
| Field | Meaning |
|---|---|
| `alias` *(default)* | attached alias (diacritics ignored) |
| `comment` | disambiguation comment |
| `series` *(default)* | series name (diacritics ignored) |
| `seriesaccent` | series name with diacritics |
| `sid` | series MBID |
| `tag` | attached tag |
| `type` | series type |

### tag
| Field | Meaning |
|---|---|
| `tag` *(default)* | (part of) a tag |

### work
| Field | Meaning |
|---|---|
| `alias` *(default)* | attached alias (diacritics ignored) |
| `arid` | MBID of any work artist |
| `artist` | combined credited artist name |
| `artistname` | name of any work artist |
| `comment` | disambiguation comment |
| `creditname` | credited name of any work artist |
| `iswc` | any attached ISWC |
| `lang` | ISO 639-3 work-language code |
| `tag` | attached tag |
| `type` | work type |
| `work` *(default)* | work name (diacritics ignored) |
| `workaccent` | work name with diacritics |
| `wid` | work MBID |

### url
| Field | Meaning |
|---|---|
| `resource` *(default)* | (part of) the URL's resource |
| `url` | the URL itself |

---

## 8. Controlled vocabularies

### Release status
`official`, `promotion`, `bootleg`, `pseudo-release`, `withdrawn`, `cancelled`

### Release-group primary types
`album`, `single`, `ep`, `broadcast`, `other`

### Release-group secondary types
`audio drama`, `audiobook`, `compilation`, `demo`, `dj-mix`, `field recording`,
`interview`, `live`, `mixtape/street`, `remix`, `soundtrack`, `spokenword`

### Artist gender
`male`, `female`, `other`, `not applicable`

---

## 9. Data submission (write API — XML only)

All POST submissions require a `client=<application-version>` parameter and
authentication.

| Operation | Endpoint |
|---|---|
| Submit tags/genres | `POST /ws/2/tag?client=<client>` (body: `user-tag-list`; attrs: `upvote`, `downvote`, `withdraw`) |
| Submit ratings (0–100) | `POST /ws/2/rating?client=<client>` |
| Submit barcodes (GTIN/EAN/UPC) | `POST /ws/2/release/?client=<client>` |
| Submit ISRCs | `POST /ws/2/recording/?client=<client>` |
| Add to collection | `PUT /ws/2/collection/<gid>/<entities>` |
| Remove from collection | `DELETE /ws/2/collection/<gid>/<entities>` |

---

## 10. Pagination cheatsheet

- **Lookup `inc` subqueries cap linked results at 25.** To get more, switch to a
  **browse** request with `limit`/`offset`.
- **Browse** is the only request type that returns a total count for paging.
- `limit` max is **100** for most entities (search and browse).
- Increment `offset` by the **number of results actually returned**, not by a fixed
  `limit`, to avoid gaps/overlaps.
- Releases cap at roughly **500 total tracks** per response page.

---

## 11. Quick recipes

```bash
# Search artists named "Portishead" (JSON)
curl -s -A "MyApp/1.0 (me@example.com)" \
  "https://musicbrainz.org/ws/2/artist?query=artist:Portishead&fmt=json"

# Lookup a release with recordings + artist credits + labels
curl -s -A "MyApp/1.0 (me@example.com)" \
  "https://musicbrainz.org/ws/2/release/<MBID>?inc=recordings+artist-credits+labels&fmt=json"

# Browse all albums for an artist, page 1 (100 at a time)
curl -s -A "MyApp/1.0 (me@example.com)" \
  "https://musicbrainz.org/ws/2/release-group?artist=<MBID>&type=album&limit=100&offset=0&fmt=json"

# Find recordings by ISRC
curl -s -A "MyApp/1.0 (me@example.com)" \
  "https://musicbrainz.org/ws/2/isrc/GBAYE0601498?inc=artist-credits&fmt=json"
```

---

## 12. Further reading

- [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API)
- [MusicBrainz API / Search](https://musicbrainz.org/doc/MusicBrainz_API/Search)
- [Development / XML Web Service / Version 2](https://musicbrainz.org/doc/Development/XML_Web_Service/Version_2)
- [MBID](https://musicbrainz.org/doc/MBID) · [Disc ID](https://musicbrainz.org/doc/Disc_ID)
- [Rate limiting](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting)
- Swagger prototype (community): <https://github.com/JonnyJD/musicbrainz-swagger-docs>
