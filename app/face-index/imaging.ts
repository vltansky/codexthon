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

function clampIndex(value: number, size: number): number {
  if (value < 0) return 0;
  if (value >= size) return size - 1;
  return value;
}
