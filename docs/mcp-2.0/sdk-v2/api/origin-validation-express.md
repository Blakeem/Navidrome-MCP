Source: https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/express/middleware/originValidation.html
Version: MCP TypeScript SDK V2 API reference (protocol 2026-07-28, beta line); source pinned at GitHub commit `cc4b41617ce3601b1290d67216ea0b194a3cd9ac` (modelcontextprotocol/typescript-sdk)
Retrieved: 2026-08-11

---

[MCP TypeScript SDK (V2)](https://ts.sdk.modelcontextprotocol.io/v2/api/) / [@modelcontextprotocol/express](https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/express/) / middleware/originValidation

# middleware/originValidation

## Functions

### localhostOriginValidation()

> **localhostOriginValidation**(): `RequestHandler`

Defined in: [middleware/express/src/middleware/originValidation.ts:50](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/middleware/express/src/middleware/originValidation.ts#L50)

Convenience middleware for localhost Origin validation. Allows only origins whose hostname is `localhost`, `127.0.0.1`, or `[::1]` (IPv6 localhost).

#### Returns

`RequestHandler`

#### Example

```ts
app.use(localhostOriginValidation());
```

---

### originValidation()

> **originValidation**(`allowedOriginHostnames`): `RequestHandler`

Defined in: [middleware/express/src/middleware/originValidation.ts:23](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/middleware/express/src/middleware/originValidation.ts#L23)

Express middleware for Origin header validation. Validates the `Origin` header hostname (port-agnostic) against an allowed list.

Browsers attach an `Origin` header to cross-origin requests; validating it — alongside Host header validation — protects localhost and development servers against DNS rebinding and cross-site request forgery. Requests without an `Origin` header pass (non-browser MCP clients do not send one); a present value that is not allowed, or that cannot be parsed, is rejected with `403`.

#### Parameters

##### allowedOriginHostnames

`string`[]

List of allowed origin hostnames (without scheme or port). For IPv6, provide the address with brackets (e.g., `[::1]`).

#### Returns

`RequestHandler`

Express middleware function

#### Example

```ts
app.use(originValidation(['localhost', '127.0.0.1', '[::1]']));
```
