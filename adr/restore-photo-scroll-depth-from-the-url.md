# Restore photo scroll depth from the URL

- Date: 2026-07-24
- Owners: @vltansky
- Related: `src/photo-gallery.ts`, `app/ParticipantPhotosPage.tsx`, `app/navigation.ts`

## Context

The photo gallery replaced page-by-page navigation with infinite scroll, but a bare infinite scroll loses the user's place on refresh, back navigation, and shared links. Prior art converges on three separable mechanisms: an IntersectionObserver sentinel with an in-flight guard for loading, `history.replaceState` to mirror progress into the URL without polluting history, and restoration anchored to an item or page rather than a pixel offset (TanStack Query's canonical example, Vaadin's directory, Immich's `?at=<assetId>` param).

## Decision

The URL remains the source of truth for gallery depth. `?pages=N` records how many pages are loaded, updated via `replaceState` as the user scrolls; on load the gallery prefix-loads pages 1 through N (capped) and restores position. Legacy `?page=N` links map onto the same mechanism, so pre-existing deep links keep working. A session cache hydrates the already-loaded photos instantly on back navigation while the network refreshes them.

## Alternatives Considered

- Keep numbered pagination: rejected by product direction; browsing hundreds of photos page-by-page adds friction to selection.
- Immich-style `?at=<photoId>` anchor: more precise and immune to page-size changes, but breaks the existing `?page=` contract and needs id-to-position resolution; unnecessary at this scale.
- Virtualization with a scroll-state snapshot (react-virtuoso): pixel-exact but session-only, not shareable via URL, and overkill for hundreds of photos.
- Pixel-offset restoration: rejected; it breaks whenever viewport or layout changes.

## Consequences

- Refresh, back navigation, and shared links land at the same depth without backend changes; the server still serves offset pages.
- Prefix-loading grows linearly with depth, bounded by the page cap; deep positions cost several sequential fetches on cold load.
- The loaded-depth contract is coarse (page granularity, ~24 photos), which is acceptable for a selection gallery.
