<!--
source: https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/server/server/perRequestTransport.html (Type Aliases > PerRequestResponseMode only)
version: TypeScript SDK v2.0.0-beta.1 (v2 API reference, beta line implementing MCP spec revision 2026-07-28)
retrieved: 2026-08-11
note: This page also documents the PerRequestHTTPServerTransport class and its
  Options/MessageExtra interfaces -- an advanced/power-user building block for
  hand-wired transport-neutral routing (mentioned only in passing in
  create-mcp-handler.md's createMcpHandler() prose). That class is OUT OF
  SCOPE here; only PerRequestResponseMode is captured, because
  CreateMcpHandlerOptions.responseMode (create-mcp-handler.md) is typed
  directly against it.
-->

# server/perRequestTransport (PerRequestResponseMode only)

## Type Aliases

### PerRequestResponseMode

> **PerRequestResponseMode** = `"auto"` | `"sse"` | `"json"`

Defined in: [packages/server/src/server/perRequestTransport.ts:76](https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/server/src/server/perRequestTransport.ts#L76)

How the transport shapes its HTTP response for a request:

-   `auto` (default): answer with a single JSON body unless the handler emits a related message before its result, in which case the response upgrades to an SSE stream.
-   `sse`: always answer handler output over an SSE stream. The stream opens once the request has passed the pre-dispatch validation gates, so ladder rejections keep their mapped HTTP status instead of being framed onto a 200 stream.
-   `json`: never stream; related messages other than the terminal response are dropped.
