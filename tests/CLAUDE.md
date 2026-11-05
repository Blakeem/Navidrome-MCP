# Testing Strategy for Navidrome MCP Server

## Core Testing Principles - CRITICAL

These rules hold outside `tests/e2e/`. The e2e suite follows its own content rule and scrobble
rule under End-to-End Tests.

### ✅ **ALWAYS DO**
- **Live reads**: Test API compatibility against real server, validate structure not content
- **Mock writes**: NEVER modify server data - mock all create/update/delete operations
- **Shared auth**: Use `getSharedLiveClient()` to prevent rate limiting
- **Structure validation**: Test response shapes, field types, never specific content

### ❌ **NEVER DO**
- **Real writes**: Never create/modify/delete server data in tests
- **Content testing**: Don't test specific song names, artists, album titles
- **Individual auth**: Never construct a `NavidromeClient` in a live test. Use `getSharedLiveClient()`.
- **External API calls**: Always mock Last.fm, Radio Browser, LRCLIB

---

## Implementation Patterns

### Live Read Testing
Use for API compatibility validation. Test structure, not content:

**Key Elements:**
- `liveClient = await getSharedLiveClient()` in beforeAll
- Minimal parameters (`limit: 1`) to reduce response size
- Validate response properties exist with correct types
- If data exists, verify required DTO fields but not values
- Test edge cases like empty queries, special characters

### Mocked Write Testing
Use for all operations that modify data:

**Key Elements:**
- `mockClient = createMockClient()` in beforeEach
- `mockClient.request.mockResolvedValue(expectedResponse)`
- Verify correct API calls with `expect().toHaveBeenCalledWith()`
- Test both success and error scenarios
- Include input validation tests

### External API Testing
Always mock external services:

**Key Elements:**
- Mock fetch globally: `global.fetch = vi.fn()`
- Provide realistic mock responses
- Test error handling for API failures
- Never make real external API calls in unit tests

---

## Test Organization

### Directory Structure
```
tests/
├── unit/                        # Unit tests, one subdirectory per src/ area, plus e2e-harness/ for the e2e harness logic
├── integration/playback/        # Live-mpv playback integration tests (run via `pnpm test:playback`)
├── integration/coordination/    # Multi-process tests against dist/ (run via `pnpm test:playback`)
├── e2e/                         # Playwright web remote suite (run via `pnpm test:e2e`)
│   ├── playwright.config.ts
│   ├── fixtures.ts              # `test` and `expect` with the e2e fixtures
│   ├── content.ts               # Songs of the two albums test code may name
│   ├── harness/                 # Temp store, instance spawn, mpv probe, scrobble guard, globalSetup
│   ├── pages/                   # Page objects HostPage and GuestPage, and the prompt and position helpers they share
│   └── specs/                   # *.e2e.ts
├── helpers/                     # Test setup and config helpers (setup-config-store, test-config, env-detection)
├── factories/                   # Mock client & data factories
├── fixtures/                    # Static test inputs (TLS key and certificate pairs)
└── CLAUDE.md                    # This file
```

### Test Layers

| Layer | Folder | Config | Command | May touch | When to run |
|---|---|---|---|---|---|
| Mocked unit | `tests/unit/` | `vitest.config.ts` | `pnpm test:run` | Loopback sockets, temp files and short-lived child Node processes only. Every Navidrome write and external API is mocked. | After every change |
| Live reads | `describeLive` and `skipIf(shouldSkipLiveTests())` blocks in the files `vitest.live.config.ts` lists | `vitest.live.config.ts` | `pnpm test:live` | Navidrome reads, one shared login | Before a release |
| Playback integration | `tests/integration/playback/` | `vitest.playback.config.ts` | `pnpm test:playback` (user only) | The user's live mpv queue, which it clears, and Navidrome reads | After a playback change |
| Coordination | `tests/integration/coordination/` | `vitest.playback.config.ts` | `pnpm test:playback` (user only) | Child `dist/web/main.js` processes on random ports, and mpv on the default pipe, which teardown quits | After a change to player startup, ports or leases |
| End-to-end | `tests/e2e/` | `tests/e2e/playwright.config.ts` | `pnpm test:e2e` | One isolated `navidrome-web` instance with its own store, port and mpv, Navidrome reads, now-playing notices, and the machine's audio output at the test volume (`TEST_VOLUME` in `fixtures.ts`) | After a web remote or jukebox change |

### Playback Integration Tests (separate suite)

Live-mpv playback tests live in `tests/integration/playback/` and are
**excluded from `pnpm test:run`**. The suite also runs the multi-process tests in
`tests/integration/coordination/`. The user runs it on demand, since it clears
the live mpv queue:

```bash
pnpm test:playback   # pnpm build, then vitest with vitest.playback.config.ts
```

They require:
- A real mpv binary on PATH (or `playback.mpvPath` in the store / `MPV_PATH`)
- A reachable Navidrome instance (per the seeded `settings.json` store)
- A current `dist/`, which the script builds first. The coordination tests spawn
  `dist/web/main.js`, so a direct vitest run against a stale `dist/` tests old code.

Tests skip when mpv is not found, when `SKIP_INTEGRATION_TESTS` or
`MOCK_ONLY_TESTS` is `true`, or in CI without Navidrome credentials in the
seeded store. An unreachable Navidrome fails the suite. It does not skip.
Use `describePlayback` / `itPlayback` from `tests/integration/playback/helpers.ts` instead of
raw `describe`/`it`. Use `waitFor` for async mpv state polling instead
of fixed `setTimeout`.

### End-to-End Tests (separate suite)

The Playwright suite in `tests/e2e/` drives the web remote in jukebox mode through a host
browser context and guest browser contexts. `vitest.config.ts` excludes it, and CI does not
run it. Run it on demand:

```bash
pnpm test:e2e   # pnpm build, then playwright test -c tests/e2e/playwright.config.ts
```

Prerequisites:
- Navidrome `url`, `username` and `password` in your `settings.json` store (`NAVIDROME_CONFIG_PATH` honored)
- mpv on PATH or at `playback.mpvPath`, and a working audio output device
- The Chromium browser, installed once with `pnpm exec playwright install chromium`
- The albums The Slip and Ghosts I–IV by Nine Inch Nails in the library
- On Linux, `XDG_RUNTIME_DIR` set to your runtime folder, where PipeWire and PulseAudio keep their sockets

`harness/global-setup.ts` fails before any test with a message that names the missing
prerequisite when the store has no usable Navidrome login, mpv is not found, `XDG_RUNTIME_DIR`
is unset on Linux, `dist/web/main.js` is missing or the instance does not answer `/healthz`. A missing album fails each test that
needs it with the album named. An audio output that does not open fails each test that waits
for playback, naming the `null` output. A missing Chromium fails when Playwright launches
the browser. Failure traces and screenshots land in `tests/e2e/test-results/`, and the HTML
report in `tests/e2e/playwright-report/`. Both folders are gitignored.

**Isolation.** `globalSetup` starts one `dist/web/main.js` for the entire run, on a free port,
with a temp store and a private mpv pipe. The temp store copies only the Navidrome login and
`playback.mpvPath` from your store, so no test reaches Last.fm or LRCLIB. It sets
`webui.expose: true`, since a jukebox code needs a LAN-reachable bind, so the instance is
reachable on the LAN while the suite runs. The child gets its own `USERNAME` (Windows) or
`XDG_RUNTIME_DIR` (POSIX), which `getDefaultIpcPath()` turns into a private pipe, so it spawns
its own mpv. When your `XDG_RUNTIME_DIR` is set, the child also gets `PIPEWIRE_RUNTIME_DIR` and
`PULSE_RUNTIME_PATH` on that folder, so its mpv still finds the audio server. The suite never
connects to the user's mpv, and setup fails when the private pipe equals the default one. Teardown runs after failed tests too. It shuts the instance down
through `/api/shutdown`, kills a child that is still alive, quits mpv on the private pipe only
and removes the temp folder.

**Scrobble rule.** The instance submits a scrobble once a track passes
`min(duration / 2, 240)` seconds, and Navidrome play counts must not change. The auto
`scrobbleGuard` fixture pauses mpv and fails the test when a track reaches 80 percent of that
point, and pauses mpv at each test end. A track shorter than 80 percent of the 30 seconds
the instance counts never trips it. The margin covers an instance that keeps Navidrome's
duration while mpv reports a shorter one. While mpv reports no duration, the guard trips at 80
percent of the scrobble point of the shortest track the instance counts. So no test seeks
forward, and each test keeps every track's playing time short. Now-playing notices to Navidrome are accepted.

**Fixtures** (`fixtures.ts`). Import `test` and `expect` from `fixtures.ts`, never from
`@playwright/test`.
- `instance`: the port, loopback base URL, admin password and private pipe path.
- `hostPage`: a `HostPage` in its own context with the run's admin session, open at `/admin`
  and showing "Live". The admin logs in once per run in `globalSetup`, since the login throttle
  counts every attempt. Only a test of the login form logs in again, in a fresh context.
- `newGuestPage()`: opens a new context with no session and no base URL, and returns a
  `GuestPage` that has loaded nothing, for a join that must fail before the page loads.
- `openGuest(joinLink, { keepWelcome })`: opens a `newGuestPage()` per guest, joins through the
  link, closes the welcome dialog unless `keepWelcome` is set, and returns the `GuestPage`.
  Each guest context closes at test end. `joinGuest()` in `fixtures.ts` wraps it and also returns
  the guest's label and session id from the guest list.
- `jukebox`: an `AdminApi` that calls the API as the admin session, for setup and backend
  checks (open, read or close a code, guests, bans, ban a guest, jukebox settings, queue, volume,
  play or queue a song, the admin session's role). `postResponse()` returns the raw answer, for a test of a refusal.
- Playwright's own `page`: a fresh context at the loopback base URL with no session, for the
  login form, the root redirect, a join that must fail and a guest that joins over loopback
  through `/guest#k=<key>`.
- `mpv`: an `MpvProbe` on the private pipe. `waitUntilPlaying()` passes once mpv is unpaused,
  not idle, on an audio output other than `null`, and `time-pos` rises. `queueSongIds()` reads
  the song id of each mpv playlist entry, for a backend check of the queue.
- Auto fixtures: `resetState` closes the jukebox, removes every ban, clears the queue, restores
  the default guest song limit and share link, and sets the volume to `TEST_VOLUME` before each
  test. `scrobbleGuard` is described above.

**Page objects** (`pages/`). `HostPage` and `GuestPage` hold locators and actions only. Specs
hold the assertions. Add a locator or action a test needs to its page object, not to the spec.

**Adding a spec.** Create `tests/e2e/specs/<area>.e2e.ts`. Each test sets up its own state
through fixtures and never depends on another test. Each test checks the UI and the backend
effect, such as the page text and the `jukebox` API answer or an `mpv` property. Every guest
that opens a join link joins from this machine's LAN address, and the instance allows one address
60 join attempts an hour (`LOCAL_JOINS_PER_HOUR` in `src/webui/auth/auth-service.ts`), refused
ones included. So the specs of one run make at most 60 join attempts through join links together.

**Locator and assertion rules.**
- Locate by role and accessible name first, then label, then text. Scope a locator to its
  dialog by the dialog's accessible name where dialogs share a button name such as "Close".
  A name matches as a substring, so pass `exact: true` where one dialog's name holds another's,
  such as "Jukebox" and "Jukebox QR code".
- A control with no accessible name gets one in `src/webui/public/` (an `aria-label` or a role)
  when that adds no visible change. Otherwise locate it by its existing `id` scoped to its
  dialog. Add a `data-testid` only when neither fits.
- Use web-first assertions (`toBeVisible`, `toHaveText`, `toHaveCount`) and `expect.poll` for
  backend state. No `waitForTimeout` and no fixed sleeps. Lint fails on `waitForTimeout` and on
  a conditional in a test.
- A native `confirm()` is dismissed unless a `page.once('dialog')` handler is registered before
  the click. Register one before every click that opens a prompt, and assert the prompt text.
  `HostPage.acceptNextPrompt()` and `GuestPage.acceptNextPrompt()` register one that accepts the
  prompt and resolves its text. `HostPage.dismissNextPrompt()` dismisses it instead.

**Content rule.** Test code names only the albums The Slip and Ghosts I–IV by Nine Inch Nails,
which `README.md` names in its license section. `content.ts` finds their songs and fails with
the missing album named. Every other song or album is picked without naming it.

**Product defects.** A test that fails from a product defect gets the product fix, with a unit
test where the unit suite covers that module. Never weaken a test to get green. A fix that
would change documented user-visible behavior is escalated to the user first.

### Live Read Tests (separate suite)

Live reads run against a real Navidrome. `pnpm test:run` sets
`SKIP_INTEGRATION_TESTS` in `vitest.config.ts`, so their `describeLive` /
`skipIf(shouldSkipLiveTests())` blocks skip there and the default run stays
deterministic. Run them on demand:

```bash
pnpm test:live   # vitest.live.config.ts
```

Two reasons they are separated, both measured:

- **Navidrome rate-limits concurrent logins.** Four simultaneous `/auth/login`
  calls all return 429 while two succeed. Vitest's default forks pool gives each
  file its own worker, so four live files authenticated at once and failed
  together. `vitest.live.config.ts` uses `singleFork` + `isolate: false` so all
  four share one process and the suite authenticates exactly **once**.
- **Their keep-alive sockets raced fork teardown**, surfacing as an
  `ERR_IPC_CHANNEL_CLOSED` unhandled rejection: exit code 1 with zero test
  failures, on roughly 2 runs in 5. Keeping them out of the parallel pool
  removes that race.

`include` in that config is an explicit file list because live blocks sit inside
files that also hold mocked tests. **A new file with a `describeLive` block must
be added there**, or its live tests never run.

### Current Test Coverage
Unit tests mirror `src/`, with one subdirectory per `src/` area under `tests/unit/`.
`tests/unit/e2e-harness/` tests the e2e harness logic that needs no instance.

---

## Common Patterns Reference

### Pagination Testing
Test limit/offset parameters are respected, verify response structure.

### Error Handling
Mock network failures, API errors, validation failures - ensure graceful handling.

### Input Validation
Test required fields, format validation, boundary conditions.

### Feature Detection
Test conditional tool registration based on configuration flags.

### Edge Cases
Empty results, special characters, unicode, oversized inputs.

---

## API-Specific Notes

### Navidrome APIs
- **REST API**: Use `request()` for CRUD operations
- **Subsonic API**: Use `subsonicRequest()` for stars/ratings
- **Response Types**: Paginated vs Search responses have different structures

### Mock Factories
```typescript
// Write operations
const mockClient = createMockClient();

// Read operations
const liveClient = await getSharedLiveClient();

// Mock data
import { mockPlaylist } from '../../factories/mock-data.js';
```

---

## Quality Gates

**MUST pass before completion:**
```bash
pnpm test:run         # mocked suite, deterministic
pnpm lint            # 0 errors/warnings
pnpm typecheck       # 0 type errors
pnpm typecheck:tests # 0 type errors in tests/ (relaxed strictness)
pnpm check:dead-code # 0 unused exports

# Or run all at once:
pnpm check:all       # lint + typecheck + typecheck:tests + dead-code
pnpm test:all        # test:run + test:live + check:all
```

`pnpm test:run` no longer covers Navidrome API compatibility, since the live
blocks skip there. Run `pnpm test:live` (or `pnpm test:all`) before a release,
or a breaking Navidrome change will not surface.

---

## Environment Configuration

Runtime config comes from a `settings.json` store, not env. A setup file
(`tests/helpers/setup-config-store.ts`, a `setupFiles` entry in `vitest.config.ts`,
`vitest.live.config.ts` and `vitest.playback.config.ts`) runs once per test file.
It writes a **throwaway** store to a temp path, points `NAVIDROME_CONFIG_PATH` at
it, and deletes it after the file finishes, so the suite never touches the real
store.

The temp store is seeded (via `buildFormSeed()`) from, in order: the developer's real
canonical store if present, otherwise inline env (what `test:ci` injects), otherwise a
legacy `.env`. So:
- Live-read tests get real credentials from your store / env / `.env`.
- `test:ci` keeps injecting `NAVIDROME_URL/USERNAME/PASSWORD` as env — the setup turns
  them into the temp store; live tests then skip via `SKIP_INTEGRATION_TESTS`.
- Tests needing a *specific* deterministic `Config` should build it with
  `makeTestConfig()` (`tests/helpers/test-config.ts`) instead of `loadConfig()`.

---

## Key Anti-Patterns to Avoid

❌ Testing specific content: `expect(song.title).toBe('Bohemian Rhapsody')`
❌ Real server modifications: `await createPlaylist(liveClient, {...})`
❌ Unmocked external calls: Direct fetch to Last.fm/Radio Browser
❌ Individual auth sessions: Rate limiting and test interference

✅ Structure validation: `expect(song).toHaveProperty('title')`
✅ Mocked modifications: `mockClient.request.mockResolvedValue(...)`
✅ Mocked externals: `global.fetch = vi.fn()`
✅ Shared authentication: Prevents rate limiting

---

## Summary

**Test Philosophy**: Hybrid approach - live reads for API compatibility, mocked writes for safety. Outside `tests/e2e/`, always validate structure/behavior, never content/data. Use shared authentication and mock external services. Maintain 100% test pass rate with comprehensive coverage of critical operations.