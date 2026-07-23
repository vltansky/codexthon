# Reconcile imported rosters with stable participant identities

- Date: 2026-07-23
- Owners: @vltansky
- Related: `src/csv.ts`, `src/participant-reconciliation.ts`

## Context

Event rosters arrive as Luma exports or enriched CSV files and are imported repeatedly as teams and attendance evolve. Replacing the participant collection on every import would invalidate personal links, erase check-in and delivery state, and risk exposing unrelated unassigned attendees as teammates.

## Decision

We will treat normalized email as the reconciliation key for roster imports.

Raw Luma imports admit approved guests only. Explicit team and mentor fields are preserved; unmatched people receive participant-specific placeholder team keys instead of sharing a common team. Existing participants retain their access key, access version, expiry, check-in state, and delivery state. New participants receive a fresh access identity.

Participants omitted from a later import are soft-deactivated and their personal access is disabled, except for explicit manual exceptions. Importing a roster does not implicitly send email or overwrite check-in state.

## Alternatives Considered

- Delete and recreate the roster on every import: rejected because participant identity and operational history must survive repeat imports.
- Group all unmatched participants into one placeholder team: rejected because the participant portal would reveal unrelated attendee details.
- Use free-text teammate answers as access-control team keys: rejected because spelling, order, and Unicode differences can split or merge teams incorrectly.
- Perform a live Luma API sync: deferred; the current product boundary is file-based import.

## Consequences

- Positive: repeat imports are safe for issued links and event-day state.
- Positive: unassigned participants remain isolated until an organizer assigns a real team.
- Negative: email corrections require coordinated movement of dependent records and access rotation.
- Negative: removed participants remain stored for audit and recovery instead of being deleted.
