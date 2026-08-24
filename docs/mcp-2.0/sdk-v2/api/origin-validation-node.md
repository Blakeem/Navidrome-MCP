Source: https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/node/middleware/originValidation.html
Version: MCP TypeScript SDK V2 API reference (protocol 2026-07-28, beta line); source pinned at GitHub commit `cc4b41617ce3601b1290d67216ea0b194a3cd9ac` (modelcontextprotocol/typescript-sdk)
Retrieved: 2026-08-11

---

[MCP TypeScript SDK (V2)](https://ts.sdk.modelcontextprotocol.io/v2/api/) / [@modelcontextprotocol/node](https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/node/) / middleware/originValidation

# middleware/originValidation

## Functions

### localhostOriginValidation()

> **localhostOriginValidation**(): (`req`, `res`) => `boolean`

Defined in: [packages/middleware/node/src/middleware/originValidation.ts:52](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/middleware/node/src/middleware/originValidation.ts#L52)

Convenience guard for localhost Origin validation. Allows only origins whose hostname is `localhost`, `127.0.0.1`, or `[::1]` (IPv6 localhost).

#### Returns

(`req`, `res`) => `boolean`

---

### originValidation()

> **originValidation**(`allowedOriginHostnames`): (`req`, `res`) => `boolean`

Defined in: [packages/middleware/node/src/middleware/originValidation.ts:27](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/middleware/node/src/middleware/originValidation.ts#L27)

Node.js request guard for Origin header validation. Validates the `Origin` header hostname (port-agnostic) against an allowed list.

Requests without an `Origin` header pass (non-browser MCP clients do not send one); a present value that is not allowed, or that cannot be parsed, is rejected with `403`. The guard returns whether the request may proceed: when it returns `false` it has already answered the request and the caller must not handle it further.

#### Parameters

##### allowedOriginHostnames

`string`[]

List of allowed origin hostnames (without scheme or port). For IPv6, provide the address with brackets (e.g., `[::1]`).

#### Returns

(`req`, `res`) => `boolean`

#### Example

```ts
const validateOrigin = originValidation(['localhost', '127.0.0.1', '[::1]']);
http.createServer((req, res) => {
    if (!validateOrigin(req, res)) return;
    void transport.handleRequest(req, res);
});
```
