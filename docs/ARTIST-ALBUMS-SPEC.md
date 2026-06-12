# `get_artist_albums` — Tool Spec

> Return an artist's **full discography** with correct release **types/years** (MusicBrainz),
> enriched with **genres + popularity** (Last.fm), and flagged **in-library / missing** (Navidrome).
> Answers "what full albums by X am I missing?" in one call. Status: **proposed**.

Sources: [`LAST-FM-API-SPEC.md`](./LAST-FM-API-SPEC.md) · [`musicbrainz-api.md`](./musicbrainz-api.md).

---

## 1. Why two external sources (evidence)

| Need | MusicBrainz | Last.fm |
|---|---|---|
| Album list (even obscure: Download/Ours/Thermostatic all present) | ✅ authoritative | ⚠️ buried in noise |
| Release **type** (Album/Single/EP) + **secondary** (Live/Comp/Soundtrack/Remix) | ✅ only source | ❌ no type field |
| Release **year** | ✅ `first-release-date` | ❌ unreliable |
| **Genres** | ✅ `inc=genres` rides the spine request — verified live: even Thermostatic/GUNSHIP fully populated at release-group level | ⚠️ per-album tags require `album.getInfo` (N+1) — **not used** |
| **Popularity** ranking | ❌ | ✅ `playcount` |

`artist.getTopAlbums` reports 1,200–3,900 "albums"/artist — singles rank top (`66 MHz`, `Maniac`),
plus junk (`null`, `<unknown>`, `uploaded by…`, `*.com`). MBID-presence is **not** a usable filter
(real albums lack one; singles have one). ⇒ **MB is the spine; Last.fm enriches; never trust Last.fm types.**

---

## 2. Tool I/O

### Input (`GetArtistAlbumsSchema` → `validation.ts`)

| Param | Type | Default | Notes |
|---|---|---|---|
| `artist` | string | — | Name *or* MBID. Required unless `mbid`. |
| `mbid` | string | — | MusicBrainz artist MBID; skips artist resolution. |
| `includeTypes` | enum[] `album\|ep\|single` | `["album"]` | MB primary types to keep. |
| `excludeSecondary` | enum[] | `["live","compilation","soundtrack","remix","dj-mix","demo"]` | Dropped MB secondary types. `[]` = keep all. |
| `onlyMissing` | bool | `false` | Return only `inLibrary=false`. |
| `includeUnverified` | bool | `false` | Add long-tail Last.fm-only albums MB lacks (`typeUnverified=true`). |
| `verbose` | bool | `false` | Add raw `playcount`, Last.fm `url`, MB `disambiguation`. No extra requests. |

### Example request
```jsonc
{ "artist": "GUNSHIP", "onlyMissing": true }
```

### Example response (compact)
```jsonc
{
  "artist": { "name": "GUNSHIP", "mbid": "df1356d3-…", "navidromeArtistId": "4bHSZF4Asf8xq25rtiEkZd" },
  "counts": { "discography": 3, "inLibrary": 1, "missing": 2, "returned": 2 },
  "sources": { "musicbrainz": true, "lastfm": true },
  "albums": [
    { "title": "Dark All Day", "year": 2018, "primaryType": "Album", "secondaryTypes": [],
      "inLibrary": false, "libraryAlbumId": null,
      "genres": ["synthwave","electronic"], "popularityRank": 2,
      "mbid": "…", "source": "musicbrainz", "typeUnverified": false },
    { "title": "Unicorn", "year": 2023, "primaryType": "Album", "secondaryTypes": [],
      "inLibrary": false, "libraryAlbumId": null,
      "genres": ["synthwave"], "popularityRank": 3,
      "mbid": "…", "source": "musicbrainz", "typeUnverified": false }
  ]
}
```
`verbose:true` adds per-album `playcount`, `url`, `disambiguation` — all already in hand from
[A]/[B]; **never** triggers extra requests. Tracklists are deliberately out of scope (§9).

### Field provenance
| Output field | Source |
|---|---|
| `title`, `year`, `primaryType`, `secondaryTypes`, `mbid` | MB release-group |
| `genres` | MB release-group `inc=genres` (same request as spine; `[]` if MB has none — artist-level tags remain available via existing `get_artist_info`) |
| `popularityRank`, `playcount`, `url` | Last.fm `getTopAlbums` join; `popularityRank` = rank **within the returned set**; `null` if outside Last.fm's top 100 |
| `inLibrary`, `libraryAlbumId`, `navidromeArtistId` | Navidrome |
| `source` (`musicbrainz`\|`lastfm-only`), `typeUnverified` | derived in merge |

---

## 3. Pipeline (where each step + filter happens)

```
resolve artist ──┬─► [A] MB spine        ──┐
                 ├─► [B] Last.fm albums  ──┼─► [D] merge/join ─► [E] enrich ─► [F] type filter ─► [G] library compare ─► shape
                 └─► [C] Navidrome albums ─┘
```

**[A] MB spine** — `GET /ws/2/release-group?artist={mbid}&type={includeTypes}&inc=genres&limit=100&fmt=json`
(page by `offset` until `release-group-count`). *Server-side primary-type filter.* Need MBID first
(§4). Keep `id,title,first-release-date,primary-type,secondary-types,genres`. **`inc=genres`
delivers per-album genres in the same request** (verified live: GUNSHIP + Thermostatic both
populated at RG level) — this is what makes per-album `album.getInfo` unnecessary.

**[B] Last.fm** — `artist.getTopAlbums&artist={name}&limit=100&autocorrect=1`, **one page only**:
rank beyond the top 100 carries no popularity signal; spine albums that miss the join simply get
`popularityRank:null`. Strip junk + normalize titles (§5). Key by `mbid` else `normTitle`.

**[C] Navidrome** — library albums for the artist (§4).

**[D] Merge/join** — spine is canonical. Attach Last.fm row by **MBID first, else `normTitle`**.
Last.fm rows with no spine match → held for the unverified bucket.

**[E] Enrich (zero extra requests)** — genres come off the spine rows ([A] `inc=genres`);
`popularityRank`/`playcount`/`url` come off the [B] join. **No `album.getInfo` calls, ever** —
per-album deep dives (tracklist, wiki) belong to the companion `get_album_info` tool (§9).

**[F] Type filter (in code)** — drop albums whose `secondaryTypes ∩ excludeSecondary ≠ ∅`.
If `includeUnverified`, append junk-filtered Last.fm-only rows above a `playcount` floor,
`primaryType:"Unknown"`, `typeUnverified:true`.

**[G] Library compare** — set `inLibrary`/`libraryAlbumId` (§4). `onlyMissing` ⇒ keep `false` only.

**Filtering summary:** primary-type → MB server-side (A); junk/dedup → code (B); secondary-type
exclusion → code (F); library membership → code (G). MB types gate everything; Last.fm is additive only.
Last.fm noise never reaches the MCP response — unmatched `getTopAlbums` rows are discarded at [D]
(unless `includeUnverified`).

**Request budget — constant w.r.t. discography size:**
1 MB artist search (skipped when `mbid` given) + ⌈RG-count/100⌉ MB browse (1 page for nearly
every artist) + 1 Last.fm `getTopAlbums` + 1–2 Navidrome calls ⇒ **typically 4–5 requests total**.

---

## 4. Navidrome — "is this album in my library?"

Reuses `NavidromeClient.requestWithLibraryFilterAndMeta` (honors active libraries; returns `X-Total-Count`).

1. **Resolve artistId(s)** — if input is a name: `GET /api/artist?name={name}&role=maincredit`.
   ⚠️ **Collect *all* close matches**, not just one: the same act can have multiple artistIds /
   spellings (observed: `Miami Nights 1984` *and* `Miami Nights '84`). Union their albums.
2. **List library albums** — for each artistId: `GET /api/album?artist_id={id}&_start=0&_end=500`
   → `{ id, name }[]`.
3. **Match** — build `Map<normTitle, albumId>` (§5 normalization). For each discography album,
   `inLibrary = map.has(normTitle(title))`; `libraryAlbumId = map.get(...) ?? null`.
4. **Fallback** (name-resolution miss / heavy aliasing): `GET /api/album?name={title}` and confirm
   by normalized artist-name match before accepting.

`navidromeArtistId` in output = primary resolved id (first/highest match).

---

## 5. Normalization & junk rules (shared helper)

`normTitle(s)`: lowercase → strip diacritics → remove bracket/suffix noise
`[Explicit] (Instrumentals) (Deluxe…) (… Remix) - Single (Bonus…)` → collapse punctuation/whitespace
→ drop leading `the`. Used for **both** cross-source join (D) and library match (§4).

Last.fm **junk drop** (before join): names matching
`/^(null|<unknown>|\[non-album tracks\])$/i`, or containing `uploaded by`, `…\.(com|cc)`, `blogspot`,
`youtube`, `\bmixtape\b`, `vk\.com`, `playback ?fm`, `\btribute\b`, `compilation tape` — the
single-word tokens are **word-bounded** so titles merely containing them as a fragment
("Attribute", "Contribute") are not dropped; and `[Explicit]`/
`WEB`/`CDM`/`CDS` variant dupes collapsed via `normTitle`.

---

## 6. Ops

| Concern | Decision |
|---|---|
| **Feature gate** | Requires `features.lastFmApiKey` (consistent w/ sibling discovery tools). MB always on. |
| **MB User-Agent** | Required by MB. Add `features.musicBrainzUserAgent` (fallback to a sane default w/ contact). |
| **MB rate limit** | ≤ **1 req/s** — serialize MB calls through a throttle/queue. |
| **Last.fm calls** | Reuse `callLastFmApi()` in `lastfm-discovery.ts`. Exactly **one** `getTopAlbums` call per invocation; `album.getInfo` is never called by this tool. |
| **Caching** | Per-artist result cached (`utils/cache`, TTL ~24h). Cache MB + Last.fm raw separately. |
| **Errors** | `ErrorFormatter.toolExecution('get_artist_albums', err)`. MB/Last.fm failures **degrade, not fail**: MB-down ⇒ Last.fm-only (all `typeUnverified`); Last.fm-down ⇒ MB-only (no genres/popularity). Navidrome-down ⇒ omit `inLibrary` (null) + note. |
| **Logging** | `logger` only (never `console`). DEBUG: resolved MBID, counts per source, join hit-rate. |

---

## 7. Code touchpoints

| File | Change |
|---|---|
| `src/schemas/validation.ts` | `GetArtistAlbumsSchema` (auto-exports). |
| `src/utils/musicbrainz.ts` | **new** — MB fetch + UA + 1 req/s throttle + release-group paging. |
| `src/tools/lastfm-discovery.ts` | `getArtistAlbums()` impl: orchestrate A–G; reuse `callLastFmApi`. |
| `src/tools/handlers/lastfm-handlers.ts` | Register `get_artist_albums` (name + inputSchema + handleToolCall). |
| `src/types/*.ts` | `ArtistAlbumsResult` / `ArtistAlbumDTO`. |
| `src/utils/normalize-title.ts` | **new** — shared `normTitle` + junk regex. |

**Tests** (`tests/`, per `tests/CLAUDE.md`): mock MB + Last.fm fixtures (GUNSHIP small; Waveshaper
singles-vs-album; an MB-genres-empty fixture ⇒ asserts `genres: []` passthrough, no fallback call);
live-read Navidrome for library match incl. the `Miami Nights '84` alias case; assert type filter,
junk drop, join hit-rate, `onlyMissing`, and **that the Last.fm client is invoked exactly once**.

---

## 8. Decisions (resolved 2026-06-11)

1. **No per-album `album.getInfo` — ever.** Genres ride the MB spine request (`inc=genres`,
   verified live against GUNSHIP and Thermostatic — the earlier "MB genres blank for obscure
   artists" finding does not hold at the release-group level). Popularity rides the single
   `getTopAlbums` join. Result: **constant ~4–5 requests** regardless of discography size, and
   the genre union / "only when empty" conditional logic disappears. Per-album deep dives
   (tracklist, wiki) move to `get_album_info` (§9), which spends its 1–2 requests only on the
   one album the user actually asked about.
2. **`popularityRank`** = rank within the returned set (small stable integers the LLM can
   reason about); raw `playcount` only under `verbose`.
3. **Cache TTL 24h, no `refresh` flag.** Discographies change rarely; the flag is purely
   additive if staleness ever bites in practice.

Still open:

- **Default `includeTypes`**: `["album"]` matches the headline "full albums I'm missing"
  promise; `["album","ep"]` fits synthwave reality where EPs are first-class releases.
  Leaning `["album"]` + a hint in the tool description ("for electronic/synthwave artists
  consider `includeTypes: ["album","ep"]`") so the LLM opts in per query rather than every
  caller paying the EP noise for big rock/pop artists.

---

## 9. Companion tool: `get_album_info` — Spec (resolved 2026-06-12, verified live)

**The real-world flow that justifies it:** `get_artist_albums --onlyMissing` ends with the user
staring at 2–3 album titles they don't own. The natural next utterance is *"what's on Unicorn?"*
or *"is Dark All Day worth getting?"* — a question about **one** album that needs tracklist,
wiki summary, and listener counts. That payload is exactly what we evicted from
`get_artist_albums` to kill the N+1, so it lives here: 3–5 requests spent on the one album the
user actually asked about. Works for in-library albums too (and links them via
`inLibrary`/`libraryAlbumId`), but the headline surface is **albums you don't have**.

### 9.1 Source roles — inverted from the original §9 sketch (verified live 2026-06-12)

The draft assumed Last.fm `album.getInfo` carries the tracklist and MB merely "confirms
type/year". Live testing said otherwise:

| Need | Winner | Evidence (GUNSHIP "Unicorn", RG `56a2d3b3-…`) |
|---|---|---|
| **Tracklist + durations** | ✅ **MB release browse** (`/release?release-group={mbid}&inc=recordings+media`) | MB: 14/14 tracks w/ ms lengths, clean titles. Last.fm: 14 tracks but **3/14 durations (rest `null`)**, titles noisy with `(feat. …)`. Obscure albums: MB precise where it has the RG at all; Last.fm `tracks` key can be **entirely absent**. |
| **Wiki, tags, listeners/playcount** | ✅ **Last.fm `album.getInfo`** | Only source. `wiki` absent below a popularity floor; that's fine — `summary: null`. |
| **Year / primary+secondary type / genres** | ✅ MB release-group (lookup `inc=genres+artist-credits`, or search hit) | Same authority argument as §1. |
| **Name→album resolution** | ✅ MB RG search | Last.fm `autocorrect` does **not** fix typos (`unicron` ⇒ error 6); it only canonicalizes known casing/aliases. MB Lucene search scored the right hit 100 with no decoys. |

So: **MB is primary for tracklist + identity; Last.fm is primary for wiki/tags/popularity and
the tracklist fallback** when MB lacks the release group (e.g. Thermostatic "Uebermovie
Soundtrack": MB count 0, Last.fm has listeners but no tracks — then `tracks: []` + note).

### 9.2 Tool I/O

Input (`GetAlbumInfoSchema` → `validation.ts`): `mbid` (a **release-group** MBID — exactly what
`get_artist_albums` emits per album, making the follow-up call a copy-paste), **or** `artist` +
`album` names; plus `verbose` (default false). Either `mbid` or both names required.

⚠️ Last.fm's own `mbid=` param is **never used**: it wants a *release* MBID — feeding it a
release-group MBID returns error 6 (verified). Last.fm is always queried by names.

**Compact output** (the tracklist is the point of the tool — it is NOT gated behind `verbose`;
~15 rows of `{position, title, durationSeconds}` is cheap):

```jsonc
{
  "album": { "title": "UNICORN", "artist": "GUNSHIP", "mbid": "56a2d3b3-…", "year": 2023,
             "primaryType": "Album", "secondaryTypes": [],
             "inLibrary": false, "libraryAlbumId": null },
  "genres": ["pop"],                  // MB RG genres; fallback: top-5 genre-like Last.fm tags when MB
                                      // has none (bare years + shelf tags like "albums I own" filtered)
  "listeners": 61766, "playcount": 1462447,   // Last.fm (string→number); null when Last.fm missing
  "summary": "…",                     // Last.fm wiki summary, HTML + "Read more" stripped; null if absent
  "trackCount": 14,
  "tracks": [ { "position": 1, "title": "Monster in Paradise", "durationSeconds": 330 } ],
  "tracksSource": "musicbrainz",      // "musicbrainz" | "lastfm" | null (none available)
  "sources": { "musicbrainz": true, "lastfm": true },
  "note": "…"                         // only when something degraded
}
```

`verbose:true` adds (zero extra requests): `wikiFull` (stripped), `lastFmUrl`, `tags` (full
Last.fm tag list), and `tracklistRelease` (`{mbid, status, date, country}` of the MB release the
tracklist came from).

### 9.3 Pipeline

```
resolve RG ──┬─► [A] MB release browse (tracklist)──┐
 (MB lookup  ├─► [B] Last.fm album.getInfo         ─┼─► merge ─► shape
  or search) └─► [C] Navidrome §4 matcher          ─┘
```

1. **Resolve RG** — `mbid` given ⇒ RG lookup `inc=genres+artist-credits` (recovers canonical
   title/artist for [B]/[C]); names given ⇒ RG search
   `query=releasegroup:"<album>" AND artist:"<artist>"`, accept exact-norm match else top hit
   ≥ score threshold (search hits carry year/types/artist-credit but **no genres** — genres then
   fall back to Last.fm tags).
2. **[A]** `/release?release-group={rg}&inc=recordings+media&limit=100` (verified: `inc=recordings`
   works on browse). Pick release: prefer `status: "Official"`, then earliest date; flatten media
   in position order; `length` ms → whole seconds. Skipped when RG unresolved.
3. **[B]** by names (input names, else MB canonical). Yields listeners/playcount/tags/wiki +
   fallback tracks.
4. **[C]** reuse `fetchLibraryLookup` (§4) + `normTitle` match → `inLibrary`/`libraryAlbumId`.

[A]/[B]/[C] run concurrently ([A] serialized behind the resolve step by the MB 1 req/s throttle).
**Budget: 2 MB + 1 Last.fm + 1–2 Navidrome ⇒ 4–5 requests**, ~1.2s MB-throttle latency.
(When Navidrome can't resolve the artist at all, the §4.4 fallback adds up to 2 `/album?name=`
probes — worst case 7.)

### 9.4 Last.fm parsing traps (all verified live — handle every one)

- `tracks.track` is an **object, not array, for single-track albums** — coerce.
- `tracks` key **absent entirely** on very obscure albums; `wiki` absent below a popularity
  floor; `tags` can be the **empty string `""`** instead of an object; `mbid` can be `""`.
- `listeners`/`playcount` are **strings**; per-track `duration` is integer seconds **or `null`**
  (null is common — 11/14 on Unicorn); `@attr.rank` is an integer.
- `wiki.summary`/`content` contain HTML incl. a trailing `<a>Read more on Last.fm</a>` — strip
  tags *and* the "Read more" remnant.
- Not-found = HTTP 200 body `{ "error": 6, "message": "Album not found" }`.

### 9.5 Degradation (mirrors §6: degrade, not fail)

| Failure | Behavior |
|---|---|
| MB unreachable / RG not found | Last.fm-only: `year: null`, `primaryType: "Unknown"`, tracklist from Last.fm (may be `[]`), genres from tags; note says which. `mbid`-only input + MB down ⇒ hard error (no names to pivot on). |
| Last.fm unreachable / error 6 | MB-only: `listeners`/`playcount`/`summary` null, genres from MB, tracklist from MB; note distinguishes "unreachable" vs "no Last.fm entry". |
| Both | Hard error — no album source available. |
| Navidrome down | `inLibrary: null` + note. |
| Neither source has tracks | `tracks: []`, `trackCount: null`, `tracksSource: null` + note. |

Caching: raw per-source caches, TTL 24h (RG resolve by mbid/norm-names; tracklist by RG mbid;
Last.fm info by norm-names) — same rationale as §8.3. Feature-gated with the Last.fm category
(consistent with siblings). Errors via `ErrorFormatter.toolExecution('get_album_info', err)`.

### 9.6 Code touchpoints

| File | Change |
|---|---|
| `src/schemas/validation.ts` | `GetAlbumInfoSchema` (mbid XOR artist+album, `verbose`). |
| `src/utils/musicbrainz.ts` | `lookupMbReleaseGroup`, `searchMbReleaseGroup`, `browseMbReleaseTracklist` (reuse throttle/UA/fetch). |
| `src/tools/lastfm-discovery.ts` | `getAlbumInfo()` orchestration + Last.fm getInfo parser + caches. |
| `src/tools/handlers/lastfm-handlers.ts` | Register `get_album_info`. |
| Tests | `tests/unit/tools/get-album-info.test.ts` (mock-fetch routes per the get-artist-albums pattern: happy mbid + names paths, single-track object quirk, `tags:""`/absent-keys quirk, official-release pick, genre fallback, per-source degradation, verbose fields, validation); registry test gains the tool name. |
