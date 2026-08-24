<!--
source: https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.0.0-beta.1/docs/migration/upgrade-to-v2.md
version: TypeScript SDK v2.0.0-beta.1 (git tag v2.0.0-beta.1; beta line implementing MCP spec revision 2026-07-28)
retrieved: 2026-08-11
part: 6 of 7 — Types & schemas (verbatim slice of the source file, lines 1291-1473)
full guide: docs/migration/upgrade-to-v2.md, split here at heading boundaries; text is unmodified
-->

# Upgrading from v1.x to v2 — part 6: Types & schemas

### Types & schemas

#### Zod `*Schema` constants moved to `@modelcontextprotocol/core`

The Zod schemas (`CallToolResultSchema`, `ListToolsResultSchema`, …) that v1 exported
from `types.js` now live in a separate **`@modelcontextprotocol/core`** package. Neither
`@modelcontextprotocol/client` nor `@modelcontextprotocol/server` re-exports them — both
packages stay Zod-free in their public surface.

The v1→v2 change is just an import-path swap — `.parse()` / `.safeParse()` keep working
unchanged:

```typescript
// v1
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
if (CallToolResultSchema.safeParse(value).success) { ... }

// v2 — same Zod schema, new package
import { CallToolResultSchema } from '@modelcontextprotocol/core';
if (CallToolResultSchema.safeParse(value).success) { ... }
```

`@modelcontextprotocol/core` is the canonical home for the spec's Zod schema constants
(and the OAuth/OpenID metadata schemas). It is runtime-neutral (its only dependency is
`zod`) and is **not** required by `client` / `server` — install it only if you import the
raw schemas directly.

If you would rather keep your project Zod-free, the **`isSpecType` / `specTypeSchemas`**
alternatives are exported from `@modelcontextprotocol/client` and `…/server`:

```typescript
import { isSpecType, specTypeSchemas } from '@modelcontextprotocol/client';
if (isSpecType.CallToolResult(value)) { ... }
const blocks = mixed.filter(isSpecType.ContentBlock);
const result = specTypeSchemas.CallToolResult['~standard'].validate(value);
```

`isSpecType` and `specTypeSchemas` are keyed by `SpecTypeName` — a literal union of
every named type in the MCP spec — so you get autocomplete and a compile error on typos.
`specTypeSchemas.X` is a `StandardSchemaV1Sync<In, Out>` (`validate()` is synchronous).
`validate()` returns `{ value }` or `{ issues }` and never throws — unlike `.parse()` on
the real schema; code that caught a `ZodError` should inspect `result.issues` (or keep
`.parse()` on the schema imported from `@modelcontextprotocol/core`).
The pre-existing `isCallToolResult(value)` guard still works.

**`specTypeSchemas.X` is `StandardSchemaV1`, not `ZodType`.** Zod-specific composition
— `.extend()`, `.pick()`, `.omit()`, `.merge()`, `.shape`, `.passthrough()`,
`.parseAsync()` — does **not** compile on a `specTypeSchemas` entry; reach for the real
Zod schema from `@modelcontextprotocol/core` when you need to derive a tolerant variant
of a spec schema (e.g.
`ListToolsResultSchema.extend({ tools: ToolSchema.omit({ outputSchema: true }).array() })`).
The Zod-specific `AnySchema` / `SchemaOutput` types from `…/zod-compat.js` are removed —
replace with `StandardSchemaV1` / `StandardSchemaV1.InferOutput<T>` (the codemod's
removal message says the same).

**Composing two core schemas.** Zod composition needs a shared zod: deriving from a
single core schema (as above) and combining core schemas with your own `z` typecheck
when your `zod` resolves to the **same copy** `@modelcontextprotocol/core` uses (a
`zod ^4.2.0` range that dedupes). When it cannot — a zod@3-pinned project nests core's
own zod@4 — v1 idioms that combined two spec schemas with your `z` no longer compile:
core does not export its zod instance, and a foreign zod's `z.union(…)` / `.or(…)`
rejects core's schema types. For accept-either result parsing, skip composition:
request with the `ResultSchema` passthrough (the same one the
[gateway note](#request-ctxmcpreqsend-and-calltool-no-longer-require-a-schema-for-spec-methods)
uses) and discriminate with sequential `safeParse`:

```typescript
// v1 — one composed schema
const result = await client.request(req, z.union([CompatibilityCallToolResultSchema, CreateTaskResultSchema]));

// v2 — passthrough request, then sequential discrimination
import { CompatibilityCallToolResultSchema, CreateTaskResultSchema, ResultSchema } from '@modelcontextprotocol/core';
const raw = await client.request(req, ResultSchema);
const asTask = CreateTaskResultSchema.safeParse(raw);
const result = asTask.success ? asTask.data : CompatibilityCallToolResultSchema.parse(raw);
```

Order the candidates from most to least specific, and `.parse()` the last one so a
result that matches no candidate still fails loudly.

The role-aggregate unions (`ClientRequest`, `ServerResult`, `ServerRequest`,
`ClientResult`, `ClientNotification`, `ServerNotification`) and the typed-method maps
(`RequestMethod`, `RequestTypeMap`, `ResultTypeMap`, `NotificationTypeMap`) no longer
include task vocabulary; the deprecated `Task*` types remain importable on their own.
(One published-alpha qualification, like the `-32002` note in [Errors](#errors): the
`2.0.0-alpha.3` and earlier typings predate this — the typed maps there still carry the
`tasks/*` entries, and `ResultTypeMap['tools/call']` still unions `CreateTaskResult`, so
a `client.request({ method: 'tools/call', … })` result does not assign to
`Promise<CallToolResult>`. If pinned to those alphas, narrow with the
`isCallToolResult` guard — the recommended discrimination tool anyway, per the next
paragraph; `2.0.0-alpha.4` and later are unaffected.)

**Discriminating result shapes: use guards, not the `in` operator.** The v2
zod-inferred result types are passthrough objects — every union member carries an index
signature — so v1-idiomatic property discrimination such as
`if ('content' in result) { … } else { result.toolResult }` no longer narrows: the `in`
check is satisfiable by every member, and the else branch can collapse to `never`
(surfacing as `TS2339` on the property you then read). Use the exported guards instead:
`isCallToolResult(result)`, or `isSpecType.GetPromptResult(result)` and friends for any
other spec type ([above](#zod-schema-constants-moved-to-modelcontextprotocolcore)). An
adjacent trap when keeping a union for later narrowing: a `const` **annotation** is
control-flow-narrowed straight back to the initializer's type — after
`const r: A | B = await fn()`, `r` has `fn`'s return type, not the union — so when you
need the wider union (e.g. a `CompatibilityCallToolResult` branch), apply an
`as A | B` assertion instead of an annotation.

#### Removed type aliases

| Removed                                                         | Replacement                                                     |
| --------------------------------------------------------------- | --------------------------------------------------------------- |
| `JSONRPCError`                                                  | `JSONRPCErrorResponse`                                          |
| `JSONRPCErrorSchema`                                            | `JSONRPCErrorResponseSchema`                                    |
| `isJSONRPCError`                                                | `isJSONRPCErrorResponse`                                        |
| `isJSONRPCResponse` (deprecated in v1)                          | `isJSONRPCResultResponse` ²                                     |
| `JSONRPCResponseSchema` (result-only in v1)                     | `JSONRPCResultResponseSchema` ²                                 |
| `JSONRPCResponse` (result-only in v1)                           | `JSONRPCResultResponse` ²                                       |
| `ResourceReference` / `ResourceReferenceSchema`                 | `ResourceTemplateReference` / `ResourceTemplateReferenceSchema` |
| `IsomorphicHeaders`                                             | Web Standard `Headers`                                          |
| `RequestHandlerExtra`                                           | `ServerContext` / `ClientContext` / `BaseContext`               |
| `ResourceTemplate` (the spec wire **type** from `sdk/types.js`) | `ResourceTemplateType` ³                                        |

² v2 introduces **new** `isJSONRPCResponse` / `JSONRPCResponse` / `JSONRPCResponseSchema`
with corrected semantics — they match **both** result and error responses (the schema is
`z.union([JSONRPCResultResponseSchema, JSONRPCErrorResponseSchema])`). v1's symbols only
matched results. To preserve v1 behavior, rename to `isJSONRPCResultResponse` /
`JSONRPCResultResponse` / `JSONRPCResultResponseSchema` (the codemod does this).

³ The `ResourceTemplate` URI-template helper **class** (from `sdk/server/mcp.js`) is
**unchanged** — keep `new ResourceTemplate(...)` as-is. Only the like-named spec wire
type from `types.js` was renamed to `ResourceTemplateType` to resolve the v1 collision;
the codemod scopes the rename to imports from `sdk/types.js` only.

All other symbols from `@modelcontextprotocol/sdk/types.js` retain their original
names — import the TypeScript types, error classes, enums, and type guards from
`@modelcontextprotocol/client` or `@modelcontextprotocol/server`, and the Zod
`*Schema` constants from `@modelcontextprotocol/core`.

One type-level narrowing to note: client/server capability `experimental` payloads are
now typed as JSON-compatible objects (nested JSON values) rather than arbitrary
objects. A payload typed `Record<string, unknown>` no longer assigns (`TS2322`) — give
the source a JSON-compatible type or cast at the boundary.

The `Protocol` base class itself is no longer exported (it is internal engine). If you
were reaching into protocol internals — rare, mostly debugging tools —
`client.fallbackRequestHandler` / `server.fallbackRequestHandler` receives every
inbound request that no registered handler matches, before capability gating. Delete
the v1 `shared/protocol.js` import: `Protocol` has no v2 import path. The codemod
drops `Protocol` (and `mergeCapabilities`) from the rewritten import and leaves an
`@mcp-codemod-error` marker at the site explaining the replacement.

#### JSON Schema 2020-12 posture (SEP-1613, SEP-2106)

The default validator supports **JSON Schema 2020-12 only**. On Node it is now `Ajv2020`
instead of draft-07 `Ajv`; the Cloudflare Workers default was already 2020-12. Schemas
declaring a different `$schema` are rejected with `Error("…unsupported dialect…")`.

`CallToolResult.structuredContent` is widened from `{ [k: string]: unknown }` to
`unknown` (SEP-2106 lifts the `type:"object"` root restriction). The presence check is
`!== undefined`, not falsy (`null` / `0` / `false` / `""` are legal values now). External
`$ref` is not dereferenced (unchanged from v1; Ajv throws `MissingRefError` at compile,
surfaced per-tool on `callTool`).

| v1 pattern                                                         | Mechanical fix                                                                                                                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `result.structuredContent.<key>` / `result.structuredContent?.<k>` | narrow first: `const sc = result.structuredContent; if (typeof sc === 'object' && sc !== null && '<k>' in sc) { sc.<k> }`                                                                              |
| `if (!result.structuredContent)`                                   | `if (result.structuredContent === undefined)`                                                                                                                                                          |
| relying on default `Ajv` being draft-07                            | `new AjvJsonSchemaValidator(new Ajv({ strict: false, validateFormats: true, validateSchema: false, allErrors: true }))` (import `Ajv`, `addFormats`, `AjvJsonSchemaValidator` from `…/validators/ajv`) |
| draft-07 idioms via `fromJsonSchema(schema)`                       | `fromJsonSchema(schema, new AjvJsonSchemaValidator(ajv))` — the `McpServer`/`Client` `jsonSchemaValidator` option does **not** reach `fromJsonSchema`-authored schemas                                 |
| `outputSchema` / `inputSchema` with absolute-URI `$ref`            | inline under `$defs` and reference with `#/$defs/Name`                                                                                                                                                 |

A tool may now register an `outputSchema` whose root is `type:"array"`, `type:"string"`,
etc.; toward 2025-era clients the codec wraps it in a `{result:…}` envelope, and toward
every era a non-object `structuredContent` with no `text` block of its own gets a
`JSON.stringify(...)` `text` block auto-appended. See [support-2026-07-28.md › Per-era wire codecs](./support-2026-07-28.md#per-era-wire-codecs) for how the codec applies these per era.

**Your advertised tool schemas change shape on the wire.** The same `registerTool`
calls produce `tools/list` entries whose generated `inputSchema` differs from v1:
JSON Schema 2020-12 idioms (zod 4 conversion), different `additionalProperties`
handling (no `additionalProperties: false` by default; passthrough objects emit
`"additionalProperties": {}` instead of `true`), and no `execution.taskSupport` member.
Golden tests, transcript pins, and strict client-side validators of your advertised
tool list need re-baselining — the new shapes are spec-conformant.

