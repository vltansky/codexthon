# Group photos by unnamed face clusters with personal claims

- Date: 2026-07-24
- Owners: @vltansky
- Related: `base44/functions/participant-photos/service.ts`, `base44/entities/face-cluster.jsonc`, `base44/entities/photo-face-index.jsonc`, `adr/run-face-inference-in-the-admin-browser.md`, `adr/curate-face-groups-with-floors-confirmed-merges-and-seed-gating.md`

## Context

Event photos live in one shared Drive folder that every participant can already browse, so face features change discoverability, not access. Research across the event-photo product space showed the dominant pattern is selfie search (guest uploads a selfie, gets a private gallery), while personal photo libraries (Google Photos, immich, ente) use browsable face groups. We wanted proactive discovery: people scroll a People grid, recognize themselves, and their photos collect themselves — no upload step.

## Decision

Photos are grouped into unnamed face clusters that anyone with portal access can browse; tapping a face shows every photo of that person.

- **Claims are personal and non-exclusive.** "This is me" stores the cluster key on the viewer's own record. Two people may claim the same cluster; nobody is ever unassigned by someone else's claim. Multi-claim handles pose-split fragments, and unclaiming is always available.
- **One photo-owner model.** Participants, mentors, and judges are interchangeable photo owners, resolved token-first then by authenticated email; selections, claims, and Drive-folder ids persist on the owner's own entity.
- **"My photos" is a union.** Manual selections and face-matched photos combine; manual selection stays an independent gesture, matched photos carry a "you" badge, and the Drive-folder export mirrors the union.
- **Cluster keys are stable and assignment is incremental.** New faces join existing clusters; a full re-cluster never runs once claims exist, because claims reference cluster keys. Admin-confirmed merges migrate claims to the surviving key.
- **No face imagery is stored.** The index keeps embeddings, boxes, and scores; group covers render client-side as CSS crops over the Drive thumbnails already served by the gallery.

## Alternatives Considered

- Selfie search (industry standard for events): rejected as the primary surface because it adds an upload step and hides the browsable People grid; it may still be layered on later as a shortcut for finding one's own group.
- Exclusive claim/naming with conflict resolution: rejected because contested claims need moderation and a wrong assignment harms the previous owner; non-exclusive claims make conflicts structurally impossible.
- Auto-attaching photos by matching profile pictures: rejected because attendees have no reliable reference imagery and mistakes would silently pollute "my photos" and exports.

## Consequences

- Anyone with portal access can enumerate all photos of one person; acceptable here because the full gallery is already shared, and the face index is event-scoped data that should be deleted when the event ends.
- A participant who claims a fragment later benefits from admin merges automatically; claims follow the surviving cluster.
- Converting noise detections into usable groups requires re-indexing, which resets cluster keys and therefore claims — deliberately deferred until after the event.
