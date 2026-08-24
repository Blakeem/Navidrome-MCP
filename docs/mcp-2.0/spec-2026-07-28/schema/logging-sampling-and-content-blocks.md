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
> PART 5 of the schema capture: Logging, sampling, annotations and content blocks. Verbatim slice of schema.ts, source lines 2034-2597
> (as numbered inside the captured code block of the original single-file capture).

---

# Schema Reference (schema.ts, 2026-07-28) — Logging, sampling, annotations and content blocks

```typescript
/* Logging */

/**
 * Parameters for a `notifications/message` notification.
 *
 * @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577).
 * Remains in the specification for at least twelve months; see the
 * deprecated features registry.
 *
 * @example Log database connection failed
 * {@includeCode ./examples/LoggingMessageNotificationParams/log-database-connection-failed.json}
 *
 * @category `notifications/message`
 */
export interface LoggingMessageNotificationParams extends NotificationParams {
  /**
   * The severity of this log message.
   */
  level: LoggingLevel;
  /**
   * An optional name of the logger issuing this message.
   */
  logger?: string;
  /**
   * The data to be logged, such as a string message or an object. Any JSON serializable type is allowed here.
   */
  data: unknown;
}

/**
 * JSONRPCNotification of a log message passed from server to client. The client opts in by setting `"io.modelcontextprotocol/logLevel"` in a request's `_meta`.
 *
 * @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577).
 * Remains in the specification for at least twelve months; see the
 * deprecated features registry.
 *
 * @example Log database connection failed
 * {@includeCode ./examples/LoggingMessageNotification/log-database-connection-failed.json}
 *
 * @category `notifications/message`
 */
export interface LoggingMessageNotification extends JSONRPCNotification {
  method: "notifications/message";
  params: LoggingMessageNotificationParams;
}

/**
 * The severity of a log message.
 *
 * These map to syslog message severities, as specified in RFC-5424:
 * https://datatracker.ietf.org/doc/html/rfc5424#section-6.2.1
 *
 * @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577).
 * Remains in the specification for at least twelve months; see the
 * deprecated features registry.
 *
 * @category Common Types
 */
export type LoggingLevel =
  | "debug"
  | "info"
  | "notice"
  | "warning"
  | "error"
  | "critical"
  | "alert"
  | "emergency";

/* Sampling */
/**
 * Parameters for a `sampling/createMessage` request.
 *
 * @example Basic request
 * {@includeCode ./examples/CreateMessageRequestParams/basic-request.json}
 *
 * @example Request with tools
 * {@includeCode ./examples/CreateMessageRequestParams/request-with-tools.json}
 *
 * @example Follow-up request with tool results
 * {@includeCode ./examples/CreateMessageRequestParams/follow-up-with-tool-results.json}
 *
 * @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577).
 * Remains in the specification for at least twelve months; see the
 * deprecated features registry.
 *
 * @category `sampling/createMessage`
 */
export interface CreateMessageRequestParams {
  messages: SamplingMessage[];
  /**
   * The server's preferences for which model to select. The client MAY ignore these preferences.
   */
  modelPreferences?: ModelPreferences;
  /**
   * An optional system prompt the server wants to use for sampling. The client MAY modify or omit this prompt.
   */
  systemPrompt?: string;
  /**
   * A request to include context from one or more MCP servers (including the caller), to be attached to the prompt.
   * The client MAY ignore this request.
   *
   * Default is `"none"`. The values `"thisServer"` and `"allServers"` are deprecated (SEP-2596): servers SHOULD
   * omit this field or use `"none"`, and SHOULD only use the deprecated values if the client declares
   * {@link ClientCapabilities.sampling.context}.
   *
   * @deprecated The `"thisServer"` and `"allServers"` values are deprecated as of protocol version 2025-11-25
   * (SEP-2596) and will be removed no later than the Sampling feature itself (SEP-2577). Omit this field or use `"none"`.
   */
  includeContext?: "none" | "thisServer" | "allServers";
  /**
   * @TJS-type number
   */
  temperature?: number;
  /**
   * The requested maximum number of tokens to sample (to prevent runaway completions).
   *
   * The client MAY choose to sample fewer tokens than the requested maximum.
   */
  maxTokens: number;
  stopSequences?: string[];
  /**
   * Optional metadata to pass through to the LLM provider. The format of this metadata is provider-specific.
   */
  metadata?: JSONObject;
  /**
   * Tools that the model may use during generation.
   * The client MUST return an error if this field is provided but {@link ClientCapabilities.sampling.tools} is not declared.
   */
  tools?: Tool[];
  /**
   * Controls how the model uses tools.
   * The client MUST return an error if this field is provided but {@link ClientCapabilities.sampling.tools} is not declared.
   * Default is `{ mode: "auto" }`.
   */
  toolChoice?: ToolChoice;
}

/**
 * Controls tool selection behavior for sampling requests.
 *
 * @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577).
 * Remains in the specification for at least twelve months; see the
 * deprecated features registry.
 *
 * @category `sampling/createMessage`
 */
export interface ToolChoice {
  /**
   * Controls the tool use ability of the model:
   * - `"auto"`: Model decides whether to use tools (default)
   * - `"required"`: Model MUST use at least one tool before completing
   * - `"none"`: Model MUST NOT use any tools
   */
  mode?: "auto" | "required" | "none";
}

/**
 * A request from the server to sample an LLM via the client. The client has full discretion over which model to select. The client should also inform the user before beginning sampling, to allow them to inspect the request (human in the loop) and decide whether to approve it.
 *
 * @example Sampling request
 * {@includeCode ./examples/CreateMessageRequest/sampling-request.json}
 *
 * @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577).
 * Remains in the specification for at least twelve months; see the
 * deprecated features registry.
 *
 * @category `sampling/createMessage`
 */
export interface CreateMessageRequest {
  method: "sampling/createMessage";
  params: CreateMessageRequestParams;
}

/**
 * The result returned by the client for a {@link CreateMessageRequest | sampling/createMessage} request.
 * The client should inform the user before returning the sampled message, to allow them
 * to inspect the response (human in the loop) and decide whether to allow the server to see it.
 *
 * @example Text response
 * {@includeCode ./examples/CreateMessageResult/text-response.json}
 *
 * @example Tool use response
 * {@includeCode ./examples/CreateMessageResult/tool-use-response.json}
 *
 * @example Final response after tool use
 * {@includeCode ./examples/CreateMessageResult/final-response.json}
 *
 * @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577).
 * Remains in the specification for at least twelve months; see the
 * deprecated features registry.
 *
 * @category `sampling/createMessage`
 */
export interface CreateMessageResult extends SamplingMessage {
  /**
   * The name of the model that generated the message.
   */
  model: string;

  /**
   * The reason why sampling stopped, if known.
   *
   * Standard values:
   * - `"endTurn"`: Natural end of the assistant's turn
   * - `"stopSequence"`: A stop sequence was encountered
   * - `"maxTokens"`: Maximum token limit was reached
   * - `"toolUse"`: The model wants to use one or more tools
   *
   * This field is an open string to allow for provider-specific stop reasons.
   */
  stopReason?: "endTurn" | "stopSequence" | "maxTokens" | "toolUse" | string;
}

/**
 * Describes a message issued to or received from an LLM API.
 *
 * @example Single content block
 * {@includeCode ./examples/SamplingMessage/single-content-block.json}
 *
 * @example Multiple content blocks
 * {@includeCode ./examples/SamplingMessage/multiple-content-blocks.json}
 *
 * @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577).
 * Remains in the specification for at least twelve months; see the
 * deprecated features registry.
 *
 * @category `sampling/createMessage`
 */
export interface SamplingMessage {
  role: Role;
  content: SamplingMessageContentBlock | SamplingMessageContentBlock[];
  _meta?: MetaObject;
}

/**
 * @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577).
 * Remains in the specification for at least twelve months; see the
 * deprecated features registry.
 *
 * @category `sampling/createMessage`
 */
export type SamplingMessageContentBlock =
  | TextContent
  | ImageContent
  | AudioContent
  | ToolUseContent
  | ToolResultContent;

/**
 * Optional annotations for the client. The client can use annotations to inform how objects are used or displayed
 *
 * @category Common Types
 */
export interface Annotations {
  /**
   * Describes who the intended audience of this object or data is.
   *
   * It can include multiple entries to indicate content useful for multiple audiences (e.g., `["user", "assistant"]`).
   */
  audience?: Role[];

  /**
   * Describes how important this data is for operating the server.
   *
   * A value of 1 means "most important," and indicates that the data is
   * effectively required, while 0 means "least important," and indicates that
   * the data is entirely optional.
   *
   * @TJS-type number
   * @minimum 0
   * @maximum 1
   */
  priority?: number;

  /**
   * The moment the resource was last modified, as an ISO 8601 formatted string.
   *
   * Should be an ISO 8601 formatted string (e.g., "2025-01-12T15:00:58Z").
   *
   * Examples: last activity timestamp in an open file, timestamp when the resource
   * was attached, etc.
   */
  lastModified?: string;
}

/**
 * @category Content
 */
export type ContentBlock =
  TextContent | ImageContent | AudioContent | ResourceLink | EmbeddedResource;

/**
 * Text provided to or from an LLM.
 *
 * @example Text content
 * {@includeCode ./examples/TextContent/text-content.json}
 *
 * @category Content
 */
export interface TextContent {
  type: "text";

  /**
   * The text content of the message.
   */
  text: string;

  /**
   * Optional annotations for the client.
   */
  annotations?: Annotations;

  _meta?: MetaObject;
}

/**
 * An image provided to or from an LLM.
 *
 * @example `image/png` content with annotations
 * {@includeCode ./examples/ImageContent/image-png-content-with-annotations.json}
 *
 * @category Content
 */
export interface ImageContent {
  type: "image";

  /**
   * The base64-encoded image data.
   *
   * @format byte
   */
  data: string;

  /**
   * The MIME type of the image. Different providers may support different image types.
   */
  mimeType: string;

  /**
   * Optional annotations for the client.
   */
  annotations?: Annotations;

  _meta?: MetaObject;
}

/**
 * Audio provided to or from an LLM.
 *
 * @example `audio/wav` content
 * {@includeCode ./examples/AudioContent/audio-wav-content.json}
 *
 * @category Content
 */
export interface AudioContent {
  type: "audio";

  /**
   * The base64-encoded audio data.
   *
   * @format byte
   */
  data: string;

  /**
   * The MIME type of the audio. Different providers may support different audio types.
   */
  mimeType: string;

  /**
   * Optional annotations for the client.
   */
  annotations?: Annotations;

  _meta?: MetaObject;
}

/**
 * A request from the assistant to call a tool.
 *
 * @example `get_weather` tool use
 * {@includeCode ./examples/ToolUseContent/get-weather-tool-use.json}
 *
 * @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577).
 * Remains in the specification for at least twelve months; see the
 * deprecated features registry.
 *
 * @category `sampling/createMessage`
 */
export interface ToolUseContent {
  type: "tool_use";

  /**
   * A unique identifier for this tool use.
   *
   * This ID is used to match tool results to their corresponding tool uses.
   */
  id: string;

  /**
   * The name of the tool to call.
   */
  name: string;

  /**
   * The arguments to pass to the tool, conforming to the tool's input schema.
   */
  input: { [key: string]: unknown };

  /**
   * Optional metadata about the tool use. Clients SHOULD preserve this field when
   * including tool uses in subsequent sampling requests to enable caching optimizations.
   */
  _meta?: MetaObject;
}

/**
 * The result of a tool use, provided by the user back to the assistant.
 *
 * @example `get_weather` tool result
 * {@includeCode ./examples/ToolResultContent/get-weather-tool-result.json}
 *
 * @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577).
 * Remains in the specification for at least twelve months; see the
 * deprecated features registry.
 *
 * @category `sampling/createMessage`
 */
export interface ToolResultContent {
  type: "tool_result";

  /**
   * The ID of the tool use this result corresponds to.
   *
   * This MUST match the ID from a previous {@link ToolUseContent}.
   */
  toolUseId: string;

  /**
   * The unstructured result content of the tool use.
   *
   * This has the same format as {@link CallToolResult.content} and can include text, images,
   * audio, resource links, and embedded resources.
   */
  content: ContentBlock[];

  /**
   * An optional structured result value.
   *
   * This can be any JSON value (object, array, string, number, boolean, or null).
   * If the tool defined an {@link Tool.outputSchema}, this SHOULD conform to that schema.
   */
  structuredContent?: unknown;

  /**
   * Whether the tool use resulted in an error.
   *
   * If true, the content typically describes the error that occurred.
   * Default: false
   */
  isError?: boolean;

  /**
   * Optional metadata about the tool result. Clients SHOULD preserve this field when
   * including tool results in subsequent sampling requests to enable caching optimizations.
   */
  _meta?: MetaObject;
}

/**
 * The server's preferences for model selection, requested of the client during sampling.
 *
 * Because LLMs can vary along multiple dimensions, choosing the "best" model is
 * rarely straightforward.  Different models excel in different areas—some are
 * faster but less capable, others are more capable but more expensive, and so
 * on. This interface allows servers to express their priorities across multiple
 * dimensions to help clients make an appropriate selection for their use case.
 *
 * These preferences are always advisory. The client MAY ignore them. It is also
 * up to the client to decide how to interpret these preferences and how to
 * balance them against other considerations.
 *
 * @example With hints and priorities
 * {@includeCode ./examples/ModelPreferences/with-hints-and-priorities.json}
 *
 * @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577).
 * Remains in the specification for at least twelve months; see the
 * deprecated features registry.
 *
 * @category `sampling/createMessage`
 */
export interface ModelPreferences {
  /**
   * Optional hints to use for model selection.
   *
   * If multiple hints are specified, the client MUST evaluate them in order
   * (such that the first match is taken).
   *
   * The client SHOULD prioritize these hints over the numeric priorities, but
   * MAY still use the priorities to select from ambiguous matches.
   */
  hints?: ModelHint[];

  /**
   * How much to prioritize cost when selecting a model. A value of 0 means cost
   * is not important, while a value of 1 means cost is the most important
   * factor.
   *
   * @TJS-type number
   * @minimum 0
   * @maximum 1
   */
  costPriority?: number;

  /**
   * How much to prioritize sampling speed (latency) when selecting a model. A
   * value of 0 means speed is not important, while a value of 1 means speed is
   * the most important factor.
   *
   * @TJS-type number
   * @minimum 0
   * @maximum 1
   */
  speedPriority?: number;

  /**
   * How much to prioritize intelligence and capabilities when selecting a
   * model. A value of 0 means intelligence is not important, while a value of 1
   * means intelligence is the most important factor.
   *
   * @TJS-type number
   * @minimum 0
   * @maximum 1
   */
  intelligencePriority?: number;
}

/**
 * Hints to use for model selection.
 *
 * Keys not declared here are currently left unspecified by the spec and are up
 * to the client to interpret.
 *
 * @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577).
 * Remains in the specification for at least twelve months; see the
 * deprecated features registry.
 *
 * @category `sampling/createMessage`
 */
export interface ModelHint {
  /**
   * A hint for a model name.
   *
   * The client SHOULD treat this as a substring of a model name; for example:
   *  - `claude-3-5-sonnet` should match `claude-3-5-sonnet-20241022`
   *  - `sonnet` should match `claude-3-5-sonnet-20241022`, `claude-3-sonnet-20240229`, etc.
   *  - `claude` should match any Claude model
   *
   * The client MAY also map the string to a different provider's model name or a different model family, as long as it fills a similar niche; for example:
   *  - `gemini-1.5-flash` could match `claude-3-haiku-20240307`
   */
  name?: string;
}

```
