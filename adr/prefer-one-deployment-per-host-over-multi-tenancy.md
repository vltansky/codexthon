# Prefer one deployment per host over multi-tenancy

- Date: 2026-07-23
- Owners: @vltansky
- Related: `README.md`, `adr/adopt-base44-as-the-application-platform.md`

## Context

Codexthon was designed for one event operator and one active event context. Supporting many independent ambassadors in one shared application would require tenant identifiers on every entity, function-mediated authorization for every admin operation, per-event MCP tokens and connector settings, abuse controls, and exhaustive cross-tenant isolation tests.

The shared service would also make one maintainer the custodian of every host's attendee PII, promo credentials, sender identity, photo resources, and event-night uptime.

## Decision

We will distribute Codexthon as one isolated deployment per host instead of operating a shared multi-tenant service.

Each host owns their Base44 app, participant data, secrets, Google connectors, MCP tokens, and deployment lifecycle. Platform isolation supplies the "admin of my event, not yours" boundary without application-level tenancy.

The current repository does not support parallel events or multiple independent host organizations inside one deployment. Improve setup, configuration, diagnostics, reset-for-next-event behavior, and upgrade documentation before considering multi-tenancy.

## Alternatives Considered

- One shared multi-host Base44 app: rejected because Base44's platform roles do not express per-event administration, forcing every data access through a new authorization layer.
- Add `event_id` filters while retaining direct entity access: rejected because one missed filter could expose another host's roster or credentials.
- Build a managed multi-tenant product now: rejected because the operational and security burden is disproportionate to the current small, technical host audience.

## Consequences

- Positive: participant data and money-equivalent promo credentials are isolated by deployment.
- Positive: each host controls their sender, Drive resources, secrets, and uptime.
- Positive: the existing single-event data model and direct admin UI remain understandable.
- Negative: every host must complete their own setup and upgrades.
- Negative: one deployment cannot serve several independent hosts or simultaneous events.
- Follow-up: revisit a managed multi-tenant design only when there is demonstrated demand for zero-setup hosting or a deliberate decision to operate Codexthon as a service.
