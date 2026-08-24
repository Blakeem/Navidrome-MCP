Source: https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/server/server/middleware/originValidation.html
Version: MCP TypeScript SDK V2 API reference (protocol 2026-07-28, beta line); source pinned at GitHub commit `cc4b41617ce3601b1290d67216ea0b194a3cd9ac` (modelcontextprotocol/typescript-sdk)
Retrieved: 2026-08-11

---

[MCP TypeScript SDK (V2)](https://ts.sdk.modelcontextprotocol.io/v2/api/) / [@modelcontextprotocol/server](https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/server/) / server/middleware/originValidation

# server/middleware/originValidation

## Type Aliases

### OriginValidationResult

> **OriginValidationResult** = { `hostname?`: `string`; `ok`: `true`; `origin?`: `string`; } | { `errorCode`: `"invalid_origin_header"` | `"invalid_origin"`; `hostname?`: `string`; `message`: `string`; `ok`: `false`; `originHeader?`: `string`; }

Defined in: [packages/server/src/server/middleware/originValidation.ts:18](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/middleware/originValidation.ts#L18)

Framework-agnostic Origin header validation helpers.

Browsers attach an `Origin` header to cross-origin requests; validating it against an allowlist (alongside Host header validation) protects local and development MCP servers against DNS rebinding and cross-site request forgery. The framework middleware packages (`@modelcontextprotocol/express`, `@modelcontextprotocol/hono`, `@modelcontextprotocol/fastify`, `@modelcontextprotocol/node`) wrap these helpers; use them directly when mounting a handler bare on a fetch-native runtime.

Validation is deny-on-failure: a present `Origin` value that cannot be parsed (including the opaque `null` origin) is rejected, never passed through. Requests without an `Origin` header pass — non-browser MCP clients do not send one.

## Functions

### localhostAllowedOrigins()

> **localhostAllowedOrigins**(): `string`[]

Defined in: [packages/server/src/server/middleware/originValidation.ts:66](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/middleware/originValidation.ts#L66)

Convenience allowlist of localhost-class origin hostnames, mirroring `localhostAllowedHostnames`.

#### Returns

`string`[]

---

### originValidationResponse()

> **originValidationResponse**(`req`, `allowedOriginHostnames`): `Response` | `undefined`

Defined in: [packages/server/src/server/middleware/originValidation.ts:80](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/middleware/originValidation.ts#L80)

Web-standard `Request` helper for Origin validation: returns a `403` JSON-RPC error response when the request's `Origin` header is not allowed, and `undefined` when the request may proceed.

```ts
const rejected = originValidationResponse(request, localhostAllowedOrigins());
if (rejected) return rejected;
```

#### Parameters

##### req

`Request`

##### allowedOriginHostnames

`string`[]

#### Returns

`Response` | `undefined`

---

### validateOriginHeader()

> **validateOriginHeader**(`originHeader`, `allowedOriginHostnames`): [`OriginValidationResult`](#originvalidationresult)

Defined in: [packages/server/src/server/middleware/originValidation.ts:38](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/middleware/originValidation.ts#L38)

Validate an `Origin` header against an allowlist of hostnames (port-agnostic).

- A missing/empty `Origin` header passes: non-browser clients do not send one, and only browser-originated requests carry the header this check defends against.
- Allowlist items are hostnames only (no scheme, no port), the same convention as `validateHostHeader`. For IPv6, include brackets (e.g. `[::1]`).
- Any present value that cannot be parsed as an origin URL — including the literal `null` origin browsers send for opaque contexts — is rejected (deny on failure).

#### Parameters

##### originHeader

`string` | `null` | `undefined`

##### allowedOriginHostnames

`string`[]

#### Returns

[`OriginValidationResult`](#originvalidationresult)
