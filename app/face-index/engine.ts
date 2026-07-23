import * as ort from "onnxruntime-web";

import { alignFace, alignedSize, embeddingTensorData, normalizeEmbedding } from "./align";
import { laplacianSharpness, type Rgba } from "./imaging";
import { decodeDetections } from "./scrfd";

// buffalo_s: SCRFD-500M detector + MobileFaceNet ArcFace embedder — the same
// models immich ships, hosted on their HF mirror. Runs in the admin's browser
// because the Base44 function sandbox cannot execute WASM ML (no dynamic import).
const detectionModelUrl = "https://huggingface.co/immich-app/buffalo_s/resolve/main/detection/model.onnx";
const recognitionModelUrl = "https://huggingface.co/immich-app/buffalo_s/resolve/main/recognition/model.onnx";
const ortVersion = "1.20.1";
const detectionSize = 640;
const detectionThreshold = 0.5;

ort.env.wasm.numThreads = 1;
// Load wasm assets from the CDN so vite does not need to bundle them.
ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ortVersion}/dist/`;

export interface DetectedFacePayload {
  score: number;
  sharpness: number;
  box: number[];
  embedding: number[];
}

interface Sessions {
  detector: ort.InferenceSession;
  recognizer: ort.InferenceSession;
}

let sessionsPromise: Promise<Sessions> | null = null;

export function loadFaceSessions(): Promise<Sessions> {
  sessionsPromise ??= createSessions().catch((error) => {
    sessionsPromise = null;
    throw error;
  });
  return sessionsPromise;
}

async function createSessions(): Promise<Sessions> {
  const [detectionBytes, recognitionBytes] = await Promise.all([fetchModel(detectionModelUrl), fetchModel(recognitionModelUrl)]);
  const [detector, recognizer] = await Promise.all([
    ort.InferenceSession.create(detectionBytes, { executionProviders: ["wasm"] }),
    ort.InferenceSession.create(recognitionBytes, { executionProviders: ["wasm"] }),
  ]);
  return { detector, recognizer };
}

async function fetchModel(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download the face model (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function detectAndEmbed(imageBlob: Blob): Promise<DetectedFacePayload[]> {
  const sessions = await loadFaceSessions();
  const bitmap = await createImageBitmap(imageBlob);
  try {
    const scale = Math.min(detectionSize / bitmap.width, detectionSize / bitmap.height);
    const letterbox = drawToCanvas(bitmap, detectionSize, detectionSize, bitmap.width * scale, bitmap.height * scale);
    const detectionOutput = await sessions.detector.run({
      [sessions.detector.inputNames[0]!]: new ort.Tensor("float32", detectionTensorData(letterbox), [1, 3, detectionSize, detectionSize]),
    });
    const detections = decodeDetections(
      sessions.detector.outputNames.map((name) => detectionOutput[name] as { dims: readonly number[]; data: Float32Array }),
      { size: detectionSize, scale },
      detectionThreshold,
    );
    if (detections.length === 0) return [];

    const fullImage = drawToCanvas(bitmap, bitmap.width, bitmap.height, bitmap.width, bitmap.height);
    const faces: DetectedFacePayload[] = [];
    for (const detection of detections) {
      const aligned = alignFace(fullImage, detection.keypoints);
      const embeddingOutput = await sessions.recognizer.run({
        [sessions.recognizer.inputNames[0]!]: new ort.Tensor("float32", embeddingTensorData(aligned), [1, 3, alignedSize, alignedSize]),
      });
      const embedding = normalizeEmbedding((embeddingOutput[sessions.recognizer.outputNames[0]!] as { data: Float32Array }).data);
      faces.push({
        score: detection.score,
        sharpness: laplacianSharpness(aligned),
        box: relativeBox(detection.box, bitmap.width, bitmap.height),
        embedding: [...embedding],
      });
    }
    return faces;
  } finally {
    bitmap.close();
  }
}

function drawToCanvas(bitmap: ImageBitmap, canvasWidth: number, canvasHeight: number, drawWidth: number, drawHeight: number): Rgba {
  const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  context.drawImage(bitmap, 0, 0, drawWidth, drawHeight);
  const imageData = context.getImageData(0, 0, canvasWidth, canvasHeight);
  return { width: canvasWidth, height: canvasHeight, data: imageData.data };
}

function detectionTensorData(letterbox: Rgba): Float32Array {
  const planeSize = letterbox.width * letterbox.height;
  const tensorData = new Float32Array(3 * planeSize);
  for (let i = 0; i < planeSize; i++) {
    tensorData[i] = (letterbox.data[i * 4]! - 127.5) / 128;
    tensorData[planeSize + i] = (letterbox.data[i * 4 + 1]! - 127.5) / 128;
    tensorData[planeSize * 2 + i] = (letterbox.data[i * 4 + 2]! - 127.5) / 128;
  }
  return tensorData;
}

function relativeBox(box: [number, number, number, number], width: number, height: number): number[] {
  return [box[0] / width, box[1] / height, box[2] / width, box[3] / height].map((value) => Math.min(1, Math.max(0, value)));
}
