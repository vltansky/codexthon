# Architecture Decision Records

This directory stores durable decisions that shape Codexthon across features, deployments, or contributor workflows.

## When an ADR is required

Create an ADR for a decision that is cross-cutting, security-sensitive, expensive to reverse, or likely to be misunderstood after the original discussion disappears.

An ADR is not required for:

- session notes, task plans, or temporary exploration
- event-specific operations, counts, or deployment status
- small bug fixes, local refactors, and replaceable implementation details

## Naming

- Use lowercase, dash-separated filenames.
- Use a present-tense imperative verb phrase.
- Do not use numeric prefixes; the slug is the identifier.
- Do not add a `Status` field. Merge is approval.

## Minimum structure

Each ADR includes a date plus Context, Decision, and Consequences. Add alternatives, implementation notes, or links only when they preserve useful rationale.

## Superseding a decision

Merged ADRs are immutable. When a decision changes, add a new ADR, link the earlier ADR, and state that the new record supersedes it.

## Current decisions

- [Adopt ADRs for repo-level decisions](./adopt-adrs-for-repo-level-decisions.md)
- [Adopt Base44 as the application platform](./adopt-base44-as-the-application-platform.md)
- [Keep sensitive event data out of source control](./keep-sensitive-event-data-out-of-source-control.md)
- [Support Google authentication and signed personal links](./support-google-authentication-and-signed-personal-links.md)
- [Separate admin and participant MCP surfaces](./separate-admin-and-participant-mcp-surfaces.md)
- [Reconcile imported rosters with stable participant identities](./reconcile-imported-rosters-with-stable-participant-identities.md)
- [Assign complete promo pairs at check-in](./assign-complete-promo-pairs-at-check-in.md)
- [Model judging with exclusive panel assignments](./model-judging-with-exclusive-panel-assignments.md)
- [Keep shared contracts inside Base44 function bundles](./keep-shared-contracts-inside-base44-function-bundles.md)
- [Use privacy-safe Base44 analytics](./use-privacy-safe-base44-analytics.md)
- [Use operator-owned Google connectors](./use-operator-owned-google-connectors.md)
- [Preserve event content across operational resets](./preserve-event-content-across-operational-resets.md)
- [Prefer one deployment per host over multi-tenancy](./prefer-one-deployment-per-host-over-multi-tenancy.md)
- [Group photos by unnamed face clusters with personal claims](./group-photos-by-unnamed-face-clusters-with-personal-claims.md)
- [Run face inference in the admin browser](./run-face-inference-in-the-admin-browser.md)
- [Curate face groups with floors, confirmed merges, and seed gating](./curate-face-groups-with-floors-confirmed-merges-and-seed-gating.md)
- [Rank face covers and people by perceived sharpness](./rank-face-covers-and-people-by-perceived-sharpness.md)
- [Refresh face-derived data in place instead of reindexing](./refresh-face-derived-data-in-place-instead-of-reindexing.md)
- [Restore photo scroll depth from the URL](./restore-photo-scroll-depth-from-the-url.md)
