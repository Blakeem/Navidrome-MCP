<!--
source: https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/server/server/serverEventBus.html (Classes, Interfaces, and Type Aliases sections only)
version: TypeScript SDK v2.0.0-beta.1 (v2 API reference, beta line implementing MCP spec revision 2026-07-28)
retrieved: 2026-08-11
note: Captured because CreateMcpHandlerOptions.bus and McpHttpHandler.bus/notify
  (server/createMcpHandler.html, this directory's create-mcp-handler.md) are
  typed directly against ServerEventBus/ServerNotifier/ServerEvent -- without
  this page those option-object types have dangling references. The page's
  `## Functions` section (createServerNotifier, honoredSubset,
  listenFilterAccepts, serverEventToNotification -- internal subscriptions/listen
  routing helpers) is OUT OF SCOPE and not captured here.
-->

# server/serverEventBus (Classes, Interfaces, Type Aliases only)

## Classes

### InMemoryServerEventBus

Defined in: [packages/server/src/server/serverEventBus.ts:56](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/serverEventBus.ts#L56)

A `ServerEventBus` backed by an in-process listener set.

`publish()` delivers synchronously to the live listener set (a listener unsubscribing itself mid-dispatch is safe; the entry's listen-router listeners never unsubscribe peers). A throwing listener does not stop delivery to the others.

#### Implements

-   [`ServerEventBus`](#servereventbus)

#### Constructors

##### Constructor

> **new InMemoryServerEventBus**(`onerror?`): [`InMemoryServerEventBus`](#inmemoryservereventbus)

Defined in: [packages/server/src/server/serverEventBus.ts:63](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/serverEventBus.ts#L63)

###### Parameters

###### onerror?

(`error`) => `void`

Optional callback for errors thrown by listeners during dispatch.

###### Returns

[`InMemoryServerEventBus`](#inmemoryservereventbus)

#### Accessors

##### listenerCount

###### Get Signature

> **get** **listenerCount**(): `number`

Defined in: [packages/server/src/server/serverEventBus.ts:86](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/serverEventBus.ts#L86)

The number of currently registered listeners (test/introspection only — the routers track capacity via their own open-subscription set).

###### Returns

`number`

#### Methods

##### publish()

> **publish**(`event`): `void`

Defined in: [packages/server/src/server/serverEventBus.ts:65](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/serverEventBus.ts#L65)

Publish a change event to every registered listener.

###### Parameters

###### event

[`ServerEvent`](#serverevent)

###### Returns

`void`

###### Implementation of

[`ServerEventBus`](#servereventbus).[`publish`](#publish-1)

##### subscribe()

> **subscribe**(`listener`): () => `void`

Defined in: [packages/server/src/server/serverEventBus.ts:75](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/serverEventBus.ts#L75)

Register a listener; returns an idempotent unsubscribe function.

###### Parameters

###### listener

(`event`) => `void`

###### Returns

() => `void`

###### Implementation of

[`ServerEventBus`](#servereventbus).[`subscribe`](#subscribe-1)

## Interfaces

### ServerEventBus

Defined in: [packages/server/src/server/serverEventBus.ts:37](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/serverEventBus.ts#L37)

The server-side change-event seam for `subscriptions/listen`.

The serving entry (`createMcpHandler`) owns the per-stream listen router: each open `subscriptions/listen` stream registers a listener via `subscribe()`, and consumer code (typically via `handler.notify.*` sugar) publishes change events via `publish()`. In-process servers can use the default [`InMemoryServerEventBus`](#inmemoryservereventbus); multi-process deployments implement this interface over their own pub/sub.

The SDK owns wire semantics (ack-first, filtering, subscription-id stamping, teardown); a `ServerEventBus` only sources the events. It MUST NOT echo back to the listener that published an event when called from inside that listener (no surprise here — the default delivers synchronously and listeners never publish).

#### Methods

##### publish()

> **publish**(`event`): `void`

Defined in: [packages/server/src/server/serverEventBus.ts:41](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/serverEventBus.ts#L41)

Publish a change event to every registered listener.

###### Parameters

###### event

[`ServerEvent`](#serverevent)

###### Returns

`void`

##### subscribe()

> **subscribe**(`listener`): () => `void`

Defined in: [packages/server/src/server/serverEventBus.ts:45](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/serverEventBus.ts#L45)

Register a listener; returns an idempotent unsubscribe function.

###### Parameters

###### listener

(`event`) => `void`

###### Returns

() => `void`

* * *

### ServerNotifier

Defined in: [packages/server/src/server/serverEventBus.ts:96](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/serverEventBus.ts#L96)

Typed publish-side facade over `bus.publish` returned by `createMcpHandler`: each method publishes the corresponding [`ServerEvent`](#serverevent). Prefer this over calling `bus.publish` directly — the names match the wire methods.

#### Methods

##### promptsChanged()

> **promptsChanged**(): `void`

Defined in: [packages/server/src/server/serverEventBus.ts:100](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/serverEventBus.ts#L100)

Publish `notifications/prompts/list_changed` to every open subscription that opted in.

###### Returns

`void`

##### resourcesChanged()

> **resourcesChanged**(): `void`

Defined in: [packages/server/src/server/serverEventBus.ts:102](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/serverEventBus.ts#L102)

Publish `notifications/resources/list_changed` to every open subscription that opted in.

###### Returns

`void`

##### resourceUpdated()

> **resourceUpdated**(`uri`): `void`

Defined in: [packages/server/src/server/serverEventBus.ts:104](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/serverEventBus.ts#L104)

Publish `notifications/resources/updated` for `uri` to every open subscription that opted in to that URI.

###### Parameters

###### uri

`string`

###### Returns

`void`

##### toolsChanged()

> **toolsChanged**(): `void`

Defined in: [packages/server/src/server/serverEventBus.ts:98](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/serverEventBus.ts#L98)

Publish `notifications/tools/list_changed` to every open subscription that opted in.

###### Returns

`void`

## Type Aliases

### ServerEvent

> **ServerEvent** = { `kind`: `"tools_list_changed"`; } | { `kind`: `"prompts_list_changed"`; } | { `kind`: `"resources_list_changed"`; } | { `kind`: `"resource_updated"`; `uri`: `string`; }

Defined in: [packages/server/src/server/serverEventBus.ts:15](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/serverEventBus.ts#L15)

A change event a server publishes for delivery on open `subscriptions/listen` streams. Each variant maps onto exactly one notification method:

-   `tools_list_changed` → `notifications/tools/list_changed`
-   `prompts_list_changed` → `notifications/prompts/list_changed`
-   `resources_list_changed` → `notifications/resources/list_changed`
-   `resource_updated` → `notifications/resources/updated` (carries the URI)

The bus carries the EVENT, not the wire shape — the entry's listen router owns subscription-id stamping and per-stream filtering.
