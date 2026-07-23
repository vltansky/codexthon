// SCRFD decode ported from insightface's python reference implementation:
// strides 8/16/32, two anchors per cell, distance-encoded boxes and keypoints.
const strides = [8, 16, 32];
const anchorsPerCell = 2;

export interface DetectedFace {
  score: number;
  box: [number, number, number, number];
  keypoints: [number, number][];
}

export interface DetectionGeometry {
  size: number;
  scale: number;
}

interface OutputTensor {
  dims: readonly number[];
  data: Float32Array;
}

export function decodeDetections(
  outputs: OutputTensor[],
  geometry: DetectionGeometry,
  scoreThreshold = 0.5,
  iouThreshold = 0.4,
): DetectedFace[] {
  const candidates: DetectedFace[] = [];
  for (const [strideIndex, stride] of strides.entries()) {
    const scores = outputs[strideIndex]!.data;
    const boxes = outputs[strideIndex + 3]!.data;
    const keypoints = outputs[strideIndex + 6]!.data;
    const cells = geometry.size / stride;
    for (let cellY = 0; cellY < cells; cellY++) {
      for (let cellX = 0; cellX < cells; cellX++) {
        for (let anchor = 0; anchor < anchorsPerCell; anchor++) {
          const index = (cellY * cells + cellX) * anchorsPerCell + anchor;
          const score = scores[index]!;
          if (score < scoreThreshold) continue;
          const centerX = cellX * stride;
          const centerY = cellY * stride;
          const box: [number, number, number, number] = [
            (centerX - boxes[index * 4]! * stride) / geometry.scale,
            (centerY - boxes[index * 4 + 1]! * stride) / geometry.scale,
            (centerX + boxes[index * 4 + 2]! * stride) / geometry.scale,
            (centerY + boxes[index * 4 + 3]! * stride) / geometry.scale,
          ];
          const points: [number, number][] = [];
          for (let point = 0; point < 5; point++) {
            points.push([
              (centerX + keypoints[index * 10 + point * 2]! * stride) / geometry.scale,
              (centerY + keypoints[index * 10 + point * 2 + 1]! * stride) / geometry.scale,
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
