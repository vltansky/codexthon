# Rank face covers and people by perceived sharpness

- Date: 2026-07-24
- Owners: @vltansky
- Related: `base44/functions/face-index/sharpness.ts`, `base44/functions/face-index/indexer.ts`, `base44/functions/participant-photos/people-order.ts`, `app/face-index/imaging.ts`

## Context

Group covers were picked by detection confidence, which measures how face-like a region is, not how good it looks: large motion-blurred faces routinely beat sharp ones. The people grid also mixed obviously blurry covers among sharp ones with no quality signal at all.

Two sharpness metrics failed against real event photos before one worked. Variance of Laplacian on a point-sampled 112px resample tracks face size instead of blur: upsampling smooths the edges of small sharp faces while point-sampled downsampling aliases sensor noise in large defocused faces into fake detail. Measuring at native crop resolution inverts the bias: per-pixel edge density favors small noisy crops, and a soft mid-size face outscored a tack-sharp close-up.

## Decision

Sharpness is the variance of the 4-neighbor Laplacian over the face box resampled to a fixed 112x112 where each output pixel is the area average of its source region. The fixed output scale matches how covers render (small tiles), so the score tracks perceived sharpness: defocused faces average smooth, tiny faces upscale soft, crisp faces keep their edges. The metric lives twice by design — browser ingest and server backfill — per the shared-contracts ADR.

The score is stored per face and used in two places:

- **Covers:** the cover face maximizes detection score weighted by sharpness relative to the sharpest cluster member, falling back to detection score alone for faces without sharpness.
- **People ordering:** the participant grid orders claimed groups first, then cover sharpness descending, then photo count. Clusters whose centroid cosine similarity is at least 0.4 — below the 0.5 merge threshold but plausibly the same person — are placed adjacent so a participant can claim both.

Cluster centroids are embedding-derived biometric data and never leave the server; the people response shape is unchanged.

## Alternatives Considered

- Detection score alone: rejected; it selected blurry covers, the original defect.
- Native-resolution variance: rejected after measurement; noise and per-pixel edge density outweigh optical blur across face sizes.
- Point-sampled fixed-scale variance: rejected after measurement; interpolation artifacts make the score track face size.
- Face-box area heuristics: rejected; the worst offenders were the largest faces.

## Consequences

- Scores are comparable across face sizes and match what a viewer sees in a tile.
- Changing the metric requires remeasuring stored faces; see the in-place refresh ADR.
- Small background faces rank last by construction, which is the desired grid order.
