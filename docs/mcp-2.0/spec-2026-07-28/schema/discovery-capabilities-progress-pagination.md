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
> PART 2 of the schema capture: Discovery, capabilities, icons, progress, pagination, CacheableResult. Verbatim slice of schema.ts, source lines 670-1128
> (as numbered inside the captured code block of the original single-file capture).

---

# Schema Reference (schema.ts, 2026-07-28) — Discovery, capabilities, icons, progress, pagination, CacheableResult

```typescript
/* Discovery */
/**
 * A request from the client asking the server to advertise its supported
 * protocol versions, capabilities, and other metadata. Servers **MUST**
 * implement `server/discover`. Clients **MAY** call it but are not required
 * to — version negotiation can also happen inline via per-request `_meta`.
 *
 * @example Discover request
 * {@includeCode ./examples/DiscoverRequest/server-discover-request.json}
 *
 * @category `server/discover`
 */
export interface DiscoverRequest extends JSONRPCRequest {
  method: "server/discover";
  params: RequestParams;
}

/**
 * The result returned by the server for a {@link DiscoverRequest | server/discover} request.
 *
 * @example Server capabilities discovery
 * {@includeCode ./examples/DiscoverResult/server-capabilities-discovery.json}
 *
 * @category `server/discover`
 */
export interface DiscoverResult extends CacheableResult {
  /**
   * MCP Protocol Versions this server supports. The client should choose a
   * version from this list for use in subsequent requests.
   */
  supportedVersions: string[];
  /**
   * The capabilities of the server.
   */
  capabilities: ServerCapabilities;
  /**
   * Natural-language guidance describing the server and its features.
   *
   * This can be used by clients to improve an LLM's understanding of
   * available tools (e.g., by including it in a system prompt). It should
   * focus on information that helps the model use the server effectively
   * and should not duplicate information already in tool descriptions.
   */
  instructions?: string;
}

/**
 * A successful response from the server for a {@link DiscoverRequest | server/discover} request.
 *
 * @example Discover result response
 * {@includeCode ./examples/DiscoverResultResponse/discover-result-response.json}
 *
 * @category `server/discover`
 */
export interface DiscoverResultResponse extends JSONRPCResultResponse {
  result: DiscoverResult;
}

/**
 * Capabilities a client may support. Known capabilities are defined here, in this schema, but this is not a closed set: any client can define its own, additional capabilities.
 *
 * @category `server/discover`
 */
export interface ClientCapabilities {
  /**
   * Experimental, non-standard capabilities that the client supports.
   */
  experimental?: { [key: string]: JSONObject };
  /**
   * Present if the client supports listing roots.
   *
   * @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577).
   * Remains in the specification for at least twelve months; see the
   * deprecated features registry.
   *
   * @example Roots — minimum baseline support
   * {@includeCode ./examples/ClientCapabilities/roots-minimum-baseline-support.json}
   */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  roots?: {};
  /**
   * Present if the client supports sampling from an LLM.
   *
   * @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577).
   * Remains in the specification for at least twelve months; see the
   * deprecated features registry.
   *
   * @example Sampling — minimum baseline support
   * {@includeCode ./examples/ClientCapabilities/sampling-minimum-baseline-support.json}
   *
   * @example Sampling — tool use support
   * {@includeCode ./examples/ClientCapabilities/sampling-tool-use-support.json}
   *
   * @example Sampling — context inclusion support (deprecated)
   * {@includeCode ./examples/ClientCapabilities/sampling-context-inclusion-support-deprecated.json}
   */
  sampling?: {
    /**
     * Whether the client supports context inclusion via `includeContext` parameter.
     * If not declared, servers SHOULD only use `includeContext: "none"` (or omit it).
     */
    context?: JSONObject;
    /**
     * Whether the client supports tool use via `tools` and `toolChoice` parameters.
     */
    tools?: JSONObject;
  };
  /**
   * Present if the client supports elicitation from the server.
   *
   * @example Elicitation — form and URL mode support
   * {@includeCode ./examples/ClientCapabilities/elicitation-form-and-url-mode-support.json}
   *
   * @example Elicitation — form mode only (implicit)
   * {@includeCode ./examples/ClientCapabilities/elicitation-form-only-implicit.json}
   */
  elicitation?: {
    form?: JSONObject;
    url?: JSONObject;
  };

  /**
   * Optional MCP extensions that the client supports. Keys are extension identifiers
   * (e.g., "io.modelcontextprotocol/oauth-client-credentials"), and values are
   * per-extension settings objects. An empty object indicates support with no settings.
   *
   * Keys MUST follow the {@link MetaObject | `_meta` key naming rules}, with a
   * mandatory prefix.
   *
   * @example Extensions — MCP Apps (UI) extension with MIME type support
   * {@includeCode ./examples/ClientCapabilities/extensions-ui-mime-types.json}
   */
  extensions?: { [key: string]: JSONObject };
}

/**
 * Capabilities that a server may support. Known capabilities are defined here, in this schema, but this is not a closed set: any server can define its own, additional capabilities.
 *
 * @category `server/discover`
 */
export interface ServerCapabilities {
  /**
   * Experimental, non-standard capabilities that the server supports.
   */
  experimental?: { [key: string]: JSONObject };
  /**
   * Present if the server supports sending log messages to the client.
   *
   * @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577).
   * Remains in the specification for at least twelve months; see the
   * deprecated features registry.
   *
   * @example Logging — minimum baseline support
   * {@includeCode ./examples/ServerCapabilities/logging-minimum-baseline-support.json}
   */
  logging?: JSONObject;
  /**
   * Present if the server supports argument autocompletion suggestions.
   *
   * @example Completions — minimum baseline support
   * {@includeCode ./examples/ServerCapabilities/completions-minimum-baseline-support.json}
   */
  completions?: JSONObject;
  /**
   * Present if the server offers any prompt templates.
   *
   * @example Prompts — minimum baseline support
   * {@includeCode ./examples/ServerCapabilities/prompts-minimum-baseline-support.json}
   *
   * @example Prompts — list changed notifications
   * {@includeCode ./examples/ServerCapabilities/prompts-list-changed-notifications.json}
   */
  prompts?: {
    /**
     * Whether this server supports notifications for changes to the prompt list.
     */
    listChanged?: boolean;
  };
  /**
   * Present if the server offers any resources to read.
   *
   * @example Resources — minimum baseline support
   * {@includeCode ./examples/ServerCapabilities/resources-minimum-baseline-support.json}
   *
   * @example Resources — subscription to individual resource updates (only)
   * {@includeCode ./examples/ServerCapabilities/resources-subscription-to-individual-resource-updates-only.json}
   *
   * @example Resources — list changed notifications (only)
   * {@includeCode ./examples/ServerCapabilities/resources-list-changed-notifications-only.json}
   *
   * @example Resources — all notifications
   * {@includeCode ./examples/ServerCapabilities/resources-all-notifications.json}
   */
  resources?: {
    /**
     * Whether this server supports subscribing to resource updates.
     */
    subscribe?: boolean;
    /**
     * Whether this server supports notifications for changes to the resource list.
     */
    listChanged?: boolean;
  };
  /**
   * Present if the server offers any tools to call.
   *
   * @example Tools — minimum baseline support
   * {@includeCode ./examples/ServerCapabilities/tools-minimum-baseline-support.json}
   *
   * @example Tools — list changed notifications
   * {@includeCode ./examples/ServerCapabilities/tools-list-changed-notifications.json}
   */
  tools?: {
    /**
     * Whether this server supports notifications for changes to the tool list.
     */
    listChanged?: boolean;
  };
  /**
   * Optional MCP extensions that the server supports. Keys are extension identifiers
   * (e.g., "io.modelcontextprotocol/tasks"), and values are per-extension settings
   * objects. An empty object indicates support with no settings.
   *
   * Keys MUST follow the {@link MetaObject | `_meta` key naming rules}, with a
   * mandatory prefix.
   *
   * @example Extensions — Tasks extension support
   * {@includeCode ./examples/ServerCapabilities/extensions-tasks.json}
   */
  extensions?: { [key: string]: JSONObject };
}

/**
 * An optionally-sized icon that can be displayed in a user interface.
 *
 * @category Common Types
 */
export interface Icon {
  /**
   * A standard URI pointing to an icon resource. May be an HTTP/HTTPS URL or a
   * `data:` URI with Base64-encoded image data.
   *
   * Consumers SHOULD take steps to ensure URLs serving icons are from the
   * same domain as the client/server or a trusted domain.
   *
   * Consumers SHOULD take appropriate precautions when consuming SVGs as they can contain
   * executable JavaScript.
   *
   * @format uri
   */
  src: string;

  /**
   * Optional MIME type override if the source MIME type is missing or generic.
   * For example: `"image/png"`, `"image/jpeg"`, or `"image/svg+xml"`.
   */
  mimeType?: string;

  /**
   * Optional array of strings that specify sizes at which the icon can be used.
   * Each string should be in WxH format (e.g., `"48x48"`, `"96x96"`) or `"any"` for scalable formats like SVG.
   *
   * If not provided, the client should assume that the icon can be used at any size.
   */
  sizes?: string[];

  /**
   * Optional specifier for the theme this icon is designed for. `"light"` indicates
   * the icon is designed to be used with a light background, and `"dark"` indicates
   * the icon is designed to be used with a dark background.
   *
   * If not provided, the client should assume the icon can be used with any theme.
   */
  theme?: "light" | "dark";
}

/**
 * Base interface to add `icons` property.
 *
 * @internal
 */
export interface Icons {
  /**
   * Optional set of sized icons that the client can display in a user interface.
   *
   * Clients that support rendering icons MUST support at least the following MIME types:
   * - `image/png` - PNG images (safe, universal compatibility)
   * - `image/jpeg` (and `image/jpg`) - JPEG images (safe, universal compatibility)
   *
   * Clients that support rendering icons SHOULD also support:
   * - `image/svg+xml` - SVG images (scalable but requires security precautions)
   * - `image/webp` - WebP images (modern, efficient format)
   */
  icons?: Icon[];
}

/**
 * Base interface for metadata with name (identifier) and title (display name) properties.
 *
 * @internal
 */
export interface BaseMetadata {
  /**
   * Intended for programmatic or logical use, but used as a display name in past specs or fallback (if title isn't present).
   */
  name: string;

  /**
   * Intended for UI and end-user contexts — optimized to be human-readable and easily understood,
   * even by those unfamiliar with domain-specific terminology.
   *
   * If not provided, the name should be used for display (except for {@link Tool},
   * where `annotations.title` should be given precedence over using `name`,
   * if present).
   */
  title?: string;
}

/**
 * Describes the MCP implementation.
 *
 * @category `server/discover`
 */
export interface Implementation extends BaseMetadata, Icons {
  /**
   * The version of this implementation.
   */
  version: string;

  /**
   * An optional human-readable description of what this implementation does.
   *
   * This can be used by clients or servers to provide context about their purpose
   * and capabilities. For example, a server might describe the types of resources
   * or tools it provides, while a client might describe its intended use case.
   */
  description?: string;

  /**
   * An optional URL of the website for this implementation.
   *
   * @format uri
   */
  websiteUrl?: string;
}

/* Progress notifications */

/**
 * Parameters for a {@link ProgressNotification | notifications/progress} notification.
 *
 * @example Progress message
 * {@includeCode ./examples/ProgressNotificationParams/progress-message.json}
 *
 * @category `notifications/progress`
 */
export interface ProgressNotificationParams extends NotificationParams {
  /**
   * The progress token which was given in the initial request, used to associate this notification with the request that is proceeding.
   */
  progressToken: ProgressToken;
  /**
   * The progress thus far. This should increase every time progress is made, even if the total is unknown.
   *
   * @TJS-type number
   */
  progress: number;
  /**
   * Total number of items to process (or total progress required), if known.
   *
   * @TJS-type number
   */
  total?: number;
  /**
   * An optional message describing the current progress.
   */
  message?: string;
}

/**
 * An out-of-band notification used to inform the receiver of a progress update for a long-running request.
 *
 * @example Progress message
 * {@includeCode ./examples/ProgressNotification/progress-message.json}
 *
 * @category `notifications/progress`
 */
export interface ProgressNotification extends JSONRPCNotification {
  method: "notifications/progress";
  params: ProgressNotificationParams;
}

/* Pagination */
/**
 * Common params for paginated requests.
 *
 * @example List request with cursor
 * {@includeCode ./examples/PaginatedRequestParams/list-with-cursor.json}
 *
 * @category Common Types
 */
export interface PaginatedRequestParams extends RequestParams {
  /**
   * An opaque token representing the current pagination position.
   * If provided, the server should return results starting after this cursor.
   */
  cursor?: Cursor;
}

/** @internal */
export interface PaginatedRequest extends JSONRPCRequest {
  params: PaginatedRequestParams;
}

/** @internal */
export interface PaginatedResult extends Result {
  /**
   * An opaque token representing the pagination position after the last returned result.
   * If present, there may be more results available.
   */
  nextCursor?: Cursor;
}

/**
 * A result that supports a time-to-live (TTL) hint for client-side caching.
 *
 * @internal
 */
export interface CacheableResult extends Result {
  /**
   * A hint from the server indicating how long (in milliseconds) the
   * client MAY cache this response before re-fetching. Semantics are
   * analogous to HTTP Cache-Control max-age.
   *
   * - If 0, The response SHOULD be considered immediately stale,
   *   The client MAY re-fetch every time the result is needed.
   * - If positive, the client SHOULD consider the result fresh for this many
   *   milliseconds after receiving the response.
   *
   * @minimum 0
   */
  ttlMs: number;

  /**
   * Indicates the intended scope of the cached response, analogous to HTTP
   * `Cache-Control: public` vs `Cache-Control: private`.
   *
   * - `"public"`: The response does not contain user-specific data. Any
   *   client or intermediary (e.g., shared gateway, caching proxy) MAY cache
   *   the response and serve it across authorization contexts.
   * - `"private"`: The response MAY be cached and reused only within the
   *   same authorization context. Caches MUST NOT be shared across
   *   authorization contexts (e.g., a different access token requires a
   *   different cache).
   *
   */
  cacheScope: "public" | "private";
}

```
