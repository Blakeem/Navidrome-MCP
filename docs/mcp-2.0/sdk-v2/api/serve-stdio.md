<!--
source: https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/server/server/serveStdio.html
version: TypeScript SDK v2.0.0-beta.1 (v2 API reference, beta line implementing MCP spec revision 2026-07-28)
retrieved: 2026-08-11
-->

# server/serveStdio

## Interfaces

### ServeStdioOptions

Defined in: [packages/server/src/server/serveStdio.ts:85](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/serveStdio.ts#L85)

Options for [`serveStdio`](#servestdio).

#### Properties

##### legacy?

> `optional` **legacy?**: `"reject"` | `"serve"`

Defined in: [packages/server/src/server/serveStdio.ts:98](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/serveStdio.ts#L98)

How a 2025-era opening (an `initialize` request, or any claim-less message) is handled:

-   `'serve'` (default) — the connection is pinned to a 2025-era instance from the same factory and served exactly as a hand-wired stdio server serves it today.
-   `'reject'` — the opening request is answered with the unsupported-protocol-version error naming the supported modern revisions (claim-less notifications are dropped); the connection stays open for a modern opening.

##### maxSubscriptions?

> `optional` **maxSubscriptions?**: `number`

Defined in: [packages/server/src/server/serveStdio.ts:116](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/serveStdio.ts#L116)

Reject a new `subscriptions/listen` with `-32603` 'Subscription limit reached' (in-band, before the ack) when this many subscriptions are already open on this connection.

###### Default

```ts
1024
```

##### onerror?

> `optional` **onerror?**: (`error`) => `void`

Defined in: [packages/server/src/server/serveStdio.ts:109](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/serveStdio.ts#L109)

Callback for out-of-band errors (reporting only; it never alters what is written to the wire).

###### Parameters

###### error

`Error`

###### Returns

`void`

##### transport?

> `optional` **transport?**: [`Transport`](./../../../index/@modelcontextprotocol/server/#transport-1)

Defined in: [packages/server/src/server/serveStdio.ts:107](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/serveStdio.ts#L107)

Bring your own transport (for example a `StdioServerTransport` constructed over a Unix domain socket or TCP stream, per the stdio binding's custom-transport guidance). Defaults to a [`StdioServerTransport`](./stdio.html#stdioservertransport) over the current process's stdio. The entry owns the transport: it starts it, receives every inbound message, and closes it when the connection ends.

* * *

### StdioServerHandle

Defined in: [packages/server/src/server/serveStdio.ts:120](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/serveStdio.ts#L120)

The handle returned by [`serveStdio`](#servestdio).

#### Methods

##### close()

> **close**(): `Promise`<`void`\>

Defined in: [packages/server/src/server/serveStdio.ts:122](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/serveStdio.ts#L122)

Tears the connection down: closes the pinned instance (if any) and the underlying transport.

###### Returns

`Promise`<`void`\>

## Functions

### serveStdio()

> **serveStdio**(`factory`, `options?`): [`StdioServerHandle`](#stdioserverhandle)

Defined in: [packages/server/src/server/serveStdio.ts:375](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/serveStdio.ts#L375)

Serves MCP over stdio from a server factory, owning the era decision for the connection: the opening exchange selects the era, ONE instance from the factory is pinned for the connection lifetime, and everything after passes straight through to it. See the module documentation for the opening rules.

```ts
import { serveStdio } from '@modelcontextprotocol/server/stdio';

serveStdio(() => {
    const server = new McpServer({ name: 'my-server', version: '1.0.0' }, { capabilities: { tools: {} } });
    // register tools/resources/prompts once — the same factory serves both eras
    return server;
});
```

#### Parameters

##### factory

[`McpServerFactory`](./createMcpHandler.html#mcpserverfactory)

##### options?

[`ServeStdioOptions`](#servestdiooptions) = `{}`

#### Returns

[`StdioServerHandle`](#stdioserverhandle)
