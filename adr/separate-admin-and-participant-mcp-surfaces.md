# Separate admin and participant MCP surfaces

- Date: 2026-07-23
- Owners: @vltansky
- Related: `base44/functions/admin-mcp/`, `base44/functions/portal-mcp/`, `mcp/admin-mcp-proxy.ts`

## Context

Agents are useful both to event operators and participants, but those roles have fundamentally different authority. Operators need roster mutations, imports, delivery, assignments, and reset operations. A participant should only be able to read their own event context.

## Decision

We will expose separate Admin MCP and participant MCP endpoints.

The Admin MCP uses a dedicated bearer token and a Base44 service-role client. It may expose read and write tools, but access keys and promo values are redacted from ordinary reads. Credential-returning and destructive actions must be explicit.

The participant MCP uses the same signed personal key as the participant portal. The backend resolves exactly one active participant from the key before creating the MCP server. Participant tools are read-only and identity-scoped; a key cannot select or inspect another participant.

Both surfaces send private no-cache and no-referrer headers.

## Alternatives Considered

- Use one MCP server with a role parameter: rejected because caller-supplied role selection would blur the authorization boundary.
- Give participants Base44 service credentials: rejected because the privilege is far broader than their needs.
- Expose only the Admin MCP: rejected because participants benefit from agent access to their own team, logistics, and credits.

## Consequences

- Positive: least privilege is enforced at endpoint construction, not only in tool descriptions.
- Positive: participant and operator tool catalogs can evolve independently.
- Negative: shared portal contracts must remain compatible across multiple function bundles.
- Follow-up: new participant tools must derive identity from the verified token and must not accept another participant identifier.
