<!--
source: https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.0.0-beta.1/docs/migration/upgrade-to-v2.md
version: TypeScript SDK v2.0.0-beta.1 (git tag v2.0.0-beta.1; beta line implementing MCP spec revision 2026-07-28)
retrieved: 2026-08-11
part: 3 of 7 — Low-level protocol, handler context (ctx), server registration API (verbatim slice of the source file, lines 447-804)
full guide: docs/migration/upgrade-to-v2.md, split here at heading boundaries; text is unmodified
-->

# Upgrading from v1.x to v2 — part 3: Low-level protocol, handler context (ctx), server registration API

### Low-level protocol & handler context (`ctx`)

The second parameter to every request handler — previously the flat `RequestHandlerExtra`
object named `extra` — is now a structured **context** object named `ctx`. This is the
`ctx` that appears throughout the rest of this guide.

The codemod renames the parameter and remaps property access via
[`contextPropertyMap.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/codemod/src/migrations/v1-to-v2/mappings/contextPropertyMap.ts).
A few mappings need optional-chaining adjustment (the `http` group is `undefined` on
stdio):

| v1 (`extra.*`)                                    | v2 (`ctx.*`)                   | Note                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extra.signal`                                    | `ctx.mcpReq.signal`            |                                                                                                                                                                                                                                                                                                                         |
| `extra.requestId`                                 | `ctx.mcpReq.id`                |                                                                                                                                                                                                                                                                                                                         |
| `extra._meta`                                     | `ctx.mcpReq._meta`             |                                                                                                                                                                                                                                                                                                                         |
| `extra.sendRequest(...)`                          | `ctx.mcpReq.send(...)`         |                                                                                                                                                                                                                                                                                                                         |
| `extra.sendNotification(...)`                     | `ctx.mcpReq.notify(...)`       |                                                                                                                                                                                                                                                                                                                         |
| `extra.sessionId`                                 | `ctx.sessionId`                |                                                                                                                                                                                                                                                                                                                         |
| `extra.authInfo`                                  | `ctx.http?.authInfo`           | optional — `undefined` on stdio                                                                                                                                                                                                                                                                                         |
| `extra.requestInfo`                               | `ctx.http?.req`                | a standard Web `Request`; `ServerContext` only                                                                                                                                                                                                                                                                          |
| `extra.closeSSEStream`                            | `ctx.http?.closeSSE`           | `ServerContext` only; the member itself is also optional — defined only when the transport has an `eventStore` AND the client's negotiated protocol version supports resumable close (2025-11-25+); an `eventStore` transport serving a 2025-06-18 client still leaves it `undefined`. Call as `ctx.http?.closeSSE?.()` |
| `extra.closeStandaloneSSEStream`                  | `ctx.http?.closeStandaloneSSE` | `ServerContext` only; member optional as above — `ctx.http?.closeStandaloneSSE?.()`                                                                                                                                                                                                                                     |
| `extra.taskStore` / `taskId` / `taskRequestedTtl` | _removed_                      | see [Experimental tasks](#experimental-tasks-interception-removed)                                                                                                                                                                                                                                                      |

The transport-level seam behind `ctx.http?.authInfo` is unchanged from v1: a transport
that passes `{ authInfo }` as the second argument to `onmessage(message, extra)` — e.g.
an `InMemoryTransport` test seam — still surfaces it as `ctx.http?.authInfo` on any
transport, and `ctx.http` is defined whenever `authInfo` is supplied, even without an
HTTP transport.

`BaseContext` is the common base; `ServerContext` and `ClientContext` extend it. None
of the three takes type parameters — v1's `RequestHandlerExtra<TRequest, TNotification>`
arguments selected request/notification unions that the v2 context carries
intrinsically, so their removal loses no type information; review only handlers that
passed custom (non-standard) unions, whose `sendRequest` / `sendNotification` typing
was narrowed by them. `ServerContext.mcpReq` adds convenience methods that replace
calling `server.*` from inside a handler:

| `ctx.mcpReq.*` (new)                           | Replaces (inside a handler)                                                                                                                                                                                                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ctx.mcpReq.log(level, data, logger?)`         | `server.sendLoggingMessage(...)` — ⚠ **`@deprecated`**, see [§Deprecated in v2](#deprecated-in-v2-sep-2577); the notification also becomes request-related on every era — see [§`ctx.mcpReq.log()` is request-related on every era](#ctxmcpreqlog-is-request-related-on-every-era) |
| `ctx.mcpReq.elicitInput(params, options?)`     | `server.elicitInput(...)`                                                                                                                                                                                                                                                           |
| `ctx.mcpReq.requestSampling(params, options?)` | `server.createMessage(...)` — ⚠ **`@deprecated`**, see [§Deprecated in v2](#deprecated-in-v2-sep-2577)                                                                                                                                                                             |

#### Deprecated in v2 (SEP-2577)

The roots, sampling, and logging subsystems are deprecated as of protocol version
2026-07-28 (SEP-2577). Everything below is **still fully functional in v2** and marked
`@deprecated` for removal in a later major; on a 2026-07-28 connection prefer the
[multi-round-trip `input_required` pattern](./support-2026-07-28.md#multi-round-trip-requests)
instead.

- **Runtime APIs**: `Server.createMessage` / `listRoots` / `sendLoggingMessage`,
  `McpServer.sendLoggingMessage`, `Client.setLoggingLevel` / `sendRootsListChanged`, and
  the `ctx.mcpReq.log` / `ctx.mcpReq.requestSampling` handler-context helpers. Outside a
  handler, `McpServer` users reach the `Server.*` methods via the unchanged
  [`mcpServer.server` accessor](#unchanged-apis).
- **Capability fields**: the `roots`, `sampling`, and `logging` capability schema fields.
- **Type stacks**: the full Logging stack (`LoggingLevel`, `SetLevelRequest`,
  `LoggingMessageNotification` and params), the full Sampling stack
  (`CreateMessageRequest`/`Result`, `SamplingMessage`, `ModelPreferences`/`ModelHint`,
  `ToolChoice`, `ToolUseContent`/`ToolResultContent`, the `includeContext` enum values),
  and the full Roots stack (`Root`, `ListRootsRequest`/`Result`,
  `RootsListChangedNotification`).
- **`registerClient`** (Dynamic Client Registration) — prefer Client ID Metadata
  Documents per SEP-991.

The deprecation is annotation-only — JSDoc `@deprecated` markers were added, nothing
else: every deprecated runtime API keeps its v1 call signature (e.g.
`Server.sendLoggingMessage(params, sessionId?)` keeps the two-argument form) and its
wire behavior, and remains functional for at least the twelve-month deprecation window.

#### `setRequestHandler` / `setNotificationHandler` use method strings

The low-level handler registration takes a **method string** instead of a Zod schema.
The codemod rewrites every spec-method registration via
[`schemaToMethodMap.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/codemod/src/migrations/v1-to-v2/mappings/schemaToMethodMap.ts).

```typescript
// v1
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => { ... });
// v2
server.setRequestHandler('tools/call', async (request, ctx) => { ... });
```

**Custom (non-spec) methods** use the 3-arg form `(method, { params, result? }, handler)`
where `params` and `result` are any [Standard Schema](https://standardschema.dev). The
handler receives the parsed `params` directly (not the full request envelope); `_meta`
is at `ctx.mcpReq._meta`. The 3-arg notification handler is `(params, notification) => void`.

```typescript
server.setRequestHandler('acme/search', { params: SearchParams, result: SearchResult }, async (params, ctx) => { ... });
```

The custom form also covers **spec method names carried with custom payloads**: a v1
integration that reused a spec method string for its own payload shape (e.g.
`notifications/message` notifications carrying a proprietary params object) registers
it with the 3-arg form and its own schema. The overloads are selected by the arguments'
shape, not by the method name — a schemas object as the second argument always selects
the custom form, which validates against **your** schema (the spec schema is not
applied) and hands the handler the parsed params rather than the envelope.

**Spec notifications** use the 2-arg form `setNotificationHandler(method, handler)`.
Unlike the 3-arg custom form, the spec-form handler receives the **full notification
envelope** (`{ method, params }`), parsed against the spec schema — read
`notification.params`:

```typescript
client.setNotificationHandler('notifications/tools/list_changed', async notification => {
    console.log(notification.method, notification.params);
});
```

The two overloads are selected by the method string's **type**: the spec form binds the
method to the `NotificationMethod` union (`RequestMethod` on the request side — both
exported), so a method string computed at runtime must be typed as `NotificationMethod`
to select it; an untyped `string` lands on the custom-schema overload and fails to
compile without a schemas argument. `Parameters<Client['setNotificationHandler']>[0]`
also resolves to the custom `string` overload by design — name `NotificationMethod`
directly instead. The request side has the same trap one slot over:
`Parameters<Client['setRequestHandler']>` (and `typeof`-indexed casts over the overload
set) resolve against the 3-arg custom-method overload, so index `[1]` is the
`{ params, result }` schemas object, **not** the handler — v1 signature-erasing handler
casts derived positionally change meaning with no runtime symptom. Name the exported
types (`RequestMethod` and your own handler/param types) instead of deriving them
positionally. Generic helpers that v1 parameterized on a notification schema need
this conversion by hand; the codemod only warns on them.

**Handler returns are spec-typed.** In v1 the handler's return type flowed from the
schema you registered; v2 types it from the method name (`'tools/list'` →
`ListToolsResult`, and so on). Tool tables kept as plain object literals surface two
recurring compile errors: an unannotated literal widens `type: 'object'` to `string`
and no longer satisfies the spec type's `type: 'object'` literal member (fix:
`type: 'object' as const`, or annotate the table as `Tool[]`); and a heterogeneous
table whose inferred union carries `prop?: undefined` members does not satisfy the spec
types' `Record<string, JSONValue>` index signatures, since `undefined` is not a
`JSONValue` (fix: annotate the handler's return type —
`async (req): Promise<ListToolsResult> => …` — or the table itself, so each literal is
checked against the target type instead of being inferred and widened first).

#### `request()`, `ctx.mcpReq.send()`, and `callTool()` no longer require a schema for spec methods

For **spec** methods, drop the result-schema argument; the SDK resolves it from the
method name. The codemod drops it from `client.request()` and `client.callTool()`; drop
it from `ctx.mcpReq.send()` by hand.

```typescript
// v1
import { CreateMessageResultSchema } from '@modelcontextprotocol/sdk/types.js';
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const r = await extra.sendRequest({ method: 'sampling/createMessage', params: { ... } }, CreateMessageResultSchema);
    return { content: [{ type: 'text', text: 'done' }] };
});

// v2
server.setRequestHandler('tools/call', async (request, ctx) => {
    const r = await ctx.mcpReq.send({ method: 'sampling/createMessage', params: { ... } });
    return { content: [{ type: 'text', text: 'done' }] };
});
```

For **custom (non-spec)** methods, keep the result-schema argument:
`await client.request({ method: 'acme/search', params }, SearchResult)` — only drop the
schema when calling a spec method.

**Forwarding arbitrary methods (gateways / proxies).** Dropping the schema changes
semantics, not just the signature: a schema-less spec-method call now **enforces** the
spec result schema (a non-conforming upstream result is rejected locally with
`SdkError(SdkErrorCode.InvalidResult)` and a conforming one is re-serialized in schema
key order), and a schema-less call for a **non-spec** method throws a `TypeError` at
the call site (`'…' is not a spec method; pass a result schema`).
A relay that forwards `{ method, params }` it does not understand must keep passing an
explicit result schema. The v1 idiom survives with an import-path change:

```typescript
import { ResultSchema } from '@modelcontextprotocol/core';
const result = await upstream.request({ method, params }, ResultSchema); // v1-identical passthrough
```

For byte-exact forwarding (member order preserved), pass your own accept-anything
Standard Schema instead. Check call sites whose `method` is **not a literal** — the
codemod may have dropped the schema argument there; restore it.

The **inbound half** — a relay re-emitting an upstream JSON-RPC error from its own
handler — has a supported surface too: reconstruct the typed error with
`ProtocolError.fromError(code, message, data)` and throw it; the encode seam serializes
it back to the wire shape (see [Typed `ProtocolError` subclasses](#typed-protocolerror-subclasses)).
Note this is typed reconstruction, not byte-exact relay: legacy codes are normalized at
the encode seam (`-32002` re-emits as `-32602`) and the typed subclasses keep only their
schema-defined `data` members, so extra upstream data keys are dropped. Throwing a plain
object carrying `.code` / `.message` / `.data` happens to work today, but it is
unspecified behavior — prefer `fromError`.

The return type is inferred from the method name via `ResultTypeMap` (e.g.
`client.request({ method: 'tools/call', ... })` returns `Promise<CallToolResult>`).
v1 call sites that passed `CreateMessageResultWithToolsSchema` explicitly need no
replacement: the schema-less send resolves to
`CreateMessageResult | CreateMessageResultWithTools`, and validation selects the
with-tools variant when the request set `tools` or `toolChoice`.

### Server registration API

The deprecated variadic `.tool()`, `.prompt()`, `.resource()` are removed. Use
`registerTool` / `registerPrompt` / `registerResource` with an explicit config object.
The codemod converts the call shape and wraps `inputSchema` / `outputSchema` /
`argsSchema` / `uriSchema` raw shapes.

```typescript
// v1 — raw shape, variadic
server.tool('greet', 'Greet a user', { name: z.string() }, async ({ name }) => {
    return { content: [{ type: 'text', text: `Hello, ${name}!` }] };
});

// v2 — config object, Standard Schema
server.registerTool('greet', { description: 'Greet a user', inputSchema: z.object({ name: z.string() }) }, async ({ name }) => {
    return { content: [{ type: 'text', text: `Hello, ${name}!` }] };
});
```

`registerResource` requires a `metadata` argument — pass `{}` if you have none.

A tool or prompt registered **without** an `inputSchema` / `argsSchema` passes the
context as its callback's single argument — v1 passed `(extra)`, v2 passes `(ctx)`:

```typescript
server.registerTool('ping', { description: 'Liveness check' }, async ctx => ({ content: [] }));
```

A one-parameter callback typechecks under either reading, so remember that the first
parameter here is the context object, not an args object.

#### Standard Schema objects (raw shapes deprecated)

v2 expects schema objects implementing the [Standard Schema spec](https://standardschema.dev/)
for `inputSchema`, `outputSchema`, and `argsSchema`. Raw `{ field: z.string() }` shapes
are still **accepted via `@deprecated` overloads** on `registerTool`/`registerPrompt`
(auto-wrapped with `z.object()`), and `completable()` accepts any `StandardSchemaV1`;
prefer wrapping explicitly. Zod v4, ArkType, and Valibot all implement the spec.

For **optional completable arguments**, apply `.optional()` to the _result_ of
`completable()` — `completable(z.string(), cb).optional()`, not
`completable(z.string().optional(), cb)`. v2 resolves completion metadata on the schema
found after unwrapping an outer optional wrapper, so the v1 nesting returns empty
completion lists — nothing errors — and if no argument carries completion metadata in
the v2 position, the server does not advertise the `completions` capability at all. The
codemod inverts the common nesting automatically and flags shapes it cannot rewrite.

**Zod v3 is no longer supported** (v1 peer was `^3.25 || ^4.0`). Check the **declared
range** in your `package.json`, not just the installed version: a zod-3 range that
satisfied the v1 peer installs and typechecks cleanly under v2 and only fails at
runtime — and quietly: registration swallows the conversion failure, the server starts
and connects normally, and the first `tools/list` (so `client.listTools()`) answers
with an error pointing at `fromJsonSchema()` while the process keeps running. (Only the
deprecated unwrapped raw-shape form with zod-3 field values throws at registration,
with a message pointing at `zod/v4`.) Zod **≥4.2.0** self-converts via
`~standard.jsonSchema` — the supported path. Zod **4.0–4.1** lacks it, so the SDK falls
back to its bundled Zod's `z.toJSONSchema()` with a one-time `[mcp-sdk]` console
warning; and because `.describe()` field descriptions live in the _authoring_ Zod's
registry, the fallback **drops them** from the generated JSON Schema. Fix ladder:
(1) upgrade to `zod ^4.2.0`; (2) if you must pin an older or separate Zod, attach a
`~standard.jsonSchema` provider backed by _your_ Zod's `toJSONSchema` so conversion
(and descriptions) run through your instance; (3) author the schema as raw JSON Schema
via `fromJsonSchema()`. (Raw shapes are wrapped with the SDK's **bundled** Zod — built
with a foreign Zod they fail at registration or at the first `tools/list`; pass
`z.object()`-wrapped schemas from your own Zod instead.)

In a monorepo that pins zod@3 workspace-wide and cannot bump, step (1) can be applied
**per workspace member**: add a zod-4 alias dependency to the migrating member only —
`"zod-v4": "npm:zod@^4.2.0"` in that member's `package.json` — and author SDK-bound
schemas with it (`import { z } from 'zod-v4'`), leaving the rest of the workspace, and
the member's own zod-3 consumer schemas, untouched. The alias copy does not need to be
the same instance as the SDK's bundled zod: conversion runs through the **authoring**
instance's `~standard.jsonSchema`, so `.describe()` descriptions are preserved and the
emitted dialect is 2020-12. Keep the two z's apart — schemas authored with the alias
are for the SDK; they do not compose with the workspace's zod-3 schemas. (For the
bundle-side effects of the same pin, see
[Bundlers: nested `zod` copies](#bundlers-nested-zod-copies-in-zod3-pinned-monorepos).)

**Hosts that forward consumer-authored schemas.** The ladder assumes you author the
schemas yourself. A host API that accepts raw shapes or schemas written by **its own
consumers** — plugin systems, agent frameworks — cannot control the authoring zod
version or instance, and v1's built-in conversion of foreign shapes is gone. Convert on
the host side and register the result with `fromJsonSchema()`: zod-4 input via zod's
own `z.toJSONSchema(z.object(shape), { io: 'input', target: 'draft-2020-12' })` (the
conversion is runtime-structural, so a zod ≥4.2 in the host handles schemas built by a
different zod-4 copy), zod-3 input via the
[`zod-to-json-schema`](https://www.npmjs.com/package/zod-to-json-schema) package. Strip
the `$schema` member from the converted output before passing it to `fromJsonSchema()`
— `zod-to-json-schema` stamps a draft-07 `$schema` by default, and the default
validator [accepts 2020-12 only](#json-schema-2020-12-posture-sep-1613-sep-2106).

How a too-old zod surfaces depends on which entry point your code imports. With
main-entry `import { z } from 'zod'` on a zod-3 range, the project **typechecks cleanly
and fails at the first `tools/list`** (the quiet runtime path above). With
`import * as z from 'zod/v4'` — or any zod whose _typings_ predate
`~standard.jsonSchema` (zod 4.0–4.1, and zod 3.25.x via the `zod/v4` subpath) — the
same code **runs** through the bundled fallback but **fails to compile**:
`registerTool`/`registerPrompt` reject the schema with `TS2769: No overload matches
this call` listing both overloads. The real cause is buried in the first overload's
elaboration — `Property 'jsonSchema' is missing in type …` (that property is
`~standard.jsonSchema`, added in zod 4.2.0) — and a follow-on implicit-`any` error on
the handler's arguments usually appears below it. If you see that two-overload error on
a registration call with a zod schema, check the installed zod version before anything
else; both symptoms resolve identically with step (1) of the ladder.

Projects that must stay below zod 4.2 and accept the documented runtime fallback can
resolve the remaining registration compile errors with an explicit assertion to the
registration schema type — `inputSchema: schema as unknown as
StandardSchemaWithJSON<Input, Output>` — or a small typed wrapper that attaches a
`~standard.jsonSchema` provider (step (2) of the ladder, which changes runtime
conversion but not the schema's static type) and returns the asserted type. The
fallback caveats (one-time warning, dropped `.describe()` descriptions) still apply
unless the provider is attached.

The forced zod-4 bump also surfaces zod's **own** type-level API changes in consumer
annotations: `z.ZodTypeDef` no longer exists and `z.ZodType`'s generic parameters
changed, so v3-era annotations like `z.ZodType<Output, z.ZodTypeDef, Input>` fail to
compile — see [zod's v3-to-v4 changelog](https://zod.dev/v4/changelog). Consumer-only
schemas can keep compiling via zod's v3 compat subpath (`zod/v3`), but anything passed
to the SDK must be a zod-4 (or other Standard Schema) schema.

The deprecated raw-shape overloads exist only on `registerTool` / `registerPrompt`.
`RegisteredTool.update()` / `RegisteredPrompt.update()` take **schema objects**
(`paramsSchema` / `outputSchema`: `StandardSchemaWithJSON`) — a raw shape passed to
`update()` is not auto-wrapped; wrap it with `z.object()` yourself.

```typescript
import * as z from 'zod/v4';
server.registerTool('greet', { inputSchema: z.object({ name: z.string() }) }, handler);

// ArkType works too
import { type } from 'arktype';
server.registerTool('greet', { inputSchema: type({ name: 'string' }) }, handler);

// Raw JSON Schema via fromJsonSchema (validator defaults to runtime-appropriate choice)
import { fromJsonSchema } from '@modelcontextprotocol/server';
server.registerTool('greet', { inputSchema: fromJsonSchema({ type: 'object', properties: { name: { type: 'string' } } }) }, handler);

// No-parameter tools: z.object({})
```

Removed Zod-specific helpers (the codemod marks each call site `@mcp-codemod-error`):
`schemaToJson` — use `fromJsonSchema()` from `@modelcontextprotocol/server` for raw JSON
Schema, or your schema library's native JSON-Schema conversion; `parseSchemaAsync` — use
your schema library's validation directly (e.g. Zod's `.safeParseAsync()`);
`getSchemaShape` / `getSchemaDescription` / `isOptionalSchema` / `unwrapOptionalSchema`
have no replacement (internal Zod introspection). `SchemaInput<T>` →
`StandardSchemaWithJSON.InferInput<T>` is rewritten mechanically by the codemod. The
internal `standardSchemaToJsonSchema` / `validateStandardSchema` helpers are **not** part
of the public surface — do not import them.

v1's second compat module, `server/zod-json-schema-compat.js` (`toJsonSchemaCompat`), is
also removed — and the codemod does **not** rewrite its import (expect `TS2307`). If you
build `Tool` / `Prompt` advertisements yourself, use your schema library's native
conversion: zod 4's `z.toJSONSchema(schema, { io: 'input', target: 'draft-2020-12' })`
produces the dialect v2 advertises.

