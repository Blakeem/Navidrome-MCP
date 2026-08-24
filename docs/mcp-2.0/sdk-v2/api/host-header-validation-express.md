Source: https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/express/middleware/hostHeaderValidation.html
Version: MCP TypeScript SDK V2 API reference (protocol 2026-07-28, beta line); source pinned at GitHub commit `cc4b41617ce3601b1290d67216ea0b194a3cd9ac` (modelcontextprotocol/typescript-sdk)
Retrieved: 2026-08-11

---

[MCP TypeScript SDK (V2)](https://ts.sdk.modelcontextprotocol.io/v2/api/) / [@modelcontextprotocol/express](https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/express/) / middleware/hostHeaderValidation

# middleware/hostHeaderValidation

## Functions

### hostHeaderValidation()

> **hostHeaderValidation**(`allowedHostnames`): `RequestHandler`

Defined in: [middleware/express/src/middleware/hostHeaderValidation.ts:23](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/middleware/express/src/middleware/hostHeaderValidation.ts#L23)

Express middleware for DNS rebinding protection. Validates `Host` header hostname (port-agnostic) against an allowed list.

This is particularly important for servers without authorization or HTTPS, such as localhost servers or development servers. DNS rebinding attacks can bypass same-origin policy by manipulating DNS to point a domain to a localhost address, allowing malicious websites to access your local server.

#### Parameters

##### allowedHostnames

`string`[]

List of allowed hostnames (without ports). For IPv6, provide the address with brackets (e.g., `[::1]`).

#### Returns

`RequestHandler`

Express middleware function

#### Example

```ts
const middleware = hostHeaderValidation(['localhost', '127.0.0.1', '[::1]']);
app.use(middleware);
```

---

### localhostHostValidation()

> **localhostHostValidation**(): `RequestHandler`

Defined in: [middleware/express/src/middleware/hostHeaderValidation.ts:50](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/middleware/express/src/middleware/hostHeaderValidation.ts#L50)

Convenience middleware for localhost DNS rebinding protection. Allows only `localhost`, `127.0.0.1`, and `[::1]` (IPv6 localhost) hostnames.

#### Returns

`RequestHandler`

#### Example

```ts
app.use(localhostHostValidation());
```
