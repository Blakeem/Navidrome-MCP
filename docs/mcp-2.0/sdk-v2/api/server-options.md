<!--
source: https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/server/server/server.html (ServerOptions section only)
version: TypeScript SDK v2.0.0-beta.1 (v2 API reference, beta line implementing MCP spec revision 2026-07-28)
retrieved: 2026-08-11
note: This page also documents the deprecated low-level `Server` class in full
  ("Use McpServer instead for the high-level API. Only use Server for advanced
  use cases.") — that class's own methods (createMessage, elicitInput, etc.)
  are already captured in prose in sdk-v2/advanced-low-level-server.md and are
  OUT OF SCOPE for this file. Only the `ServerOptions` type declaration is
  captured here, verbatim, per the brief's explicit list of serving entry
  points to capture in full TypeScript-signature depth.
-->

# server/server (ServerOptions only)

## Type Aliases

### ServerOptions

> **ServerOptions** = [`ProtocolOptions`](./../../../index/@modelcontextprotocol/server/#protocoloptions) & `object`

Defined in: [packages/server/src/server/server.ts:75](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/server.ts#L75)

#### Type Declaration

##### cacheHints?

> `optional` **cacheHints?**: `Partial`<`Record`<`CacheableResultMethod`, [`CacheHint`](./../../../index/@modelcontextprotocol/server/#cachehint)\>>

Cache hints for the cacheable results of the 2026-07-28 protocol revision (`ttlMs` / `cacheScope`), keyed by operation. The cacheable operations are `tools/list`, `prompts/list`, `resources/list`, `resources/templates/list`, `resources/read` and `server/discover`. The hint is used when the result for that operation does not provide its own cache fields — most useful for the list results and `server/discover`, which the SDK builds itself. A hint registered with an individual resource (`registerResource(..., { cacheHint })`) takes precedence for that resource's `resources/read` results, field by field: a field the per-resource hint leaves unset still falls back to the per-operation hint configured here.

Absent hints (or omitting this option entirely) keep today's behavior: cacheable 2026-07-28 results are emitted with `ttlMs: 0` and `cacheScope: 'private'`. Responses to 2025-era requests are never affected. Invalid values throw a `RangeError` at construction time.

##### capabilities?

> `optional` **capabilities?**: [`ServerCapabilities`](./../../../index/@modelcontextprotocol/server/#servercapabilities)

Capabilities to advertise as being supported by this server.

Note: per the MCP spec, a server that declares a capability MUST respond to that capability's requests (e.g. `tools/list` for `tools`) — potentially with an empty result — rather than with a "Method not found" error. [`McpServer`](./mcp.html#mcpserver) handles this automatically for capabilities declared here; when using the low-level [`Server`](#server) directly, you are responsible for registering a request handler for every capability you declare.

##### inputRequired?

> `optional` **inputRequired?**: `object`

Multi-round-trip serving knobs. On 2026-era requests the client fulfils `input_required` returns; on 2025-era connections the SDK's legacy shim fulfils them server-side (real server→client requests + handler re-entry), so handlers are written once and serve both eras.

###### inputRequired.legacyShim?

> `optional` **legacyShim?**: `boolean`

`false` disables the shim: an `input_required` return on a 2025-era request fails loudly (the pre-shim behavior).

###### Default

```ts
true
```

###### inputRequired.maxRounds?

> `optional` **maxRounds?**: `number`

Handler re-entries per originating request before the shim fails (tools/call: `isError` result; prompts/resources: JSON-RPC error).

###### Default

```ts
8
```

###### inputRequired.roundTimeoutMs?

> `optional` **roundTimeoutMs?**: `number`

Per-leg timeout (ms) for the shim's embedded server→client requests, sent with `resetTimeoutOnProgress: true`. Human-paced — deliberately far above the 60s protocol default.

###### Default

```ts
600_000
```

##### instructions?

> `optional` **instructions?**: `string`

Optional instructions describing how to use the server and its features.

##### jsonSchemaValidator?

> `optional` **jsonSchemaValidator?**: [`jsonSchemaValidator`](./../../../index/@modelcontextprotocol/server/#jsonschemavalidator)

JSON Schema validator for elicitation response validation.

The validator is used to validate user input returned from elicitation requests against the requested schema.

###### Default

Runtime-selected validator (AJV-backed on Node.js, `@cfworker/json-schema`\-backed on browser/workerd runtimes)

##### requestState?

> `optional` **requestState?**: `object`

Multi-round-trip `requestState` integrity hook (protocol revision 2026-07-28).

###### requestState.verify?

> `optional` **verify?**: (`state`, `ctx`) => `unknown` | `Promise`<`unknown`\>

Called on every multi-round-trip request round whose echoed `requestState` is a string (i.e. whenever `ctx.mcpReq.requestState()` would return one), BEFORE the handler runs — including the legacy shim's in-process rounds. Throw or reject to refuse the request: the seam answers with a wire-level `-32602` Invalid Params error whose message is frozen to `"Invalid or expired requestState"` and whose `data.reason` is `'invalid_request_state'` — the thrown reason is surfaced via the server's `onerror` callback only and never reaches the wire.

This is the place to put HMAC or AEAD verification of `requestState`. The spec MUST for integrity-protecting state that influences authorization, resource access, or business logic is on the server author (basic/patterns/mrtr, server requirements 4–5); the SDK provides NO default verification — [`createRequestStateCodec`](./requestStateCodec.html#createrequeststatecodec) is the SDK-provided HMAC helper whose `verify` drops in here directly. Leaving this option unconfigured keeps the passthrough behavior — `ctx.mcpReq.requestState()` returns the raw wire string, which MUST be treated as attacker-controlled input.

The resolved value is LOAD-BEARING: when the hook resolves with a non-`undefined` value — as [`RequestStateCodec`](./requestStateCodec.html#requeststatecodec)`.verify` does (the decoded payload) — the seam hands THAT value to the handler via the typed `ctx.mcpReq.requestState<T>()` accessor, so a codec-using handler reads its verified state with no second decode call. A verifier that is not also the decoder should resolve `undefined` (return nothing) to keep the accessor on the raw wire string — resolving an incidental value (e.g. a boolean verification flag) would replace what the handler reads.

###### Parameters

###### state

`string`

###### ctx

[`ServerContext`](./../../../index/@modelcontextprotocol/server/#servercontext)

###### Returns

`unknown` | `Promise`<`unknown`\>
