export interface DecodedImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

// Matches the aligned-crop size the browser indexer measures, so backfilled
// values stay roughly comparable with values from fresh ingests.
const sampleSize = 112;

// Variance of the 4-neighbor Laplacian over the face box resampled to
// 112x112 grayscale; higher means sharper. Used to backfill sharpness for
// faces indexed before the browser started reporting it.
export function faceSharpness(image: DecodedImage, box: number[]): number {
  if (box.length !== 4) return 0;
  const [x1, y1, x2, y2] = box as [number, number, number, number];
  if (!(x2 > x1) || !(y2 > y1)) return 0;
  const gray = new Float32Array(sampleSize * sampleSize);
  const pixel: [number, number, number] = [0, 0, 0];
  for (let y = 0; y < sampleSize; y++) {
    for (let x = 0; x < sampleSize; x++) {
      const sourceX = (x1 + ((x + 0.5) / sampleSize) * (x2 - x1)) * image.width - 0.5;
      const sourceY = (y1 + ((y + 0.5) / sampleSize) * (y2 - y1)) * image.height - 0.5;
      bilinearSample(image, sourceX, sourceY, pixel);
      gray[y * sampleSize + x] = 0.299 * pixel[0] + 0.587 * pixel[1] + 0.114 * pixel[2];
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

function bilinearSample(image: DecodedImage, x: number, y: number, out: [number, number, number]): void {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const cx0 = clampIndex(x0, image.width);
  const cx1 = clampIndex(x0 + 1, image.width);
  const cy0 = clampIndex(y0, image.height);
  const cy1 = clampIndex(y0 + 1, image.height);
  const p00 = (cy0 * image.width + cx0) * 4;
  const p10 = (cy0 * image.width + cx1) * 4;
  const p01 = (cy1 * image.width + cx0) * 4;
  const p11 = (cy1 * image.width + cx1) * 4;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  const { data } = image;
  out[0] = data[p00]! * w00 + data[p10]! * w10 + data[p01]! * w01 + data[p11]! * w11;
  out[1] = data[p00 + 1]! * w00 + data[p10 + 1]! * w10 + data[p01 + 1]! * w01 + data[p11 + 1]! * w11;
  out[2] = data[p00 + 2]! * w00 + data[p10 + 2]! * w10 + data[p01 + 2]! * w01 + data[p11 + 2]! * w11;
}

function clampIndex(value: number, size: number): number {
  if (value < 0) return 0;
  if (value >= size) return size - 1;
  return value;
}
