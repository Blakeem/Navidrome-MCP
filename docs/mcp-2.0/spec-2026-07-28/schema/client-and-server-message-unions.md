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
> PART 7 of the schema capture: Client and server message unions. Verbatim slice of schema.ts, source lines 3168-3214
> (as numbered inside the captured code block of the original single-file capture).

---

# Schema Reference (schema.ts, 2026-07-28) — Client and server message unions

```typescript
/* Client messages */
/** @internal */
export type ClientRequest =
  | DiscoverRequest
  | CompleteRequest
  | GetPromptRequest
  | ListPromptsRequest
  | ListResourcesRequest
  | ListResourceTemplatesRequest
  | ReadResourceRequest
  | SubscriptionsListenRequest
  | CallToolRequest
  | ListToolsRequest;

/** @internal */
export type ClientNotification = CancelledNotification;

/** @internal */
export type ClientResult = EmptyResult;

/* Server messages */

/** @internal */
export type ServerNotification =
  | CancelledNotification
  | ProgressNotification
  | LoggingMessageNotification
  | ResourceUpdatedNotification
  | ResourceListChangedNotification
  | ToolListChangedNotification
  | PromptListChangedNotification
  | SubscriptionsAcknowledgedNotification;

/** @internal */
export type ServerResult =
  | EmptyResult
  | DiscoverResult
  | CompleteResult
  | GetPromptResult
  | ListPromptsResult
  | ListResourceTemplatesResult
  | ListResourcesResult
  | ReadResourceResult
  | SubscriptionsListenResult
  | CallToolResult
  | ListToolsResult
  | InputRequiredResult;
```
