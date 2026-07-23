import { bilinearSample, type Rgba } from "./imaging.ts";

// Canonical ArcFace 112x112 landmark template (left eye, right eye, nose, mouth corners).
const template: [number, number][] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

export const alignedSize = 112;

interface Similarity {
  a: number;
  b: number;
  tx: number;
  ty: number;
}

// Least-squares non-reflective similarity transform mapping source points onto
// the template: [x'] = [a -b][x] + [tx]
//               [y']   [b  a][y]   [ty]
function estimateSimilarity(source: [number, number][], target: [number, number][]): Similarity {
  const count = source.length;
  let sourceMeanX = 0, sourceMeanY = 0, targetMeanX = 0, targetMeanY = 0;
  for (let i = 0; i < count; i++) {
    sourceMeanX += source[i][0] / count;
    sourceMeanY += source[i][1] / count;
    targetMeanX += target[i][0] / count;
    targetMeanY += target[i][1] / count;
  }
  let crossSum = 0, dotSum = 0, normSum = 0;
  for (let i = 0; i < count; i++) {
    const sx = source[i][0] - sourceMeanX;
    const sy = source[i][1] - sourceMeanY;
    const tx = target[i][0] - targetMeanX;
    const ty = target[i][1] - targetMeanY;
    dotSum += sx * tx + sy * ty;
    crossSum += sx * ty - sy * tx;
    normSum += sx * sx + sy * sy;
  }
  const a = dotSum / normSum;
  const b = crossSum / normSum;
  return {
    a,
    b,
    tx: targetMeanX - (a * sourceMeanX - b * sourceMeanY),
    ty: targetMeanY - (b * sourceMeanX + a * sourceMeanY),
  };
}

export function alignFace(img: Rgba, keypoints: [number, number][]): Rgba {
  const { a, b, tx, ty } = estimateSimilarity(keypoints, template);
  const inverseScale = 1 / (a * a + b * b);
  const data = new Uint8Array(alignedSize * alignedSize * 4);
  const pixel: [number, number, number] = [0, 0, 0];
  for (let y = 0; y < alignedSize; y++) {
    for (let x = 0; x < alignedSize; x++) {
      const dx = x - tx;
      const dy = y - ty;
      const sourceX = (a * dx + b * dy) * inverseScale;
      const sourceY = (-b * dx + a * dy) * inverseScale;
      bilinearSample(img, sourceX, sourceY, pixel);
      const offset = (y * alignedSize + x) * 4;
      data[offset] = pixel[0];
      data[offset + 1] = pixel[1];
      data[offset + 2] = pixel[2];
      data[offset + 3] = 255;
    }
  }
  return { width: alignedSize, height: alignedSize, data };
}

export function embeddingTensorData(aligned: Rgba): Float32Array {
  const planeSize = alignedSize * alignedSize;
  const tensorData = new Float32Array(3 * planeSize);
  for (let i = 0; i < planeSize; i++) {
    tensorData[i] = (aligned.data[i * 4] - 127.5) / 127.5;
    tensorData[planeSize + i] = (aligned.data[i * 4 + 1] - 127.5) / 127.5;
    tensorData[planeSize * 2 + i] = (aligned.data[i * 4 + 2] - 127.5) / 127.5;
  }
  return tensorData;
}

export function normalizeEmbedding(raw: Float32Array): Float32Array {
  let norm = 0;
  for (const value of raw) norm += value * value;
  norm = Math.sqrt(norm);
  const normalized = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) normalized[i] = raw[i] / norm;
  return normalized;
}
