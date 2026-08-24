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
> PART 1 of the schema capture: JSON + JSON-RPC types, error codes, MRTR input types, cancellation. Verbatim slice of schema.ts, source lines 18-669
> (as numbered inside the captured code block of the original single-file capture).

---

# Schema Reference (schema.ts, 2026-07-28) — JSON + JSON-RPC types, error codes, MRTR input types, cancellation

```typescript
/* JSON types */

/**
 * @category Common Types
 */
export type JSONValue =
  string | number | boolean | null | JSONObject | JSONArray;

/**
 * @category Common Types
 */
export type JSONObject = { [key: string]: JSONValue };

/**
 * @category Common Types
 */
export type JSONArray = JSONValue[];

/* JSON-RPC types */

/**
 * Refers to any valid JSON-RPC object that can be decoded off the wire, or encoded to be sent.
 *
 * @category JSON-RPC
 */
export type JSONRPCMessage =
  JSONRPCRequest | JSONRPCNotification | JSONRPCResponse;

/** @internal */
export const LATEST_PROTOCOL_VERSION = "2026-07-28";
/** @internal */
export const JSONRPC_VERSION = "2.0";

/**
 * Represents the contents of a `_meta` field, which clients and servers use to attach additional metadata to their interactions.
 *
 * Certain key names are reserved by MCP for protocol-level metadata; implementations MUST NOT make assumptions about values at these keys. Additionally, specific schema definitions may reserve particular names for purpose-specific metadata, as declared in those definitions.
 *
 * Valid keys have two segments:
 *
 * **Prefix:**
 * - Optional — if specified, MUST be a series of _labels_ separated by dots (`.`), followed by a slash (`/`).
 * - Labels MUST start with a letter and end with a letter or digit. Interior characters may be letters, digits, or hyphens (`-`).
 * - Implementations SHOULD use reverse DNS notation (e.g., `com.example/` rather than `example.com/`).
 * - Any prefix where the second label is `modelcontextprotocol` or `mcp` is **reserved** for MCP use. For example: `io.modelcontextprotocol/`, `dev.mcp/`, `org.modelcontextprotocol.api/`, and `com.mcp.tools/` are all reserved. However, `com.example.mcp/` is NOT reserved, as the second label is `example`.
 *
 * **Name:**
 * - Unless empty, MUST start and end with an alphanumeric character (`[a-z0-9A-Z]`).
 * - Interior characters may be alphanumeric, hyphens (`-`), underscores (`_`), or dots (`.`).
 *
 * @see [General fields: `_meta`](/specification/2026-07-28/basic/index#meta) for more details.
 * @category Common Types
 */
export type MetaObject = Record<string, unknown>;

/**
 * Extends {@link MetaObject} with additional request-specific fields. All key naming rules from `MetaObject` apply.
 *
 * @see {@link MetaObject} for key naming rules and reserved prefixes.
 * @see [General fields: `_meta`](/specification/2026-07-28/basic/index#meta) for more details.
 * @category Common Types
 */
export interface RequestMetaObject extends MetaObject {
  /**
   * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by {@link ProgressNotification | notifications/progress}). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
   */
  progressToken?: ProgressToken;
  /**
   * The MCP Protocol Version being used for this request. Required.
   *
   * For the HTTP transport, this value MUST match the `MCP-Protocol-Version`
   * header; otherwise the server MUST return a `400 Bad Request`. If the
   * server does not support the requested version, it MUST return an
   * {@link UnsupportedProtocolVersionError}.
   */
  "io.modelcontextprotocol/protocolVersion": string;
  /**
   * Identifies the client software making the request. Clients SHOULD
   * include this field on every request unless specifically configured not
   * to do so.
   *
   * The {@link Implementation} schema requires `name` and `version`; other
   * fields are optional.
   *
   * The value is self-reported by the client and is not verified by the
   * protocol. It is intended for display, logging, and debugging. Servers
   * SHOULD NOT use it to change their behavior, and SHOULD NOT rely on it for
   * security decisions.
   */
  "io.modelcontextprotocol/clientInfo"?: Implementation;
  /**
   * The client's capabilities for this specific request. Required.
   *
   * Capabilities are declared per-request rather than once at initialization;
   * an empty object means the client supports no optional capabilities.
   * Servers MUST NOT infer capabilities from prior requests.
   */
  "io.modelcontextprotocol/clientCapabilities": ClientCapabilities;
  /**
   * The desired log level for this request. Optional.
   *
   * If absent, the server MUST NOT send any {@link LoggingMessageNotification | notifications/message}
   * notifications for this request. The client opts in to log messages by
   * explicitly setting a level. Replaces the former `logging/setLevel` RPC.
   *
   * @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577).
   * Remains in the specification for at least twelve months; see the
   * deprecated features registry.
   */
  "io.modelcontextprotocol/logLevel"?: LoggingLevel;
}

/**
 * Extends {@link MetaObject} with additional notification-specific fields. All key naming rules from `MetaObject` apply.
 *
 * @see {@link MetaObject} for key naming rules and reserved prefixes.
 * @see [General fields: `_meta`](/specification/2026-07-28/basic/index#meta) for more details.
 * @category Common Types
 */
export interface NotificationMetaObject extends MetaObject {
  /**
   * Identifies the subscription stream a notification was delivered on. The
   * server MUST include this key on every notification delivered via a
   * {@link SubscriptionsListenRequest | subscriptions/listen} stream, so the
   * client can correlate the notification with the originating subscription.
   * The key is absent on notifications not delivered via a subscription
   * stream (e.g. progress notifications for an in-flight request), which is
   * why it is optional here.
   *
   * The value is the JSON-RPC ID of the `subscriptions/listen` request that
   * opened the stream.
   */
  "io.modelcontextprotocol/subscriptionId"?: RequestId;
}

/**
 * Extends {@link MetaObject} with additional result-specific fields. All key naming rules from `MetaObject` apply.
 *
 * @see {@link MetaObject} for key naming rules and reserved prefixes.
 * @see [General fields: `_meta`](/specification/2026-07-28/basic/index#meta) for more details.
 * @category Common Types
 */
export interface ResultMetaObject extends MetaObject {
  /**
   * Identifies the server software producing the response. Servers SHOULD
   * include this field on every response unless specifically configured not
   * to do so.
   *
   * The {@link Implementation} schema requires `name` and `version`; other
   * fields are optional.
   *
   * The value is self-reported by the server and is not verified by the
   * protocol. It is intended for display, logging, and debugging. Clients
   * SHOULD NOT use it to change their behavior, and SHOULD NOT rely on it for
   * security decisions.
   */
  "io.modelcontextprotocol/serverInfo"?: Implementation;
}

/**
 * A progress token, used to associate progress notifications with the original request.
 *
 * @category Common Types
 */
export type ProgressToken = string | number;

/**
 * An opaque token used to represent a cursor for pagination.
 *
 * @category Common Types
 */
export type Cursor = string;

/**
 * Common params for any request.
 *
 * @category Common Types
 */
export interface RequestParams {
  _meta: RequestMetaObject;
}

/** @internal */
export interface Request {
  method: string;
  // Allow unofficial extensions of `Request.params` without impacting `RequestParams`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: { [key: string]: any };
}

/**
 * Common params for any notification.
 *
 * @category Common Types
 */
export interface NotificationParams {
  _meta?: NotificationMetaObject;
}

/** @internal */
export interface Notification {
  method: string;
  // Allow unofficial extensions of `Notification.params` without impacting `NotificationParams`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: { [key: string]: any };
}

/**
 * Indicates the type of a {@link Result} object, allowing the client to
 * determine how to parse the response.
 *
 * complete - the request completed successfully and the result contains the final content.
 * input_required - the request requires additional input and the result contains an {@link InputRequiredResult} object with instructions for the client to provide additional input before retrying the original request.
 * @category Common Types
 */
export type ResultType = "complete" | "input_required" | string;

/**
 * Common result fields.
 *
 * @category Common Types
 */
export interface Result {
  _meta?: ResultMetaObject;
  /**
   * Indicates the type of the result, which allows the client to determine
   * how to parse the result object.
   *
   * Servers implementing this protocol version MUST include this field.
   * For backward compatibility, when a client receives a result from a
   * server implementing an earlier protocol version (which does not include
   * `resultType`), the client MUST treat the absent field as `"complete"`.
   */
  resultType: ResultType;
  [key: string]: unknown;
}

/**
 * @category Errors
 */
export interface Error {
  /**
   * The error type that occurred.
   */
  code: number;
  /**
   * A short description of the error. The message SHOULD be limited to a concise single sentence.
   */
  message: string;
  /**
   * Additional information about the error. The value of this member is defined by the sender (e.g. detailed error information, nested errors etc.).
   */
  data?: unknown;
}

/**
 * A uniquely identifying ID for a request in JSON-RPC.
 *
 * @category Common Types
 */
export type RequestId = string | number;

/**
 * A request that expects a response.
 *
 * @category JSON-RPC
 */
export interface JSONRPCRequest extends Request {
  jsonrpc: typeof JSONRPC_VERSION;
  id: RequestId;
}

/**
 * A notification which does not expect a response.
 *
 * @category JSON-RPC
 */
export interface JSONRPCNotification extends Notification {
  jsonrpc: typeof JSONRPC_VERSION;
}

/**
 * A successful (non-error) response to a request.
 *
 * @category JSON-RPC
 */
export interface JSONRPCResultResponse {
  jsonrpc: typeof JSONRPC_VERSION;
  id: RequestId;
  result: Result;
}

/**
 * A response to a request that indicates an error occurred.
 *
 * @category JSON-RPC
 */
export interface JSONRPCErrorResponse {
  jsonrpc: typeof JSONRPC_VERSION;
  id?: RequestId;
  error: Error;
}

/**
 * A response to a request, containing either the result or error.
 *
 * @category JSON-RPC
 */
export type JSONRPCResponse = JSONRPCResultResponse | JSONRPCErrorResponse;

// Standard JSON-RPC error codes
export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

/**
 * A JSON-RPC error indicating that invalid JSON was received by the server. This error is returned when the server cannot parse the JSON text of a message.
 *
 * @see {@link https://www.jsonrpc.org/specification#error_object | JSON-RPC 2.0 Error Object}
 *
 * @example Invalid JSON
 * {@includeCode ./examples/ParseError/invalid-json.json}
 *
 * @category Errors
 */
export interface ParseError extends Error {
  code: typeof PARSE_ERROR;
}

/**
 * A JSON-RPC error indicating that the request is not a valid request object. This error is returned when the message structure does not conform to the JSON-RPC 2.0 specification requirements for a request (e.g., missing required fields like `jsonrpc` or `method`, or using invalid types for these fields).
 *
 * @see {@link https://www.jsonrpc.org/specification#error_object | JSON-RPC 2.0 Error Object}
 *
 * @category Errors
 */
export interface InvalidRequestError extends Error {
  code: typeof INVALID_REQUEST;
}

/**
 * A JSON-RPC error indicating that the requested method does not exist or is not available.
 *
 * In MCP, a server returns this error when a client invokes a method the server does not implement — either a genuinely unknown method, or one gated behind a server capability the server did not advertise (e.g., calling `prompts/list` when the `prompts` capability was not advertised).
 *
 * A request that requires a client capability the client did not declare is signalled instead by {@link MissingRequiredClientCapabilityError} (`-32021`).
 *
 * @see {@link https://www.jsonrpc.org/specification#error_object | JSON-RPC 2.0 Error Object}
 *
 * @example Prompts not supported
 * {@includeCode ./examples/MethodNotFoundError/prompts-not-supported.json}
 *
 * @category Errors
 */
export interface MethodNotFoundError extends Error {
  code: typeof METHOD_NOT_FOUND;
}

/**
 * A JSON-RPC error indicating that the method parameters are invalid or malformed.
 *
 * In MCP, this error is returned in various contexts when request parameters fail validation:
 *
 * - **Tools**: Unknown tool name or invalid tool arguments
 * - **Prompts**: Unknown prompt name or missing required arguments
 * - **Pagination**: Invalid or expired cursor values
 * - **Logging**: Invalid log level
 * - **Elicitation**: Server requests an elicitation mode not declared in client capabilities
 * - **Sampling**: Missing tool result or tool results mixed with other content
 *
 * @see {@link https://www.jsonrpc.org/specification#error_object | JSON-RPC 2.0 Error Object}
 *
 * @example Unknown tool
 * {@includeCode ./examples/InvalidParamsError/unknown-tool.json}
 *
 * @example Invalid tool arguments
 * {@includeCode ./examples/InvalidParamsError/invalid-tool-arguments.json}
 *
 * @example Unknown prompt
 * {@includeCode ./examples/InvalidParamsError/unknown-prompt.json}
 *
 * @example Invalid cursor
 * {@includeCode ./examples/InvalidParamsError/invalid-cursor.json}
 *
 * @category Errors
 */
export interface InvalidParamsError extends Error {
  code: typeof INVALID_PARAMS;
}

/**
 * A JSON-RPC error indicating that an internal error occurred on the receiver. This error is returned when the receiver encounters an unexpected condition that prevents it from fulfilling the request.
 *
 * @see {@link https://www.jsonrpc.org/specification#error_object | JSON-RPC 2.0 Error Object}
 *
 * @example Unexpected error
 * {@includeCode ./examples/InternalError/unexpected-error.json}
 *
 * @category Errors
 */
export interface InternalError extends Error {
  code: typeof INTERNAL_ERROR;
}

/*
 * MCP error codes.
 *
 * JSON-RPC 2.0 reserves `-32000` to `-32099` for implementation-defined
 * server errors. MCP partitions that range:
 *
 * - `-32000` to `-32019`: implementation-defined. Existing SDKs and
 *   implementations use codes here for their own purposes; the specification
 *   will never define codes in this sub-range, and receivers must not assign
 *   cross-implementation semantics to them.
 * - `-32020` to `-32099`: reserved for error codes defined by the MCP
 *   specification. Every code allocated here is recorded in this file.
 *   Codes are allocated sequentially starting at `-32020` and proceeding
 *   toward `-32099`.
 *
 * Codes defined by earlier protocol versions remain reserved and are never
 * reused: `-32002` (resource not found, 2025-11-25 and earlier; replaced by
 * `-32602`) and `-32042` (URL elicitation required, 2025-11-25 only).
 */

/**
 * Error code returned when the HTTP headers of a request do not match the
 * corresponding values in the request body, or required headers are
 * missing or malformed.
 *
 * @category Errors
 */
export const HEADER_MISMATCH = -32020;

/**
 * Error code returned when a server requires a client capability that was
 * not declared in the request's `clientCapabilities`.
 *
 * @category Errors
 */
export const MISSING_REQUIRED_CLIENT_CAPABILITY = -32021;

/**
 * Error code returned when the request's protocol version is not supported
 * by the server.
 *
 * @category Errors
 */
export const UNSUPPORTED_PROTOCOL_VERSION = -32022;

/**
 * Returned when a server rejects a request because the values in the HTTP
 * headers do not match the corresponding values in the request body, or
 * because required headers are missing or malformed. For HTTP, the response
 * status code MUST be `400 Bad Request`.
 *
 * @example Header mismatch
 * {@includeCode ./examples/HeaderMismatchError/header-mismatch.json}
 *
 * @category Errors
 */
export interface HeaderMismatchError extends Omit<
  JSONRPCErrorResponse,
  "error"
> {
  error: Error & {
    code: typeof HEADER_MISMATCH;
  };
}

/**
 * Returned when the request's protocol version is unknown to the server or
 * unsupported (e.g., a known experimental or draft version the server has
 * chosen not to implement). For HTTP, the response status code MUST be
 * `400 Bad Request`.
 *
 * @example Unsupported protocol version
 * {@includeCode ./examples/UnsupportedProtocolVersionError/unsupported-version.json}
 *
 * @category Errors
 */
export interface UnsupportedProtocolVersionError extends Omit<
  JSONRPCErrorResponse,
  "error"
> {
  error: Error & {
    code: typeof UNSUPPORTED_PROTOCOL_VERSION;
    data: {
      /**
       * Protocol versions the server supports. The client should choose a
       * mutually supported version from this list and retry.
       */
      supported: string[];
      /**
       * The protocol version that was requested by the client.
       */
      requested: string;
    };
  };
}

/**
 * Returned when processing a request requires a capability the client did not
 * declare in `clientCapabilities`. For HTTP, the response status code MUST be
 * `400 Bad Request`.
 *
 * @example Missing elicitation capability
 * {@includeCode ./examples/MissingRequiredClientCapabilityError/missing-elicitation-capability.json}
 *
 * @category Errors
 */
export interface MissingRequiredClientCapabilityError extends Omit<
  JSONRPCErrorResponse,
  "error"
> {
  error: Error & {
    code: typeof MISSING_REQUIRED_CLIENT_CAPABILITY;
    data: {
      /**
       * The capabilities the server requires from the client to process this request.
       */
      requiredCapabilities: ClientCapabilities;
    };
  };
}

/* Empty result */
/**
 * A result that indicates success but carries no data.
 *
 * @category Common Types
 */
export type EmptyResult = Result;

/** @internal */
export type InputRequest =
  CreateMessageRequest | ListRootsRequest | ElicitRequest;

/** @internal */
export type InputResponse =
  CreateMessageResult | ListRootsResult | ElicitResult;

/**
 * A map of server-initiated requests that the client must fulfill.
 * Keys are server-assigned identifiers; values are the request objects.
 *
 * @example Elicitation and sampling input requests
 * {@includeCode ./examples/InputRequests/elicitation-and-sampling-input-requests.json}
 *
 * @category Multi Round-Trip
 */
export interface InputRequests {
  [key: string]: InputRequest;
}

/**
 * A map of client responses to server-initiated requests.
 * Keys correspond to the keys in the {@link InputRequests} map;
 * values are the client's result for each request.
 *
 * @example Elicitation and sampling input responses
 * {@includeCode ./examples/InputResponses/elicitation-and-sampling-input-responses.json}
 *
 * @category Multi Round-Trip
 */
export interface InputResponses {
  [key: string]: InputResponse;
}

/**
 * An InputRequiredResult sent by the server to indicate that additional input is needed
 * before the request can be completed.
 *
 * At least one of `inputRequests` or `requestState` MUST be present.
 * @example InputRequiredResult with elicitation and sampling input requests and request state
 * {@includeCode ./examples/InputRequiredResult/input-required-result-with-elicitation-and-sampling-and-request-state.json}
 *
 * @example InputRequiredResult with request state only (load shedding)
 * {@includeCode ./examples/InputRequiredResult/input-required-result-with-request-state-only.json}
 *
 * @category Multi Round-Trip
 */
export interface InputRequiredResult extends Result {
  /* Requests issued by the server that must be complete before the
   * client can retry the original request.
   */
  inputRequests?: InputRequests;
  /* Request state to be passed back to the server when the client
   * retries the original request.
   * Note: The client must treat this as an opaque blob; it must not
   * interpret it in any way.
   */
  requestState?: string;
}

/* Request parameter type that includes input responses and request state.
 * These parameters may be included in any client-initiated request.
 */
export interface InputResponseRequestParams extends RequestParams {
  /* New field to carry the responses for the server's requests from the
   * InputRequiredResult message.  For each key in the response's inputRequests
   * field, the same key must appear here with the associated response.
   */
  inputResponses?: InputResponses;
  /* Request state passed back to the server from the client.
   */
  requestState?: string;
}

/* Cancellation */
/**
 * Parameters for a `notifications/cancelled` notification.
 *
 * @example User-requested cancellation
 * {@includeCode ./examples/CancelledNotificationParams/user-requested-cancellation.json}
 *
 * @category `notifications/cancelled`
 */
export interface CancelledNotificationParams extends NotificationParams {
  /**
   * The ID of the request to cancel.
   *
   * This MUST correspond to the ID of a request the client previously issued.
   */
  requestId: RequestId;

  /**
   * An optional string describing the reason for the cancellation. This MAY be logged or presented to the user.
   */
  reason?: string;
}

/**
 * This notification is sent by the client to indicate that it is cancelling a request it previously issued.
 *
 * On stdio, the server also sends this notification, solely to terminate a {@link SubscriptionsListenRequest | subscriptions/listen} stream: it references the ID of the `subscriptions/listen` request that opened the stream. Servers MUST NOT use this notification to cancel any other request.
 *
 * The request SHOULD still be in-flight, but due to communication latency, it is always possible that this notification MAY arrive after the request has already finished.
 *
 * This notification indicates that the result will be unused, so any associated processing SHOULD cease.
 *
 * @example User-requested cancellation
 * {@includeCode ./examples/CancelledNotification/user-requested-cancellation.json}
 *
 * @category `notifications/cancelled`
 */
export interface CancelledNotification extends JSONRPCNotification {
  method: "notifications/cancelled";
  params: CancelledNotificationParams;
}

```
