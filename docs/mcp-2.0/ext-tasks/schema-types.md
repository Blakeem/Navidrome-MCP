> Source: https://github.com/modelcontextprotocol/ext-tasks/blob/main/schema/draft/schema.ts
> Spec revision: draft (extension identifier `io.modelcontextprotocol/tasks`). This is
> the TypeScript source of truth for the extension's wire types — the repo's own
> `generate:schemas` script derives the Zod schemas and `schema.json` (JSON Schema)
> from this file; this is the most concrete "before/after in TypeScript" artifact the
> extension publishes.
> Retrieved: 2026-08-11

---

# schema/draft/schema.ts

```typescript
/**
 * MCP Tasks Extension Schema (spec.types.ts)
 * Extension Identifier: io.modelcontextprotocol/tasks
 *
 * This file contains pure TypeScript interface definitions for the MCP Tasks extension.
 * These types are the source of truth and are used to generate Zod schemas via `ts-to-zod`.
 *
 * - Use `@description` JSDoc tags to generate `.describe()` calls on schemas
 * - Run `npm run generate:schemas` to regenerate schemas from these types
 *
 * @see https://modelcontextprotocol.io/seps/2663-tasks-extension
 */

import type {
  CreateMessageRequest,
  CreateMessageResult,
  ElicitRequest,
  ElicitResult,
  JSONRPCNotification,
  JSONRPCRequest,
  ListRootsRequest,
  ListRootsResult,
  NotificationParams,
  Result,
} from "@modelcontextprotocol/sdk/types.js";

/* Tasks */

/**
 * The status of a task.
 *
 * @category `tasks`
 */
export type TaskStatus =
  | "working" // The request is currently being processed
  | "input_required" // The task is waiting for input (e.g., elicitation or sampling)
  | "completed" // The request completed successfully and results are available
  | "failed" // The associated request failed due to a JSON-RPC error during execution
  | "cancelled"; // The request was cancelled before completion

/**
 * Data associated with a task.
 *
 * @category `tasks`
 */
export interface Task {
  /**
   * The task identifier.
   */
  taskId: string;

  /**
   * Current task status.
   */
  status: TaskStatus;

  /**
   * Optional human-readable message describing the current task state.
   * This can provide context for any status, including:
   * - Progress descriptions for "working"
   * - Work blocked on "input_required"
   * - Reasons for "cancelled" status
   * - Summaries for "completed" status
   * - Diagnostic information for "failed" status (e.g., error details, what went wrong)
   */
  statusMessage?: string;

  /**
   * ISO 8601 timestamp when the task was created.
   */
  createdAt: string;

  /**
   * ISO 8601 timestamp when the task was last updated.
   */
  lastUpdatedAt: string;

  /**
   * Time-to-live duration from creation in integer milliseconds, null for unlimited.
   * The server may discard the task after the TTL elapses. This value MAY change
   * over the lifetime of a task.
   * @nullable
   */
  ttlMs: number | null;

  /**
   * Suggested polling interval in integer milliseconds. Clients SHOULD honor
   * this value to avoid overwhelming the server. This value MAY change over
   * the lifetime of a task.
   */
  pollIntervalMs?: number;
}

/* Detailed Task Variants */

/**
 * A task that is in a normal working state.
 * Used by tasks/get and notifications/tasks.
 *
 * @category `tasks`
 */
export interface WorkingTask extends Task {
  status: "working";
}

/**
 * A single input request from the server to the client during task execution.
 *
 * @category `tasks`
 */
// TODO: Import from SDK once updated for MRTR
export type InputRequest =
  | CreateMessageRequest
  | ListRootsRequest
  | ElicitRequest;

/**
 * A single input response from the client to the server during task execution.
 *
 * @category `tasks`
 */
// TODO: Import from SDK once updated for MRTR
export type InputResponse =
  | CreateMessageResult
  | ListRootsResult
  | ElicitResult;

/**
 * Outstanding server-to-client requests that need to be fulfilled during task execution.
 * Keys are arbitrary identifiers for matching requests to responses. Each key MUST be
 * unique over the lifetime of a single task.
 *
 * @category `tasks`
 */
// TODO: Import from SDK once updated for MRTR
export interface InputRequests {
  [key: string]: InputRequest;
}

/**
 * Client responses to outstanding input requests. Each key MUST correspond to a
 * currently-outstanding inputRequest key.
 *
 * @category `tasks`
 */
// TODO: Import from SDK once updated for MRTR
export interface InputResponses {
  [key: string]: InputResponse;
}

/**
 * A task that is waiting for input from the client.
 * Used by tasks/get and notifications/tasks.
 *
 * @category `tasks`
 */
export interface InputRequiredTask extends Task {
  status: "input_required";

  /**
   * Server-to-client requests that need to be fulfilled during task execution.
   * Keys are arbitrary identifiers for matching requests to responses.
   */
  inputRequests: InputRequests;
}

/**
 * A task that has completed successfully.
 * Used by tasks/get and notifications/tasks.
 *
 * @category `tasks`
 */
export interface CompletedTask extends Task {
  status: "completed";

  /**
   * The final result of the task.
   * The structure matches the result type of the original request.
   * For example, a CallToolRequest task would return the CallToolResult structure.
   */
  result: { [key: string]: unknown };
}

/**
 * A task that has failed due to a JSON-RPC error during execution.
 * Used by tasks/get and notifications/tasks.
 *
 * @category `tasks`
 */
export interface FailedTask extends Task {
  status: "failed";

  /**
   * The JSON-RPC error that caused the task to fail.
   */
  error: { [key: string]: unknown };
}

/**
 * A task that has been cancelled.
 * Used by tasks/get and notifications/tasks.
 *
 * @category `tasks`
 */
export interface CancelledTask extends Task {
  status: "cancelled";
}

/**
 * A union type representing a task with status-specific fields inlined.
 * This type is used by tasks/get responses and notifications/tasks
 * notifications to provide complete task state including terminal results
 * or pending input requests.
 *
 * @category `tasks`
 */
export type DetailedTask =
  | WorkingTask
  | InputRequiredTask
  | CompletedTask
  | FailedTask
  | CancelledTask;

/* Task Creation */

/**
 * The result returned by a server in lieu of a standard result shape when
 * it elects to process a request asynchronously. The resultType field MUST
 * be set to "task". This type is Result & Task (flat).
 *
 * @category `tasks`
 */
export type CreateTaskResult = Result & Task;

/* Task Operations */

/**
 * A request to retrieve the state of a task.
 *
 * @category `tasks/get`
 */
export interface GetTaskRequest extends JSONRPCRequest {
  method: "tasks/get";
  params: {
    /**
     * The task identifier to query.
     */
    taskId: string;
  };
}

/**
 * The response to a tasks/get request. Carries the appropriate DetailedTask
 * variant for the task's current status. The resultType field MUST be set
 * to "complete".
 *
 * @category `tasks/get`
 */
export type GetTaskResult = Result & DetailedTask;

/**
 * A request to provide input responses to a task in the input_required state.
 *
 * @category `tasks/update`
 */
export interface UpdateTaskRequest extends JSONRPCRequest {
  method: "tasks/update";
  params: {
    /**
     * The task identifier to update.
     */
    taskId: string;

    /**
     * Responses to outstanding inputRequests previously surfaced by the server.
     * Each key MUST correspond to a currently-outstanding inputRequest key.
     */
    inputResponses: InputResponses;
  };
}

/**
 * The response to a tasks/update request. An empty acknowledgement.
 * The resultType field MUST be set to "complete".
 *
 * @category `tasks/update`
 */
export type UpdateTaskResult = Result;

/**
 * A request to cancel a task.
 *
 * @category `tasks/cancel`
 */
export interface CancelTaskRequest extends JSONRPCRequest {
  method: "tasks/cancel";
  params: {
    /**
     * The task identifier to cancel.
     */
    taskId: string;
  };
}

/**
 * The response to a tasks/cancel request. An empty acknowledgement.
 * Cancellation is cooperative and eventually consistent.
 * The resultType field MUST be set to "complete".
 *
 * @category `tasks/cancel`
 */
export type CancelTaskResult = Result;

/* Task Notifications */

/**
 * Parameters for a `notifications/tasks` notification.
 * Carries a complete DetailedTask for the current status.
 *
 * @category `notifications/tasks`
 */
export type TaskStatusNotificationParams = NotificationParams &
  DetailedTask & { [key: string]: unknown };

/**
 * An optional notification from the server to the client, informing it that
 * a task's status has changed. Servers are not required to send these notifications.
 * Clients subscribe via subscriptions/listen.
 *
 * @category `notifications/tasks`
 */
export interface TaskStatusNotification extends JSONRPCNotification {
  method: "notifications/tasks";
  params: TaskStatusNotificationParams;
}

/* Subscription Additions */

/**
 * Task-specific fields for the subscriptions/listen request.
 * Clients include tasksStatus to subscribe to notifications/tasks
 * for specific task IDs.
 *
 * @category `subscriptions`
 */
export interface TaskSubscriptionNotifications {
  /**
   * Subscribe to notifications/tasks for specific task IDs.
   */
  taskIds?: string[];
}

/**
 * Task-specific fields for the notifications/subscriptions/acknowledged notification.
 * The server includes the list of task IDs it has agreed to send status notifications for.
 *
 * @category `subscriptions`
 */
export interface TaskSubscriptionAcknowledgedNotifications {
  /**
   * Task IDs the server has agreed to send status notifications for.
   */
  taskIds?: string[];
}

/* Extension Capability */

/**
 * The extension capability declaration for the tasks extension.
 * An empty object indicates support; no extension-specific settings are currently defined.
 *
 * @category `tasks`
 */
export type TasksExtensionCapability = Record<string, never>;
```
