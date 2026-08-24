> Source: https://github.com/modelcontextprotocol/specification/blob/main/schema/2026-07-28/schema.ts
> (raw: https://raw.githubusercontent.com/modelcontextprotocol/specification/main/schema/2026-07-28/schema.ts)
> Spec revision: 2026-07-28
> Retrieved: 2026-08-11
>
> This is the canonical TypeScript schema — the specification's own source of
> truth for all protocol messages and structures (see
> https://modelcontextprotocol.io/specification/2026-07-28/basic/index#schema).
> Captured from the schema.ts source directly rather than the typedoc-rendered
> HTML at https://modelcontextprotocol.io/specification/2026-07-28/schema.md,
> which is generated from this same file, for a cleaner verbatim capture.
>
> PART 4 of the schema capture: Prompts and tools. Verbatim slice of schema.ts, source lines 1574-2033
> (as numbered inside the captured code block of the original single-file capture).

---

# Schema Reference (schema.ts, 2026-07-28) — Prompts and tools

```typescript
/* Prompts */
/**
 * Sent from the client to request a list of prompts and prompt templates the server has.
 *
 * @example List prompts request
 * {@includeCode ./examples/ListPromptsRequest/list-prompts-request.json}
 *
 * @category `prompts/list`
 */
export interface ListPromptsRequest extends PaginatedRequest {
  method: "prompts/list";
}

/**
 * The result returned by the server for a {@link ListPromptsRequest | prompts/list} request.
 *
 * @example Prompts list with cursor and TTL
 * {@includeCode ./examples/ListPromptsResult/prompts-list-with-cursor-and-ttl.json}
 *
 * @category `prompts/list`
 */
export interface ListPromptsResult extends PaginatedResult, CacheableResult {
  prompts: Prompt[];
}

/**
 * A successful response from the server for a {@link ListPromptsRequest | prompts/list} request.
 *
 * @example List prompts result response
 * {@includeCode ./examples/ListPromptsResultResponse/list-prompts-result-response.json}
 *
 * @category `prompts/list`
 */
export interface ListPromptsResultResponse extends JSONRPCResultResponse {
  result: ListPromptsResult;
}

/**
 * Parameters for a `prompts/get` request.
 *
 * @example Get code review prompt
 * {@includeCode ./examples/GetPromptRequestParams/get-code-review-prompt.json}
 *
 * @category `prompts/get`
 */
export interface GetPromptRequestParams extends InputResponseRequestParams {
  /**
   * The name of the prompt or prompt template.
   */
  name: string;
  /**
   * Arguments to use for templating the prompt.
   */
  arguments?: { [key: string]: string };
}

/**
 * Used by the client to get a prompt provided by the server.
 *
 * @example Get prompt request
 * {@includeCode ./examples/GetPromptRequest/get-prompt-request.json}
 *
 * @category `prompts/get`
 */
export interface GetPromptRequest extends JSONRPCRequest {
  method: "prompts/get";
  params: GetPromptRequestParams;
}

/**
 * The result returned by the server for a {@link GetPromptRequest | prompts/get} request.
 *
 * @example Code review prompt
 * {@includeCode ./examples/GetPromptResult/code-review-prompt.json}
 *
 * @category `prompts/get`
 */
export interface GetPromptResult extends Result {
  /**
   * An optional description for the prompt.
   */
  description?: string;
  messages: PromptMessage[];
}

/**
 * A successful response from the server for a {@link GetPromptRequest | prompts/get} request.
 *
 * @example Get prompt result response
 * {@includeCode ./examples/GetPromptResultResponse/get-prompt-result-response.json}
 *
 * @category `prompts/get`
 */
export interface GetPromptResultResponse extends JSONRPCResultResponse {
  result: GetPromptResult | InputRequiredResult;
}

/**
 * A prompt or prompt template that the server offers.
 *
 * @category `prompts/list`
 */
export interface Prompt extends BaseMetadata, Icons {
  /**
   * An optional description of what this prompt provides
   */
  description?: string;

  /**
   * A list of arguments to use for templating the prompt.
   */
  arguments?: PromptArgument[];

  _meta?: MetaObject;
}

/**
 * Describes an argument that a prompt can accept.
 *
 * @category `prompts/list`
 */
export interface PromptArgument extends BaseMetadata {
  /**
   * A human-readable description of the argument.
   */
  description?: string;
  /**
   * Whether this argument must be provided.
   */
  required?: boolean;
}

/**
 * The sender or recipient of messages and data in a conversation.
 *
 * @category Common Types
 */
export type Role = "user" | "assistant";

/**
 * Describes a message returned as part of a prompt.
 *
 * This is similar to {@link SamplingMessage}, but also supports the embedding of
 * resources from the MCP server.
 *
 * @category `prompts/get`
 */
export interface PromptMessage {
  role: Role;
  content: ContentBlock;
}

/**
 * A resource that the server is capable of reading, included in a prompt or tool call result.
 *
 * Note: resource links returned by tools are not guaranteed to appear in the results of {@link ListResourcesRequest | resources/list} requests.
 *
 * @example File resource link
 * {@includeCode ./examples/ResourceLink/file-resource-link.json}
 *
 * @category Content
 */
export interface ResourceLink extends Resource {
  type: "resource_link";
}

/**
 * The contents of a resource, embedded into a prompt or tool call result.
 *
 * It is up to the client how best to render embedded resources for the benefit
 * of the LLM and/or the user.
 *
 * @example Embedded file resource with annotations
 * {@includeCode ./examples/EmbeddedResource/embedded-file-resource-with-annotations.json}
 *
 * @category Content
 */
export interface EmbeddedResource {
  type: "resource";
  resource: TextResourceContents | BlobResourceContents;

  /**
   * Optional annotations for the client.
   */
  annotations?: Annotations;

  _meta?: MetaObject;
}
/**
 * An optional notification from the server to the client, informing it that the list of prompts it offers has changed. This is only delivered on a {@link SubscriptionsListenRequest | subscriptions/listen} stream when the client requested it via the `promptsListChanged` filter field.
 *
 * @example Prompts list changed
 * {@includeCode ./examples/PromptListChangedNotification/prompts-list-changed.json}
 *
 * @category `notifications/prompts/list_changed`
 */
export interface PromptListChangedNotification extends JSONRPCNotification {
  method: "notifications/prompts/list_changed";
  params?: NotificationParams;
}

/* Tools */
/**
 * Sent from the client to request a list of tools the server has.
 *
 * @example List tools request
 * {@includeCode ./examples/ListToolsRequest/list-tools-request.json}
 *
 * @category `tools/list`
 */
export interface ListToolsRequest extends PaginatedRequest {
  method: "tools/list";
}

/**
 * The result returned by the server for a {@link ListToolsRequest | tools/list} request.
 *
 * @example Tools list with cursor and TTL
 * {@includeCode ./examples/ListToolsResult/tools-list-with-cursor-and-ttl.json}
 *
 * @category `tools/list`
 */
export interface ListToolsResult extends PaginatedResult, CacheableResult {
  tools: Tool[];
}

/**
 * A successful response from the server for a {@link ListToolsRequest | tools/list} request.
 *
 * @example List tools result response
 * {@includeCode ./examples/ListToolsResultResponse/list-tools-result-response.json}
 *
 * @category `tools/list`
 */
export interface ListToolsResultResponse extends JSONRPCResultResponse {
  result: ListToolsResult;
}

/**
 * The result returned by the server for a {@link CallToolRequest | tools/call} request.
 *
 * @example Result with unstructured text
 * {@includeCode ./examples/CallToolResult/result-with-unstructured-text.json}
 *
 * @example Result with structured content
 * {@includeCode ./examples/CallToolResult/result-with-structured-content.json}
 *
 * @example Invalid tool input error
 * {@includeCode ./examples/CallToolResult/invalid-tool-input-error.json}
 *
 * @category `tools/call`
 */
export interface CallToolResult extends Result {
  /**
   * A list of content objects that represent the unstructured result of the tool call.
   */
  content: ContentBlock[];

  /**
   * An optional JSON value that represents the structured result of the tool call.
   *
   * This can be any JSON value (object, array, string, number, boolean, or null)
   * that conforms to the tool's outputSchema if one is defined.
   */
  structuredContent?: unknown;

  /**
   * Whether the tool call ended in an error.
   *
   * If not set, this is assumed to be false (the call was successful).
   *
   * Any errors that originate from the tool SHOULD be reported inside the result
   * object, with `isError` set to true, _not_ as an MCP protocol-level error
   * response. Otherwise, the LLM would not be able to see that an error occurred
   * and self-correct.
   *
   * However, any errors in _finding_ the tool, an error indicating that the
   * server does not support tool calls, or any other exceptional conditions,
   * should be reported as an MCP error response.
   */
  isError?: boolean;
}

/**
 * A successful response from the server for a {@link CallToolRequest | tools/call} request.
 *
 * @example Call tool result response
 * {@includeCode ./examples/CallToolResultResponse/call-tool-result-response.json}
 *
 * @category `tools/call`
 */
export interface CallToolResultResponse extends JSONRPCResultResponse {
  result: CallToolResult | InputRequiredResult;
}

/**
 * Parameters for a `tools/call` request.
 *
 * @example `get_weather` tool call params
 * {@includeCode ./examples/CallToolRequestParams/get-weather-tool-call-params.json}
 *
 * @example Tool call params with progress token
 * {@includeCode ./examples/CallToolRequestParams/tool-call-params-with-progress-token.json}
 *
 * @category `tools/call`
 */
export interface CallToolRequestParams extends InputResponseRequestParams {
  /**
   * The name of the tool.
   */
  name: string;
  /**
   * Arguments to use for the tool call.
   */
  arguments?: { [key: string]: unknown };
}

/**
 * Used by the client to invoke a tool provided by the server.
 *
 * @example Call tool request
 * {@includeCode ./examples/CallToolRequest/call-tool-request.json}
 *
 * @category `tools/call`
 */
export interface CallToolRequest extends JSONRPCRequest {
  method: "tools/call";
  params: CallToolRequestParams;
}

/**
 * An optional notification from the server to the client, informing it that the list of tools it offers has changed. This is only delivered on a {@link SubscriptionsListenRequest | subscriptions/listen} stream when the client requested it via the `toolsListChanged` filter field.
 *
 * @example Tools list changed
 * {@includeCode ./examples/ToolListChangedNotification/tools-list-changed.json}
 *
 * @category `notifications/tools/list_changed`
 */
export interface ToolListChangedNotification extends JSONRPCNotification {
  method: "notifications/tools/list_changed";
  params?: NotificationParams;
}

/**
 * Additional properties describing a {@link Tool} to clients.
 *
 * NOTE: all properties in `ToolAnnotations` are **hints**.
 * They are not guaranteed to provide a faithful description of
 * tool behavior (including descriptive properties like `title`).
 *
 * Clients should never make tool use decisions based on `ToolAnnotations`
 * received from untrusted servers.
 *
 * @category `tools/list`
 */
export interface ToolAnnotations {
  /**
   * A human-readable title for the tool.
   */
  title?: string;

  /**
   * If true, the tool does not modify its environment.
   *
   * Default: false
   */
  readOnlyHint?: boolean;

  /**
   * If true, the tool may perform destructive updates to its environment.
   * If false, the tool performs only additive updates.
   *
   * (This property is meaningful only when `readOnlyHint == false`)
   *
   * Default: true
   */
  destructiveHint?: boolean;

  /**
   * If true, calling the tool repeatedly with the same arguments
   * will have no additional effect on its environment.
   *
   * (This property is meaningful only when `readOnlyHint == false`)
   *
   * Default: false
   */
  idempotentHint?: boolean;

  /**
   * If true, this tool may interact with an "open world" of external
   * entities. If false, the tool's domain of interaction is closed.
   * For example, the world of a web search tool is open, whereas that
   * of a memory tool is not.
   *
   * Default: true
   */
  openWorldHint?: boolean;
}

/**
 * Definition for a tool the client can call.
 *
 * @example With default 2020-12 input schema
 * {@includeCode ./examples/Tool/with-default-2020-12-input-schema.json}
 *
 * @example With explicit draft-07 input schema
 * {@includeCode ./examples/Tool/with-explicit-draft-07-input-schema.json}
 *
 * @example With no parameters
 * {@includeCode ./examples/Tool/with-no-parameters.json}
 *
 * @example With output schema for structured content
 * {@includeCode ./examples/Tool/with-output-schema-for-structured-content.json}
 *
 * @category `tools/list`
 */
export interface Tool extends BaseMetadata, Icons {
  /**
   * A human-readable description of the tool.
   *
   * This can be used by clients to improve the LLM's understanding of available tools. It can be thought of like a "hint" to the model.
   */
  description?: string;

  /**
   * A JSON Schema object defining the expected parameters for the tool.
   *
   * Tool arguments are always JSON objects, so `type: "object"` is required at the root.
   * Beyond that, any JSON Schema 2020-12 keyword may appear alongside `type` — including
   * composition keywords (`oneOf`, `anyOf`, `allOf`, `not`), conditional keywords
   * (`if`/`then`/`else`), reference keywords (`$ref`, `$defs`, `$anchor`), and any other
   * standard validation or annotation keywords.
   *
   * Property schemas may carry an `x-mcp-header` annotation to mirror the
   * argument value into an HTTP header on the Streamable HTTP transport. See
   * the Streamable HTTP transport specification for the validity and
   * extraction rules.
   *
   * Defaults to JSON Schema 2020-12 when no explicit `$schema` is provided.
   */
  inputSchema: { $schema?: string; type: "object"; [key: string]: unknown };

  /**
   * An optional JSON Schema object defining the structure of the tool's output returned in
   * the structuredContent field of a {@link CallToolResult}. This can be any valid JSON Schema 2020-12.
   *
   * Defaults to JSON Schema 2020-12 when no explicit `$schema` is provided.
   */
  outputSchema?: { $schema?: string; [key: string]: unknown };

  /**
   * Optional additional tool information.
   *
   * Display name precedence order is: `title`, `annotations.title`, then `name`.
   */
  annotations?: ToolAnnotations;

  _meta?: MetaObject;
}

```
