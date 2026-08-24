# MCP 2.0 migration review — `navidrome-mcp` v2.2.0 → spec revision `2026-07-28`

**Status:** planning document. Nothing implemented, nothing staged.
**Written:** 2026-08-12
**Doc set this is built against:** [`docs/mcp-2.0/INDEX.md`](mcp-2.0/INDEX.md) — 102 verbatim spec/SDK/blog files, fidelity spot-check 5/5 passed.
**Repo facts** come from three independent read-only audits of `src/` (protocol surface, server state, tool schemas). Every claim below cites either `file.ts:line` (repo) or a doc-set path (spec).

---

## 0. Verdict

The migration is **feasible and worth doing**, but it is not a port — three things must be redesigned rather than renamed.

| | Finding |
|---|---|
| **Good news 1** | **One build can serve both eras.** SDK v2 serves 2025-era clients from the same factory by default (`serveStdio` defaults `legacy:'serve'`; `createMcpHandler` defaults `legacy:'stateless'`). Old clients are *not* locked out. → `sdk-v2/serving-legacy-clients.md` |
| **Good news 2** | **The reason this project avoided `McpServer` is gone.** v2 *requires* zod ≥4.2 and supports Standard Schema. The Zod-4 incompatibility documented at `tests/unit/transport/http-transport.test.ts:23-26` no longer applies. |
| **Good news 3** | The server sends **zero** server-initiated messages — no sampling, roots, progress, or `listChanged`. The spec's biggest removals cost this codebase nothing. |
| **Blocker 1** | `set_active_libraries` violates a **MUST**. Not a hazard — a conformance violation. §3.1 |
| **Blocker 2** | **Playback is physically host-affine.** 20 tools. No protocol mechanism fixes this. §3.2 |
| **Blocker 3** | `isInitializeRequest` is the sole session gate in the HTTP transport. `initialize` is **removed**. Left alone, every POST 400s. §3.3 |
| **Caveat** | The SDK docs captured are **v2.0.0-beta.1**, explicitly "can still change before the stable release". Every signature quoted here must be re-verified against stable v2 before code lands. |

**Recommended shape:** ship `3.0.0-next.N` on the `next` dist-tag, dual-era enabled, with playback restricted to stdio + single-owner deployments. Keep 2.x on `latest` until client support is real.

---

## 1. Version inventory

| Component | Now | Target | Gap |
|---|---|---|---|
| MCP protocol | `2025-06-18` (SDK default negotiated `2025-03-26`) | `2026-07-28` | new revision |
| `@modelcontextprotocol/sdk` | `1.17.4` (single package) | `@modelcontextprotocol/server` v2 + `/server/stdio` + `@modelcontextprotocol/node` | package split |
| zod | `^4.1.4` | `^4.2.0` | **bump required** — v2 needs `~standard.jsonSchema`, added in 4.2.0 |
| TypeScript | `5.9.2` | ≥5.9 works; **≥6.0 requires `"types":["node"]`** in tsconfig | conditional |
| Node | `>=20.3.0` | Node 20+, ESM-only | **already satisfied** |
| Server API | low-level `Server` + `setRequestHandler(XRequestSchema, …)` | low-level `Server` survives; handlers keyed by **method string** | mechanical |
| Transports | `StdioServerTransport`, `StreamableHTTPServerTransport` | `serveStdio`, `createMcpHandler` + `toNodeHandler` | rewrite |

Sources: `sdk-v2/get-started-packages.md`, `sdk-v2/migration-upgrade-to-v2/02-packaging-imports-transports.md:151-170`, `sdk-v2/package-server-readme.md:25`, `sdk-v2/advanced-low-level-server.md`.

---

## 2. The migration map

Drawn once. Every later claim names a part of this.

```
   ┌────────────────────────── LAYER A: PROTOCOL PLUMBING ──────────────────────────┐
   │                                                                                 │
   │  A1  package.json          @modelcontextprotocol/sdk@1.17.4                     │
   │                              → @modelcontextprotocol/server + /node   [M1]      │
   │                            zod ^4.1.4 → ^4.2.0                        [M2]      │
   │                                                                                 │
   │  A2  src/index.ts          new Server() + StdioServerTransport                  │
   │                              → serveStdio(factory)                    [M3]      │
   │                                                                                 │
   │  A3  src/transport/http.ts StreamableHTTPServerTransport + session maps         │
   │                              → createMcpHandler(factory) + toNodeHandler        │
   │                              DELETE: transports/lastActivity maps, reaper,      │
   │                                      isInitializeRequest gate       [B3, M4]    │
   │                                                                                 │
   │  A4  src/capabilities.ts   MCP_CAPABILITIES constant                            │
   │                              → ServerCapabilities + server/discover   [M5]      │
   │                              + split degraded variant                 [F1]      │
   │                                                                                 │
   │  A5  handlers/registry.ts  setRequestHandler(ListToolsRequestSchema,…)          │
   │      resources/index.ts      → setRequestHandler('tools/list', …)     [M6]      │
   │      degraded-tools.ts                                                          │
   └─────────────────────────────────────────────────────────────────────────────────┘
                                          │
   ┌────────────────────────── LAYER B: WIRE CONTRACT ──────────────────────────────┐
   │                                                                                 │
   │  B1  tool results          {content:[text]}  → + resultType, isError  [M7]      │
   │  B2  list results          → REQUIRED ttlMs + cacheScope              [M8]      │
   │  B3  errors                everything -32603 → protocol vs execution  [M9]      │
   │  B4  resources             -32002 → -32602                            [M10]     │
   │  B5  inputSchema           hand-written JSON Schema, 12 drifts        [M11]     │
   │  B6  HTTP headers          + Mcp-Method, Mcp-Name required            [M12]     │
   └─────────────────────────────────────────────────────────────────────────────────┘
                                          │
   ┌────────────────────────── LAYER C: DESIGN — MUST RETHINK ──────────────────────┐
   │                                                                                 │
   │  C1  set_active_libraries  process-global filter read by 24 tools     [B1]      │
   │  C2  playback (20 tools)    mpv = physical audio device                [B2]      │
   │  C3  cross-process guards   vote/click dedup, MusicBrainz throttle    [B4]      │
   └─────────────────────────────────────────────────────────────────────────────────┘
```

`[Mn]` = mechanical, §4. `[Bn]` = blocking, §3. `[Fn]` = pre-existing bug, §6.

---

## 3. Blocking changes — these require rethinking, not editing

### 3.1 — B1: `set_active_libraries` violates a MUST

**The normative text** (`spec-2026-07-28/basic/index.md` §Statelessness), verbatim:

> * Servers **MUST NOT** rely on prior requests over the same connection to establish context […]
> * State that needs to span multiple requests (e.g., long-running tasks, application-level handles) **MUST** be referenced by an explicit identifier the client passes on each request.

And, decisively for this project:

> This implies that an open connection, such as a STDIO process, is not a conversation or session: clients may interleave unrelated requests on the same transport, and a server must not treat connection or process identity as a proxy for conversation or session continuity.

**Why this is worse than "a multi-process problem".** My first reading was that stdio deployments were safe because one process serves one client. **That is wrong.** The spec explicitly forbids treating the stdio process as a conversation boundary. A single Claude Desktop process may interleave requests from two different chats. So:

```
   chat A ──┐
            ├──► one stdio process ──► one activeLibraryIds  ← shared, wrongly
   chat B ──┘
```

`set_active_libraries([2])` in chat A silently re-scopes chat B's next `search_songs`. **The bug exists today, in the deployment 99% of users run.** The migration doesn't create it; it names it.

**Blast radius: 24 tools.** State at `library-manager.ts:66`, written only by `set_active_libraries` (`library.ts:126`), read via `navidrome-client.ts:146-150` which appends `library_id=N` to every filtered request.

`search_songs`, `search_albums`, `search_artists`, `search_all`, `get_song`, `get_album`, `get_artist`, `get_song_playlists`, `list_recently_played`, `list_most_played`, `list_starred_items`, `list_top_rated`, `search_by_tags`, `get_tag_distribution`, `list_playlists` (only when `onlyWithPlayableTracks=true`, `playlist-crud.ts:74`), `play_songs`, `play_albums`, `play_albums_search`, `play_songs_search`, `play_playlist`, `get_play_queue`, `now_playing`, `get_artist_albums`, `get_user_details`.

**The spec's prescribed replacement** (`spec-2026-07-28/server/tools.md` §Stateful Tools — flagged non-normative): a creation tool returns an explicit handle; subsequent calls take it as an ordinary argument. *"The model is responsible for carrying `basket_id` forward."*

**Options considered:**

| | Shape | Cost | Verdict |
|---|---|---|---|
| A1 | `libraryIds?: number[]` on all 24 reader schemas | 24 schemas + 24 call sites; array in every tool description | Conformant but expensive in LLM context on every call |
| A2 | Opaque `scope` handle, minted by a creation tool (the spec's own pattern) | Medium; handle is opaque, model must carry it | Conformant; adds a concept for a feature most users don't need |
| A7 | **Delete the tool; config-only via `library.defaultLibraryIds`** | Lowest — removes 1 tool | Conformant by removal |

**Recommendation: A7 + a narrow A1.** Delete `set_active_libraries`. Add optional `libraryIds` to the **5 tools where multi-library users actually need per-call scope** — `search_songs`, `search_albums`, `search_artists`, `search_all`, `search_by_tags`. The other 19 readers use the config default (`applyDefaultConfiguration`, `library-manager.ts:255-271`, already "all libraries" when unset). Keep `get_user_details` as read-only discovery of what's available.

**Rationale:** threading an array through 24 schemas spends context on every single call to serve a minority configuration. A2 is the spec's blessed pattern but introduces a handle lifecycle for something that is, for most deployments, a static config value.

**Coupled change:** the filter caches (`filter-cache-manager.ts:57-70`) are loaded *through* the library filter (`:180,222`), so any per-call `libraryIds` needs a matching per-scope cache key — otherwise filter vocabulary stays silently scoped to whatever the process loaded at startup. Note this is already a latent staleness bug: `set_active_libraries` does **not** trigger a filter-cache reload today.

---

### 3.2 — B2: playback is host-affine and no protocol feature fixes it

**The constraint is physical.** mpv is a separate OS process reachable only over a user-scoped local socket (`mpv-process.ts:42-66`). The state that matters is an **audio device**, not a value.

Under a stateless HTTP fleet:

```
   play_songs  ──► process on host H1 ──► mpv on H1 ──► 🔊 audio plays here
   pause       ──► process on host H2 ──► ensureRunning() ──► spawns a SECOND,
                                          EMPTY mpv on H2 ──► reports success ✅
```

Write tools call `ensureRunning()` (`playback-engine.ts:308`) which **lazy-spawns**. Read tools call `ensureAttached()` (`:294-299`) which degrades silently — `now_playing` returns `{engineRunning:false}` (`playback.ts:1271-1273`), indistinguishable from "nothing is playing" while audio plays on another machine.

**Two data items are permanently lost on a fresh attach**, not reconstructible from mpv or Navidrome:
- radio station **name** (`S16`, `playback-engine.ts:183`) — already documented as a post-restart edge at `:608-611`
- `queueGeneration` (`S17`, `:190`) — restarts at 0, so two processes mint **colliding** `now_playing` repair keys (`playback.ts:1345-1348`)

**Does the spec offer per-tool affinity?** **No.** There is no protocol-level affinity mechanism. The Stateful Tools pattern assumes the server can look state up "under that key" — which presumes a shared store. An audio device is not a shared store.

**Options:**

| | Shape | Cost | Verdict |
|---|---|---|---|
| P1 | Document playback as requiring host affinity | Low | Honest; not conformant if deployed multi-node |
| P2 | Gate playback off for HTTP transport; stdio only | Low | Conformant by removal; loses functionality for local-HTTP users |
| P4 | **`navidrome-web` becomes sole mpv owner; MCP replicas proxy to it** | High, but **half-built already** | The only design where "any process serves any request" is true |
| P3/P5 | Externalize queue to Navidrome `/queue`, or state to Redis | Very high | **Reject** — neither fixes the audio-device problem |

**Recommendation: P2 for 3.0.0-next, P4 as the 3.x goal.** Restrict playback registration to stdio (extend the existing `config.features.playback` gate at `registry.ts:122`) plus an explicit opt-in for single-owner HTTP deployments. Then build P4 — the ownership election (`index.ts:159-174`), the web child (`web/spawn.ts:130`), and the `/healthz` probe (`web/acquire.ts:48`) already exist. P4 also fixes the N-scrobblers problem for free, since today's election only distinguishes MCP-vs-web, not MCP-1-vs-MCP-2 (`scrobble-tracker.ts:294-309`).

**Do not attempt P3/P5.** `S15` metadata and `S16` station name are re-fetchable from Navidrome anyway; externalizing them buys nothing the audio-device constraint doesn't immediately take back.

---

### 3.3 — B3: the HTTP transport dies silently if `initialize` is removed and nothing else changes

**Changelog item 2** (`spec-2026-07-28/changelog.md:16`): *"Make MCP stateless: remove the `initialize`/`notifications/initialized` handshake."*
**Changelog item 1** (`:14`): *"Remove protocol-level sessions and the `Mcp-Session-Id` header."*

Current code (`src/transport/http.ts:222-225`):

```
if (sessionId !== undefined || !isInitializeRequest(body))  →  400, code -32000
```

`isInitializeRequest` is the **sole gate on creating a session**. With `initialize` gone, the predicate never matches, every POST falls into the 400 branch, and the transport is **dead, not degraded**.

**What must be deleted** (not adapted): the `transports` Map (`:128`), `lastActivity` Map (`:133`), the idle reaper (`:283-296`), `onsessioninitialized` (`:237`), the per-session `createMcpServer` factory (`:96`, `:255`), and the `Mcp-Session-Id` round-trip. All of it existed only to satisfy the SDK 1.x stateful-session requirement documented at `:105-115`.

**What replaces it:** `createMcpHandler(factory)` mounted via `toNodeHandler` from `@modelcontextprotocol/node` (`sdk-v2/serving-http.md`, `sdk-v2/api/create-mcp-handler.md`).

**The Host/Origin filter survives with less code.** The hand-rolled posture logic (`http.ts:342-352`, `:369-378`) is replaced by `hostHeaderValidation(allowedHostnames)` and `originValidation(...)` from `@modelcontextprotocol/node` — guards shaped `(req,res) => boolean` that answer `403` themselves (`sdk-v2/api/host-header-validation-node.md`). This project serves plain `node:http`, so the `-node` pair is the right one of the three shapes.

**Also removed by the spec, and currently unused here** — so zero cost: SSE resumability / `Last-Event-ID` (changelog item 9; no `eventStore` is configured), the HTTP GET stream and `resources/subscribe` (item 4), `ping` and `logging/setLevel` (item 5).

---

### 3.4 — B4: two guards protect third parties and cannot be fixed per-call

Flagged separately because getting these wrong harms someone else.

| | State | Guards against | Breaks how |
|---|---|---|---|
| `vote_station` / `click_station` dedup | `radio-browser-rate-limit.ts:39-40`, explicitly no TTL | Radio Browser banning the project's **shared User-Agent** (`:24-26`) | N processes ⇒ up to N votes upstream per action |
| MusicBrainz throttle | `musicbrainz.ts:59-60`, 1 req/1.1s | MusicBrainz's **per-IP** 1 req/s policy | N replicas behind one egress IP ⇒ N× the rate |

Both are per-**process** limiters guarding per-**IP** or per-**identity** upstream policy. No per-call parameter fixes this. **Recommendation:** persist the vote/click dedup to the settings store; for MusicBrainz, require a per-deployment `musicBrainzUserAgent` when running multi-replica so a violation cannot tar the shared default (`defaults.ts:84`). Neither blocks 3.0 on stdio.

---

## 4. Mechanical changes

Ordered by dependency. None require design decisions.

| # | Change | Where | Notes |
|---|---|---|---|
| **M1** | Package split | `package.json:72` | `@modelcontextprotocol/sdk` → `@modelcontextprotocol/server` (+ `/server/stdio` subpath) + `@modelcontextprotocol/node`. Codemod: `npx @modelcontextprotocol/codemod@beta v1-to-v2 .` |
| **M2** | zod `^4.1.4` → `^4.2.0` | `package.json:75` | Required: SDK needs `~standard.jsonSchema` (added 4.2.0). Below 4.2 the SDK falls back with a documented degradation |
| **M3** | `new Server()` + `StdioServerTransport` → `serveStdio(factory)` | `src/index.ts:20,21,206-208`, `:121-122` | `legacy:'serve'` default keeps 2025 clients working |
| **M4** | HTTP transport rewrite | `src/transport/http.ts` | §3.3. `createMcpHandler` + `toNodeHandler`; delete session machinery |
| **M5** | Capability declaration + `server/discover` | `src/capabilities.ts:21-27` | Servers **MUST** implement `server/discover` (changelog item 3). Capabilities gain an `extensions` field (minor item 1) |
| **M6** | `setRequestHandler(XRequestSchema,…)` → method strings | `registry.ts:130,134`; `resources/index.ts:40,45`; `degraded-tools.ts:55,57` | `setRequestHandler('tools/list', …)`. 7 sites. Low-level `Server` **survives** — the registry architecture can stay |
| **M7** | `resultType` on every result | `registry.ts:70-79` | All results carry required `resultType: "complete"`. Single encoder ⇒ one place to change |
| **M8** | **`ttlMs` + `cacheScope` required** on list results | `registry.ts:130`, `resources/index.ts:40,45` | Minor item 5 — required on `tools/list`, `resources/list`, `resources/read`. SDK `cacheHints` defaults to `ttlMs:0` + `private`, which is safe. §5 lists the tools where a non-zero TTL would be *wrong* |
| **M9** | Error model split | `registry.ts:134-138`, `error-formatter.ts` | **Behavioral change across all 71 tools.** Today everything throws → `-32603`. Spec wants: protocol errors for unknown-tool/malformed (`-32602`), **`isError:true` tool results** for execution failures so the model can self-correct |
| **M10** | Resource-not-found `-32002` → `-32602` | `src/resources/index.ts` | Minor item 6 |
| **M11** | `inputSchema` drift | `src/tools/handlers/*`, `src/schemas/*` | 12 verified divergences. §5 |
| **M12** | `Mcp-Method` / `Mcp-Name` request headers | HTTP path | Minor item 4 — required on Streamable HTTP POST. Handled by the SDK, but custom middleware in front of the endpoint must not strip them |
| **M13** | Deterministic `tools/list` order | `registry.ts:45-47` | Minor item 3 — SHOULD, for client cache hit rates. Currently insertion-ordered, already deterministic; confirm it stays stable |
| **M14** | Test suite | `tests/unit/transport/http-transport.test.ts:69,313` | Hardcodes `protocolVersion:'2025-03-26'`. Also see `sdk-v2/migration-upgrade-to-v2/07-*` for runtime behavior changes that break tests |

---

## 5. Schema drift — a migration prerequisite, not ordinary debt

Every `inputSchema` is a **hand-written JSON Schema literal**; zod is a **separate** runtime validator. Nothing generates one from the other — no `zod-to-json-schema`, no `z.toJSONSchema()`.

This is currently harmless *because* clients treat `inputSchema` as advisory. Minor changelog item 10 loosens schemas to full **JSON Schema 2020-12** and adds `$ref` resolution requirements; the SDK moves to Ajv2020 (`sdk-v2/migration-upgrade-to-v2/06-types-and-schemas.md`). The tighter the client-side enforcement, the more these become contract violations rather than cosmetics.

**12 verified divergences:**

| Direction | Example |
|---|---|
| Wire too permissive | `query` missing `maxLength:500`; `limit`/`offset` declared `type:'number'` where zod requires `.int()` — and a non-integer makes Navidrome return the **entire unpaginated set**; `mbid` missing `.uuid()`; `set_active_libraries` missing `additionalProperties:false` |
| Wire too restrictive | `star_item`/`unstar_item`/`set_rating` declare `enum:['song','album','artist']` while `ItemTypeSchema` accepts **6** values incl. plurals (`common.ts:59-66`) — a deliberate LLM-error tolerance invisible on the wire |
| Unexpressible | 5 tools with `superRefine` cross-field rules (e.g. `add_tracks_to_playlist` needs ≥1 of 4 ID arrays, `validation.ts:67-79`) |
| **Security-relevant** | `ID_PATTERN` (`/^[A-Za-z0-9_-]+$/`, `common.ts:26`) — the URL-injection guard — appears in **zero** declared schemas |
| Known + partially patched | 9 of 11 `year` fields declare `type:'number'` with no maximum; only the 2 playback search tools were fixed (`playback-handlers.ts:243-248`). The hazard is documented in-repo at `playback-handlers.ts:68-73` |

**Recommendation: generate `inputSchema` from the zod schemas as part of the migration.** zod ≥4.2 (already required by M2) exposes `~standard.jsonSchema`, and v2's `registerTool` accepts Standard Schema directly (`sdk-v2/servers-tools.md`, `sdk-v2/advanced-schema-libraries.md`). This deletes the second artifact entirely rather than fixing 12 instances of drift in a system that will drift again.

**Structured output (`outputSchema` / `structuredContent`) — defer.** All 71 configured tools funnel through one encoder that JSON-stringifies into a single `text` block; nothing declares `outputSchema` or `structuredContent`. Adopting it is 71 new schemas, and the `verbose` flag flips `SongDTO` between 7 and 20 fields on the same tool name (`song-transformer.ts:60-141`), so a single schema per tool would mark 13 of 20 fields optional and be nearly non-discriminating. Not required by the revision. **Out of scope for 3.0.0.**

**Cacheable lists — default to `ttlMs: 0`.** Seven hazards make a naive args-keyed cache silently wrong: `sort:'random'` without `randomSeed`; the one-time `tip` on the first `list_radio_stations` (`radio.ts:213-224`); the process-global library filter; mutation invalidation with no dependency edge; `list_top_rated`'s `partial:true` lower-bound totals; and `click_station`'s per-session message. Opt individual tools in later, deliberately.

---

## 6. Pre-migration fixes — bugs that exist today, independent of MCP 2.0

These are wrong on 2.2.0 now. Fix them on `main` before or alongside the 3.0 branch.

| | Bug | Location | Note |
|---|---|---|---|
| **F1** | Degraded mode advertises the `resources` capability but registers **no** resource handlers — `resources/list` passes the SDK capability assertion, then fails "Method not found" | `src/index.ts:98-102` vs `src/capabilities.ts:23-26` | Found independently by two audits. Gets worse when `server/discover` becomes the authoritative server description. Fix = split `MCP_CAPABILITIES` into full + degraded |
| **F2** | JWT expiry is **guessed** from `config.tokenExpiry` (24h default) instead of read from the token's `exp` claim — which `jwt-decode.ts:151` already decodes | `auth-manager.ts:117` | If Navidrome's real TTL is shorter, every process serves 401s until the retry-once path repairs it. ~5 lines |
| **F3** | `durationRepairedForKey` / `notRadioConfirmedForKey` are module-level `let`s, correct only because exactly one process exists | `playback.ts:1247,1253` | Move onto `PlaybackEngine` next to `queueGeneration` (`playback-engine.ts:190`). ~20 lines. Do this regardless of which playback option wins |
| **F4** | `get_radio_station` returns "not found" for a station that demonstrably exists, when the 300s cache is stale | `radio.ts:517-521` | On cache-miss failure, retry via the uncached path the create flow already uses (`:396`). ~5 lines |
| **F5** | `test_connection` returns `{success:false}` at protocol-success — the exact pattern `library.ts:143-147` documents as misleading to an LLM | `src/tools/test.ts:123-128` | Aligns with M9 |
| **F6** | mpv IPC socket path interpolated into an error reaching LLM context | `mpv-ipc.ts:124` | Low severity; internal infrastructure detail |
| **F7** | `filterCacheManager.initialize()` failure leaves the process permanently throwing on filtered searches | `filter-cache-manager.ts:119` vs `:322` | Make it soft-fail with lazy retry, matching `LibraryManager` (`library-manager.ts:112-117`) |
| **F8** | `discover_radio_stations` accepts `offset`/`limit` but returns no total or more-pages signal | `src/types/radio.ts:115-131` | Caller cannot distinguish a full page from the last one |

---

## 7. Release strategy

**The premise holds, but for a different reason than expected.** Dual-era support means old clients are *not* locked out by the protocol. The breaking risk is the **toolchain and the tool surface**, not the wire.

```
   npm dist-tags
   ├── latest  →  2.2.x        MCP 2025-era, SDK v1, unchanged, bugfix-only
   └── next    →  3.0.0-next.N MCP 2026-07-28 + 2025-era fallback (dual)
```

**What actually breaks for a user upgrading to 3.0.0-next:**

1. `set_active_libraries` **is removed** — the single user-visible tool removal (§3.1).
2. Playback tools are **stdio-only by default** (§3.2); HTTP users must opt in as single-owner.
3. zod ≥4.2 and Node 20+ — Node is already the floor; zod is internal.
4. Nothing else. Tool names, arguments, and result shapes are otherwise unchanged.

**Why pre-release, not a straight major:** the SDK docs captured are `v2.0.0-beta.1`, whose own README says the API "can still change before the stable release", and the `sdk-v2/api/*` pages are pinned to one source commit. Shipping `latest` on a beta SDK would put an unstable dependency in front of every user. Hold `next` until stable v2 ships, then re-verify every signature quoted in this document.

**Exit criteria for promoting `next` → `latest`:**
- SDK v2 stable released and signatures re-verified
- Two or more major clients negotiate `2026-07-28` in the wild
- Playback either restricted-and-documented (P2) or rebuilt on P4
- All 8 pre-migration fixes landed

---

## 8. Open questions

Answered by the doc set:

| Q | Answer | Source |
|---|---|---|
| Is `initialize` removed? | **Yes**, entirely. Handshake gone | `changelog.md:16` |
| Can one build serve both eras? | **Yes**, by default | `sdk-v2/serving-legacy-clients.md` |
| Does the low-level `Server` survive? | **Yes**, with method-string handlers | `sdk-v2/advanced-low-level-server.md` |
| Is stdio exempt from statelessness? | **No** — a stdio process is explicitly not a conversation | `basic/index.md` §Statelessness |
| Can a tool declare host affinity? | **No** such mechanism exists | — |
| Are `ttlMs`/`cacheScope` required? | **Yes** on the five list/read operations | `changelog.md:38` |
| Is `outputSchema` required? | **No** | `server/tools.md` |
| Tool errors: protocol or `isError`? | Both — unknown-tool/malformed are protocol errors; execution failures are `isError:true` | `server/tools.md` §Error Handling |

**Still open — these need answers before the corresponding work is costed:**

1. **Can SDK v2 serve the Tasks extension at all?** The extension requires `tasks/get`/`tasks/update`/`tasks/cancel`, but the SDK states methods deleted by a revision are physically absent from that era's registry — an inbound `tasks/get` gets `-32601` *even if a handler is registered*. Whether the custom-method path (`sdk-v2/advanced-custom-methods.md`) can re-add them is unstated. **Blocks any "long-running playback as a Task" design.** (Doc-set gap 1, inconsistency 6.)
2. **No typed API reference for `McpServer.registerTool`** — prose only. This project registers every tool through one registry, so exact generic signatures are load-bearing. (Doc-set gap 2.)
3. **No client support matrix for extensions** — the `extensions/client-matrix` page is not in the set, so "will any client we target actually negotiate this?" has no evidence. (Doc-set gap 3.)
4. **Should the four optional integrations become spec extensions?** Deferred: the gating boundaries do **not** align with code categories. `radio` spans three provenances (5 Navidrome-native, 1 mpv-gated, 5 Radio-Browser-gated), and `get_artist_albums` composes Last.fm + MusicBrainz (ungated) + Navidrome. Modeling these as extensions means re-cutting categories, not relabeling.

**Doc-set caveats to carry forward:** all `sdk-v2/` files are `v2.0.0-beta.1`; the `ext-tasks/` group is draft from a repo that calls itself "not an official extension"; SEP-2663 names the base revision `2026-06-30` (read as `2026-07-28`); and the RC blog's `InputRequiredResult` example predates the final spec — use the spec shape. Full list in `mcp-2.0/INDEX.md` §Coverage notes.

---

## 9. Suggested phasing

Dependency order. Each phase is independently shippable.

```
  Phase 0 — on main, 2.2.x            F1 … F8 (pre-existing bugs)
     │                                 no protocol change, no breakage
     ▼
  Phase 1 — branch, toolchain          M1 M2 (packages, zod 4.2)
     │                                 build green, no behavior change
     ▼
  Phase 2 — schema generation          M11 → generate inputSchema from zod
     │                                 deletes the drift class permanently
     ▼
  Phase 3 — protocol plumbing          M3 M4 M5 M6 (serveStdio, createMcpHandler,
     │                                 server/discover, method-string handlers)
     ▼
  Phase 4 — wire contract              M7 M8 M9 M10 M12 M13 (resultType, cache
     │                                 hints, error split, codes, headers)
     ▼
  Phase 5 — the redesigns              B1 (delete set_active_libraries + 5 schemas)
     │                                 B2 (playback → stdio-only + opt-in)
     │                                 B4 (persist vote/click dedup)
     ▼
  Phase 6 — tests + publish            M14, then 3.0.0-next.1 on `next`
```

Phases 0–2 carry no protocol risk and can land on `main` today. The branch point is Phase 3.
