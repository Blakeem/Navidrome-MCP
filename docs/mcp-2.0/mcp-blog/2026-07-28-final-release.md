# The 2026-07-28 Specification

- **Source:** https://blog.modelcontextprotocol.io/posts/2026-07-28/
- **Kind:** Official MCP blog post — final release announcement for spec revision `2026-07-28`
- **Byline / date:** July 28, 2026 · 12 min · David Soria Parra (Lead Maintainer), Den Delimarsky (Lead Maintainer)
- **Version covered:** MCP protocol revision `2026-07-28` (vs. prior handshake-based `2025-11-25`)
- **Retrieved:** 2026-08-11
- **Capture note:** the closing "Ecosystem support" section (partner/customer marketing quotes from AWS, Cloudflare, Figma, Google Cloud, Honeycomb, Manufact, Microsoft, Netlify, Runlayer, Salt Security, Supabase, Anthropic, etc.) was omitted as marketing content carrying no migration detail, per the doc-gathering brief. Everything else on the page is captured verbatim below.

---

Since our [last November release](/posts/2025-11-25-first-mcp-anniversary/) MCP continued to grow at an astonishing rate. Across our Tier 1 SDKs, we’re seeing close to half-a-billion downloads a month, with both TypeScript and Python SDKs crossing the 1 billion total downloads threshold. In just a few months, the protocol continued to grow as the data and interactivity substrate for agentic workflows.

Today, we’re officially pushing the release button on the next version of the MCP specification, `2026-07-28`, along with the SDKs that will allow you to start building clients and servers right away.

The highlight of this release is a stateless protocol core - MCP is transforming from a bidirectional stateful protocol into a request/response stateless protocol. It was one of the most highly-requested features from developers who were eager to get better reliability and scalability for their MCP servers.

A short demo of the stateless protocol core in action.

There is, of course, more to what we’re introducing with this version:

-   Every request is self-describing, with an optional discovery call for clients that want capabilities up front, so any request can land on any instance behind a plain round-robin load balancer.
-   Method and tool names travel in the `Mcp-Method` and `Mcp-Name` HTTP headers, so gateways can route and authorize on headers directly.
-   Server-to-client requests for things like sampling and elicitation are being redesigned to use Multi Round-Trip Requests (MRTR), removing the need for constantly open bidirectional streams.
-   List responses carry cache hints and a deterministic order, so clients can cache tool catalogs and keep upstream prompt caches stable across reconnects.
-   Formally locking in on a proper extensions framework, with Tasks joining other extensions, such as MCP Apps and Enterprise Managed Authorization (EMA).
-   A set of authorization hardening changes including RFC 9207 issuer validation and a formal shift away from Dynamic Client Registration (DCR) toward client metadata documents (CIMD).
-   A formal deprecation policy with a twelve-month minimum window so you can plan upgrades instead of reacting to them.

The TypeScript, Python, Go, and C# SDKs are updated to match, with detailed migration notes for the breaking bits - and you can get started with the new spec right away.

## What changed[#](#what-changed)

### No handshake or sessions[#](#no-handshake-or-sessions)

With the new spec version, we’ve officially retired the `initialize`/`initialized` exchange along with the `Mcp-Session-Id` header (refer to [SEP-2575](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2575), [SEP-2567](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2567)). Each request now travels on its own, carrying its protocol version, client identity, and client capabilities in `_meta`. If a client wants to learn a server’s capabilities before doing anything else, there’s a new `server/discover` Remote Procedure Call (RPC) for that; however, it is not required. Any request can now land on any server instance behind a plain round-robin load balancer without needing shared storage.

```http
POST /mcp HTTP/1.1
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: search

{"jsonrpc":"2.0","id":1,"method":"tools/call",
 "params":{"name":"search","arguments":{"q":"otters"},
 "_meta":{"io.modelcontextprotocol/clientInfo":{"name":"my-app","version":"1.0"}}}}
```

Dropping the protocol-level session doesn’t force your application to be stateless. If your server needs to carry state across calls, mint an explicit handle from a tool and have the model pass it back as an argument. We found this works better than session state hidden in the transport - the model can see the handle and thread it between tools.

### Multi Round-Trip Requests (MRTR)[#](#multi-round-trip-requests-mrtr)

MRTR replaces the server-initiated `elicitation/create`, `sampling/createMessage`, and `roots/list` requests that previously required a held-open stream.

Sometimes a tool needs something from the user mid-call, such as a confirmation or a missing parameter. MRTR ([SEP-2322](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2322)) enables this scenario over a stateless protocol: the server returns `resultType: "input_required"` along with the requests it needs answered, and the client retries the original call with the answers attached in `inputResponses`.

### Header-based routing[#](#header-based-routing)

Streamable HTTP requests now must include `Mcp-Method` and `Mcp-Name` ([SEP-2243](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2243)). Your gateway, rate limiter, or WAF can route and meter on those headers instead of parsing JSON bodies.

### List results are cacheable[#](#list-results-are-cacheable)

Responses from `tools/list`, `prompts/list`, `resources/list`, and `resources/read` now carry `ttlMs` and `cacheScope` ([SEP-2549](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2549)). This allows clients to determine the best caching strategy for responses and reduce unnecessary re-fetching.

### Authorization[#](#authorization)

From our discussions with implementers for the past year, authorization is where implementers spend most of their integration time. With this spec revision, we continued evolving the MCP auth and security posture.

-   Authorization servers should return the `iss` parameter per [RFC 9207](https://www.rfc-editor.org/rfc/rfc9207), and clients must validate it before redeeming a code ([SEP-2468](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2468)). This closes an authorization-server mix-up hole.
-   Clients set `application_type` during Dynamic Client Registration (DCR) so authorization servers stop rejecting `localhost` redirects for desktop and CLI apps ([SEP-837](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/837)). If you’ve ever wondered why your CLI client’s OAuth flow got a `redirect_uri` error, this is likely why. And while we’re moving to Client ID Metadata Documents (CIMD) as the standard, this is a hardening measure making the protocol comply with OAuth spec requirements.
-   Client credentials are bound to the issuer that minted them. No reuse across authorization servers ([SEP-2352](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2352)).
-   Dynamic Client Registration itself is now formally deprecated in favor of CIMD. DCR continues to work for backward compatibility, but will be removed in a future version of the MCP spec.

### Tasks[#](#tasks)

Tasks move out of the experimental core and into the `io.modelcontextprotocol/tasks` extension, with a poll-based `tasks/get` and a new `tasks/update` ([SEP-2663](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2663)). Change notifications move from the old HTTP GET endpoint to a single `subscriptions/listen` stream that clients opt into per notification type.

### Deprecations[#](#deprecations)

Roots, Sampling, and Logging are deprecated ([SEP-2577](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2577)). They still work, and they’ll keep working for at least twelve months. New implementations shouldn’t adopt them. The legacy HTTP+SSE transport is also considered to be officially deprecated, with a year-long offramp.

## SDKs[#](#sdks)

All four Tier 1 SDKs speak `2026-07-28` as of today:

-   [TypeScript](https://github.com/modelcontextprotocol/typescript-sdk)
-   [Python](https://github.com/modelcontextprotocol/python-sdk)
-   [Go](https://github.com/modelcontextprotocol/go-sdk)
-   [C#](https://github.com/modelcontextprotocol/csharp-sdk)

Beyond the Tier 1 set, the [Rust SDK](https://github.com/modelcontextprotocol/rust-sdk) supports the new spec in beta.

The SDKs implement APIs that allow you to build both servers and clients with the new spec version. As we mentioned in the [SDK beta blog post](/posts/sdk-betas-2026-07-28/), there will be some migration cost, especially for developers that did depend on session identifiers; however, we incorporated early testing feedback that makes this process much easier.

## Getting started[#](#getting-started)

We’re excited to have developers build on the new spec. To get started, refer to the following resources:

-   [Specification](https://modelcontextprotocol.io/specification/2026-07-28)
-   [Full changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
-   [Documentation and guides](https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro)

## Thank you[#](#thank-you)

This release would not be possible without a massive community of contributors and industry partners. We’d like to acknowledge the dozens of key contributors across specification, documentation, SDKs, working and interest groups, as well as hundreds of independent worldwide communities who rallied support and excitement for MCP. We’re looking forward to continuing evolving the protocol as it grows!
