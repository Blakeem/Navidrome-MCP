Source: https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/server/server/middleware/hostHeaderValidation.html
Version: MCP TypeScript SDK V2 API reference (protocol 2026-07-28, beta line); source pinned at GitHub commit `cc4b41617ce3601b1290d67216ea0b194a3cd9ac` (modelcontextprotocol/typescript-sdk)
Retrieved: 2026-08-11

---

[MCP TypeScript SDK (V2)](https://ts.sdk.modelcontextprotocol.io/v2/api/) / [@modelcontextprotocol/server](https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/server/) / server/middleware/hostHeaderValidation

# server/middleware/hostHeaderValidation

## Type Aliases

### HostHeaderValidationResult

> **HostHeaderValidationResult** = { `hostname`: `string`; `ok`: `true`; } | { `errorCode`: `"missing_host"` | `"invalid_host_header"` | `"invalid_host"`; `hostHeader?`: `string`; `hostname?`: `string`; `message`: `string`; `ok`: `false`; }

Defined in: [packages/server/src/server/middleware/hostHeaderValidation.ts:1](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/middleware/hostHeaderValidation.ts#L1)

## Functions

### hostHeaderValidationResponse()

> **hostHeaderValidationResponse**(`req`, `allowedHostnames`): `Response` | `undefined`

Defined in: [packages/server/src/server/middleware/hostHeaderValidation.ts:51](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/middleware/hostHeaderValidation.ts#L51)

Web-standard `Request` helper for DNS rebinding protection.

#### Parameters

##### req

`Request`

##### allowedHostnames

`string`[]

#### Returns

`Response` | `undefined`

#### Example

```ts
const result = validateHostHeader(req.headers.get('host'), ['localhost']);
```

---

### localhostAllowedHostnames()

> **localhostAllowedHostnames**(): `string`[]

Defined in: [packages/server/src/server/middleware/hostHeaderValidation.ts:40](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/middleware/hostHeaderValidation.ts#L40)

Convenience allowlist for `localhost` DNS rebinding protection.

#### Returns

`string`[]

---

### validateHostHeader()

> **validateHostHeader**(`hostHeader`, `allowedHostnames`): [`HostHeaderValidationResult`](#hostheadervalidationresult)

Defined in: [packages/server/src/server/middleware/hostHeaderValidation.ts:17](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/middleware/hostHeaderValidation.ts#L17)

Parse and validate a `Host` header against an allowlist of hostnames (port-agnostic).

- Input host header may include a port (e.g. `localhost:3000`) or IPv6 brackets (e.g. `[::1]:3000`).
- Allowlist items should be hostnames only (no ports). For IPv6, include brackets (e.g. `[::1]`).

#### Parameters

##### hostHeader

`string` | `null` | `undefined`

##### allowedHostnames

`string`[]

#### Returns

[`HostHeaderValidationResult`](#hostheadervalidationresult)
