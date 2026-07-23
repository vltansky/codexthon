# Preserve event content across operational resets

- Date: 2026-07-23
- Owners: @vltansky
- Related: `base44/entities/event-settings.jsonc`, `app/AdminContentPage.tsx`, `base44/functions/admin-mcp/server.ts`

## Context

Event name, venue, Wi-Fi, agenda, promo instructions, questions and answers, and optional partner details are managed at runtime so operators can change participant-facing content without a source deployment.

An early full-system reset deleted `EventSettings` together with roster and promo data. Restoring the content required reconstructing production state, while the operational reason for reset did not require removing the event shell.

## Decision

We will store participant-facing event content in `EventSettings` and preserve it across operational resets.

The admin UI and Admin MCP reset actions delete transient event-operation data: participants, teams, mentors, judges, judge groups, check-ins, promo inventory, and access-delivery history. They do not delete `EventSettings`.

Replacing event content is a separate explicit admin action. Reset descriptions and confirmation copy must state that content is preserved.

## Alternatives Considered

- Keep event content hard-coded in the frontend: rejected because event-day changes should not require a build and deployment.
- Delete content during every reset and reseed defaults: rejected because defaults can overwrite operator edits and may no longer match the event.
- Offer one reset that silently decides what to retain: rejected because destructive scope must be explicit.

## Consequences

- Positive: operators can clear operational state without rebuilding the event page.
- Positive: content editing and destructive data cleanup have separate authorization boundaries.
- Negative: a completely fresh installation requires an additional explicit content replacement or app recreation step.
- Follow-up: regression tests must verify that every reset path leaves `EventSettings` untouched.
