<!--
source: https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/server/server/createMcpHandler.html
version: TypeScript SDK v2.0.0-beta.1 (v2 API reference, beta line implementing MCP spec revision 2026-07-28)
retrieved: 2026-08-11
-->

# server/createMcpHandler

## Interfaces

### CreateMcpHandlerOptions

Defined in: [packages/server/src/server/createMcpHandler.ts:142](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/createMcpHandler.ts#L142)

Options for [`createMcpHandler`](#createmcphandler).

#### Properties

##### bus?

> `optional` **bus?**: [`ServerEventBus`](./serverEventBus.html#servereventbus)

Defined in: [packages/server/src/server/createMcpHandler.ts:189](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/createMcpHandler.ts#L189)

The change-event bus `subscriptions/listen` streams subscribe to.

When omitted, an in-process [InMemoryServerEventBus](./serverEventBus.html#inmemoryservereventbus) is created and the returned handler's `notify` sugar publishes onto it. Multi-process deployments supply their own implementation over their pub/sub backend; the same instance can be shared across handlers.

##### keepAliveMs?

> `optional` **keepAliveMs?**: `number`

Defined in: [packages/server/src/server/createMcpHandler.ts:202](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/createMcpHandler.ts#L202)

SSE comment-frame keepalive interval for every SSE stream this handler serves. In modern `auto` mode it starts after SSE upgrade. Set to `0` to disable.

###### Default

```ts
15000
```

##### legacy?

> `optional` **legacy?**: `"reject"` | `"stateless"`

Defined in: [packages/server/src/server/createMcpHandler.ts:165](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/createMcpHandler.ts#L165)

How 2025-era (non-envelope) traffic is served:

-   `'stateless'` (the default, also when the option is omitted) — old-school stateless serving: each legacy request is answered by a fresh instance from the same factory over a streamable HTTP transport constructed with only `sessionIdGenerator: undefined` (the established stateless idiom). Because serving is per-request and stateless, GET and DELETE (2025 session operations) are answered with `405` / `Method not allowed.`.
-   `'reject'` — modern-only strict: legacy-classified requests are rejected with the unsupported-protocol-version error naming the endpoint's supported revisions (legacy-classified notifications are acknowledged with `202` and dropped). **There is no 2025 serving in this mode.**

There is no handler-valued option: to keep an existing legacy deployment (for example a sessionful streamable HTTP wiring) serving 2025 traffic next to this entry, route in user land with [`isLegacyRequest`](#islegacyrequest) in front of a `legacy: 'reject'` handler — see that predicate's documentation for the pattern.

##### maxSubscriptions?

> `optional` **maxSubscriptions?**: `number`

Defined in: [packages/server/src/server/createMcpHandler.ts:196](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/createMcpHandler.ts#L196)

Reject a new `subscriptions/listen` with `-32603` 'Subscription limit reached' (in-band, HTTP 200, before the ack) when this many subscription streams are already open on this handler.

###### Default

```ts
1024
```

##### onerror?

> `optional` **onerror?**: (`error`) => `void`

Defined in: [packages/server/src/server/createMcpHandler.ts:167](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/createMcpHandler.ts#L167)

Callback for out-of-band errors and rejected requests (reporting only; it never alters the response).

###### Parameters

###### error

`Error`

###### Returns

`void`

##### responseMode?

> `optional` **responseMode?**: [`PerRequestResponseMode`](./perRequestTransport.html#perrequestresponsemode)

Defined in: [packages/server/src/server/createMcpHandler.ts:180](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/createMcpHandler.ts#L180)

Response shaping for modern (2026-07-28) request exchanges:

-   `'auto'` (default) — a single JSON body unless the handler emits a related message before its result, in which case the response upgrades to an SSE stream.
-   `'sse'` — always stream.
-   `'json'` — never stream. **Mid-call notifications (progress, logging, any related message emitted before the result) are dropped** — only the terminal result is delivered. Listen-class subscription streams are always served over SSE regardless of this setting.

* * *

### McpHandlerRequestOptions

Defined in: [packages/server/src/server/createMcpHandler.ts:121](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/createMcpHandler.ts#L121)

Caller-provided per-request inputs for [`McpHttpHandler.fetch`](#fetch) and fetch-shaped legacy handlers ([`LegacyHttpHandler`](#legacyhttphandler)).

#### Properties

##### authInfo?

> `optional` **authInfo?**: [`AuthInfo`](./../../../index/@modelcontextprotocol/server/#authinfo)

Defined in: [packages/server/src/server/createMcpHandler.ts:127](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/createMcpHandler.ts#L127)

Validated authentication information for the request. Strictly pass-through: the handler never populates this from request headers and performs no token verification of its own.

##### parsedBody?

> `optional` **parsedBody?**: `unknown`

Defined in: [packages/server/src/server/createMcpHandler.ts:129](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/createMcpHandler.ts#L129)

A pre-parsed JSON request body (e.g. `req.body` from `express.json()`).

* * *

### McpHttpHandler

Defined in: [packages/server/src/server/createMcpHandler.ts:215](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/createMcpHandler.ts#L215)

The handler returned by [`createMcpHandler`](#createmcphandler): a web-standard `{ fetch, close, notify, bus }` object — the shape Workers/Bun/Deno expect from `export default`. `fetch` is an arrow-assigned bound property: it can be detached and passed around (`const { fetch } = handler`) without losing its binding.

Node frameworks (Express, Fastify, plain `node:http`) wrap the handler once with `toNodeHandler(handler)` from `@modelcontextprotocol/node`.

#### Properties

##### bus

> **bus**: [`ServerEventBus`](./serverEventBus.html#servereventbus)

Defined in: [packages/server/src/server/createMcpHandler.ts:238](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/createMcpHandler.ts#L238)

The change-event bus this handler's `subscriptions/listen` streams subscribe to (the supplied `bus` option, or the auto-created in-process default).

##### close

> **close**: () => `Promise`<`void`\>

Defined in: [packages/server/src/server/createMcpHandler.ts:224](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/createMcpHandler.ts#L224)

Tears down the modern leg: aborts in-flight modern exchanges and closes their per-request instances. Legacy serving is unaffected — the stateless fallback is per-request by construction and holds nothing between exchanges.

###### Returns

`Promise`<`void`\>

##### fetch

> **fetch**: (`request`, `options?`) => `Promise`<`Response`\>

Defined in: [packages/server/src/server/createMcpHandler.ts:217](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/createMcpHandler.ts#L217)

Web-standard face: serve one HTTP request and resolve with the response.

###### Parameters

###### request

`Request`

###### options?

[`McpHandlerRequestOptions`](#mcphandlerrequestoptions)

###### Returns

`Promise`<`Response`\>

##### notify

> **notify**: [`ServerNotifier`](./serverEventBus.html#servernotifier)

Defined in: [packages/server/src/server/createMcpHandler.ts:232](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/createMcpHandler.ts#L232)

Typed publish-side facade over the handler's `subscriptions/listen` bus: each method publishes the corresponding change event to every open subscription stream that opted in to that notification type.

Safe to call when no subscription is open (no-op).

* * *

### McpRequestContext

Defined in: [packages/server/src/server/createMcpHandler.ts:90](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/createMcpHandler.ts#L90)

Construction context handed to an [`McpServerFactory`](#mcpserverfactory).

Both serving entries call the factory with this context whenever they need a fresh instance: [`createMcpHandler`](#createmcphandler) once per HTTP request, and `serveStdio` (from `@modelcontextprotocol/server/stdio`) once per connection — plus once for a `server/discover` probe instance that is discarded again if the client falls back to `initialize`.

Zero-argument factories remain assignable unchanged; the context exists for factories that vary by principal or era (for example multi-tenant servers keyed off `authInfo`, or a factory that registers extra surface only for one era).

#### Properties

##### authInfo?

> `optional` **authInfo?**: [`AuthInfo`](./../../../index/@modelcontextprotocol/server/#authinfo)

Defined in: [packages/server/src/server/createMcpHandler.ts:105](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/createMcpHandler.ts#L105)

Validated authentication information passed by the caller of the handler face (pass-through; HTTP only — `serveStdio` never sets it).

##### era

> **era**: `"legacy"` | `"modern"`

Defined in: [packages/server/src/server/createMcpHandler.ts:100](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/createMcpHandler.ts#L100)

The protocol era the constructed instance will serve: `modern` for 2026-07-28 (per-request envelope) traffic, `legacy` for 2025-era traffic. Under [`createMcpHandler`](#createmcphandler) a `legacy` instance serves one request through the stateless legacy fallback (the default — `legacy: 'reject'` endpoints are strict and never construct one); under `serveStdio` it serves a connection that opened with the 2025 handshake and stays pinned to that era for its lifetime.

##### requestInfo?

> `optional` **requestInfo?**: `Request`

Defined in: [packages/server/src/server/createMcpHandler.ts:107](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/createMcpHandler.ts#L107)

The original HTTP request being served, when available (HTTP only — `serveStdio` never sets it).

## Type Aliases

### LegacyHttpHandler

> **LegacyHttpHandler** = (`request`, `options?`) => `Promise`<`Response`\>

Defined in: [packages/server/src/server/createMcpHandler.ts:139](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/createMcpHandler.ts#L139)

A fetch-shaped handler serving 2025-era traffic: the shape produced by [`legacyStatelessFallback`](#legacystatelessfallback), and the shape a hand-wired composition routes legacy requests to (see [`isLegacyRequest`](#islegacyrequest)). It is not a `legacy` option value — the entry's own legacy serving is selected by the `'stateless' | 'reject'` posture only.

#### Parameters

##### request

`Request`

##### options?

[`McpHandlerRequestOptions`](#mcphandlerrequestoptions)

#### Returns

`Promise`<`Response`\>

* * *

### McpServerFactory

> **McpServerFactory** = (`ctx`) => [`McpServer`](./mcp.html#mcpserver) | [`Server`](./server.html#server) | `Promise`<[`McpServer`](./mcp.html#mcpserver) | [`Server`](./server.html#server)\>

Defined in: [packages/server/src/server/createMcpHandler.ts:118](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/createMcpHandler.ts#L118)

A factory producing a fresh [`McpServer`](./mcp.html#mcpserver) (or low-level [`Server`](./server.html#server)) instance for one serving unit: one HTTP request under [`createMcpHandler`](#createmcphandler), or one connection (or one discarded `server/discover` probe) under `serveStdio`. The same factory backs every era either entry serves — define your tools, resources and prompts once and serve them to both eras.

#### Parameters

##### ctx

[`McpRequestContext`](#mcprequestcontext)

#### Returns

[`McpServer`](./mcp.html#mcpserver) | [`Server`](./server.html#server) | `Promise`<[`McpServer`](./mcp.html#mcpserver) | [`Server`](./server.html#server)\>

## Functions

### createMcpHandler()

> **createMcpHandler**(`factory`, `options?`): [`McpHttpHandler`](#mcphttphandler)

Defined in: [packages/server/src/server/createMcpHandler.ts:604](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/createMcpHandler.ts#L604)

Creates an HTTP handler that serves the 2026-07-28 protocol revision from a per-request server factory and, by default, falls back to old-school stateless serving for 2025-era traffic. Pass `legacy: 'reject'` for a modern-only strict endpoint.

Mounting: `handler.fetch` is the web-standard face (Cloudflare Workers, Deno, Bun, Hono's `c.req.raw`); for Express/Fastify/plain `node:http`, wrap the handler once with `toNodeHandler(handler)` from `@modelcontextprotocol/node`. When mounting bare on a fetch-native runtime, put Origin/Host validation in front of the handler — the entry itself is deliberately validation-free:

```ts
import { hostHeaderValidationResponse, originValidationResponse, localhostAllowedHostnames, localhostAllowedOrigins } from '@modelcontextprotocol/server';

export default {
    async fetch(request: Request): Promise<Response> {
        const rejected =
            hostHeaderValidationResponse(request, localhostAllowedHostnames()) ??
            originValidationResponse(request, localhostAllowedOrigins());
        return rejected ?? handler.fetch(request);
    }
};
```

Use ONE factory for both legs: the same tools/resources/prompts definition backs the modern path and the stateless legacy fallback, so the two eras can never drift apart. To keep an existing legacy deployment (for example a sessionful streamable HTTP wiring) serving 2025 traffic instead of the stateless fallback, route in user land with [`isLegacyRequest`](#islegacyrequest) in front of a strict handler — see that predicate's documentation for the pattern. Power users composing transport-neutral routing can also use the exported building blocks directly: [`classifyInboundRequest`](./../../../index/@modelcontextprotocol/server/#classifyinboundrequest) for the era decision and `PerRequestHTTPServerTransport` for single-exchange serving — such compositions must reject POSTs whose Content-Type media type is not `application/json` (415) before parsing the body, using [`isJsonContentType`](./../../../index/@modelcontextprotocol/server/#isjsoncontenttype); neither building block performs this validation itself.

The entry performs no token verification: `authInfo` given to `fetch` is passed through to handlers and the factory as-is and is never derived from request headers.

#### Parameters

##### factory

[`McpServerFactory`](#mcpserverfactory)

##### options?

[`CreateMcpHandlerOptions`](#createmcphandleroptions) = `{}`

#### Returns

[`McpHttpHandler`](#mcphttphandler)

* * *

### isLegacyRequest()

> **isLegacyRequest**(`request`, `parsedBody?`): `Promise`<`boolean`\>

Defined in: [packages/server/src/server/createMcpHandler.ts:546](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/createMcpHandler.ts#L546)

Whether [`createMcpHandler`](#createmcphandler) would route this request to its legacy (2025-era) serving rather than the modern (2026-07-28) path.

Call it with just the request: `await isLegacyRequest(request)`. For a `POST` the body is read from an internal clone, so the request you pass stays fully readable for whichever handler you route it to — no second argument is needed. (In a Node `(req, res)` handler, build that `Request` with `toWebRequest(req)` from `@modelcontextprotocol/node`; behind a body parser, which has already drained the Node stream, build it as `toWebRequest(req, req.body)` so the bytes come from the parsed body — either way the predicate still takes just the request.) The optional `parsedBody` is a perf escape hatch for a body you already hold parsed: pass it and the predicate classifies from the value directly, reading and cloning nothing. It is needed, not just faster, when the request's own body was already read — the internal clone is then impossible (cloning a used body throws a `TypeError`), so such a single-argument call rejects instead of guessing.

This is the entry's own classification step exported as a predicate — it runs exactly the code `createMcpHandler` runs to make the routing decision, not a re-implementation — so a hand-wired composition that branches on it can never disagree with the entry. It is classification only: hand-wired compositions must validate Content-Type themselves (415 for POSTs whose media type is not `application/json`, via [`isJsonContentType`](./../../../index/@modelcontextprotocol/server/#isjsoncontenttype)) before dispatching either leg — routing the legacy leg into the SDK transports gets their built-in check, but a custom modern leg has none. Use it to keep an existing legacy deployment (for example a sessionful streamable HTTP wiring) serving 2025 traffic next to a strict modern endpoint, now that the entry has no handler-valued `legacy` option:

```ts
import { createMcpHandler, isLegacyRequest } from '@modelcontextprotocol/server';

const modern = createMcpHandler(factory, { legacy: 'reject' });

export default {
    async fetch(request: Request): Promise<Response> {
        if (await isLegacyRequest(request)) {
            // e.g. an existing sessionful WebStandardStreamableHTTPServerTransport wiring
            return myExistingLegacyHandler(request);
        }
        return modern.fetch(request);
    }
};
```

Semantics (identical to the entry's routing):

-   Returns `true` only for requests with no per-request `_meta` envelope claim: claim-less POSTs (including the `initialize` handshake and 2025-era notification POSTs without a modern protocol-version header), body-less GET/DELETE session operations, all-legacy JSON-RPC batch arrays, posted JSON-RPC responses, and POSTs whose body is empty or not valid JSON.
-   Returns `false` for everything the modern path answers, including its validation-ladder rejections: a request carrying the envelope claim (even one naming a revision the endpoint does not serve — the modern path answers it with the unsupported-protocol-version error), a malformed envelope behind a present claim (answered `-32602`), a request whose `MCP-Protocol-Version` header names a modern revision but that lacks the envelope (`-32602`), and header/body mismatches (`-32020`). Consumers routing on the predicate must send `false` traffic to the modern handler, never to a legacy handler — the modern path owns those error answers.
-   `server/discover` probes sent by negotiating clients always carry the envelope claim, so they are never legacy; a hand-built claim-less POST to a method named `server/discover` has no claim and classifies legacy, exactly as the entry itself routes it.

#### Parameters

##### request

`Request`

##### parsedBody?

`unknown`

#### Returns

`Promise`<`boolean`\>

* * *

### legacyStatelessFallback()

> **legacyStatelessFallback**(`factory`, `onerror?`): [`LegacyHttpHandler`](#legacyhttphandler)

Defined in: [packages/server/src/server/createMcpHandler.ts:401](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/createMcpHandler.ts#L401)

#### Parameters

##### factory

[`McpServerFactory`](#mcpserverfactory)

##### onerror?

(`error`) => `void`

#### Returns

[`LegacyHttpHandler`](#legacyhttphandler)
