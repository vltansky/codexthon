export interface Rgba {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export function bilinearSample(img: Rgba, x: number, y: number, out: [number, number, number]): void {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const cx0 = clampIndex(x0, img.width);
  const cx1 = clampIndex(x0 + 1, img.width);
  const cy0 = clampIndex(y0, img.height);
  const cy1 = clampIndex(y0 + 1, img.height);
  const p00 = (cy0 * img.width + cx0) * 4;
  const p10 = (cy0 * img.width + cx1) * 4;
  const p01 = (cy1 * img.width + cx0) * 4;
  const p11 = (cy1 * img.width + cx1) * 4;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  const { data } = img;
  out[0] = data[p00]! * w00 + data[p10]! * w10 + data[p01]! * w01 + data[p11]! * w11;
  out[1] = data[p00 + 1]! * w00 + data[p10 + 1]! * w10 + data[p01 + 1]! * w01 + data[p11 + 1]! * w11;
  out[2] = data[p00 + 2]! * w00 + data[p10 + 2]! * w10 + data[p01 + 2]! * w01 + data[p11 + 2]! * w11;
}

const minimumSharpnessRegionSize = 8;
const sharpnessSampleSize = 112;

// Variance of the 4-neighbor Laplacian over the face box resampled to a fixed
// 112x112 by averaging each target cell's source area. The fixed output scale
// matches how covers render (small tiles), so the score tracks perceived
// sharpness: a defocused face averages smooth and scores low, a tiny face
// upscales soft and scores low, a crisp face keeps its edges and scores high.
// Mirrors base44/functions/face-index/sharpness.ts.
export function laplacianSharpness(img: Rgba, box: number[]): number {
  if (box.length !== 4) return 0;
  const [relativeX1, relativeY1, relativeX2, relativeY2] = box as [number, number, number, number];
  const x1 = Math.max(0, relativeX1 * img.width);
  const y1 = Math.max(0, relativeY1 * img.height);
  const x2 = Math.min(img.width, relativeX2 * img.width);
  const y2 = Math.min(img.height, relativeY2 * img.height);
  const regionWidth = x2 - x1;
  const regionHeight = y2 - y1;
  if (regionWidth < minimumSharpnessRegionSize || regionHeight < minimumSharpnessRegionSize) return 0;

  const gray = new Float32Array(sharpnessSampleSize * sharpnessSampleSize);
  for (let y = 0; y < sharpnessSampleSize; y++) {
    const sourceYStart = Math.floor(y1 + (y / sharpnessSampleSize) * regionHeight);
    const sourceYEnd = Math.max(sourceYStart + 1, Math.ceil(y1 + ((y + 1) / sharpnessSampleSize) * regionHeight));
    for (let x = 0; x < sharpnessSampleSize; x++) {
      const sourceXStart = Math.floor(x1 + (x / sharpnessSampleSize) * regionWidth);
      const sourceXEnd = Math.max(sourceXStart + 1, Math.ceil(x1 + ((x + 1) / sharpnessSampleSize) * regionWidth));
      let total = 0;
      let count = 0;
      for (let sourceY = sourceYStart; sourceY < sourceYEnd; sourceY++) {
        for (let sourceX = sourceXStart; sourceX < sourceXEnd; sourceX++) {
          const clampedX = Math.min(img.width - 1, Math.max(0, sourceX));
          const clampedY = Math.min(img.height - 1, Math.max(0, sourceY));
          const offset = (clampedY * img.width + clampedX) * 4;
          total += 0.299 * img.data[offset]! + 0.587 * img.data[offset + 1]! + 0.114 * img.data[offset + 2]!;
          count++;
        }
      }
      gray[y * sharpnessSampleSize + x] = total / count;
    }
  }
  let sum = 0;
  let sumOfSquares = 0;
  const interiorCount = (sharpnessSampleSize - 2) * (sharpnessSampleSize - 2);
  for (let y = 1; y < sharpnessSampleSize - 1; y++) {
    for (let x = 1; x < sharpnessSampleSize - 1; x++) {
      const i = y * sharpnessSampleSize + x;
      const response = gray[i - 1]! + gray[i + 1]! + gray[i - sharpnessSampleSize]! + gray[i + sharpnessSampleSize]! - 4 * gray[i]!;
      sum += response;
      sumOfSquares += response * response;
    }
  }
  const mean = sum / interiorCount;
  return Math.max(0, sumOfSquares / interiorCount - mean * mean);
}

function clampIndex(value: number, size: number): number {
  if (value < 0) return 0;
  if (value >= size) return size - 1;
  return value;
}
