<!--
source: https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/server/server/requestStateCodec.html
version: TypeScript SDK v2.0.0-beta.1 (v2 API reference, beta line implementing MCP spec revision 2026-07-28)
retrieved: 2026-08-11
-->

# server/requestStateCodec

## Interfaces

### RequestStateCodec

Defined in: [packages/server/src/server/requestStateCodec.ts:55](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/requestStateCodec.ts#L55)

The codec returned by [`createRequestStateCodec`](#createrequeststatecodec): `mint` seals a JSON-serializable payload into the wire string a handler returns from `inputRequired({ requestState })`; `verify` is the function to drop into [`ServerOptions`](./server.html#serveroptions)`.requestState.verify` (it throws on any failure, which the seam answers as the frozen `-32602`). The decoded payload `verify` resolves with is handed to the handler by the seam via the typed `ctx.mcpReq.requestState<T>()` accessor — `mint<T>` and `requestState<T>()` are the typed encode/read pair.

#### Type Parameters

##### T

`T` = `unknown`

#### Methods

##### mint()

> **mint**(`payload`, `ctx?`): `Promise`<`string`\>

Defined in: [packages/server/src/server/requestStateCodec.ts:64](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/requestStateCodec.ts#L64)

Seal `payload` into an opaque wire string. The result is what the handler returns from `inputRequired({ requestState })`.

###### Parameters

###### payload

`T`

###### ctx?

[`ServerContext`](./../../../index/@modelcontextprotocol/server/#servercontext)

The handler's context. Required when the codec was created with a [`bind`](#bind) callback; ignored otherwise.

###### Returns

`Promise`<`string`\>

##### verify()

> **verify**(`state`, `ctx`): `Promise`<`T`\>

Defined in: [packages/server/src/server/requestStateCodec.ts:75](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/requestStateCodec.ts#L75)

Verify an echoed `requestState` and return the original payload. Throws on any failure (bad MAC, expired, bind mismatch, malformed). The thrown message is a fixed opaque reason code (`'malformed'` / `'mac'` / `'expired'` / `'bind'`) — never the decoded payload, the binding value, or any other context-derived field.

Pass this directly as `ServerOptions.requestState.verify`.

###### Parameters

###### state

`string`

###### ctx

[`ServerContext`](./../../../index/@modelcontextprotocol/server/#servercontext)

###### Returns

`Promise`<`T`\>

* * *

### RequestStateCodecOptions

Defined in: [packages/server/src/server/requestStateCodec.ts:6](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/requestStateCodec.ts#L6)

Options for [`createRequestStateCodec`](#createrequeststatecodec).

#### Properties

##### bind?

> `optional` **bind?**: (`ctx`) => `string`

Defined in: [packages/server/src/server/requestStateCodec.ts:42](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/requestStateCodec.ts#L42)

Optional context binding. Called at mint time and again at verify time; a `requestState` minted under one binding value is rejected when echoed under a different one. Use this to bind state to the authenticated principal and/or the originating method (the spec's user-binding MUST for state that influences authorization), for example:

```ts
bind: ctx => `${ctx.mcpReq.method}\0${ctx.http?.authInfo?.clientId ?? ''}`
```

The returned value is stored in the envelope as a domain-separated HMAC tag (keyed by the codec's `key`), not the raw string — so a principal identifier in the binding does not appear in the wire value the client holds.

When configured, [`RequestStateCodec.mint`](#mint) requires its `ctx` argument.

###### Parameters

###### ctx

[`ServerContext`](./../../../index/@modelcontextprotocol/server/#servercontext)

###### Returns

`string`

##### key

> **key**: `string` | `Uint8Array`<`ArrayBufferLike`\>

Defined in: [packages/server/src/server/requestStateCodec.ts:14](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/requestStateCodec.ts#L14)

The HMAC secret. A `string` value is UTF-8-encoded. MUST be at least 32 bytes (256 bits) long; a `RangeError` is thrown at construction otherwise. The same key must be available to every server instance that may receive an echoed `requestState` (so a per-process random key only works when one process serves every round of a flow).

##### ttlSeconds?

> `optional` **ttlSeconds?**: `number`

Defined in: [packages/server/src/server/requestStateCodec.ts:21](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/requestStateCodec.ts#L21)

How long a minted `requestState` stays valid, in seconds. An echoed value past its expiry is rejected by [`RequestStateCodec.verify`](#verify). Defaults to `600` (ten minutes).

## Functions

### createRequestStateCodec()

> **createRequestStateCodec**<`T`\>(`options`): [`RequestStateCodec`](#requeststatecodec)<`T`\>

Defined in: [packages/server/src/server/requestStateCodec.ts:145](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/requestStateCodec.ts#L145)

Create an opt-in HMAC-SHA256 codec for the multi-round-trip `requestState` (protocol revision 2026-07-28).

`requestState` round-trips through the client and is attacker-controlled input on re-entry. The SDK applies no protection of its own; this helper is the convenience implementation of the spec's integrity MUST so authors don't hand-roll HMAC. Wire shape:

```
"v1." b64url({"p":<payload>,"exp":<unixSeconds>,"b":<bindTag>?}) "." b64url(mac)
```

where `bindTag` is `b64url(HMAC(key, "mcp.requestState.bind:" + bind(ctx))[:16])` — the binding value is never embedded raw.

The codec is **signed, not encrypted**: the body is integrity-protected but the client can base64url-decode it and read the payload (`p`) in clear. Do not put secrets in the payload; use an AEAD construction if confidentiality is required. The handler reads its payload back via the typed `ctx.mcpReq.requestState<T>()` accessor — the seam has already run `verify` (integrity proven, payload decoded) by the time the handler is entered.

Verification is fail-closed and constant-time (WebCrypto `subtle.verify` for the body MAC; a fixed-length XOR-accumulator compare for the bind tag). See `examples/mrtr/server.ts` for a worked end-to-end example.

Design comparison (mcp.d `secureRequestState`, the peer SDK's reference implementation): mcp.d additionally offers an AES-256-GCM encrypted mode and derives independent cipher / bind-HMAC sub-keys from the operator secret via HKDF-SHA256, with an auto-generated per-process ephemeral key when none is supplied. This codec deliberately ships only the signed mode and a single keyed HMAC (domain-separated by input prefix) — HKDF sub-key derivation and an encrypted mode are intentionally out of scope for the initial release.

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### options

[`RequestStateCodecOptions`](#requeststatecodecoptions)

#### Returns

[`RequestStateCodec`](#requeststatecodec)<`T`\>
