# Support Google authentication and signed personal links

- Date: 2026-07-23
- Owners: @vltansky
- Related: `base44/auth/config.jsonc`, `src/access-session.ts`, `base44/functions/access-portal/`

## Context

Admins and registered Base44 users need conventional authentication, while event participants need low-friction access that does not require creating an account. Personal links expose participant-specific data and promo credentials, so they must be revocable, expiring, and protected from routine URL leakage.

## Decision

We will support two participant access modes:

- Base44 Google authentication for normal user and admin sessions.
- HMAC-signed personal links for participant access without an account.

A personal token contains an opaque participant access key, access version, and expiry. Backend functions verify the signature, expiry, participant activation, access enablement, and current version before returning data. Rotation increments the version and invalidates older tokens.

The browser receives the token in the URL fragment, moves it to `sessionStorage`, and removes the fragment from the visible URL. Personal links and the Admin MCP use separate secrets.

## Alternatives Considered

- Require every participant to create a Base44 account: rejected because it adds event-day friction.
- Put the token in the query string: rejected because query values are more likely to reach server logs, referrers, and copied URLs.
- Use a permanent unsigned participant identifier: rejected because it cannot provide integrity, expiry, or safe revocation.
- Add email/password authentication now: deferred; the current interface intentionally exposes Google login and signed links only.

## Consequences

- Positive: participants can open their page with one link while admins retain managed authentication.
- Positive: rotation, deactivation, and expiry bound the lifetime of a leaked link.
- Negative: anyone holding a valid personal link can act as that participant until it expires or is revoked.
- Follow-up: treat personal links as credentials and avoid putting them in source, screenshots, analytics, or reports.
