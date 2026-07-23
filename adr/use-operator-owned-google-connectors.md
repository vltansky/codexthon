# Use operator-owned Google connectors

- Date: 2026-07-23
- Owners: @vltansky
- Related: `base44/connectors/`, `base44/functions/access-admin/`, `base44/functions/participant-photos/`

## Context

Participant and mentor invitations must reach arbitrary event addresses, including people who do not have Base44 accounts. Event photos already live in Google Drive and should remain under the event operator's control. Base44's app-user invitation and core email paths did not satisfy the personal-link delivery model.

## Decision

We will use app-scoped, operator-authorized Google connectors for email and photo workflows.

The Gmail connector uses the `gmail.send` scope and sends the branded participant and mentor messages from the connected account. The Google Drive connector reads the configured event folder tree and manages participant photo-pick folders in the connected account.

Connector access tokens stay inside Base44 backend functions. Each deployment authorizes its own Google account and configures its own event photo folder. The source repository contains connector definitions, not account identifiers, tokens, folder IDs, or participant folder links.

## Alternatives Considered

- Base44 app invitations or Core email: rejected for participant links because delivery was limited to registered app users and did not match the no-account access flow.
- Resend: removed from the primary path because Gmail already provides an operator-owned sender through the managed connector.
- Copy event photos into repository or application storage: rejected because Drive is the existing source of truth and operator-owned archive.

## Consequences

- Positive: invitations can reach participants without requiring Base44 registration.
- Positive: the event account retains ownership of sent mail and photo resources.
- Negative: an installation must complete Google OAuth before those optional features work.
- Negative: Drive participant folders shared to anyone with the link must be treated as sensitive.
- Follow-up: use a dedicated event account and the narrowest connector scopes that still support the workflow.
