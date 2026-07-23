# Adopt Base44 as the application platform

- Date: 2026-07-23
- Owners: @vltansky
- Related: `base44/config.jsonc`, `package.json`, `README.md`

## Context

The project began with a Cloudflare Worker and D1 proof of concept, then grew into a Base44 application with entities, backend functions, authentication, connectors, analytics, and site hosting. Maintaining both deployment models created duplicate infrastructure and made "self-hosting" ambiguous.

## Decision

We will keep the current Codexthon implementation and direct deployment path on Base44.

For this project, self-hosting means creating a separate Base44 app in the operator's account. Each installation owns its Base44 data, secrets, connector authorizations, and deployed site. The repository does not provide a standalone Worker, database, or mail deployment.

Another hosting platform is a migration target, not an interchangeable deployment target. Such a migration must replace the Base44 data, authentication, function, connector, analytics, and hosting boundaries and should supersede this ADR if it becomes the primary implementation.

## Alternatives Considered

- Maintain the Cloudflare Worker and D1 deployment in parallel: rejected because it duplicated the backend and no longer represented the full application.
- Provide a platform-neutral standalone server: deferred because it would require replacing Base44 entities, authentication, functions, connectors, analytics, and hosting.
- Migrate to ChatGPT Sites: viable as a deliberate migration, but not deployable from the current source without replacing Base44-dependent services.

## Consequences

- Positive: one platform owns the complete application lifecycle and authorization model.
- Positive: installations are isolated by Base44 app and connected accounts.
- Negative: the project depends on the Base44 SDK, CLI, runtime, and hosting model.
- Negative: "self-hosted" does not currently mean deployable to arbitrary infrastructure.
- Follow-up: use `npx base44 link`, Base44 Secrets, connector authorization, and `base44 deploy` for installations.
