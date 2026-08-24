> Source: https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices.md
> Spec revision: 2026-07-28
> Retrieved: 2026-08-11
> PART 3 of the Security Best Practices page: Mix-Up Attacks, Localhost Redirect URI Impersonation, CIMD Trust Policies, Scope Minimization
> (verbatim slice of the source page, lines 800-983 of the full capture).

---

# Security Best Practices — Mix-Up Attacks, Localhost Redirect URI Impersonation, CIMD Trust Policies, Scope Minimization

> Security considerations, attack vectors, and best practices for MCP implementations

### Mix-Up Attacks

#### Attack Description

An MCP client typically interacts with many authorization servers
over its lifetime. An attacker that controls one of those
authorization servers may attempt to have the client send it an
authorization code or token issued by a different, honest
authorization server (a mix-up attack, described in
[RFC9207 Section 1](https://datatracker.ietf.org/doc/html/rfc9207#section-1)).

#### Mitigation

[Authorization Response Validation](/specification/2026-07-28/basic/authorization#authorization-response-validation)
mitigates this by binding the response to the authorization server
the client recorded before redirecting, so the authorization code
cannot be redeemed at an unintended token endpoint. PKCE alone does
not prevent this attack because the client transmits the
`code_verifier` to the attacker's token endpoint. Resource indicators
do not help when the attacker's authorization server is intercepting
requests before they hit the honest authorization server. This
mitigation depends on honest authorization servers emitting `iss`; it
provides no protection against an honest server that does not.

### Localhost Redirect URI Impersonation

Native and locally-running MCP clients commonly use `localhost`
redirect URIs. When clients identify themselves with
[Client ID Metadata Documents](/specification/2026-07-28/basic/authorization/client-registration#client-id-metadata-documents),
the metadata document proves control of a domain, but it cannot prove
which local process is listening on a `localhost` redirect URI.

#### Attack Description

An attacker can claim to be any client by:

1. Providing the legitimate client's metadata URL as their `client_id`
2. Binding to any `localhost` port, and providing that address as
   the redirect\_uri
3. Receiving the authorization code via the redirect when the user
   approves

The server will see the legitimate client's metadata document and the
user will see the legitimate client's name, making attack detection
difficult.

#### Mitigation

See
[Localhost Redirect URI Risks](/specification/2026-07-28/basic/authorization/security-considerations#localhost-redirect-uri-risks)
in the authorization specification for the countermeasures expected
of authorization servers, including displaying additional warnings for
`localhost`-only redirect URIs and clearly displaying the redirect URI
hostname during authorization.

### CIMD Trust Policies

Authorization servers that accept
[Client ID Metadata Documents](/specification/2026-07-28/basic/authorization/client-registration#client-id-metadata-documents)
can apply domain-based trust policies to decide which URL-based
client IDs to accept:

* Allowlists for trusted domains (for protected servers)
* Accept any HTTPS `client_id` (for open servers)
* Reputation checks for unknown domains
* Restrictions based on domain age or certificate validation
* Display the CIMD and other associated client hostnames prominently
  to prevent phishing

Servers maintain full control over their access policies. See
[Trust Policies](/specification/2026-07-28/basic/authorization/security-considerations#trust-policies)
in the authorization specification, along with
[Section 6.4](https://www.ietf.org/archive/id/draft-ietf-oauth-client-id-metadata-document-00.html#section-6.4)
and
[Section 6.8](https://www.ietf.org/archive/id/draft-ietf-oauth-client-id-metadata-document-00.html#section-6.8)
of the Client ID Metadata Document specification, for more details.

### Scope Minimization

Poor scope design increases token compromise impact, elevates user
friction, and obscures audit trails.

#### Attack Description

An attacker obtains (via log leakage, memory scraping, or local
interception) an access token carrying broad scopes (`files:*`, `db:*`,
`admin:*`) that were granted up front because the MCP server exposed
every scope in `scopes_supported` and the client requested them all.
The token enables lateral data access, privilege chaining, and difficult
revocation without re-consenting the entire surface.

#### Risks

* Expanded blast radius: stolen broad token enables unrelated
  tool/resource access
* Higher friction on revocation: revoking a max-privilege token disrupts
  all workflows
* Audit noise: single omnibus scope masks user intent per operation
* Privilege chaining: attacker can immediately invoke high-risk tools
  without further elevation prompts
* Consent abandonment: users decline dialogs listing excessive scopes
* Scope inflation blindness: lack of metrics makes over-broad requests
  normalised

#### Mitigation

Implement a progressive, least-privilege scope model:

* Minimal initial scope set (e.g., `mcp:tools-basic`) containing only
  low-risk discovery/read operations
* Incremental elevation via targeted `WWW-Authenticate` `scope="..."`
  challenges when privileged operations are first attempted
* Down-scoping tolerance: server should accept reduced scope tokens;
  auth server MAY issue a subset of requested scopes

Server guidance:

* Emit precise scope challenges; avoid returning the full catalog
* Log elevation events (scope requested, granted subset) with
  correlation IDs

Servers have flexibility in determining which scopes to include:

* **Minimum approach**: Include only the scopes required for the
  specific operation that triggered the error.
* **Recommended approach**: Include the scopes required for the
  current operation along with related scopes that commonly work
  together, to reduce the number of step-up authorization rounds.
* **Extended approach**: Include the scopes required for the
  current operation, related scopes, and any other scopes the
  server anticipates the client may need in the near future.

The choice depends on the server's assessment of user experience impact and authorization friction.

Client guidance:

* Begin with only baseline scopes (or those specified by initial
  `WWW-Authenticate`)
* Cache recent failures to avoid repeated elevation loops for denied
  scopes

When the initial `WWW-Authenticate` challenge carries no `scope`
parameter, the
[Scope Selection Strategy](/specification/2026-07-28/basic/authorization#scope-selection-strategy)
directs clients to fall back to requesting all scopes listed in
`scopes_supported`. This approach accommodates the general-purpose
nature of MCP clients, which typically lack domain-specific knowledge
to make informed decisions about individual scope selection.
Requesting all available scopes allows the authorization server and
end-user to determine appropriate permissions during the consent
process, minimizing user friction while following the principle of
least privilege.

Scope accumulation across operations is a client-side responsibility. Clients
  **SHOULD** compute the union of previously requested scopes and newly
  challenged scopes when initiating re-authorization, as described in [Step-Up
  Authorization
  Flow](/specification/2026-07-28/basic/authorization#step-up-authorization-flow).
  This allows servers to remain stateless with respect to client scope sets
  while ensuring clients do not lose previously granted permissions.

**Hierarchical scopes**: Some authorization servers define scope hierarchies
  where a broader scope implies narrower ones (for example, an `admin` scope
  that subsumes `read`). When accumulating scopes, the client's union may
  contain semantically redundant entries. For example, a token previously
  granted a broad scope may be challenged with a narrower one it already
  implies. Clients need not deduplicate hierarchically; authorization servers
  typically normalize such redundancy during token issuance. Servers, for their
  part, must account for hierarchy when deciding whether a token is sufficient
  for an operation, but this does not affect the scopes they emit in a
  challenge.

#### Common Mistakes

* Publishing all possible scopes in `scopes_supported`
* Using wildcard or omnibus scopes (`*`, `all`, `full-access`)
* Bundling unrelated privileges to preempt future prompts
* Returning entire scope catalog in every challenge
* Silent scope semantic changes without versioning
* Treating claimed scopes in token as sufficient without server-side
  authorization logic

Proper minimization constrains compromise impact, improves audit
clarity, and reduces consent churn.
