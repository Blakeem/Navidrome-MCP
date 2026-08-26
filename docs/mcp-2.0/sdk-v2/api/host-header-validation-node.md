Source: https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/node/middleware/hostHeaderValidation.html
Version: MCP TypeScript SDK V2 API reference (protocol 2026-07-28, beta line); source pinned at GitHub commit `cc4b41617ce3601b1290d67216ea0b194a3cd9ac` (modelcontextprotocol/typescript-sdk)
Retrieved: 2026-08-11

---

[MCP TypeScript SDK (V2)](https://ts.sdk.modelcontextprotocol.io/v2/api/) / [@modelcontextprotocol/node](https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/node/) / middleware/hostHeaderValidation

# middleware/hostHeaderValidation

## Functions

### hostHeaderValidation()

> **hostHeaderValidation**(`allowedHostnames`): (`req`, `res`) => `boolean`

Defined in: [packages/middleware/node/src/middleware/hostHeaderValidation.ts:26](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/middleware/node/src/middleware/hostHeaderValidation.ts#L26)

Node.js request guard for DNS rebinding protection. Validates the `Host` header hostname (port-agnostic) against an allowed list.

Unlike the framework adapters, plain `node:http` has no middleware chain, so the guard returns whether the request may proceed: when it returns `false` it has already answered the request with a `403` JSON-RPC error and the caller must not handle it further.

#### Parameters

##### allowedHostnames

`string`[]

List of allowed hostnames (without ports). For IPv6, provide the address with brackets (e.g., `[::1]`).

#### Returns

(`req`, `res`) => `boolean`

#### Example

```ts
const validateHost = hostHeaderValidation(['localhost', '127.0.0.1', '[::1]']);
http.createServer((req, res) => {
    if (!validateHost(req, res)) return;
    void transport.handleRequest(req, res);
});
```

---

### localhostHostValidation()

> **localhostHostValidation**(): (`req`, `res`) => `boolean`

Defined in: [packages/middleware/node/src/middleware/hostHeaderValidation.ts:51](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/middleware/node/src/middleware/hostHeaderValidation.ts#L51)

Convenience guard for localhost DNS rebinding protection. Allows only `localhost`, `127.0.0.1`, and `[::1]` (IPv6 localhost) hostnames.

#### Returns

(`req`, `res`) => `boolean`
