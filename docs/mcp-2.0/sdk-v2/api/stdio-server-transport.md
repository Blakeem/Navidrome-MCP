<!--
source: https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/server/server/stdio.html
version: TypeScript SDK v2.0.0-beta.1 (v2 API reference, beta line implementing MCP spec revision 2026-07-28)
retrieved: 2026-08-11
-->

# server/stdio

## Classes

### StdioServerTransport

Defined in: [packages/server/src/server/stdio.ts:19](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/stdio.ts#L19)

Server transport for stdio: this communicates with an MCP client by reading from the current process' `stdin` and writing to `stdout`.

This transport is only available in Node.js environments.

#### Example

```ts
const server = new McpServer({ name: 'my-server', version: '1.0.0' });
const transport = new StdioServerTransport();
await server.connect(transport);
```

#### Implements

-   [`Transport`](./../../../index/@modelcontextprotocol/server/#transport-1)

#### Constructors

##### Constructor

> **new StdioServerTransport**(`_stdin?`, `_stdout?`, `options?`): [`StdioServerTransport`](#stdioservertransport)

Defined in: [packages/server/src/server/stdio.ts:24](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/stdio.ts#L24)

###### Parameters

###### \_stdin?

`Readable` = `process.stdin`

###### \_stdout?

`Writable` = `process.stdout`

###### options?

###### maxBufferSize?

`number`

Maximum size of the read buffer in bytes. If a single message exceeds this size the transport will emit an error and close.

Defaults to 10 MB.

###### Returns

[`StdioServerTransport`](#stdioservertransport)

#### Properties

##### onclose?

> `optional` **onclose?**: () => `void`

Defined in: [packages/server/src/server/stdio.ts:40](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/stdio.ts#L40)

Callback for when the connection is closed for any reason.

This should be invoked when [`close()`](./../../../index/@modelcontextprotocol/server/#close-2) is called as well.

###### Returns

`void`

###### Implementation of

[`Transport`](./../../../index/@modelcontextprotocol/server/#transport-1).[`onclose`](./../../../index/@modelcontextprotocol/server/#onclose-2)

##### onerror?

> `optional` **onerror?**: (`error`) => `void`

Defined in: [packages/server/src/server/stdio.ts:41](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/stdio.ts#L41)

Callback for when an error occurs.

Note that errors are not necessarily fatal; they are used for reporting any kind of exceptional condition out of band.

###### Parameters

###### error

`Error`

###### Returns

`void`

###### Implementation of

[`Transport`](./../../../index/@modelcontextprotocol/server/#transport-1).[`onerror`](./../../../index/@modelcontextprotocol/server/#onerror-2)

##### onmessage?

> `optional` **onmessage?**: (`message`) => `void`

Defined in: [packages/server/src/server/stdio.ts:42](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/stdio.ts#L42)

Callback for when a message (request or response) is received over the connection.

Includes the [`request`](./../../../index/@modelcontextprotocol/server/#request-1) and [`authInfo`](./../../../index/@modelcontextprotocol/server/#authinfo-1) if the transport is authenticated.

The [`request`](./../../../index/@modelcontextprotocol/server/#request-1) can be used to get the original request information (headers, etc.)

###### Parameters

###### message

[`JSONRPCMessage`](./../../../index/@modelcontextprotocol/server/#jsonrpcmessage)

###### Returns

`void`

###### Implementation of

[`Transport`](./../../../index/@modelcontextprotocol/server/#transport-1).[`onmessage`](./../../../index/@modelcontextprotocol/server/#onmessage-1)

#### Methods

##### \_ondata()

> **\_ondata**(`chunk`): `void`

Defined in: [packages/server/src/server/stdio.ts:45](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/stdio.ts#L45)

###### Parameters

###### chunk

`Buffer`

###### Returns

`void`

##### \_onerror()

> **\_onerror**(`error`): `void`

Defined in: [packages/server/src/server/stdio.ts:54](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/stdio.ts#L54)

###### Parameters

###### error

`Error`

###### Returns

`void`

##### \_onstdouterror()

> **\_onstdouterror**(`error`): `void`

Defined in: [packages/server/src/server/stdio.ts:57](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/stdio.ts#L57)

###### Parameters

###### error

`Error`

###### Returns

`void`

##### close()

> **close**(): `Promise`<`void`\>

Defined in: [packages/server/src/server/stdio.ts:95](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/stdio.ts#L95)

Closes the connection.

###### Returns

`Promise`<`void`\>

###### Implementation of

[`Transport`](./../../../index/@modelcontextprotocol/server/#transport-1).[`close`](./../../../index/@modelcontextprotocol/server/#close-2)

##### send()

> **send**(`message`): `Promise`<`void`\>

Defined in: [packages/server/src/server/stdio.ts:119](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/stdio.ts#L119)

Sends a JSON-RPC message (request or response).

If present, `relatedRequestId` is used to indicate to the transport which incoming request to associate this outgoing message with.

###### Parameters

###### message

[`JSONRPCMessage`](./../../../index/@modelcontextprotocol/server/#jsonrpcmessage)

###### Returns

`Promise`<`void`\>

###### Implementation of

[`Transport`](./../../../index/@modelcontextprotocol/server/#transport-1).[`send`](./../../../index/@modelcontextprotocol/server/#send-1)

##### start()

> **start**(): `Promise`<`void`\>

Defined in: [packages/server/src/server/stdio.ts:67](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/stdio.ts#L67)

Starts listening for messages on `stdin`.

###### Returns

`Promise`<`void`\>

###### Implementation of

[`Transport`](./../../../index/@modelcontextprotocol/server/#transport-1).[`start`](./../../../index/@modelcontextprotocol/server/#start-1)
