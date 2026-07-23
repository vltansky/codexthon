# Refresh face-derived data in place instead of reindexing

- Date: 2026-07-24
- Owners: @vltansky
- Related: `base44/functions/face-index/indexer.ts`, `app/AdminFacesPage.tsx`

## Context

Cluster keys are generated randomly per indexing run, and participant, mentor, and judge claims reference them. Resetting and reindexing a live event therefore silently orphans every claim and the Drive exports built on them. At the same time, data derived from stored faces — sharpness, cover picks, centroids — evolves after launch and must be recomputable.

A first recompute implementation processed the whole album in one request and was killed by the platform request timeout: thumbnail fetch plus pure-JS jpeg decode costs roughly a second per photo, and Base44 functions only log completed executions, so the failure surfaced as a silently spinning button.

## Decision

Derived face data is refreshed in place by an admin `recompute` action that never changes cluster keys. Each call processes a small batch (10 photos) and returns progress; the caller loops until the server reports done, at which point covers and centroids are re-picked for every cluster with writes in small parallel batches. A `force` flag with a photo-id cursor remeasures records that were already stamped, which is how metric changes reach existing data.

Photos whose thumbnails cannot be fetched or decoded are stamped with zero sharpness and counted, so the loop always terminates and a broken thumbnail cannot wedge the refresh.

Full reset plus reindex remains available but is a pre-launch tool; once claims exist it is a last resort.

## Alternatives Considered

- Reset and reindex to pick up new derived fields: rejected; it orphans claims mid-event.
- One-shot server job: rejected; it exceeds the platform request window and fails invisibly.
- Skipping failed photos without stamping: rejected; the client loop would retry them forever.

## Consequences

- Admin maintenance actions on this platform are designed as batched, cursor-driven loops with client-side progress.
- Cluster keys function as stable identities; any future feature that stores them can rely on refreshes preserving them.
- A forced refresh re-reads every Drive thumbnail (~1s per photo), which is minutes of admin-visible progress, not a background job.
