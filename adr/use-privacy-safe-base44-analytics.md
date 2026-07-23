# Use privacy-safe Base44 analytics

- Date: 2026-07-23
- Owners: @vltansky
- Related: `src/participant-analytics.ts`, `app/participantAnalytics.ts`

## Context

Operators need aggregate evidence about portal visits and key promo, agent-setup, Wi-Fi, photo-selection, and folder-export interactions. PostHog and Google Analytics were considered, but the Base44 SDK already provides custom events without adding another client, account, or data processor.

Participant analytics can easily become a second activity log containing identity, credentials, photo IDs, URLs, or raw errors. That is unnecessary for the operational questions this project needs to answer.

## Decision

We will send a small aggregate event taxonomy through `base44.analytics.track()`:

- `participant_page_viewed`
- `participant_action_completed`
- `participant_action_failed`

Properties are limited to approved coarse dimensions such as page, access mode, area, action, target category, gallery view, page number, selected count, and safe error category. Events must not contain names, emails, participant or photo IDs, personal keys, promo values, folder URLs, URL fragments, or raw errors.

An external redemption link click is recorded as `apply_clicked`, not as a successful redemption. Success events are emitted only after the local operation completes, such as a clipboard write, saved selection, or Drive-folder export. Preview activity is excluded and duplicate SPA page events are suppressed.

## Alternatives Considered

- PostHog: deferred until the project needs longer retention, funnels, cohorts, session replay, or participant-level histories.
- Google Analytics: rejected for now because it adds configuration and a marketing-oriented reporting surface without improving the event-day taxonomy.
- Store per-participant activity entities: rejected because aggregate product evidence does not justify another identity-linked log.

## Consequences

- Positive: analytics use the existing platform and a deliberately small privacy boundary.
- Positive: event meaning distinguishes an attempted external action from a verified local success.
- Negative: Base44 plan retention and dashboard capabilities constrain historical analysis.
- Negative: the system cannot answer participant-level behavioral questions by design.
