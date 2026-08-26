<!--
source: https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.0.0-beta.1/packages/server/CHANGELOG.md
version: TypeScript SDK v2.0.0-beta.1 (git tag v2.0.0-beta.1; beta line implementing MCP spec revision 2026-07-28)
retrieved: 2026-08-11
part: 1 of 4 — 2.0.0-beta.1, and 2.0.0-alpha.4 Major Changes (verbatim slice of the source CHANGELOG, lines 9-58)
split here at release/section-heading boundaries; text is unmodified
-->

# @modelcontextprotocol/server CHANGELOG — part 1: 2.0.0-beta.1, and 2.0.0-alpha.4 Major Changes

## 2.0.0-beta.1

### Patch Changes

- [#2402](https://github.com/modelcontextprotocol/typescript-sdk/pull/2402) [`a400259`](https://github.com/modelcontextprotocol/typescript-sdk/commit/a4002596b914c675d17ac22471d1287976dbb52a) Thanks [@felixweinberger](https://github.com/felixweinberger)! - First beta release of SDK v2 with support for the MCP 2026-07-28 specification
  revision. See the migration guides for upgrading from v1
  (`docs/migration/upgrade-to-v2.md`) and adopting the 2026-07-28 revision
  (`docs/migration/support-2026-07-28.md`).

## 2.0.0-alpha.4

### Major Changes

- [#2286](https://github.com/modelcontextprotocol/typescript-sdk/pull/2286) [`1823aae`](https://github.com/modelcontextprotocol/typescript-sdk/commit/1823aae891837ebb5e3db885ec635f9efefd5771) Thanks [@felixweinberger](https://github.com/felixweinberger)! - Split the wire layer into per-era codecs and make protocol-revision deletions physical. Deliberate wire/schema behavior changes (see docs/migration/support-2026-07-28.md "Per-era wire codecs"):
    - `resultType` is no longer modeled by any neutral wire schema: `EmptyResultSchema` (strict) now rejects `{resultType}` bodies; on 2025-era connections a foreign `resultType` is stripped before validation instead of rejected; the member exists only inside the 2026-era codec, which requires it.
    - `CallToolResult.content` / `ToolResultContent.content` are required at the wire boundary (`content.default([])` removed): handler results without `content` are rejected with `-32602` instead of silently defaulted, and content-less wire results fail the client parse loudly.
    - Custom (3-arg) handlers now receive `_meta` minus the reserved envelope keys instead of having it deleted before params validation.
    - `specTypeSchemas` re-scoped to the neutral model: result validators no longer accept `resultType`; task message-type validators and `RequestMetaEnvelope` left the public set (`SpecTypeName` narrowed).
    - Role aggregate types/schemas (`ClientRequest`, `ServerResult`, …) no longer carry task vocabulary; the deprecated `Task*` types remain importable unchanged.
    - Era-mismatched spec methods fail physically: inbound era-deleted methods get `-32601` even with a handler registered; outbound sends throw `SdkErrorCode.MethodNotSupportedByProtocolVersion` locally.
    - Value guards (`isCallToolResult`, …) are documented as neutral-shape consumer checks, not wire validators.

- [#2286](https://github.com/modelcontextprotocol/typescript-sdk/pull/2286) [`1823aae`](https://github.com/modelcontextprotocol/typescript-sdk/commit/1823aae891837ebb5e3db885ec635f9efefd5771) Thanks [@felixweinberger](https://github.com/felixweinberger)! - `createMcpHandler` now returns a web-standards-only `{ fetch, close, notify, bus }` handler — the shape Workers/Bun/Deno expect from `export default`. The duck-typed `.node(req, res, parsedBody?)` face is removed; Node frameworks (Express, Fastify, plain `node:http`) wrap the
  handler once with the new `toNodeHandler(handler, { onerror? })` exported from `@modelcontextprotocol/node`, which converts the Node request to a web-standard `Request`, calls `handler.fetch`, and writes the `Response` back honoring write backpressure. The optional `onerror`
  receives the adapter-level error fallback (request conversion / `handler.fetch` throw) before the `500` response is written, restoring observability parity with the removed `.node` face. `NodeIncomingMessageLike` and `NodeServerResponseLike` move from
  `@modelcontextprotocol/server` to `@modelcontextprotocol/node`.

- [#2286](https://github.com/modelcontextprotocol/typescript-sdk/pull/2286) [`1823aae`](https://github.com/modelcontextprotocol/typescript-sdk/commit/1823aae891837ebb5e3db885ec635f9efefd5771) Thanks [@felixweinberger](https://github.com/felixweinberger)! - Hide wire-only protocol members from the public surface, at the type level and at runtime. `resultType` (the 2026-07-28 result discrimination field) is no longer declared on any public result type — the wire schemas keep parsing it, and the client funnel now consumes it raw-first: `'complete'` results are stripped to the public shape and any other kind (e.g. `input_required`) rejects with the new `SdkErrorCode.UnsupportedResultType` instead of masking into an empty success. The reserved `_meta` envelope keys are lifted out of inbound requests and notifications before handlers run, and the multi-round-trip retry fields (`inputResponses`, `requestState`) out of inbound requests only (the spec reserves those names on client-initiated requests; notification params keep them), so handler params keep the 2025-era shape; for requests the lifted material surfaces at `ctx.mcpReq.envelope`, `ctx.mcpReq.inputResponses`, and `ctx.mcpReq.requestState` (notifications have no ctx — their lifted envelope keys are not surfaced). High-level client/server methods now return the named public result types (`Promise<CallToolResult>` etc.). Task wire vocabulary stays importable but is `@deprecated` and excluded from the typed method maps (`RequestMethod`/`RequestTypeMap`/`ResultTypeMap`/`NotificationTypeMap`), and `callTool` is typed as plain `CallToolResult`. See docs/migration/support-2026-07-28.md "Wire-only members hidden from public types".

- [#2286](https://github.com/modelcontextprotocol/typescript-sdk/pull/2286) [`1823aae`](https://github.com/modelcontextprotocol/typescript-sdk/commit/1823aae891837ebb5e3db885ec635f9efefd5771) Thanks [@felixweinberger](https://github.com/felixweinberger)! - `resources/read` for an unknown URI now answers with JSON-RPC error code `-32602`
  (Invalid Params) on every protocol revision, with `error.data.uri` echoing the
  requested URI. The 2026-07-28 specification requires `-32602`; the v1.x SDK already
  emitted `-32602` on earlier revisions, so v1.x peers see no change.

    This supersedes an interim `-32002` emission that shipped in earlier v2 alphas. The
    era-aware encode seam (`WireCodec.encodeErrorCode`) maps any handler-thrown `-32002`
    to `-32602` on the wire; note that a `-32002` thrown without `data.uri` is emitted as
    a bare `-32602` and is no longer recognizable as resource-not-found — throw
    `ResourceNotFoundError` (or include `data: { uri }`) to preserve the classification.

    `ProtocolErrorCode.ResourceNotFound` (`-32002`) remains importable as receive-tolerated
    vocabulary; clients should accept both `-32602` and `-32002` from peers (the
    specification's backwards-compatibility clause). The new typed `ResourceNotFoundError`
    class carries `data.uri`, and `ProtocolError.fromError` reconstructs it from a `-32602`
    only when `error.data` is exactly `{ uri: string }` (and nothing else), and from a
    legacy `-32002` whenever `data.uri` is a string; a bare `-32002` without `data.uri`
    stays a generic `ProtocolError`.

- [#2286](https://github.com/modelcontextprotocol/typescript-sdk/pull/2286) [`1823aae`](https://github.com/modelcontextprotocol/typescript-sdk/commit/1823aae891837ebb5e3db885ec635f9efefd5771) Thanks [@felixweinberger](https://github.com/felixweinberger)! - SEP-1613 / SEP-2106 (JSON Schema 2020-12 posture): the Node default JSON Schema validator is now `Ajv2020` (true draft 2020-12) instead of the draft-07 `Ajv` class — `$defs`/`prefixItems`/`unevaluatedProperties`/`dependentRequired` are now enforced where they were previously silently ignored; to opt back, construct the draft-07 instance with the v1 defaults — `const ajv = new Ajv({ strict: false, validateFormats: true, validateSchema: false, allErrors: true }); addFormats(ajv);` — and pass `new AjvJsonSchemaValidator(ajv)`. Schemas declaring a `$schema` other than 2020-12 are rejected with a clear error rather than mis-validating. `outputSchema` may now have a non-object root and `CallToolResult.structuredContent` is widened to `unknown` (a deliberate source-level break for typed consumers — see the migration guide for the narrowing pattern). Toward 2025-era clients McpServer wraps a non-object `outputSchema` (and the matching `structuredContent`) in a `{result: …}` envelope so the tool stays callable, with same-document `$ref`/`$dynamicRef` pointers rewritten to keep resolving — low-level `Server` users (those bypassing `McpServer` and registering a `tools/call` handler directly) get the same wrap by routing the result through the new `Server.projectCallToolResult(result, advertisedOutputSchema)`. Independently, on every era (the SEP's MUST applies regardless of client version), McpServer auto-appends a `TextContent` JSON serialisation when a handler returns non-object `structuredContent` without its own text block. The `structuredContent` presence check is `!== undefined` (not falsy) on both sides. Thanks @mattzcarey (#2249).

