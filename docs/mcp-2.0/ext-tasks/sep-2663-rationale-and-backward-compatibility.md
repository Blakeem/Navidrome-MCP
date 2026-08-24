> Source: https://modelcontextprotocol.io/seps/2663-tasks-extension (mirrored at
> https://modelcontextprotocol.github.io/ext-tasks/seps/2663-tasks-extension; body
> reproduced from the canonical repository markdown file
> `seps/2663-tasks-extension.md` in https://github.com/modelcontextprotocol/ext-tasks,
> which is byte-identical in wording/content to the modelcontextprotocol.io mirror,
> differing only in the site's cosmetic Mintlify status-badge wrapper and markdown
> list-marker/emphasis-character style). This is the SEP (Standards Enhancement
> Proposal) that defines the Tasks extension: it carries the Motivation for
> redesigning tasks as an extension, the Rationale for each design choice, and the
> Backward Compatibility table comparing the removed `2025-11-25` core-protocol
> `tasks.*` feature against this extension's `io.modelcontextprotocol/tasks` — the
> single most direct answer in this source set to "what changed and why."
> Spec revision: SEP-2663, Status: Final, Type: Extensions Track, Created 2026-04-27.
> modelcontextprotocol.io marks Final-status SEPs as a historical record of the
> as-accepted design, not a living document — "Refer to the current specification and
> its changelog for authoritative requirements" (i.e. `ext-tasks/specification.md` in
> this same folder for the current normative text).
> Retrieved: 2026-08-11
> Curation note (2026-08-12): the SEP's own `## Specification` section (its headings
> `Extension Identifier` through `Reservations`) was removed from this file by the
> curator as a near-verbatim duplicate of `ext-tasks/specification.md`, which is the
> authoritative normative copy per the header above. Everything else the SEP contains
> — the header block, Abstract, Motivation, Rationale, Backward Compatibility,
> Security Implications and Reference Implementation — is kept here verbatim and
> unabridged. Full duplicate text is recoverable from the Source URL.

---

# SEP-2663: Tasks Extension

- **Status**: Final
- **Type**: Extensions Track
- **Created**: 2026-04-27
- **Author(s)**: Luca Chang (@LucaButBoring), Caitie McCaffrey (@CaitieM20); on behalf of the Agents Working Group
- **Sponsor**: Caitie McCaffrey (@CaitieM20)
- **Extension Identifier**: `io.modelcontextprotocol/tasks`
- **PR**: https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2663

## Abstract

This SEP defines an extension that allows a server to respond to a `tools/call` request with an asynchronous _task handle_ instead of a final result, allowing the client to retrieve the eventual result by polling. The extension introduces three methods: `tasks/get`, `tasks/update`, and `tasks/cancel`; a polymorphic-result discriminator (`resultType: "task"`); and a `Task` shape that carries a task status, in-progress server-to-client requests, and a final result or error. Task creation is server-directed: the client signals support by including the extension in its per-request capabilities, and the server decides on a per-request basis whether to materialize a task.

Tasks will become a foundational building block of MCP and are expected to be supported in future protocol versions. The experimental `tasks` feature in the `2025-11-25` specification served as a stopgap until the protocol's extension mechanism was available. Now that [extensions](https://modelcontextprotocol.io/extensions/overview) have been [formalized](https://modelcontextprotocol.io/seps/2133-extensions), moving tasks to an official extension gives the feature time to incubate and evolve based on additional real-world implementation feedback, without being constrained by the core specification's release cadence. Once the extension has stabilized and achieved broad adoption, it is intended to be promoted into the core protocol.

This proposal _removes_ the version of [tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks) specified in the `2025-11-25` release from the core protocol and moves it to an Extension. It also proposes updates to Tasks shaped by implementation feedback since that release, and by several changes to the base protocol included in the `2026-06-30` specification:

- [SEP-2260: Require Server requests to be associated with a Client request](https://modelcontextprotocol.io/seps/2260-Require-Server-requests-to-be-associated-with-Client-requests)
- [SEP-2322: Multi Round-Trip Requests](https://modelcontextprotocol.io/seps/2322-MRTR)
- [SEP-2243: HTTP Header Standardization for Streamable HTTP Transport](https://modelcontextprotocol.io/seps/2243-http-standardization)
- [SEP-2567: Sessionless MCP via Explicit State Handles](https://modelcontextprotocol.io/seps/2567-sessionless-mcp)
- [SEP-2575: Make MCP Stateless](https://modelcontextprotocol.io/seps/2575-stateless-mcp)

## Motivation

The experimental [tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks) feature served as an alternate execution mode for tool calls, elicitation, and sampling, allowing receivers to return a poll handle instead of blocking until a final result was ready. Implementation experience surfaced several challenges:

1. **The handshake is fragile.** Tasks today expose method-level capabilities (`tasks.requests.tools.call` declares that `tools/call` **MAY** be task-augmented) alongside a tool-level `execution.taskSupport` field that declares whether a particular tool will accept the augmentation. Clients express their own support for tasks by passing a `task` parameter on their requests, but **MUST NOT** include it if the method/tool does not support tasks. A client that wants to opt into tasks must therefore prime its state with a `tools/list` call before issuing any task-augmented request, and cannot blindly attach a `task` parameter to every request to handle tools isomorphically. This is confusing, implicit, and easy to get wrong.

2. **`tasks/result` is a blocking trap.** In the current flow, a client that observes `input_required` is required to call `tasks/result` prematurely so that the server has an SSE stream on which to side-channel elicitation or sampling requests. `tasks/result` then blocks until the entire operation completes. This forces long-lived persistent connections that many clients and servers do not want to implement, and it conflicts with [SEP-2260](https://modelcontextprotocol.io/seps/2260-Require-Server-requests-to-be-associated-with-Client-requests), which disallows unsolicited server-to-client requests outright. Under SEP-2260, the SSE semantics that justified the blocking behavior no longer apply.

3. **`tasks/list` scoping cannot be defined.** To avoid clients cancelling or retrieving results for tasks they shouldn't have access to, all tasks should be bound to some sort of "authorization context," the implementation of which is left to individual servers according to their existing bespoke permission models. However, in many cases, it is not possible to perform this binding, in which case the task ID becomes the only line of defense against contamination. In this scenario, it is unsafe for a server to support `tasks/list` at all. While it was possible for tasks to instead be bound to a session, [SEP-2567](https://modelcontextprotocol.io/seps/2567-sessionless-mcp) removes sessions from the protocol. There is no other natural scope a server can define unilaterally — task IDs can be unguessable handles that a server can recognize one at a time, but servers cannot reliably correlate two unrelated handles to the same caller without additional state.

Beyond implementation challenges, tasks face another structural issue: **Client-hosted tasks are no longer expressible.** [SEP-1686](./1686-tasks.md) permitted clients to host tasks for elicitation and sampling, in part to avoid coupling tasks to tool calls. [SEP-2260](https://modelcontextprotocol.io/seps/2260-Require-Server-requests-to-be-associated-with-Client-requests) makes any unsolicited server-to-client request invalid; every server-to-client polling request under client-hosted tasks would be unsolicited by definition.

This proposal intends to solve the above issues by redesigning certain aspects of the feature and moving tasks out to an official extension. Redefining tasks as an official extension gives the feature more time to incubate and evolve independently of the core specification, promoting adoption. As part of the redesign, this proposal consolidates the polling lifecycle into `tasks/get` and a new `tasks/update` to remove the blocking `tasks/result` method. The redesign allows servers to return tasks unsolicited (in response to ordinary, non-`task`-flagged requests) to eliminate the per-request opt-in and the `tools/list` warmup, relying instead on the extension capability as the single handshake point. Finally, this proposal removes client-hosted elicitation and sampling tasks in compliance with [SEP-2260](https://modelcontextprotocol.io/seps/2260-Require-Server-requests-to-be-associated-with-Client-requests).


## Rationale

### Unsolicited Tasks vs. Immediate Results

An [alternative proposal](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1905) would have handled the immediate result case individually, and with slightly different preconditions: _If_ tasks are supported, _and_ the client supports immediate task results, _then_ servers may return a regular result in response to a task-augmented request. That version of immediate results looked like a better option at the time, as it implied no breaking changes on top of the initial tasks specification.

However, as we look to [move away](https://blog.modelcontextprotocol.io/posts/2025-12-19-mcp-transport-future/) from stateful protocol interactions and given the current experimental state of tasks in general, it seems worth proposing a somewhat more radical change that reduces the complexity of the overall specification and makes tasks more "native" to MCP at this time. In particular, the choice to allow unsolicited tasks (in _addition_ to immediate results) means promoting tasks to a first-class concept intended for all persistent operations, as opposed to being a parallel and somewhat specialized concept.

This happens to align with the proposed [SEP-2322](https://modelcontextprotocol.io/seps/2322-MRTR), but the two are not coupled with one another.

### Splitting Reads (`tasks/get`) and Writes (`tasks/update`)

Earlier drafts of this redesign let `tasks/get` carry `inputResponses` so a single round trip would both submit responses and observe the resulting state. That conflation has costs: it makes the read path non-idempotent (a retried `tasks/get` could re-submit responses), it forces the read path to share the eventual-consistency model of the write, and it complicates intermediaries that want to cache or deduplicate reads. Splitting the methods leaves `tasks/get` as a pure, idempotent read that any layer can cache or replay safely, and confines write semantics — including their eventual-consistency window — to `tasks/update`.

`tasks/update`'s ack-only response shape follows from the same separation: there is no read data the server needs to return that the client cannot get from a follow-up `tasks/get`, and forcing an embedded `Task` into the response would re-introduce the non-idempotency we are trying to avoid. The cost is one extra round-trip per round of input — paid only when the task actually requires a client request.

### Task Creation Consistency

The following new requirement is introduced:

> A server **MUST NOT** return `CreateTaskResult` until the task is durably created — that is, until a `tasks/get` for the returned `taskId` would resolve. In eventually-consistent environments, the server **MUST** wait for consistency before responding. This requirement eliminates the need for clients to speculatively poll for task creation.

Unlike `tasks/update` and `tasks/cancel`, task creation is strongly-consistent. This has to be the case to avoid speculative `tasks/get` requests from requestors that would otherwise not know if a task has silently been dropped or if it simply has not been created yet. Conversely, eventual consistency in `tasks/update` and `tasks/cancel` works because the client behavior is not contingent on the results of those operations (the client can continue to poll either way). While consistent task creation does increase latency costs in distributed systems that did not already behave this way, explicitly introducing this requirement simplifies client implementations and eliminates a source of undefined behavior.

This also aligns with long-running operation APIs in general, which typically require that once an operation is acknowledged, it must be findable via the polling endpoint.

### Ack-only Cancellation

In the `2025-11-25` design of tasks, `tasks/cancel` returned a task describing the task's state immediately after the cancellation attempt. That return shape implies a synchronous read — the server must consult task state to populate it — but cancellation is inherently asynchronous in many applications (a separate worker decides whether and when to honor it), so the returned task object would in many cases simply repeat what the next `tasks/get` would show. Reducing `tasks/cancel` to an ack matches the operation's actual semantics: The request is a signal, not a state query. Clients that want to know the post-cancel status do so via `tasks/get` on the same code path they use for all other state observation.

The eventual-consistency on the ack is the same separation as for `tasks/update`: The server may record the cancellation request and respond before the worker has actually transitioned the task, without allowing the client to interpret the ack as strongly-consistent.

While `tasks/update` and `tasks/cancel` use ack-only response shapes for the reasons above, servers **SHOULD** still return errors for clearly invalid requests — such as an unknown `taskId`. The ack-only design is about avoiding synchronous reads of task state in the success path, not about suppressing errors that the server can detect at request time. Returning errors for invalid inputs gives clients a faster signal that something is wrong, rather than forcing them to discover the problem indirectly through subsequent `tasks/get` polls.

### Composition with Multi Round-Trip Requests

The following new requirement is introduced:

> Server implementations that use multi round-trip requests in conjunction with task creation (for example, a tool that requires elicitation over `InputRequiredResult` before creating a task) **SHOULD** resolve all MRTR exchanges _synchronously_ before responding with a `CreateTaskResult`.

A `tools/call` that supports both MRTR ([SEP-2322](https://modelcontextprotocol.io/seps/2322-MRTR)) and this extension may use them sequentially by sending one or more `InputRequiredResult` exchanges to gather input synchronously, followed by a `CreateTaskResult` to hand off to asynchronous execution. This composition is a consequence of the `resultType` discriminator — each response is independently typed and the client switches behavior based on the value it receives, _without_ maintaining any state between the two modes. Prohibiting this would require imposing an artificial constraint with no protocol-level mechanism to enforce it, since the client is unaware that the server will create a task ahead of time.

The two flows maintain separate state despite sharing field names. The MRTR phase ends when the server returns any non-`"input_required"` `resultType`, at which point its `inputRequests` keys are consumed. The task phase begins with `CreateTaskResult` and maintains _its own_ `inputRequests` keys independently. Key uniqueness for task `inputRequests` is scoped to the lifetime of the task and does not extend to keys from the preceding MRTR phase. Clients do not need to deduplicate across the two flows.

## Backward Compatibility

The experimental tasks feature in the `2025-11-25` release is **not wire-compatible** with this extension. Implementations that need to interoperate with both surfaces can shim at the SDK level by implementing the experimental and extension flows in parallel and dispatching on the negotiated protocol version and the client capability the peer declared. The following table summarizes the expected behavior for each permutation:

| Protocol Version | `tasks.*` (legacy)                                                                                                                                                                                                                                                                                                                                                                                               | `io.modelcontextprotocol/tasks`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2025-11-25`      | Legacy experimental tasks per the `2025-11-25` specification. The client opts into task augmentation per request via the `task` parameter on `CallToolRequest`; the server uses `tasks/result`, `tasks/get`, `tasks/cancel`, and (where supported) `tasks/list` per that specification. This extension does not apply.                                                                                       | This extension is not defined under the `2025-11-25` protocol version. Servers **MUST NOT** treat this capability as enabling tasks under that protocol version; requests proceed as if the client had declared no task capability at all.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `2026-06-30`      | The legacy capability is not part of this extension. Servers **MUST** treat clients declaring only the legacy capability as non-declaring with respect to this extension. Servers that simultaneously support the `2025-11-25` Tasks specification alongside this extension **SHOULD** continue to permit `tasks/get` and `tasks/cancel` requests from such clients to operate on tasks created under that flow. | The canonical case. Full task lifecycle as specified in this document, with the following wire-level differences from the `2025-11-25` experimental feature: <br> - `tasks/result` is removed; clients calling it **MUST** receive `-32601` (Method Not Found). <br> - The `task` parameter on `CallToolRequest` is removed; servers **MUST** ignore it (treat the field as unknown) rather than using it as an opt-in. <br> - The `tasks.requests.*`, `tasks.cancel`, and `tasks.list` capability declarations are not part of this extension. Servers that previously advertised these **MUST** migrate to declaring `io.modelcontextprotocol/tasks`, and **MUST NOT** continue to advertise the legacy capabilities under any protocol version that includes this extension. |

A server that returns the standard `CallToolResult` shape — i.e., never elects to create a task — remains fully spec-compliant under this extension. Clients that have negotiated the extension **MUST** handle both result shapes for any augmented request.

## Security Implications

- **Task ID unguessability.** A server **MAY** use task IDs as bearer tokens for a server's stored state. Servers **MUST** generate them with sufficient entropy that a third party cannot enumerate or guess them.
- **Auth binding.** Servers **MUST** perform authentication and authorization checks on each task-related request to ensure that the client has permission to access a task.
- **Cross-caller correlation.** Because there is no `tasks/list`, a server cannot inadvertently leak the existence of one caller's tasks to another. This is an improvement over the `2025-11-25` tasks specification, in which a poorly-scoped list could expose unrelated task IDs.
- **Input-request trust model.** `inputRequests` carry elicitation and sampling payloads from the server through the client to the user or model. Hosts **MUST** apply the same trust model to these payloads as they would to standard elicitation/sampling requests. A task is not a higher-trust channel.

## Reference Implementation

Implemented in [mcpkit](https://github.com/panyam/mcpkit/blob/02cfbe0d2cada8167b9043b9130804c8638b0aa5/core/task_v2.go) (see [usage example](https://github.com/panyam/mcpkit/tree/02cfbe0d2cada8167b9043b9130804c8638b0aa5/examples/tasks-v2)).
