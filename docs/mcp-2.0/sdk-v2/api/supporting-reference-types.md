<!--
source: https://ts.sdk.modelcontextprotocol.io/v2/api/index/@modelcontextprotocol/server/ (selected Interfaces/Type Aliases sections only)
version: TypeScript SDK v2.0.0-beta.1 (v2 API reference, beta line implementing MCP spec revision 2026-07-28)
retrieved: 2026-08-11
note: This index page lists every exported symbol of @modelcontextprotocol/server
  (auth, tasks, sampling, prompts, roots, JSON-RPC envelope, error classes, etc.)
  -- almost all OUT OF SCOPE for this capture. Only the types that ServerOptions
  (server-options.md), CreateMcpHandlerOptions/McpRequestContext
  (create-mcp-handler.md), and RequestStateCodec (request-state-codec.md)
  reference directly by name are extracted here, verbatim, each under its own
  heading exactly as it appears on the source page, so those option-object
  types have no dangling references. Sections are in source-page order
  (alphabetical within each of Interfaces / Type Aliases).
-->

# index/@modelcontextprotocol/server (selected Interfaces and Type Aliases)

## Interfaces

### AuthInfo

Defined in: [packages/core-internal/src/types/types.ts:727](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/core-internal/src/types/types.ts#L727)

Information about a validated access token, provided to request handlers.

#### Properties

##### clientId

> **clientId**: `string`

Defined in: [packages/core-internal/src/types/types.ts:736](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/core-internal/src/types/types.ts#L736)

The client ID associated with this token.

##### expiresAt?

> `optional` **expiresAt?**: `number`

Defined in: [packages/core-internal/src/types/types.ts:746](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/core-internal/src/types/types.ts#L746)

When the token expires (in seconds since epoch).

##### extra?

> `optional` **extra?**: `Record`<`string`, `unknown`\>

Defined in: [packages/core-internal/src/types/types.ts:758](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/core-internal/src/types/types.ts#L758)

Additional data associated with the token. This field should be used for any additional data that needs to be attached to the auth info.

##### resource?

> `optional` **resource?**: `URL`

Defined in: [packages/core-internal/src/types/types.ts:752](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/core-internal/src/types/types.ts#L752)

The RFC 8707 resource server identifier for which this token is valid. If set, this MUST match the MCP server's resource identifier (minus hash fragment).

##### scopes

> **scopes**: `string`\[\]

Defined in: [packages/core-internal/src/types/types.ts:741](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/core-internal/src/types/types.ts#L741)

Scopes associated with this token.

##### token

> **token**: `string`

Defined in: [packages/core-internal/src/types/types.ts:731](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/core-internal/src/types/types.ts#L731)

The access token.

* * *

### CacheHint

Defined in: [packages/core-internal/src/shared/resultCacheHints.ts:33](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/core-internal/src/shared/resultCacheHints.ts#L33)

A cache hint for a cacheable result (protocol revision 2026-07-28): the values to emit for `ttlMs` / `cacheScope` when the handler does not provide them itself. Absent fields fall back to the conservative defaults (`ttlMs: 0`, `cacheScope: 'private'`).

#### Properties

##### cacheScope?

> `optional` **cacheScope?**: [`CacheScope`](#cachescope-1)

Defined in: [packages/core-internal/src/shared/resultCacheHints.ts:37](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/core-internal/src/shared/resultCacheHints.ts#L37)

Whether the result may be cached by shared caches (`public`) or only by the requesting client (`private`).

##### ttlMs?

> `optional` **ttlMs?**: `number`

Defined in: [packages/core-internal/src/shared/resultCacheHints.ts:35](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/core-internal/src/shared/resultCacheHints.ts#L35)

Cache lifetime in milliseconds. Must be a non-negative safe integer.

* * *

### jsonSchemaValidator

Defined in: [packages/core-internal/src/validators/types.ts:51](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/core-internal/src/validators/types.ts#L51)

Provider interface for creating validators from JSON Schemas

This is the main extension point for custom validator implementations. Implementations should:

-   Support JSON Schema Draft 2020-12 (or be compatible with it)
-   Return validator functions that can be called multiple times
-   Handle schema compilation/caching internally
-   Provide clear error messages on validation failure

#### Example

```ts
class MyValidatorProvider implements jsonSchemaValidator {
    getValidator<T>(schema: JsonSchemaType): JsonSchemaValidator<T> {
        // Compile/cache validator from schema
        return (input: unknown) =>
            isValid(schema, input)
                ? { valid: true, data: input as T, errorMessage: undefined }
                : { valid: false, data: undefined, errorMessage: 'Error details' };
    }
}
```

#### Methods

##### getValidator()

> **getValidator**<`T`\>(`schema`): [`JsonSchemaValidator`](#jsonschemavalidator-1)<`T`\>

Defined in: [packages/core-internal/src/validators/types.ts:58](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/core-internal/src/validators/types.ts#L58)

Create a validator for the given JSON Schema

###### Type Parameters

###### T

`T`

###### Parameters

###### schema

[`JsonSchemaType`](#jsonschematype)

Standard JSON Schema object

###### Returns

[`JsonSchemaValidator`](#jsonschemavalidator-1)<`T`\>

A validator function that can be called multiple times

* * *

### BaseContext

> **BaseContext** = `object`

Defined in: [packages/core-internal/src/shared/protocol.ts:327](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/core-internal/src/shared/protocol.ts#L327)

Base context provided to all request handlers.

#### Properties

##### http?

> `optional` **http?**: `object`

Defined in: [packages/core-internal/src/shared/protocol.ts:440](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/core-internal/src/shared/protocol.ts#L440)

HTTP transport information, only available when using an HTTP-based transport.

###### authInfo?

> `optional` **authInfo?**: [`AuthInfo`](#authinfo)

Information about a validated access token, provided to request handlers.

##### mcpReq

> **mcpReq**: `object`

Defined in: [packages/core-internal/src/shared/protocol.ts:336](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/core-internal/src/shared/protocol.ts#L336)

Information about the MCP request being handled.

###### \_meta?

> `optional` **\_meta?**: [`RequestMeta`](#requestmeta)

Metadata from the original request, with the reserved `io.modelcontextprotocol/*` envelope keys already lifted out (readable via `ctx.mcpReq.envelope`).

###### droppedInputResponseKeys?

> `optional` **droppedInputResponseKeys?**: `string`\[\]

Keys of `inputResponses` entries the SDK dropped because they were not bare response objects (for example the wrapped `{method, result}` shape some peers emit). Surfaced so a handler can re-issue the corresponding input request rather than hard-fail.

###### envelope?

> `optional` **envelope?**: `Partial`<[`RequestMetaEnvelope`](#requestmetaenvelope)\>

The per-request `_meta` envelope (protocol revision 2026-07-28): the reserved `io.modelcontextprotocol/*` keys carried by the request, lifted out of the `_meta` the handler sees. Surfaced as received — `Partial` because only the keys the request actually carried are present (envelope requiredness is enforced per request at dispatch time, not by the lift); only present at all when the request carried envelope keys.

###### id

> **id**: [`RequestId`](#requestid)

The JSON-RPC ID of the request being handled.

###### inputResponses?

> `optional` **inputResponses?**: `Record`<`string`, `unknown`\>

Multi-round-trip input responses carried by a retried request (protocol revision 2026-07-28), lifted out of the params the handler sees. Entries are the BARE response objects keyed by the identifiers the server assigned in `inputRequests`; entries that do not look like bare responses (e.g. a `{method, result}` wrapper) are dropped and their keys recorded in `droppedInputResponseKeys`.

The values arrive from the client and are NOT validated by the SDK — treat them as untrusted input.

###### method

> **method**: `string`

The method name of the request (e.g., 'tools/call', 'ping').

###### notify

> **notify**: (`notification`) => `Promise`<`void`\>

Sends a notification that relates to the current request being handled.

This is used by certain transports to correctly associate related messages.

###### Parameters

###### notification

[`Notification`](#notification-1)

###### Returns

`Promise`<`void`\>

###### requestState

> **requestState**: [`RequestStateAccessor`](#requeststateaccessor)

Reads the multi-round-trip request state for the current round: the value the configured `ServerOptions.requestState.verify` hook resolved with (e.g. `createRequestStateCodec.verify`'s decoded payload — `mint<T>`/`requestState<T>()` are the typed pair), the raw wire string when no hook is configured, or `undefined` when the round carried no state. The type parameter is a compile-time cast only.

SECURITY: `requestState` round-trips through the client and MUST be treated as attacker-controlled input. The SDK applies no integrity protection by default — servers whose state influences authorization or business logic MUST integrity-protect it and verify via the `requestState.verify` hook (spec: basic/patterns/mrtr, server requirements 4–5).

###### send

> **send**: {<`M`\>(`request`, `options?`): `Promise`<[`ResultTypeMap`](#resulttypemap)\[`M`\]>; <`T`\>(`request`, `resultSchema`, `options?`): `Promise`<[`InferOutput`](./namespaces/StandardSchemaV1.html#inferoutput)<`T`\>>; }

Sends a request that relates to the current request being handled.

This is used by certain transports to correctly associate related messages.

For spec methods the result type is inferred from the method name. For custom (non-spec) methods, pass a result schema as the second argument.

###### Call Signature

> <`M`\>(`request`, `options?`): `Promise`<[`ResultTypeMap`](#resulttypemap)\[`M`\]>

###### Type Parameters

###### M

`M` _extends_ [`RequestMethod`](#requestmethod)

###### Parameters

###### request

###### method

`M`

###### params?

`Record`<`string`, `unknown`\>

###### options?

[`RequestOptions`](#requestoptions)

###### Returns

`Promise`<[`ResultTypeMap`](#resulttypemap)\[`M`\]>

###### Call Signature

> <`T`\>(`request`, `resultSchema`, `options?`): `Promise`<[`InferOutput`](./namespaces/StandardSchemaV1.html#inferoutput)<`T`\>>

###### Type Parameters

###### T

`T` _extends_ [`StandardSchemaV1`](#standardschemav1)<`unknown`, `unknown`\>

###### Parameters

###### request

###### method

`string` = `...`

###### params?

{\[`key`: `string`\]: `unknown`; `_meta?`: {\[`key`: `string`\]: `unknown`; `io.modelcontextprotocol/related-task?`: { `taskId`: `string`; }; `progressToken?`: `string` | `number`; }; } = `...`

###### params.\_meta?

{\[`key`: `string`\]: `unknown`; `io.modelcontextprotocol/related-task?`: { `taskId`: `string`; }; `progressToken?`: `string` | `number`; } = `...`

See [General fields: `_meta`](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#meta) for notes on `_meta` usage.

###### params.\_meta.io.modelcontextprotocol/related-task?

{ `taskId`: `string`; } = `...`

If specified, this request is related to the provided task.

###### params.\_meta.io.modelcontextprotocol/related-task.taskId

`string` = `...`

###### params.\_meta.progressToken?

`string` | `number` = `...`

If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.

###### resultSchema

`T`

###### options?

[`RequestOptions`](#requestoptions)

###### Returns

`Promise`<[`InferOutput`](./namespaces/StandardSchemaV1.html#inferoutput)<`T`\>>

###### signal

> **signal**: `AbortSignal`

An abort signal used to communicate if the request was cancelled from the sender's side.

##### sessionId?

> `optional` **sessionId?**: `string`

Defined in: [packages/core-internal/src/shared/protocol.ts:331](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/core-internal/src/shared/protocol.ts#L331)

The session ID from the transport, if available.

* * *

### ServerContext

> **ServerContext** = [`BaseContext`](#basecontext) & `object`

Defined in: [packages/core-internal/src/shared/protocol.ts:451](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/core-internal/src/shared/protocol.ts#L451)

Context provided to server-side request handlers, extending [`BaseContext`](#basecontext) with server-specific fields.

#### Type Declaration

##### http?

> `optional` **http?**: `object`

###### http.closeSSE?

> `optional` **closeSSE?**: () => `void`

Closes the SSE stream for this request, triggering client reconnection. Only available when using a StreamableHTTPServerTransport with eventStore configured.

###### Returns

`void`

###### http.closeStandaloneSSE?

> `optional` **closeStandaloneSSE?**: () => `void`

Closes the standalone GET SSE stream, triggering client reconnection. Only available when using a StreamableHTTPServerTransport with eventStore configured.

###### Returns

`void`

###### http.req?

> `optional` **req?**: `globalThis.Request`

The original HTTP request.

##### mcpReq

> **mcpReq**: `object`

###### mcpReq.elicitInput

> **elicitInput**: (`params`, `options?`) => `Promise`<[`ElicitResult`](#elicitresult)\>

Send an elicitation request to the client, requesting user input.

###### Parameters

###### params

[`ElicitRequestFormParams`](#elicitrequestformparams) | [`ElicitRequestURLParams`](#elicitrequesturlparams)

###### options?

[`RequestOptions`](#requestoptions)

###### Returns

`Promise`<[`ElicitResult`](#elicitresult)\>

###### Deprecated

Throws on a 2026-07-28-era request — return `inputRequired(...)` (multi-round-trip) from the handler instead. The 2025 push-style server-to-client request model is replaced by input\_required results in the 2026-07-28 protocol. If your factory serves both eras, this only works on the legacy path.

###### mcpReq.log

> **log**: (`level`, `data`, `logger?`) => `Promise`<`void`\>

Send a log message notification to the client. Respects the client's log level filter set via logging/setLevel.

###### Parameters

###### level

[`LoggingLevel`](#logginglevel)

###### data

`unknown`

###### logger?

`string`

###### Returns

`Promise`<`void`\>

###### Deprecated

Deprecated as of protocol version 2026-07-28 (SEP-2577). Remains functional during the deprecation window (at least twelve months). Migrate to stderr logging (STDIO servers) or OpenTelemetry.

###### mcpReq.requestSampling

> **requestSampling**: (`params`, `options?`) => `Promise`<[`CreateMessageResult`](#createmessageresult) | [`CreateMessageResultWithTools`](#createmessageresultwithtools)\>

Request LLM sampling from the client.

###### Parameters

###### params

[`CreateMessageRequest`](#createmessagerequest)\[`"params"`\]

###### options?

[`RequestOptions`](#requestoptions)

###### Returns

`Promise`<[`CreateMessageResult`](#createmessageresult) | [`CreateMessageResultWithTools`](#createmessageresultwithtools)\>

###### Deprecated

Deprecated as of protocol version 2026-07-28 (SEP-2577). Throws on a 2026-07-28-era request — return `inputRequired(...)` (multi-round-trip) from the handler instead, or migrate to calling LLM provider APIs directly. The 2025 push-style server-to-client request model is replaced by input\_required results in the 2026-07-28 protocol. If your factory serves both eras, this only works on the legacy path.

## Type Aliases

### CacheScope

> **CacheScope** = `"public"` | `"private"`

Defined in: [packages/core-internal/src/shared/resultCacheHints.ts:25](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/core-internal/src/shared/resultCacheHints.ts#L25)

The cache scopes defined for cacheable results (SEP-2549).

* * *

### JsonSchemaType

> **JsonSchemaType** = `JSONSchema.Interface`

Defined in: [packages/core-internal/src/validators/types.ts:14](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/core-internal/src/validators/types.ts#L14)

JSON Schema type definition (JSON Schema Draft 2020-12)

This uses the object form of JSON Schema (excluding boolean schemas). While `true` and `false` are valid JSON Schemas, this SDK uses the object form for practical type safety.

Re-exported from json-schema-typed for convenience.

#### See

[https://json-schema.org/draft/2020-12/json-schema-core.html](https://json-schema.org/draft/2020-12/json-schema-core.html)

* * *

### JsonSchemaValidator

> **JsonSchemaValidator**<`T`\> = (`input`) => [`JsonSchemaValidatorResult`](#jsonschemavalidatorresult)<`T`\>

Defined in: [packages/core-internal/src/validators/types.ts:26](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/core-internal/src/validators/types.ts#L26)

A validator function that validates data against a JSON Schema

#### Type Parameters

##### T

`T`

#### Parameters

##### input

`unknown`

#### Returns

[`JsonSchemaValidatorResult`](#jsonschemavalidatorresult)<`T`\>

* * *

### JsonSchemaValidatorResult

> **JsonSchemaValidatorResult**<`T`\> = { `data`: `T`; `errorMessage`: `undefined`; `valid`: `true`; } | { `data`: `undefined`; `errorMessage`: `string`; `valid`: `false`; }

Defined in: [packages/core-internal/src/validators/types.ts:19](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/core-internal/src/validators/types.ts#L19)

Result of a JSON Schema validation operation

#### Type Parameters

##### T

`T`

* * *

### ProtocolOptions

> **ProtocolOptions** = `object`

Defined in: [packages/core-internal/src/shared/protocol.ts:65](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/core-internal/src/shared/protocol.ts#L65)

Additional initialization options.

#### Properties

##### debouncedNotificationMethods?

> `optional` **debouncedNotificationMethods?**: `string`\[\]

Defined in: [packages/core-internal/src/shared/protocol.ts:90](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/core-internal/src/shared/protocol.ts#L90)

An array of notification method names that should be automatically debounced. Any notifications with a method in this list will be coalesced if they occur in the same tick of the event loop. e.g., `['notifications/tools/list_changed']`

##### enforceStrictCapabilities?

> `optional` **enforceStrictCapabilities?**: `boolean`

Defined in: [packages/core-internal/src/shared/protocol.ts:83](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/core-internal/src/shared/protocol.ts#L83)

Whether to restrict emitted requests to only those that the remote side has indicated that they can handle, through their advertised capabilities.

Note that this DOES NOT affect checking of _local_ side capabilities, as it is considered a logic error to mis-specify those.

Currently this defaults to `false`, for backwards compatibility with SDK versions that did not advertise capabilities correctly. In future, this will default to `true`.

##### supportedProtocolVersions?

> `optional` **supportedProtocolVersions?**: `string`\[\]

Defined in: [packages/core-internal/src/shared/protocol.ts:74](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/core-internal/src/shared/protocol.ts#L74)

Protocol versions supported. The legacy `initialize` handshake offers and falls back to the first 2025-era entry in the list (the client sends it, the server counter-offers it); 2026-era entries are only ever selected via `server/discover`. Passed to transport during [`connect()`](#connect).

###### Default

[`SUPPORTED_PROTOCOL_VERSIONS`](#supported-protocol-versions)

* * *

### RequestStateAccessor

> **RequestStateAccessor** = <`T`\>() => `T` | `undefined`

Defined in: [packages/core-internal/src/shared/protocol.ts:293](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/core-internal/src/shared/protocol.ts#L293)

The type of `ctx.mcpReq.requestState`. The type parameter is caller-asserted (no validation, like the two-argument `acceptedContent<T>`) — pair with `createRequestStateCodec<T>` so the claim is backed by the codec's verification.

#### Type Parameters

##### T

`T` = `unknown`

#### Returns

`T` | `undefined`
