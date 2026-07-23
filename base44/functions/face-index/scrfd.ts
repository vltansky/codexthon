import { resize, type Rgba } from "./imaging.ts";

// SCRFD decode ported from insightface's python reference implementation:
// strides 8/16/32, two anchors per cell, distance-encoded boxes and keypoints.
const strides = [8, 16, 32];
const anchorsPerCell = 2;

export interface DetectedFace {
  score: number;
  box: [number, number, number, number];
  keypoints: [number, number][];
}

export interface DetectionInput {
  tensorData: Float32Array;
  size: number;
  scale: number;
}

export function preprocessForDetection(img: Rgba, size = 640): DetectionInput {
  const scale = Math.min(size / img.width, size / img.height);
  const scaledWidth = Math.round(img.width * scale);
  const scaledHeight = Math.round(img.height * scale);
  const scaled = resize(img, scaledWidth, scaledHeight);

  const tensorData = new Float32Array(3 * size * size);
  const planeSize = size * size;
  for (let y = 0; y < scaledHeight; y++) {
    for (let x = 0; x < scaledWidth; x++) {
      const source = (y * scaledWidth + x) * 4;
      const target = y * size + x;
      tensorData[target] = (scaled.data[source] - 127.5) / 128;
      tensorData[planeSize + target] = (scaled.data[source + 1] - 127.5) / 128;
      tensorData[planeSize * 2 + target] = (scaled.data[source + 2] - 127.5) / 128;
    }
  }
  return { tensorData, size, scale };
}

interface OutputTensor {
  dims: readonly number[];
  data: Float32Array;
}

export function decodeDetections(
  outputs: OutputTensor[],
  input: DetectionInput,
  scoreThreshold = 0.5,
  iouThreshold = 0.4,
): DetectedFace[] {
  const candidates: DetectedFace[] = [];
  for (const [strideIndex, stride] of strides.entries()) {
    const scores = outputs[strideIndex].data;
    const boxes = outputs[strideIndex + 3].data;
    const keypoints = outputs[strideIndex + 6].data;
    const cells = input.size / stride;
    for (let cellY = 0; cellY < cells; cellY++) {
      for (let cellX = 0; cellX < cells; cellX++) {
        for (let anchor = 0; anchor < anchorsPerCell; anchor++) {
          const index = (cellY * cells + cellX) * anchorsPerCell + anchor;
          const score = scores[index];
          if (score < scoreThreshold) continue;
          const centerX = cellX * stride;
          const centerY = cellY * stride;
          const box: [number, number, number, number] = [
            (centerX - boxes[index * 4] * stride) / input.scale,
            (centerY - boxes[index * 4 + 1] * stride) / input.scale,
            (centerX + boxes[index * 4 + 2] * stride) / input.scale,
            (centerY + boxes[index * 4 + 3] * stride) / input.scale,
          ];
          const points: [number, number][] = [];
          for (let point = 0; point < 5; point++) {
            points.push([
              (centerX + keypoints[index * 10 + point * 2] * stride) / input.scale,
              (centerY + keypoints[index * 10 + point * 2 + 1] * stride) / input.scale,
            ]);
          }
          candidates.push({ score, box, keypoints: points });
        }
      }
    }
  }
  return nonMaxSuppression(candidates, iouThreshold);
}

function nonMaxSuppression(faces: DetectedFace[], iouThreshold: number): DetectedFace[] {
  const sorted = [...faces].sort((a, b) => b.score - a.score);
  const kept: DetectedFace[] = [];
  for (const face of sorted) {
    if (kept.every((other) => intersectionOverUnion(face.box, other.box) < iouThreshold)) kept.push(face);
  }
  return kept;
}

function intersectionOverUnion(a: [number, number, number, number], b: [number, number, number, number]): number {
  const left = Math.max(a[0], b[0]);
  const top = Math.max(a[1], b[1]);
  const right = Math.min(a[2], b[2]);
  const bottom = Math.min(a[3], b[3]);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  return intersection / (areaA + areaB - intersection);
}
