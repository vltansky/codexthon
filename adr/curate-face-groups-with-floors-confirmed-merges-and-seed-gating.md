# Curate face groups with floors, confirmed merges, and seed gating

- Date: 2026-07-24
- Owners: @vltansky
- Related: `base44/functions/face-index/indexer.ts`, `base44/functions/participant-photos/service.ts`, `app/AdminFacesPage.tsx`

## Context

Face indexing of a full event album produced 1265 faces in 440 groups for roughly 120 attendees. Measurement against the production embeddings showed the surplus is not a clustering failure: groups with three or more faces numbered 112–113, matching attendance almost exactly, and no photo contained the same group twice. The surplus consists of single-face groups from tiny background faces (median face height 5.3% of the frame, versus 8.9% in real groups) plus a small number of pose-split fragments. Simulated centroid merging at cosine 0.55 healed only 31 pairs, so merging alone cannot fix the count; two of those pairs joined well-established groups where a wrong merge would silently move a stranger's photos into someone's claimed group and Drive export.

## Decision

Face-group curation happens in three layers:

1. **Presentation floor.** The participant People grid hides single-face groups, except groups the viewer has claimed. The admin Faces page continues to show everything.
2. **Admin-confirmed merges.** The server proposes duplicate pairs (cluster-centroid cosine ≥ 0.55, never pairs that co-occur in a photo, since one person cannot appear twice in a frame) and an admin confirms each merge visually. Merging rewrites face assignments, recomputes the surviving group, and migrates claims across Participant, Mentor, and Judge records. Merges are not offered or applied automatically.
3. **Join-not-seed ingest gating.** Faces below 6% of frame height may still match into existing groups (so "you're in this photo" keeps working for wide shots) but can no longer create new groups; unmatched tiny faces are stored under a `noise_` key that never becomes a FaceCluster and is excluded from the future match pool.

## Alternatives Considered

- Automatic merging at a similarity threshold: rejected because a false merge contaminates claimed groups irreversibly, and only two high-stakes pairs existed — human confirmation costs minutes.
- Hard-dropping small faces at detection: rejected because it also removes genuine matches in wide crowd shots, trading recall for cosmetics.
- Lowering the assignment threshold to merge more aggressively: rejected because the measured error rate of the current threshold is zero and looser thresholds risk cross-person merges.
- Re-indexing at higher thumbnail resolution: deferred; it improves small-face embeddings but requires a reset that orphans existing claims mid-event.

## Consequences

- The participant grid reflects roughly the real number of people photographed; the raw index still contains every detection for auditability.
- Fragment healing requires occasional admin attention on the Faces page.
- Noise-keyed faces are invisible everywhere and permanently excluded from matching; converting them into usable data requires re-indexing at higher resolution after the event.
