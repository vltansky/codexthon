# Keep shared contracts inside Base44 function bundles

- Date: 2026-07-23
- Owners: @vltansky
- Related: `base44/functions/`, `src/function-access-compatibility.test.ts`

## Context

Base44 deploys each backend function from its own directory. Function code cannot rely on application-side `src/` modules or sibling function directories being included in its deployment bundle. Several endpoints must nevertheless agree on signed-token, portal-response, quick-link, and CSV contracts.

## Decision

We will keep deployment-critical modules inside every Base44 function bundle that needs them, even when that creates deliberate source duplication.

Compatibility tests will compare duplicated modules or exercise them against the same fixtures. A change to a shared contract must update every participating bundle in the same change.

Application-only shared logic may remain in `src/`; it is not a source for runtime imports from Base44 functions.

## Alternatives Considered

- Import shared runtime code directly from `src/`: rejected because it is outside the function bundle boundary.
- Import across sibling function directories: rejected because it couples independently deployed archives.
- Publish a shared package: deferred because the current contracts are small and package publication would add release coordination.

## Consequences

- Positive: every deployed function is self-contained and predictable.
- Positive: compatibility tests make intentional duplication visible.
- Negative: contract changes require synchronized edits in several directories.
- Negative: ordinary deduplication tools may incorrectly flag these copies as removable.
