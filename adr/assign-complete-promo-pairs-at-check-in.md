# Assign complete promo pairs at check-in

- Date: 2026-07-23
- Owners: @vltansky
- Related: `src/promo-inventory.ts`, `base44/functions/check-in-participants/`

## Context

Each eligible participant receives one Codex credit and one API credit. Inventory can arrive in separate files and may therefore contain incomplete, blocked, assigned, or available records. Credits are credentials and should not be consumed by inactive or absent participants.

## Decision

We will model a participant allocation as one promo record containing a complete Codex-and-API pair.

Only complete, unassigned, and unblocked records are available for automatic assignment. The first successful check-in assigns one pair to the participant. Repeat check-ins and roster imports preserve that assignment; check-out does not return it to inventory. Participants cannot see promo values before check-in.

Admins may explicitly assign, reassign, block, or unblock inventory. Incomplete records remain visible for reconciliation but are excluded from automatic assignment.

## Alternatives Considered

- Assign Codex and API credits independently: rejected because a participant could receive only half of the promised allocation.
- Assign credits during roster import: rejected because imports include people who may not attend.
- Release a pair on check-out: rejected because a revealed credential cannot be assumed unused or safely reassigned.

## Consequences

- Positive: event-day assignment is idempotent and tied to attendance.
- Positive: incomplete or intentionally blocked inventory cannot be consumed accidentally.
- Negative: check-in fails when no complete pair is available.
- Negative: inventory reconciliation must pair separately imported allocations before they become assignable.
