# Run face inference in the admin browser

- Date: 2026-07-24
- Owners: @vltansky
- Related: `app/face-index/engine.ts`, `base44/functions/face-index/indexer.ts`, `adr/curate-face-groups-with-floors-confirmed-merges-and-seed-gating.md`

## Context

The photo people feature needs face detection and embedding for every event photo. The original design ran this inside a Base44 backend function: a local proof of concept confirmed the ONNX pipeline (SCRFD detection plus MobileFaceNet embeddings on the WASM execution provider) works under plain Deno at roughly 65ms per detection and 65ms per face.

The deployed function sandbox is stricter than plain Deno. A diagnostics probe from inside a deployed function showed dynamic `import()` is disabled entirely — `import.meta.url` is undefined and even `data:` URL imports are rejected — while `fetch` and `WebAssembly` work. Every maintained JavaScript ONNX runtime loads its WASM/emscripten module through dynamic import, so no version of onnxruntime-web can initialize in that sandbox; native modules and filesystem access are unavailable as well. This is a platform limit, not a configuration problem.

## Decision

Face detection and embedding run in the admin's browser on the admin Faces page, using onnxruntime-web with CDN-served WASM and the buffalo_s models, loaded through a dynamic import so onnxruntime never enters the participant bundle.

Only inference lives on the client. The `face-index` function owns everything stateful: embedding validation (shape and L2 norm), cluster assignment and thresholds, merges and claim migration, aggregates, and all participant-facing reads. The persisted schema does not record where embeddings were computed, so the inference host can move to a server later without data changes.

## Alternatives Considered

- Backend inference in the Base44 function: impossible today; fails at ONNX runtime initialization due to the dynamic-import restriction, verified empirically.
- Separate inference service (for example Python with InsightFace): rejected for now because it adds hosting, security surface, and cost for a job that runs a few minutes per event.
- Managed face APIs (for example AWS Rekognition): rejected because they send attendee biometrics to a third party and add a vendor for marginal benefit.
- Inference in each participant's browser at view time: rejected because it repeats the same work per visitor and requires shipping models to every device.

## Consequences

- Indexing progresses only while an admin keeps the Faces page open; acceptable for a per-event batch of minutes, and safe to stop and resume.
- The browser is treated as an untrusted embedding producer; server-side validation keeps state consistent even if a tab dies mid-run.
- If the platform ever permits WASM ML server-side, only the inference call site changes; entities, thresholds, and claims are untouched.
