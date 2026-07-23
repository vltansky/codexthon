import * as ort from "npm:onnxruntime-web@1.17.3";

// buffalo_s: SCRFD-500M detector (~2.5MB) + MobileFaceNet ArcFace embedder
// (~13MB) — the same models immich ships, hosted on their HF mirror.
const detectionModelUrl = "https://huggingface.co/immich-app/buffalo_s/resolve/main/detection/model.onnx";
const recognitionModelUrl = "https://huggingface.co/immich-app/buffalo_s/resolve/main/recognition/model.onnx";

// The hosted runtime disallows dynamic import(), which rules out ort >= 1.18
// (its wasm backend dynamically imports an emscripten .mjs loader). 1.17.x
// inlines the glue via bundler-resolvable require() and only fetch()es the
// .wasm binary, located through this explicit CDN prefix.
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/";

export interface FaceSessions {
  detector: ort.InferenceSession;
  recognizer: ort.InferenceSession;
}

// Module-level cache so warm invocations skip the ~15MB model download and
// WASM session creation.
let sessionsPromise: Promise<FaceSessions> | null = null;

export function faceSessions(): Promise<FaceSessions> {
  sessionsPromise ??= createSessions().catch((error) => {
    sessionsPromise = null;
    throw error;
  });
  return sessionsPromise;
}

async function createSessions(): Promise<FaceSessions> {
  const [detectionBytes, recognitionBytes] = await Promise.all([
    fetchModel(detectionModelUrl),
    fetchModel(recognitionModelUrl),
  ]);
  const [detector, recognizer] = await Promise.all([
    ort.InferenceSession.create(detectionBytes, { executionProviders: ["wasm"] }),
    ort.InferenceSession.create(recognitionBytes, { executionProviders: ["wasm"] }),
  ]);
  return { detector, recognizer };
}

async function fetchModel(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download face model (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

export { ort };
