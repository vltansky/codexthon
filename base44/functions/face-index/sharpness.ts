export interface DecodedImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

const minimumRegionSize = 8;
const sampleSize = 112;

// Variance of the 4-neighbor Laplacian over the face box resampled to a fixed
// 112x112 by averaging each target cell's source area. The fixed output scale
// matches how covers render (small tiles), so the score tracks perceived
// sharpness: a defocused face averages smooth and scores low, a tiny face
// upscales soft and scores low, a crisp face keeps its edges and scores high.
// Area averaging (not point sampling) keeps sensor noise in defocused faces
// from aliasing into fake detail. Calibrated on real event photos; mirrored in
// app/face-index/imaging.ts.
export function faceSharpness(image: DecodedImage, box: number[]): number {
  if (box.length !== 4) return 0;
  const [relativeX1, relativeY1, relativeX2, relativeY2] = box as [number, number, number, number];
  const x1 = Math.max(0, relativeX1 * image.width);
  const y1 = Math.max(0, relativeY1 * image.height);
  const x2 = Math.min(image.width, relativeX2 * image.width);
  const y2 = Math.min(image.height, relativeY2 * image.height);
  const regionWidth = x2 - x1;
  const regionHeight = y2 - y1;
  if (regionWidth < minimumRegionSize || regionHeight < minimumRegionSize) return 0;

  const gray = new Float32Array(sampleSize * sampleSize);
  for (let y = 0; y < sampleSize; y++) {
    const sourceYStart = Math.floor(y1 + (y / sampleSize) * regionHeight);
    const sourceYEnd = Math.max(sourceYStart + 1, Math.ceil(y1 + ((y + 1) / sampleSize) * regionHeight));
    for (let x = 0; x < sampleSize; x++) {
      const sourceXStart = Math.floor(x1 + (x / sampleSize) * regionWidth);
      const sourceXEnd = Math.max(sourceXStart + 1, Math.ceil(x1 + ((x + 1) / sampleSize) * regionWidth));
      let total = 0;
      let count = 0;
      for (let sourceY = sourceYStart; sourceY < sourceYEnd; sourceY++) {
        for (let sourceX = sourceXStart; sourceX < sourceXEnd; sourceX++) {
          const clampedX = Math.min(image.width - 1, Math.max(0, sourceX));
          const clampedY = Math.min(image.height - 1, Math.max(0, sourceY));
          const offset = (clampedY * image.width + clampedX) * 4;
          total += 0.299 * image.data[offset]! + 0.587 * image.data[offset + 1]! + 0.114 * image.data[offset + 2]!;
          count++;
        }
      }
      gray[y * sampleSize + x] = total / count;
    }
  }
  let sum = 0;
  let sumOfSquares = 0;
  const interiorCount = (sampleSize - 2) * (sampleSize - 2);
  for (let y = 1; y < sampleSize - 1; y++) {
    for (let x = 1; x < sampleSize - 1; x++) {
      const i = y * sampleSize + x;
      const response = gray[i - 1]! + gray[i + 1]! + gray[i - sampleSize]! + gray[i + sampleSize]! - 4 * gray[i]!;
      sum += response;
      sumOfSquares += response * response;
    }
  }
  const mean = sum / interiorCount;
  return Math.max(0, sumOfSquares / interiorCount - mean * mean);
}
