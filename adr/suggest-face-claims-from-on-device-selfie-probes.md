# Suggest face claims from on-device selfie probes

- Date: 2026-07-24
- Owners: @vltansky
- Related: `adr/group-photos-by-unnamed-face-clusters-with-personal-claims.md`, `adr/run-face-inference-in-the-admin-browser.md`, `base44/functions/participant-photos/selfie-match.ts`, `app/SelfieFinder.tsx`

## Context

The People tab groups event photos by unnamed face clusters and lets participants claim the groups that are them. Finding yourself requires scanning the whole grid, and single-face groups are hidden from it entirely, so a participant whose only appearance is a singleton has no way to discover or claim it. An earlier decision rejected selfie upload as the primary discovery model in favor of zero-friction proactive browsing.

## Decision

We will add a selfie probe as an optional shortcut that suggests clusters to claim, without changing browse-first discovery.

The selfie is embedded in the participant's browser with the same models the admin indexing flow uses; the image never leaves the device, and only the largest face's embedding is sent. The `participant-photos` function matches the probe against per-face index embeddings (best member face per cluster, with a strong and a weak threshold) and returns ranked suggestion cards, including otherwise hidden singletons. Nothing is claimed automatically, probes are never persisted, and stored embeddings and centroids never leave the server.

## Alternatives Considered

- Selfie probe as the primary discovery flow: rejected earlier and still rejected; browsing stays the default, the probe only accelerates claiming.
- Shipping cluster centroids to the client and matching locally: rejected because it hands biometric derivatives of other attendees to every participant.
- Matching the probe against cluster centroids instead of member faces: rejected because a front-camera selfie is a cross-domain probe, and one selfie-like member shot matches better than a pose-averaged centroid.
- Auto-claiming strong matches: rejected because claims are personal, non-exclusive, and cheap to confirm by hand; a false auto-claim silently pollutes "My photos" and the Drive export.

## Consequences

- Positive: participants can find their groups, including hidden singletons, from one selfie without any biometric data leaving their device.
- Positive: the server keeps its existing invariant that embeddings and centroids stay server-side.
- Negative: the first probe downloads roughly 25 MB of models and wasm in the participant's browser, so the finder loads them lazily on demand.
- Negative: an authenticated participant can probe the matcher with arbitrary embeddings; accepted for a single-event deployment where every caller is an attendee with gallery access.
- Follow-up: the strong and weak thresholds are untuned constants; calibrate them against real event fixtures.

## Links

- `~/.vs/luma-promo-dispenser/specs/2026-07-24-selfie-find-me-design.md` (session design, not part of the repository)
