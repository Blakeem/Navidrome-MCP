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
> PART 3 of the schema capture: Resources and subscriptions. Verbatim slice of schema.ts, source lines 1129-1573
> (as numbered inside the captured code block of the original single-file capture).

---

# Schema Reference (schema.ts, 2026-07-28) — Resources and subscriptions

```typescript
/* Resources */
/**
 * Sent from the client to request a list of resources the server has.
 *
 * @example List resources request
 * {@includeCode ./examples/ListResourcesRequest/list-resources-request.json}
 *
 * @category `resources/list`
 */
export interface ListResourcesRequest extends PaginatedRequest {
  method: "resources/list";
}

/**
 * The result returned by the server for a {@link ListResourcesRequest | resources/list} request.
 *
 * @example Resources list with cursor and TTL
 * {@includeCode ./examples/ListResourcesResult/resources-list-with-cursor-and-ttl.json}
 *
 * @category `resources/list`
 */
export interface ListResourcesResult extends PaginatedResult, CacheableResult {
  resources: Resource[];
}

/**
 * A successful response from the server for a {@link ListResourcesRequest | resources/list} request.
 *
 * @example List resources result response
 * {@includeCode ./examples/ListResourcesResultResponse/list-resources-result-response.json}
 *
 * @category `resources/list`
 */
export interface ListResourcesResultResponse extends JSONRPCResultResponse {
  result: ListResourcesResult;
}

/**
 * Sent from the client to request a list of resource templates the server has.
 *
 * @example List resource templates request
 * {@includeCode ./examples/ListResourceTemplatesRequest/list-resource-templates-request.json}
 *
 * @category `resources/templates/list`
 */
export interface ListResourceTemplatesRequest extends PaginatedRequest {
  method: "resources/templates/list";
}

/**
 * The result returned by the server for a {@link ListResourceTemplatesRequest | resources/templates/list} request.
 *
 * @example Resource templates list with cursor and TTL
 * {@includeCode ./examples/ListResourceTemplatesResult/resource-templates-list-with-cursor-and-ttl.json}
 *
 * @category `resources/templates/list`
 */
export interface ListResourceTemplatesResult
  extends PaginatedResult, CacheableResult {
  resourceTemplates: ResourceTemplate[];
}

/**
 * A successful response from the server for a {@link ListResourceTemplatesRequest | resources/templates/list} request.
 *
 * @example List resource templates result response
 * {@includeCode ./examples/ListResourceTemplatesResultResponse/list-resource-templates-result-response.json}
 *
 * @category `resources/templates/list`
 */
export interface ListResourceTemplatesResultResponse extends JSONRPCResultResponse {
  result: ListResourceTemplatesResult;
}

/**
 * Common params for resource-related requests.
 *
 * @internal
 */
export interface ResourceRequestParams extends RequestParams {
  /**
   * The URI of the resource. The URI can use any protocol; it is up to the server how to interpret it.
   *
   * @format uri
   */
  uri: string;
}

/**
 * Parameters for a `resources/read` request.
 *
 * @category `resources/read`
 */
export interface ReadResourceRequestParams
  extends ResourceRequestParams, InputResponseRequestParams {}

/**
 * Sent from the client to the server, to read a specific resource URI.
 *
 * @example Read resource request
 * {@includeCode ./examples/ReadResourceRequest/read-resource-request.json}
 *
 * @category `resources/read`
 */
export interface ReadResourceRequest extends JSONRPCRequest {
  method: "resources/read";
  params: ReadResourceRequestParams;
}

/**
 * The result returned by the server for a {@link ReadResourceRequest | resources/read} request.
 *
 * @example File resource contents
 * {@includeCode ./examples/ReadResourceResult/file-resource-contents.json}
 *
 * @category `resources/read`
 */
export interface ReadResourceResult extends CacheableResult {
  contents: (TextResourceContents | BlobResourceContents)[];
}

/**
 * A successful response from the server for a {@link ReadResourceRequest | resources/read} request.
 *
 * @example Read resource result response
 * {@includeCode ./examples/ReadResourceResultResponse/read-resource-result-response.json}
 *
 * @example Read resource result response with TTL
 * {@includeCode ./examples/ReadResourceResultResponse/read-resource-result-response-with-ttl.json}
 *
 * @category `resources/read`
 */
export interface ReadResourceResultResponse extends JSONRPCResultResponse {
  result: ReadResourceResult | InputRequiredResult;
}

/**
 * An optional notification from the server to the client, informing it that the list of resources it can read from has changed. This is only delivered on a {@link SubscriptionsListenRequest | subscriptions/listen} stream when the client requested it via the `resourcesListChanged` filter field.
 *
 * @example Resources list changed
 * {@includeCode ./examples/ResourceListChangedNotification/resources-list-changed.json}
 *
 * @category `notifications/resources/list_changed`
 */
export interface ResourceListChangedNotification extends JSONRPCNotification {
  method: "notifications/resources/list_changed";
  params?: NotificationParams;
}

/**
 * The set of notification types a client may opt in to on a
 * {@link SubscriptionsListenRequest | subscriptions/listen} request.
 *
 * Each notification type is **opt-in**; the server **MUST NOT** send
 * notification types the client has not explicitly requested here.
 *
 * @category `subscriptions/listen`
 */
export interface SubscriptionFilter {
  /**
   * If true, receive {@link ToolListChangedNotification | notifications/tools/list_changed}.
   */
  toolsListChanged?: boolean;
  /**
   * If true, receive {@link PromptListChangedNotification | notifications/prompts/list_changed}.
   */
  promptsListChanged?: boolean;
  /**
   * If true, receive {@link ResourceListChangedNotification | notifications/resources/list_changed}.
   */
  resourcesListChanged?: boolean;
  /**
   * Subscribe to {@link ResourceUpdatedNotification | notifications/resources/updated} for these resource URIs.
   * Replaces the former `resources/subscribe` RPC.
   */
  resourceSubscriptions?: string[];
}

/**
 * Parameters for a {@link SubscriptionsListenRequest | subscriptions/listen} request.
 *
 * @category `subscriptions/listen`
 */
export interface SubscriptionsListenRequestParams extends RequestParams {
  /**
   * The notifications the client opts in to on this stream. The server
   * **MUST NOT** send notification types the client has not explicitly
   * requested.
   */
  notifications: SubscriptionFilter;
}

/**
 * Sent from the client to open a long-lived channel for receiving notifications
 * outside the context of a specific request. Replaces the previous HTTP GET
 * endpoint and ensures consistent behavior between HTTP and STDIO.
 *
 * @example Listen for tools and resource list changes
 * {@includeCode ./examples/SubscriptionsListenRequest/listen-for-list-changes.json}
 *
 * @category `subscriptions/listen`
 */
export interface SubscriptionsListenRequest extends JSONRPCRequest {
  method: "subscriptions/listen";
  params: SubscriptionsListenRequestParams;
}

/**
 * Extends {@link ResultMetaObject} with the subscription-stream identifier carried by a
 * {@link SubscriptionsListenResult}. All key naming rules from `MetaObject` apply.
 *
 * @see {@link MetaObject} for key naming rules and reserved prefixes.
 * @category `subscriptions/listen`
 */
export interface SubscriptionsListenResultMetaObject extends ResultMetaObject {
  /**
   * Identifies the subscription stream this response closes, so the client can
   * correlate it with the originating subscription — mirroring the same key on
   * the stream's notifications. The value is the JSON-RPC ID of the
   * `subscriptions/listen` request that opened the stream (and equals this
   * response's `id`).
   */
  "io.modelcontextprotocol/subscriptionId": RequestId;
}

/**
 * The response to a {@link SubscriptionsListenRequest | subscriptions/listen}
 * request, signalling that the subscription has ended gracefully (for example,
 * during server shutdown). Because the listen stream is long-lived, this result
 * is sent only when the server tears the subscription down; an abrupt transport
 * close carries no response. The result body is otherwise empty.
 *
 * @example Subscription closed gracefully
 * {@includeCode ./examples/SubscriptionsListenResult/listen-closed.json}
 *
 * @category `subscriptions/listen`
 */
export interface SubscriptionsListenResult extends Result {
  _meta: SubscriptionsListenResultMetaObject;
}

/**
 * A successful response from the server for a {@link SubscriptionsListenRequest | subscriptions/listen}
 * request, sent when the server tears the subscription down gracefully.
 *
 * @example Subscription closed gracefully response
 * {@includeCode ./examples/SubscriptionsListenResultResponse/listen-closed-response.json}
 *
 * @category `subscriptions/listen`
 */
export interface SubscriptionsListenResultResponse extends JSONRPCResultResponse {
  result: SubscriptionsListenResult;
}

/**
 * Parameters for a {@link SubscriptionsAcknowledgedNotification | notifications/subscriptions/acknowledged} notification.
 *
 * @category `notifications/subscriptions/acknowledged`
 */
export interface SubscriptionsAcknowledgedNotificationParams extends NotificationParams {
  /**
   * The subset of requested notification types the server agreed to honor.
   * Only includes notification types the server actually supports; if the
   * client requested an unsupported type (e.g., `promptsListChanged` when
   * the server has no prompts), it is omitted from this set.
   */
  notifications: SubscriptionFilter;
}

/**
 * Sent by the server to acknowledge that a
 * {@link SubscriptionsListenRequest | subscriptions/listen} subscription has been
 * established and to report which notification types it agreed to honor.
 *
 * This notification MUST be the first message the server sends carrying the
 * subscription's ID in `io.modelcontextprotocol/subscriptionId`. The server MUST
 * NOT send any notification on the subscription before acknowledging it. On
 * stdio, where every subscription shares one channel, this ordering is defined
 * per subscription ID and not per channel: messages belonging to other
 * subscriptions MAY be interleaved before it.
 *
 * @example Listen acknowledged
 * {@includeCode ./examples/SubscriptionsAcknowledgedNotification/listen-acknowledged.json}
 *
 * @category `notifications/subscriptions/acknowledged`
 */
export interface SubscriptionsAcknowledgedNotification extends JSONRPCNotification {
  method: "notifications/subscriptions/acknowledged";
  params: SubscriptionsAcknowledgedNotificationParams;
}

/**
 * Parameters for a `notifications/resources/updated` notification.
 *
 * @example File resource updated
 * {@includeCode ./examples/ResourceUpdatedNotificationParams/file-resource-updated.json}
 *
 * @category `notifications/resources/updated`
 */
export interface ResourceUpdatedNotificationParams extends NotificationParams {
  /**
   * The URI of the resource that has been updated. This might be a sub-resource of the one that the client actually subscribed to.
   *
   * @format uri
   */
  uri: string;
}

/**
 * A notification from the server to the client, informing it that a resource has changed and may need to be read again. This is only sent for resources the client opted in to via the `resourceSubscriptions` field of a {@link SubscriptionsListenRequest | subscriptions/listen} request.
 *
 * @example File resource updated notification
 * {@includeCode ./examples/ResourceUpdatedNotification/file-resource-updated-notification.json}
 *
 * @category `notifications/resources/updated`
 */
export interface ResourceUpdatedNotification extends JSONRPCNotification {
  method: "notifications/resources/updated";
  params: ResourceUpdatedNotificationParams;
}

/**
 * A known resource that the server is capable of reading.
 *
 * @example File resource with annotations
 * {@includeCode ./examples/Resource/file-resource-with-annotations.json}
 *
 * @category `resources/list`
 */
export interface Resource extends BaseMetadata, Icons {
  /**
   * The URI of this resource.
   *
   * @format uri
   */
  uri: string;

  /**
   * A description of what this resource represents.
   *
   * This can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a "hint" to the model.
   */
  description?: string;

  /**
   * The MIME type of this resource, if known.
   */
  mimeType?: string;

  /**
   * Optional annotations for the client.
   */
  annotations?: Annotations;

  /**
   * The size of the raw resource content, in bytes (i.e., before base64 encoding or any tokenization), if known.
   *
   * This can be used by Hosts to display file sizes and estimate context window usage.
   */
  size?: number;

  _meta?: MetaObject;
}

/**
 * A template description for resources available on the server.
 *
 * @category `resources/templates/list`
 */
export interface ResourceTemplate extends BaseMetadata, Icons {
  /**
   * A URI template (according to RFC 6570) that can be used to construct resource URIs.
   *
   * @format uri-template
   */
  uriTemplate: string;

  /**
   * A description of what this template is for.
   *
   * This can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a "hint" to the model.
   */
  description?: string;

  /**
   * The MIME type for all resources that match this template. This should only be included if all resources matching this template have the same type.
   */
  mimeType?: string;

  /**
   * Optional annotations for the client.
   */
  annotations?: Annotations;

  _meta?: MetaObject;
}

/**
 * The contents of a specific resource or sub-resource.
 *
 * @internal
 */
export interface ResourceContents {
  /**
   * The URI of this resource.
   *
   * @format uri
   */
  uri: string;
  /**
   * The MIME type of this resource, if known.
   */
  mimeType?: string;

  _meta?: MetaObject;
}

/**
 * @example Text file contents
 * {@includeCode ./examples/TextResourceContents/text-file-contents.json}
 *
 * @category Content
 */
export interface TextResourceContents extends ResourceContents {
  /**
   * The text of the item. This must only be set if the item can actually be represented as text (not binary data).
   */
  text: string;
}

/**
 * @example Image file contents
 * {@includeCode ./examples/BlobResourceContents/image-file-contents.json}
 *
 * @category Content
 */
export interface BlobResourceContents extends ResourceContents {
  /**
   * A base64-encoded string representing the binary data of the item.
   *
   * @format byte
   */
  blob: string;
}

```
