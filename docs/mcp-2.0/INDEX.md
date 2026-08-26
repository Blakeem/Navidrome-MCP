# MCP 2.0 (spec revision 2026-07-28) — doc set index

Working set for the `navidrome-mcp` v2.x → MCP-2.0 migration plan. Every file below is a
**verbatim capture** (HTML→markdown only); each carries a source header with URL, version,
and retrieval date. Nothing here is summarized — files were split at heading boundaries and
irrelevant pages removed, never rewritten.

Four groups:

- `spec-2026-07-28/` — normative specification (modelcontextprotocol.io), retrieved 2026-08-11
- `sdk-v2/` — TypeScript SDK **v2.0.0-beta.1** docs, typed API reference, package READMEs and CHANGELOGs
- `ext-tasks/` — the `io.modelcontextprotocol/tasks` **extension** (draft, separate repo — not part of the revision above)
- `mcp-blog/` — official MCP blog posts (rationale, release announcements)

---

## Start here (the questions the plan has to answer)

| Question | Read, in order |
| --- | --- |
| What is backward-incompatible? | `spec-2026-07-28/changelog.md` → `spec-2026-07-28/basic/index.md` (§Statelessness) → `spec-2026-07-28/basic/versioning.md` |
| What is the required new shape? | `spec-2026-07-28/server/discover.md`, `spec-2026-07-28/basic/transports/streamable-http.md`, `spec-2026-07-28/basic/patterns/mrtr.md` |
| What does the TS SDK v2 call it? | `sdk-v2/protocol-versions.md` → `sdk-v2/migration-support-2026-07-28.md` → `sdk-v2/migration-upgrade-to-v2/*` |
| What are the exact v2 signatures? | `sdk-v2/api/create-mcp-handler.md`, `sdk-v2/api/serve-stdio.md`, `sdk-v2/api/server-options.md` |
| Removed vs deprecated? | `spec-2026-07-28/deprecated.md` + `sdk-v2/migration-upgrade-to-v2/07-behavioral-changes-and-unchanged-apis.md` |
| What must be redesigned (session-dependent code)? | `spec-2026-07-28/server/tools.md` (§Stateful Tools) → `spec-2026-07-28/basic/authorization/security-best-practices-2-…` (§State Handle Hijacking) → `sdk-v2/serving-sessions-state-scaling.md` → `sdk-v2/api/request-state-codec.md` |
| Should long-running playback become Tasks? | `ext-tasks/overview.md` → `ext-tasks/repo-readme-status.md` (maturity) → `ext-tasks/specification.md` → `ext-tasks/sep-2663-rationale-and-backward-compatibility.md`. **Read inconsistency 6 in Coverage notes first — the SDK does not serve `tasks/*` on the 2026 era.** |
| How do I keep the Host/Origin filter? | `sdk-v2/api/host-header-validation-node.md` + `sdk-v2/api/origin-validation-node.md` (plain `node:http`, which is what this project runs) |

---

## `spec-2026-07-28/` — normative specification

### Base protocol

- `spec-2026-07-28/index.md` — spec root: overview, base-protocol properties ("stateless, self-contained requests; per-request capability negotiation"), extension list, security principles. Read first for the chapter map.
- `spec-2026-07-28/architecture.md` — client/host/server roles, the per-request capability-negotiation model, sequence diagram of discover → request → MRTR → subscriptions. Read when you need the whole shape on one page.
- `spec-2026-07-28/basic/index.md` — **the most load-bearing spec page.** JSON-RPC message shapes, `resultType`, the full error-code allocation policy and code table, **§Statelessness** (what a server may and may not infer across requests), auth posture, JSON Schema rules, and the complete **`_meta` reserved-key tables** (per-request `protocolVersion` / `clientInfo` / `clientCapabilities` / `logLevel`, per-response `serverInfo`). Read before touching `src/capabilities.ts` or any handler.
- `spec-2026-07-28/basic/versioning.md` — version negotiation without a handshake, `UnsupportedProtocolVersionError` (`-32022`) shape, extension negotiation, **backward compatibility with `initialize`-based versions + the client/server era compatibility matrix**. Read when deciding whether to ship dual-era.
- `spec-2026-07-28/changelog.md` — every change against `2025-11-25`, numbered, with SEP links. The fastest inventory of what breaks. Read first.
- `spec-2026-07-28/deprecated.md` — the deprecated-features registry: feature, SEP, deprecated-in revision, migration path, earliest removal. Read to decide migration urgency (what still works vs what must not be built on).

### Message patterns

- `spec-2026-07-28/basic/patterns/index.md` — the three patterns (request/response, MRTR, subscribe-and-notify) and the rule that **servers MUST NOT initiate JSON-RPC requests**. Read before designing any server-initiated flow.
- `spec-2026-07-28/basic/patterns/mrtr.md` — **Multi Round-Trip Requests in full**: `InputRequests` / `InputResponses` / `InputRequiredResult`, which methods may return it, server and client requirements, `requestState` integrity rules. The candidate replacement for anything that needed a session.
- `spec-2026-07-28/basic/patterns/subscriptions.md` — `subscriptions/listen`: notification filter table, acknowledgment, `subscriptionId` correlation, graceful close. Replaces the HTTP GET stream and `resources/subscribe`.
- `spec-2026-07-28/basic/patterns/cancellation.md` — `notifications/cancelled` vs stream-close, per transport; timeout rules. Read when touching long-running tool calls (playback).
- `spec-2026-07-28/basic/patterns/progress.md` — `progressToken` in `_meta` and `notifications/progress`. Short; read alongside cancellation.

### Transports

- `spec-2026-07-28/basic/transports/index.md` — what a transport binding must provide, custom transports, and where backward-compat detection lives. Read before the two binding pages.
- `spec-2026-07-28/basic/transports/stdio.md` — stdio framing, stdout/stderr rules, shutdown, unexpected termination, and the **`server/discover` era-probe fallback rules**. Directly governs `src/index.ts`.
- `spec-2026-07-28/basic/transports/streamable-http.md` — **the whole HTTP chapter**: single POST endpoint, SSE response streams, removal of the GET stream and of sessions, `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` headers, `x-mcp-header` → `Mcp-Param-*` mirroring with Base64 sentinel encoding, server validation + `HeaderMismatch` (`-32020`), backward compatibility with `Mcp-Session-Id` / `Last-Event-ID` era clients. Directly governs `src/transport/http.ts`.

### Server features

- `spec-2026-07-28/server/discover.md` — the mandatory `server/discover` RPC: request/response JSON, `DiscoverResult` fields, when a client calls it. Servers **MUST** implement it.
- `spec-2026-07-28/server/tools.md` — `tools/list` + `tools/call` wire shapes, tool definition fields, tool names, `x-mcp-header`, content types, `structuredContent` / `outputSchema`, error handling, and **§Stateful Tools** (the explicit-handle pattern that replaces per-session state). Read when deciding the fate of `set_active_libraries`.
- `spec-2026-07-28/server/resources.md` — `resources/list`, `resources/read`, templates, annotations, URI schemes, and the `-32002` → `-32602` error-code change. Governs `src/resources/index.ts`.
- `spec-2026-07-28/server/utilities/caching.md` — required `ttlMs` / `cacheScope` on cacheable results, cache key rules, interaction with notifications and pagination, security of `"public"` scope. Read with the two list pages.
- `spec-2026-07-28/server/utilities/pagination.md` — opaque cursors, which operations paginate, client/server obligations.
- `spec-2026-07-28/server/utilities/logging.md` — **deprecated** feature, kept for one fact the plan needs: the per-request `io.modelcontextprotocol/logLevel` `_meta` key replaces `logging/setLevel`, and **absence means the server emits nothing**.

### Extensions

- `spec-2026-07-28/extensions/overview.md` — extension identifiers, official extension repos, the SEP-based lifecycle, and the client/server `extensions` capability negotiation JSON. Read when asking whether the optional integrations (Last.fm, radio, lyrics, playback) should be extensions, and before the `ext-tasks/` group. **Note:** unversioned/rolling page — see Coverage notes.

### Authorization

- `spec-2026-07-28/basic/authorization/index.md` — the auth chapter proper: roles, standards, discovery, registration, scope selection, authorization flow steps, resource parameter, token usage, refresh tokens, error handling.
- `spec-2026-07-28/basic/authorization/authorization-server-discovery.md` — RFC 9728 protected-resource metadata and AS metadata discovery requirements.
- `spec-2026-07-28/basic/authorization/client-registration.md` — Client ID Metadata Documents (the new preferred path), pre-registration, and **deprecated** Dynamic Client Registration; AS binding.
- `spec-2026-07-28/basic/authorization/security-considerations.md` — the MUSTs: audience binding, token theft, comms security, code protection, mix-up, open redirection, confused deputy, privilege restriction. Short — read this before the best-practices parts.
- `spec-2026-07-28/basic/authorization/security-best-practices-1-confused-deputy-and-token-passthrough.md` — part 1/3: introduction, Confused Deputy, Token Passthrough (why a server must never forward its own upstream token).
- `spec-2026-07-28/basic/authorization/security-best-practices-2-ssrf-state-handles-local-servers-stdio-proxies.md` — part 2/3: **SSRF** (relevant to the radio-stream validator), **State Handle Hijacking** (the security rules for the handle pattern that replaces session state), local-server compromise, OAuth URL validation, stdio-proxy security. The most project-relevant part.
- `spec-2026-07-28/basic/authorization/security-best-practices-3-oauth-client-attacks.md` — part 3/3: mix-up attacks, localhost redirect-URI impersonation, CIMD trust policies, scope minimization. Read only if the plan adds OAuth.

### Schema reference (`schema.ts`, split into 7 verbatim parts)

The canonical TypeScript schema — the specification's own source of truth. Split at the
file's own `/* section */` comments; every part carries the same source header.

- `spec-2026-07-28/schema/core-jsonrpc-errors-and-mrtr-types.md` — JSON/JSON-RPC envelope types, `RequestMetaObject` / `ResultMetaObject`, `Result` + `ResultType`, **every error code and typed error** (`HeaderMismatchError`, `UnsupportedProtocolVersionError`, `MissingRequiredClientCapabilityError`), `InputRequests` / `InputResponses` / `InputRequiredResult`, cancellation. The part you read most.
- `spec-2026-07-28/schema/discovery-capabilities-progress-pagination.md` — `DiscoverRequest` / `DiscoverResult`, **`ClientCapabilities` and `ServerCapabilities`**, `Icon`, `Implementation`, progress, `PaginatedResult`, `CacheableResult`. Read when rebuilding `src/capabilities.ts`.
- `spec-2026-07-28/schema/resources-and-subscriptions.md` — resource list/read/template types plus the whole `subscriptions/listen` type family.
- `spec-2026-07-28/schema/prompts-and-tools.md` — prompt types (kept: `ResourceLink` and `EmbeddedResource` live here and are used by tool results), `ListTools*`, `CallTool*`, `ToolAnnotations`, `Tool`.
- `spec-2026-07-28/schema/logging-sampling-and-content-blocks.md` — logging types, sampling types, and **`Annotations` / `ContentBlock` / `TextContent` / `ImageContent` / `AudioContent`** (needed for tool results even though sampling is deprecated).
- `spec-2026-07-28/schema/completion-roots-and-elicitation.md` — completion, roots, and the elicitation request/result + `PrimitiveSchemaDefinition` family (the wire shapes a server embeds in MRTR `inputRequests`).
- `spec-2026-07-28/schema/client-and-server-message-unions.md` — `ClientRequest` / `ClientNotification` / `ServerNotification` / `ServerResult` unions. Tiny; read to see the complete method surface of the revision.

---

## `sdk-v2/` — TypeScript SDK v2.0.0-beta.1

### Orientation

- `sdk-v2/readme.md` — repo README: package split, install commands, v1-vs-v2 support windows, minimal server example. Read first in this group.
- `sdk-v2/get-started-packages.md` — the nine published packages, which one to install, why `./stdio` is a subpath, when `core` is needed.
- `sdk-v2/get-started-first-server.md` — end-to-end minimal server with `registerTool` + `serveStdio` (Node 20+, ESM, zod v4). The shortest concrete before/after for `src/index.ts`.
- `sdk-v2/protocol-versions.md` — **the SDK's era model**: `legacy` vs `modern`, `versionNegotiation` modes (`legacy` / `auto` / `{pin}`), the probe, `createMcpHandler` / `serveStdio` serving both eras, and the canonical era-difference matrix. Read before any code decision.

### Migration (highest value for this plan)

- `sdk-v2/migration-index.md` — which of the two guides applies, and the codemod invocation (`npx @modelcontextprotocol/codemod@beta v1-to-v2 .`). One page; read first.
- `sdk-v2/migration-support-2026-07-28.md` — **adopting the 2026-07-28 revision on v2**: `versionNegotiation`, `createMcpHandler`, `serveStdio`, in-process testing, cancellation-by-stream-close, `requestState` as the replacement for per-session state (with the multi-phase state-machine example), per-era wire codecs, wire-only members, MRTR, the legacy shim, `subscriptions/listen`, `Mcp-Param-*`, cache hints, **§Tasks: deprecated wire vocabulary**, and the 2025-vs-2026 behavior matrix. **The single most useful file in the set.**
- `sdk-v2/migration-upgrade-to-v2/01-codemod-and-scope.md` — part 1/7: TL;DR path, what the codemod rewrites automatically, and the explicit list of what it cannot.
- `sdk-v2/migration-upgrade-to-v2/02-packaging-imports-transports.md` — part 2/7: the package split, Node 20 + ESM-only, monorepo/manifest handling, Jest/CJS caveats, zod duplication, staged migration, and **transport import changes** (`StreamableHTTPServerTransport` → `NodeStreamableHTTPServerTransport`, stdio subpaths, removed `SSEServerTransport` / `WebSocketClientTransport`).
- `sdk-v2/migration-upgrade-to-v2/03-handler-context-and-registration.md` — part 3/7: `extra` → `ctx` remap table, SEP-2577 deprecations in the SDK, **`setRequestHandler(Schema, …)` → method strings** (directly replaces `ListToolsRequestSchema` / `CallToolRequestSchema` registration), schema-less `request()`, and `registerTool` / Standard Schema / **zod ≥4.2 requirement**.
- `sdk-v2/migration-upgrade-to-v2/04-http-headers-and-errors.md` — part 4/7: Web-standard `Headers` reads, `hostHeaderValidation` relocation, and the **three error kinds** (`ProtocolError` / `SdkError` / `SdkHttpError`) with the complete `SdkErrorCode` table and the typed `ProtocolError` subclasses.
- `sdk-v2/migration-upgrade-to-v2/05-auth.md` — part 5/7: OAuth error consolidation, `AuthProvider`, RFC 9207 `iss` validation, DCR defaults, TLS requirement, scope step-up, credential/issuer binding, and the conformance obligations left to the implementer. Read only if the plan exposes authenticated HTTP.
- `sdk-v2/migration-upgrade-to-v2/06-types-and-schemas.md` — part 6/7: Zod `*Schema` constants moved to `@modelcontextprotocol/core`, `isSpecType` / `specTypeSchemas`, removed type aliases, and the **JSON Schema 2020-12 posture** (Ajv2020, widened `structuredContent`).
- `sdk-v2/migration-upgrade-to-v2/07-behavioral-changes-and-unchanged-apis.md` — part 7/7: runtime behavior changes that break tests (unknown-tool rejection, list auto-aggregation, lazy output-schema validation, stdio buffer cap, eager capability handlers, response caching), plus **Enhancements** and the **Unchanged APIs** list. Read when estimating test churn.

### Server-side API guides (prose)

- `sdk-v2/servers-tools.md` — `registerTool` with a zod schema, validation behavior, `outputSchema` + `structuredContent`, annotations. The v2 shape of every tool in `src/tools/`.
- `sdk-v2/servers-resources.md` — `registerResource`, `ResourceTemplate`, list callbacks, path sanitization, list-changed notification.
- `sdk-v2/servers-errors.md` — tool errors (`isError`) vs protocol errors, typed subclasses, and the `ProtocolErrorCode` table. Read alongside `src/utils/error-formatter.ts`.
- `sdk-v2/servers-input-required.md` — the SDK's MRTR surface: `inputRequired(...)`, `acceptedContent` / `inputResponse`, `requestState` + `createRequestStateCodec`, write-once handlers, the legacy shim. **The concrete API for anything that needed interactive or cross-call state.**
- `sdk-v2/servers-notifications.md` — `send*ListChanged`, `handler.notify.*`, the `ServerEventBus`, and how change notifications reach a `subscriptions/listen` stream.
- `sdk-v2/servers-logging-progress-cancellation.md` — `ctx.mcpReq.notify` / `log` / `signal`, and forwarding the abort signal into your own I/O. Read for playback and long-running tools.

### Serving / hosting (prose)

- `sdk-v2/serving-stdio.md` — `serveStdio(factory)`, stdout-is-the-wire, Inspector, shutdown. Governs `src/index.ts`.
- `sdk-v2/serving-http.md` — `createMcpHandler(factory)`, the per-request factory (`era`, `authInfo`, `requestInfo`), mounting via `toNodeHandler`, Host/Origin validation, `authInfo` pass-through, `responseMode`, shutdown. Governs `src/transport/http.ts`.
- `sdk-v2/serving-express.md` — `createMcpExpressApp()` (an `express()` with `express.json()` + DNS-rebinding protection pre-applied), `{ host, allowedHosts, allowedOrigins }`, passing `req.body` as `toNodeHandler`'s third argument, `requireBearerAuth` → `ctx.http.authInfo`. Read for the **default-vs-`0.0.0.0` allowlist semantics** even though this project mounts on plain `node:http`.
- `sdk-v2/serving-legacy-clients.md` — `legacy: 'stateless' | 'reject'`, `isLegacyRequest` routing in front of an existing sessionful deployment, and where SSE went. **Read for the `next` dist-tag / dual-era shipping decision.**
- `sdk-v2/serving-sessions-state-scaling.md` — what sessions still mean (2025-era only), event stores, resumability, and multi-node `ServerEventBus`. Read when arguing about what per-session server state is still legal.
- `sdk-v2/serving-web-standard.md` — `export default handler`, and the framework-agnostic `hostHeaderValidationResponse` / `originValidationResponse` guards. Read for the Host-filtering rewrite even if not deploying to Workers.
- `sdk-v2/serving-authorization.md` — `requireBearerAuth`, writing a token verifier, RFC 9728 metadata router, reading `ctx.http.authInfo`, per-tool scopes. Only relevant if the HTTP surface becomes authenticated.

### API reference — typed signatures (`ts.sdk.modelcontextprotocol.io/v2/api/…`)

TypeDoc pages: exact option-object fields, defaults and return types for the serving
entry points the prose guides only describe. Every page is pinned to SDK source commit
`cc4b41617ce…`. Read these when writing the code, the prose guides when deciding what to write.

- `sdk-v2/api/create-mcp-handler.md` — `createMcpHandler()`, `CreateMcpHandlerOptions` (`legacy`, `responseMode`, `bus`, `keepAliveMs` = 15000, `maxSubscriptions` = 1024, `onerror`), `McpHttpHandler` (`fetch` / `close` / `notify` / `bus`), `McpRequestContext` (`era`, `authInfo`, `requestInfo`), `McpServerFactory`, `isLegacyRequest()` with its full routing semantics, `legacyStatelessFallback()`. **The single reference for `src/transport/http.ts`.**
- `sdk-v2/api/serve-stdio.md` — `serveStdio()`, `ServeStdioOptions` (`legacy: 'serve' | 'reject'`, `transport`, `onerror`, `maxSubscriptions`), `StdioServerHandle.close()`. Note the stdio posture values differ from the HTTP ones (`'serve'`, not `'stateless'`). Governs `src/index.ts`.
- `sdk-v2/api/server-options.md` — `ServerOptions` type declaration only: `capabilities`, `instructions`, **`cacheHints`** (per-operation `ttlMs`/`cacheScope`, default `ttlMs: 0` + `private`), **`inputRequired`** (`legacyShim`, `maxRounds` = 8, `roundTimeoutMs` = 600_000), **`requestState.verify`** (the frozen `-32602` behavior and the load-bearing resolved value), `jsonSchemaValidator`.
- `sdk-v2/api/request-state-codec.md` — `createRequestStateCodec()`, `RequestStateCodecOptions` (`key` ≥ 32 bytes, `ttlSeconds` = 600, `bind`), `RequestStateCodec.mint/verify`, the `"v1."b64url(...)"."b64url(mac)` wire shape, and "signed, not encrypted". **The concrete integrity mechanism for any state handle replacing session state.**
- `sdk-v2/api/per-request-response-mode.md` — the three `PerRequestResponseMode` values (`auto` / `sse` / `json`) that `responseMode` is typed against. One screen; read with `create-mcp-handler.md`.
- `sdk-v2/api/server-event-bus.md` — `ServerEventBus` / `InMemoryServerEventBus` (`publish`, `subscribe`, `listenerCount`), `ServerNotifier` (`toolsChanged`, `resourcesChanged`, `resourceUpdated`, `promptsChanged`), `ServerEvent`. Read if list-changed notifications must reach `subscriptions/listen` streams.
- `sdk-v2/api/stdio-server-transport.md` — `StdioServerTransport` constructor (`_stdin`, `_stdout`, `maxBufferSize` default 10 MB), `start`/`send`/`close`, the `onmessage`/`onerror`/`onclose` hooks. Read only if supplying your own transport to `serveStdio`.
- `sdk-v2/api/supporting-reference-types.md` — the referenced types extracted from the package index so the option objects above have no dangling names: `AuthInfo`, `CacheHint` / `CacheScope`, `BaseContext` (**the whole `ctx.mcpReq` shape**: `envelope`, `inputResponses`, `requestState`, `notify`, `send`, `signal`), `ServerContext` (with the deprecated `elicitInput` / `log` / `requestSampling`), `ProtocolOptions`, `RequestStateAccessor`, the JSON-Schema validator types. **Read this for `ctx` field names.**

#### Host / Origin validation (DNS-rebinding protection)

Same two function names exist in three packages with three different shapes — pick by how
you mount. This project serves plain `node:http`, so the `-node` pair is the relevant one.

- `sdk-v2/api/host-header-validation-node.md` — `@modelcontextprotocol/node`: `hostHeaderValidation(allowedHostnames)` → `(req, res) => boolean` guard (returns `false` **after** having answered `403`), `localhostHostValidation()`. Directly replaces this project's hand-rolled Host filter.
- `sdk-v2/api/origin-validation-node.md` — `@modelcontextprotocol/node`: `originValidation(allowedOriginHostnames)` → `(req, res) => boolean`, `localhostOriginValidation()`; missing `Origin` passes, unparseable is rejected.
- `sdk-v2/api/host-header-validation-server.md` — `@modelcontextprotocol/server`: the framework-agnostic trio `validateHostHeader()` → `HostHeaderValidationResult` (`missing_host` / `invalid_host_header` / `invalid_host`), `hostHeaderValidationResponse()` → `Response | undefined`, `localhostAllowedHostnames()`. Read for the result-code vocabulary and the port-agnostic / IPv6-bracket rules.
- `sdk-v2/api/origin-validation-server.md` — `@modelcontextprotocol/server`: `validateOriginHeader()` → `OriginValidationResult` (`invalid_origin_header` / `invalid_origin`), `originValidationResponse()`, `localhostAllowedOrigins()`, and the **deny-on-failure** rule including the opaque `null` origin.
- `sdk-v2/api/host-header-validation-express.md` — `@modelcontextprotocol/express`: same names as Express `RequestHandler` middleware. Read only if the config GUI ever moves to Express.
- `sdk-v2/api/origin-validation-express.md` — `@modelcontextprotocol/express`: `originValidation()` / `localhostOriginValidation()` as Express middleware.

### Advanced / reference

- `sdk-v2/advanced-low-level-server.md` — the low-level `Server`: `setRequestHandler(method, handler)`, hand-written `tools/list`, `fromJsonSchema` validation, and `mcp.server` as the per-method escape hatch. Read if keeping the current registry-style architecture.
- `sdk-v2/advanced-custom-methods.md` — non-spec methods with `{ params, result }` schemas, custom notifications, and **declaring `capabilities.extensions`**. Read together with `ext-tasks/` and inconsistency 6.
- `sdk-v2/advanced-custom-transports.md` — the `Transport` interface contract, framing helpers, `sessionId` / `setProtocolVersion` / `setSupportedProtocolVersions` / `hasPerRequestStream`.
- `sdk-v2/advanced-schema-libraries.md` — Standard Schema support (zod v4, ArkType, Valibot), `fromJsonSchema`, and swapping the JSON Schema validator. Read with the zod-4.2 requirement in migration part 3.
- `sdk-v2/advanced-wire-schemas.md` — `@modelcontextprotocol/core` wire schemas for code holding raw JSON.
- `sdk-v2/advanced-gateway.md` — `client.connect(transport, { prior })` with a persisted `DiscoverResult`; what `server/discover` returns in practice.
- `sdk-v2/testing.md` — driving `handler.fetch` in-process with a real `Client`, `InMemoryTransport.createLinkedPair()` (2025-era only), and spawning for stdio coverage. Read when planning the test-suite migration.
- `sdk-v2/troubleshooting.md` — exact error messages and fixes (`TS2589` duplicate zod, `ERA_NEGOTIATION_FAILED`, `METHOD_NOT_SUPPORTED_BY_PROTOCOL_VERSION`, missing `SSEServerTransport`).

### Package READMEs and CHANGELOGs

- `sdk-v2/package-server-readme.md` — install line, beta warning, and the TypeScript ≥6.0 `"types": ["node"]` requirement.
- `sdk-v2/package-middleware-node-readme.md` — the complete export list of `@modelcontextprotocol/node` (`NodeStreamableHTTPServerTransport`, `toNodeHandler`, `toWebRequest`, …) and two mounting examples.
- `sdk-v2/package-server-legacy-readme.md` — what the frozen v1 copy provides (`/sse`, `/auth`) and that it is planned for removal in v3.
- `sdk-v2/package-server-changelog-1-beta1-and-alpha4-major.md` — part 1/4: beta.1 note plus the **alpha.4 Major Changes** — per-era wire codecs, `createMcpHandler` web-standard shape, hidden wire-only members, `resources/read` `-32602`, JSON Schema 2020-12 posture.
- `sdk-v2/package-server-changelog-2-alpha4-minor.md` — part 2/4: alpha.4 Minor Changes — `createRequestStateCodec`, cache hints, `MethodNotSupportedByProtocolVersion`, the legacy-stateless default, MRTR server side, Origin validation, SEP-2243 header validation, `serveStdio`, **the `-32020/-32021/-32022` renumber**, `subscriptions/listen`, `server/discover` wiring.
- `sdk-v2/package-server-changelog-3-alpha4-patch.md` — part 3/4: alpha.4 Patch Changes — deprecated accessors, rejection-code pinning, `ctx.mcpReq.log()` channel change, eventStore store-first semantics, draft re-pins.
- `sdk-v2/package-server-changelog-4-alpha3-to-alpha1.md` — part 4/4: alpha.3 → alpha.1 — **tasks removal (SEP-2663) and what stayed as deprecated wire vocabulary**, custom-method support, and the original v2 package split entries.
- `sdk-v2/package-core-changelog.md` — schema-package changes (`RequestMetaEnvelopeSchema` removed; `SubscriptionsListen*` added).
- `sdk-v2/package-middleware-node-changelog.md` — `@modelcontextprotocol/node` history: `toNodeHandler`, `toWebRequest`, Host/Origin guards for plain `node:http`.
- `sdk-v2/package-server-legacy-changelog.md` — frozen-package history, including the `mcpAuthRouter` `iss` behavior change.

---

## `ext-tasks/` — the `io.modelcontextprotocol/tasks` extension (draft)

Not part of the `2026-07-28` revision: the core protocol *removed* experimental tasks and
moved them to this separately-versioned extension repo. Read this group only for the
"should long-running playback return a task handle?" decision — and read inconsistency 6
before costing it.

- `ext-tasks/repo-readme-status.md` — the repo's own **maturity disclaimer**: experimental, "not an official extension", may change significantly or be discontinued, still working toward SEP-2663. Read this first — it decides whether the rest is actionable.
- `ext-tasks/overview.md` — the extension's landing page: why tasks, progressive enhancement with the `-32003` Missing-Required-Client-Capability example, Architecture diagram (client / server / task store / worker), lifecycle sequence diagram, the **task-status state diagram + status table**, mid-flight input, cancellation, security, and **`Supported Methods`: `tools/call` only**. The one-page shape of the whole extension.
- `ext-tasks/specification.md` — the **normative spec**: extension identifier, capability negotiation JSON (client `_meta` + server `server/discover`), polymorphic results (`resultType: "task"`), the `Task` / `CreateTaskResult` shapes, `tasks/get` / `tasks/update` / `tasks/cancel` request-response pairs, status notifications over `subscriptions/listen`, the `Mcp-Name` routing-header MUST, a full worked message flow, error handling (protocol vs task-execution errors), reservations, security and backwards compatibility. Read for wire shapes.
- `ext-tasks/schema-types.md` — `schema/draft/schema.ts` verbatim: the TypeScript source of truth the repo generates its Zod schemas and JSON Schema from. Read when writing types.
- `ext-tasks/sep-2663-rationale-and-backward-compatibility.md` — SEP-2663 minus its (duplicated) Specification section: Abstract, **Motivation** (why the `2025-11-25` tasks feature failed: fragile handshake, blocking `tasks/result`, undefinable `tasks/list` scope), **Rationale** per design choice (including **§Composition with Multi Round-Trip Requests** — MRTR first, then `CreateTaskResult`), the **Backward Compatibility matrix** vs the removed legacy `tasks.*`, Security Implications, Reference Implementation. Read for "what changed and why".

---

## `mcp-blog/` — official announcements and rationale

- `mcp-blog/2026-07-28-final-release.md` — the release post for the final revision: stateless core, `server/discover`, header routing, MRTR, cacheable lists, extensions, auth hardening, deprecation policy, and the state-handle guidance. Shortest authoritative summary of the whole change. (Marketing "Ecosystem support" section was omitted at capture time — noted in its header.)
- `mcp-blog/2026-07-28-release-candidate.md` — the fullest **rationale** post: before/after HTTP wire examples, why sessions were removed, the explicit-handle pattern, extensions becoming first-class, auth hardening, JSON Schema 2020-12, and the governance/lifecycle model. Read for the "why" behind every breaking change. **One code example predates the final spec — see Coverage notes.**
- `mcp-blog/sdk-betas-2026-07-28.md` — per-SDK beta status and, specifically, the **TypeScript v2 split-package section**: what opting in means, that upgrading the SDK does not by itself change the wire, and the two-guide migration structure. Read to justify the `next` dist-tag / pre-release plan.
- `mcp-blog/future-of-mcp-transports.md` — the Dec 2025 Transport Working Group roadmap that both posts above cite as the plan they complete. Read only for design motivation (infrastructure complexity, scaling friction, ambiguous session scope). **Pre-RC: several mechanisms here shipped differently — its own header says which.**

---

## Coverage notes

**Scope anchor for round 2.** The written brief file this set was gathered against
(`…/scratchpad/mcp2-brief.md`) no longer exists on disk at re-curation time, so relevance
decisions in this round were made against the scope as recorded in the round-1 index above
— `navidrome-mcp` v2.x → MCP spec revision `2026-07-28` on TypeScript SDK v2, server side
only. Anything the original brief asked for that is not visible in that record could have
been dropped without my noticing.

### Inconsistencies between sources

1. **MRTR `inputRequests` entry shape — release-candidate blog vs final spec.**
   `mcp-blog/2026-07-28-release-candidate.md` (§"Server-to-client requests, restructured")
   shows an `InputRequiredResult` whose entry is
   `{"type": "elicitation", "message": "…", "schema": {…}}`.
   The final spec, `spec-2026-07-28/basic/patterns/mrtr.md` (§InputRequests) and the
   `InputRequests` type in `spec-2026-07-28/schema/core-jsonrpc-errors-and-mrtr-types.md`,
   require a full request object:
   `{"method": "elicitation/create", "params": {"mode": "form", "message": "…", "requestedSchema": {…}}}`.
   The blog example is a pre-final sketch (RC locked 2026-05-21). **Use the spec shape.**

2. **`-32042` (URL elicitation required) — SDK error table vs spec error policy.**
   `sdk-v2/servers-errors.md` lists `UrlElicitationRequired` `-32042` in what it calls "the
   complete vocabulary of wire codes the SDK sends and recognizes", while
   `spec-2026-07-28/basic/index.md` (§Error Codes) states `-32042` is `2025-11-25`-only and
   implementations of this revision **MUST NOT** emit it.
   Reconciled by `sdk-v2/migration-support-2026-07-28.md` (§Multi-round-trip requests): on a
   2026-07-28 request the SDK fails locally instead of emitting `-32042`. The flat table is
   era-agnostic, not wrong — but do not read it as "emit this on 2026-07-28".

3. **`HeaderMismatch` code number inside the SDK changelog.**
   `sdk-v2/package-server-changelog-3-alpha4-patch.md` contains an entry stating the HTTP
   header/body mismatch code is `-32001` (`HEADER_MISMATCH`). It is superseded within the
   same release by `sdk-v2/package-server-changelog-2-alpha4-minor.md` ("`HeaderMismatch` is
   now `-32020` (was `-32001`)"), which matches `spec-2026-07-28/basic/index.md` and
   `spec-2026-07-28/basic/transports/streamable-http.md`. **`-32020` is current**; the
   `-32001` entry is historical alpha record. (Unrelated: `-32001` remains an SDK convention
   for "Session not found" on the 2025-era stateful HTTP transport.)

4. **Schema-artifact location — SDK guide is stale relative to the released spec.**
   `sdk-v2/migration-support-2026-07-28.md` opens with "until the revision is finalized, the
   spec repository publishes the 2026-07-28 schema under `schema/draft/` — there is no
   `schema/2026-07-28/` directory yet". The SDK guide is from `v2.0.0-beta.1` (pre-release);
   the captured schema in `spec-2026-07-28/schema/*` comes from
   `schema/2026-07-28/schema.ts`, which now exists. Tooling advice in that paragraph is
   obsolete; the type content is not.

5. **SEP-2663 names the base revision `2026-06-30`, not `2026-07-28`.**
   `ext-tasks/sep-2663-rationale-and-backward-compatibility.md` (§Abstract list of base-protocol
   changes, and the **`Protocol Version` column of the Backward Compatibility table**) targets
   "the `2026-06-30` specification". No other file in the set knows that date: the revision
   shipped as `2026-07-28` (`spec-2026-07-28/changelog.md`, whose item 6 is this very tasks
   move). The SEP was Created 2026-04-27 and is Final-status/frozen, so it kept the revision's
   pre-final date. **Read `2026-06-30` in that file as `2026-07-28`.**

6. **The Tasks extension requires methods the TS SDK v2 refuses to serve on the 2026 era.**
   `ext-tasks/specification.md` (§Supported Methods, §Task Polling) requires a server to answer
   `tasks/get` / `tasks/update` / `tasks/cancel` and to return `CreateTaskResult` from
   `tools/call`. But `sdk-v2/migration-support-2026-07-28.md` states methods deleted by a
   revision are *physically absent from that era's registry* — "an inbound `tasks/get` on a
   2026-era connection gets `-32601` **even if a handler is registered**" — and its §Tasks
   section keeps only the 2025-era task **wire vocabulary**, marked `@deprecated`, with
   `tasks/*` excluded from `RequestMethod` / `ResultTypeMap` so `setRequestHandler` rejects
   them at compile time and `ResultTypeMap['tools/call']` is plain `CallToolResult`.
   `sdk-v2/package-server-changelog-4-alpha3-to-alpha1.md` records the same removal
   ("servers do not advertise the `tasks` capability and inbound `tasks/*` requests receive
   `-32601`"). Neither source states whether the vendor-prefixed custom-method path in
   `sdk-v2/advanced-custom-methods.md` can re-add them. **Treat "adopt Tasks on SDK v2
   beta.1" as unproven until that is resolved — see gap 1.**

### Version-anchor caveats (not contradictions)

- `spec-2026-07-28/extensions/overview.md` lives outside the per-revision tree
  (`modelcontextprotocol.io/extensions/overview`) and its own internal links point at
  `/specification/draft/…`. It is the only page describing the extensions framework; treat
  its *mechanism* statements as authoritative for `2026-07-28` only where the changelog and
  `spec-2026-07-28/basic/versioning.md` (§Extension Negotiation) agree — they do for the
  `extensions` capability map.
- The whole `ext-tasks/` group is **draft**, from a repo that calls itself experimental and
  "not an official extension" (`ext-tasks/repo-readme-status.md`). Its `specification.md`
  is `specification/draft/tasks`, not a dated revision — it can change without a changelog.
- `mcp-blog/future-of-mcp-transports.md` (2025-12-19) is pre-RC design direction: "Server
  Cards" at `/.well-known/mcp.json` became the `server/discover` RPC, and the "cookie-like"
  session idea never shipped. Its capture header says so; keep it for the WHY only.
- All `sdk-v2/` files are pinned to **`v2.0.0-beta.1`**, which is a pre-stable line whose API
  "can still change before the stable release"; the `sdk-v2/api/*` TypeDoc pages additionally
  pin SDK source commit `cc4b41617ce3601b1290d67216ea0b194a3cd9ac`. Any signature quoted from
  `sdk-v2/` should be re-verified against the stable v2 release before the migration lands.

### What was removed from this set, and why

Out-of-scope per the brief (the project registers no prompts, completions, elicitation,
sampling, or roots, and is a server, not a client): the spec pages
`client/elicitation.md`, `client/sampling.md`, `client/roots.md`, `server/prompts.md`,
`server/utilities/completion.md`, and the generic `server/index.md` primitives table.
The **wire types** for elicitation, sampling and roots are still present in
`spec-2026-07-28/schema/completion-roots-and-elicitation.md` and
`spec-2026-07-28/schema/logging-sampling-and-content-blocks.md`, because MRTR embeds them —
so nothing needed to build an `inputRequests` payload was lost.
Also removed as duplicates of more complete files: `sdk-v2/docs-index.md` (⊂ `readme.md`),
`sdk-v2/package-core-readme.md` (⊂ `advanced-wire-schemas.md`),
`sdk-v2/package-middleware-readme.md` (⊂ `get-started-packages.md`), and
`mcp-blog/understanding-mcp-extensions.md` (a pre-RC explainer duplicated by
`extensions/overview.md` whose claim that extensions are negotiated "during the
initialization handshake" is false for this revision).

Removed in curate round 2 (the Tasks gap-fill gather returned two overlapping pairs):

- `modelcontextprotocol.io/extensions/tasks/overview.md` — the .io hub page for the
  extension. It carries no mechanism the repo's own landing page lacks, and it explicitly
  defers to the ext-tasks repository for the specification, so the repo page was kept as the
  more authoritative of the two: `ext-tasks/overview.md`.
- The `## Specification` section of SEP-2663 (`Extension Identifier` … `Reservations`), which
  restates `ext-tasks/specification.md` almost sentence for sentence. Kept: the SEP's unique
  Abstract / Motivation / Rationale / Backward Compatibility / Security / Reference
  Implementation, in `ext-tasks/sep-2663-rationale-and-backward-compatibility.md` (whose
  header records the cut). The SEP's own header calls Final-status SEPs a historical record
  and points at the current specification for authoritative requirements, and the two texts
  do differ in small ways — e.g. on partial `inputResponses` the spec page ends the sentence
  "…(a strict subset of currently-outstanding keys); **in that case the task remains in
  `input_required` until the remaining responses arrive**", which the SEP text omits. Where
  they differ, `ext-tasks/specification.md` governs.

### Fidelity spot-check

Round 1 (2026-08-11) re-fetched four files from the source cited in their own header and
compared a substantive passage word for word — **4 checked, 0 failures**:
`sdk-v2/migration-support-2026-07-28.md` (the 10-row era behavior matrix),
`spec-2026-07-28/basic/transports/streamable-http.md` (the Standard Request Headers and
Encoding-examples tables), `spec-2026-07-28/schema/core-jsonrpc-errors-and-mrtr-types.md`
(`UnsupportedProtocolVersionError` + the `-32020/-32021/-32022` constants), and
`mcp-blog/2026-07-28-release-candidate.md` (the `InputRequiredResult` JSON block).

One conversion note observed while checking: the spec pages are authored in MDX and wrap
some paragraphs in `<Info>` / `<Note>` / `<Warning>` components, and fence code blocks as
```` ```json theme={null} ````. The captures drop those component tags and the `theme={null}`
attribute and keep the enclosed text verbatim — an HTML→markdown conversion, not an edit.

Round 2 (2026-08-12) checked five of the files the gap-fill gathers added, each against the
source cited in its own header. **5 checked, 0 failures.**

| File | Compared | Result |
| --- | --- | --- |
| `ext-tasks/schema-types.md` | whole `schema.ts` body vs `raw.githubusercontent.com/modelcontextprotocol/ext-tasks/main/schema/draft/schema.ts` | **byte-identical**, 374/374 lines, empty diff |
| `ext-tasks/specification.md` | whole body vs the repo markdown the page is published from (`specification/draft/tasks.md`) | identical; the only deltas are the VitePress container markers `::: tip Note` / `:::` being unwrapped (enclosed text kept verbatim) and one leading blank line |
| `ext-tasks/sep-2663-rationale-and-backward-compatibility.md` | the sections this file keeps (header block, Abstract, Motivation, Rationale → Reference Implementation) vs `seps/2663-tasks-extension.md` | identical; the only delta is table-column padding (the .io rendering pads the `Protocol Version` column one space wider) |
| `sdk-v2/api/create-mcp-handler.md` | five substantive passages (the whole `legacy` option description, `keepAliveMs`, `maxSubscriptions`, the `isLegacyRequest` `server/discover` clause, `McpHttpHandler.close`) vs the TypeDoc HTML page | word for word identical |
| `sdk-v2/api/origin-validation-server.md` | the `OriginValidationResult` union declaration and four prose passages vs the TypeDoc HTML page | word for word identical (differences are only the spaces HTML tag-stripping leaves around inline `<code>`) |

Two capture-vs-source observations from this round, neither an edit:

- The suspicious half-sentence in SEP-2663 ("A server **MAY** accept a partial set of
  responses (a strict subset of currently-outstanding keys);" — ending at the semicolon) is
  **in the upstream SEP itself**, not a truncated capture; the ext-tasks specification page
  completes the same sentence. That divergence is why the SEP's duplicate Specification
  section was the copy dropped (see "What was removed").
- TypeDoc pages are captured with their `Defined in: packages/…#Lnn` GitHub links intact, so
  every signature in `sdk-v2/api/*` can be traced to SDK source at commit `cc4b41617ce…`.

### Gaps left open

All three gaps recorded in round 1 are now closed: the Tasks extension (`ext-tasks/`), the
typed API reference for the v2 serving entry points (`sdk-v2/api/create-mcp-handler.md`,
`serve-stdio.md`, `server-options.md`, `request-state-codec.md`), and the Host/Origin
validation helpers (`sdk-v2/api/*-validation-*.md` + `sdk-v2/serving-express.md`).

Three remain:

1. **Can the TS SDK v2 serve the Tasks extension at all?** (inconsistency 6.) No file states
   whether `setRequestHandler('tasks/get', { params, result }, handler)` — the custom-method
   path in `sdk-v2/advanced-custom-methods.md` — is permitted on a 2026-era connection, or
   whether the era registry rejects `tasks/*` names outright as
   `sdk-v2/migration-support-2026-07-28.md` implies. Without that, "adopt Tasks for playback"
   cannot be costed. Needs the v2 API reference for the low-level `Server.setRequestHandler`
   overloads and/or the SDK's extension-serving documentation.
2. **No typed API reference for `McpServer` itself.** `registerTool` / `registerResource` /
   `RegisteredTool.update` / the tool-callback type appear only in prose
   (`sdk-v2/servers-tools.md`, `sdk-v2/servers-resources.md`) and in migration part 3. This
   project registers every tool through one registry, so the exact generic signatures are
   load-bearing for the port.
3. **No client-side support matrix for extensions.** `spec-2026-07-28/extensions/overview.md`
   and `ext-tasks/overview.md` both point at `modelcontextprotocol.io/extensions/client-matrix`
   for which hosts actually negotiate which extension; that page is not in the set, so the
   "will any client we target even use Tasks?" question has no evidence here.
