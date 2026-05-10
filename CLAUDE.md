# CLAUDE.md - Development Guidelines for Navidrome MCP Server

MCP (Model Context Protocol) server exposing AI-assistant tools that talk to a
Navidrome music server (plus optional Last.fm, LRCLIB, Radio Browser, mpv).

**Stack:** TypeScript (ultra-strict), Node.js ESM, **pnpm** (not npm/yarn).

---

## Quality gates (CI-enforced)

Run after every change. Must all be zero issues:

```bash
pnpm check:all      # lint + typecheck + dead-code (the usual one)
pnpm test:run       # unit tests
pnpm test:playback  # live-mpv integration suite (separate; needs mpv + Navidrome)
pnpm build          # production bundle
```

Dead-code (`ts-unused-exports`) blocks PRs — when you delete or refactor
a function, remove its exports too. Tests under `tests/` are part of the
analysis, so tests importing a symbol keep it alive.

`pnpm test` is watch-mode for development; use `pnpm test:run` for one-shot.

See `tests/CLAUDE.md` for the testing strategy (live reads / mocked writes /
mocked external APIs).

---

## Application structure

Layout you'll need to navigate. Most tasks touch 1-2 of these.

| Path | Purpose |
|---|---|
| `src/client/` | `NavidromeClient` (REST + Subsonic, single-flight auth, retry-on-401, JSON-sniff for `text/plain` bodies), `AuthManager` (JWT) |
| `src/tools/` | Tool implementations grouped by surface (`media-library.ts`, `playlist-management/`, `radio.ts`, `radio-validation/`, `user-preferences.ts`, `lastfm-discovery.ts`, `lyrics.ts`, `tags.ts`, `library.ts`, `search/`, `test.ts`) |
| `src/tools/handlers/` | MCP tool category factories — wire impl functions into `name` + `inputSchema` + `handleToolCall`. `registry.ts` composes all categories. |
| `src/schemas/` | `common.ts` (reusable patterns + `IdSchema`/`createIdSchema` with `[A-Za-z0-9_-]+` regex), `pagination.ts`, `validation.ts` (input schemas, e.g. `SetActiveLibrariesSchema`, `StarItemSchema`) |
| `src/transformers/` | Raw Navidrome API rows → DTOs (`song`, `album`, `artist`, `playlist`, `shared-transformers`) |
| `src/types/` | DTO + request/response interfaces (`core.ts` for `SongDTO`/`AlbumDTO`/`ArtistDTO`, others by surface) |
| `src/services/` | `playback/` (mpv IPC + engine), `library-manager.ts`, `filter-cache-manager.ts` |
| `src/utils/` | `error-formatter`, `logger`, `subsonic-auth` (salted-MD5), `sanitize-url` (strips creds before LLM exposure), `network-safety` (private-IP block for redirect targets), `cache`, `version` |
| `src/constants/` | `defaults.ts`, `timeouts.ts` |
| `src/resources/` | MCP resource handlers |

---

## Established patterns — use these, don't reinvent

- **Schemas:** import from `src/schemas/index.js`. Don't redefine inline. Add new ones to `validation.ts` and they auto-export.
- **Errors:** `throw new Error(ErrorFormatter.toolExecution('tool_name', error))`. Other helpers: `httpRequest`, `configMissing`, `toolUnknown`, `subsonicApi`, `subsonicResponse`.
- **Logging:** `import { logger }` from `utils/logger.js`. **Never `console.log`** — it breaks MCP stdio.
- **Path-segment IDs:** wrap with `encodeURIComponent` at every URL interpolation site. The `IdSchema` regex catches obvious abuse, but the encode is defense-in-depth.
- **Subsonic auth:** `client.subsonicRequest()` — POST + salted-MD5 by default. Don't hand-roll Subsonic fetches.
- **Stream URLs to mpv:** `buildSubsonicAuthParams()` from `utils/subsonic-auth.ts`. Anything user-facing that may contain a URL goes through `sanitizeFilename()` first.
- **Raw responses with `text/plain`:** the client now JSON-sniffs the body, so callers can `await client.request<T>(...)` and just read `response.field` directly. No per-call workarounds needed.

---

## Environment

Required env vars: `NAVIDROME_URL`, `NAVIDROME_USERNAME`, `NAVIDROME_PASSWORD`.
Feature-gated: `LASTFM_API_KEY` (Last.fm tools), `RADIO_BROWSER_USER_AGENT`
(radio discovery), `LYRICS_PROVIDER=lrclib` (lyrics), `MPV_PATH` /
auto-detected (playback). `DEBUG=true` for verbose logging.

Local config lives in `.env` (main) and `.env.test` (test runs). Read these
files directly when you need values.

---

## Testing Navidrome via curl (debugging)

The auth endpoint is `/auth/login` (NOT `/auth` or `/api/login`). The
authenticated `/api/*` calls use the `X-ND-Authorization: Bearer <token>`
header (NOT `Authorization`).

```bash
TOKEN=$(curl -s -X POST "$NAVIDROME_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$NAVIDROME_USERNAME\",\"password\":\"$NAVIDROME_PASSWORD\"}" | jq -r '.token')

# Listing endpoint (X-Total-Count comes back in headers; -i to see)
curl -si "$NAVIDROME_URL/api/album?_start=0&_end=5&library_id=1" \
  -H "X-ND-Authorization: Bearer $TOKEN" | head -20

# Filter by tag UUID (use {tag_name}_id, e.g. genre_id, mood_id)
curl -s "$NAVIDROME_URL/api/album?genre_id=UUID&library_id=1" \
  -H "X-ND-Authorization: Bearer $TOKEN" | jq '.'

# Discover tag values + their UUIDs
curl -s "$NAVIDROME_URL/api/tag?tag_name=genre&library_id=1" \
  -H "X-ND-Authorization: Bearer $TOKEN" | jq '.[] | {id, tagValue}'
```

**Quirks worth knowing:** Navidrome returns several JSON endpoints with
`Content-Type: text/plain` (e.g. `POST /playlist/{id}/tracks`,
`GET /song/{id}/playlists`). The client handles this transparently, but
if you're curl-debugging directly, expect text/plain on JSON bodies.

---

## Testing via MCP Inspector

```bash
pnpm build

# List all registered tools (count varies with feature flags)
npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list

# Call a specific tool
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call --tool-name test_connection \
  --tool-arg includeServerInfo=true

# Web UI for interactive exploration
npx @modelcontextprotocol/inspector node dist/index.js
```

For end-to-end LLM-facing verification, ask the user to restart the MCP
server and use the actual `mcp__navidrome__*` tools — `add_tracks_to_playlist`
behavior, for example, can only be confirmed in the live path.
