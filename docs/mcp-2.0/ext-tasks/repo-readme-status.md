> Source: https://github.com/modelcontextprotocol/ext-tasks/blob/main/README.md
> Spec revision: draft (extension identifier `io.modelcontextprotocol/tasks`); this
> file carries the repository's own status/maturity disclaimer for the extension —
> load-bearing for any decision to build on it.
> Retrieved: 2026-08-11

---

# MCP Tasks Extension (Experimental)
This repository is under development and is working towards implementing the changes described in [SEP-2663](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2663). For the latest status and discussion, see the pull request.

> **⚠️ Experimental Extension** — This repository contains an **experimental** extension to the [Model Context Protocol](https://modelcontextprotocol.io). It is **not** an official extension and may change significantly or be discontinued. See the [Extensions specification](https://modelcontextprotocol.io/seps/2133-extensions) for details on the experimental extension process.

## Overview

This extension defines the **Tasks** primitive for the Model Context Protocol (MCP). Tasks are durable state machines that carry information about the underlying execution state of a request, enabling requestor polling and deferred result retrieval. Each task is uniquely identifiable by a receiver-generated **task ID**.

Tasks are useful for:

- Representing expensive computations and batch processing requests
- Integrating seamlessly with external job/workflow APIs
- Enabling call-now, fetch-later execution patterns

**Extension Identifier:** `io.modelcontextprotocol/tasks`

## Development

### Schema Generation

The JSON Schema is auto-generated from the TypeScript type definitions using [ts-to-zod](https://github.com/fabien0102/ts-to-zod) and Zod's `toJSONSchema()`. Do not hand-edit `schema.json` or `generated/schema.ts`.

```bash
# Generate Zod schemas and JSON Schema from schema.ts
npm run generate:schemas

# Verify TypeScript compiles and generated files are up to date
npm run check:schema

```

## Governance

This repository follows the [Model Context Protocol Governance](https://modelcontextprotocol.io/community/governance) process. See [MAINTAINERS.md](MAINTAINERS.md) for the list of maintainers specific to this repository.

## Policies

This repository follows the Model Context Protocol project policies:

- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Contributing Guidelines](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)

## License

This project is licensed under the Apache License 2.0. See [LICENSE](https://github.com/modelcontextprotocol/ext-tasks/blob/main/LICENSE) for details.
