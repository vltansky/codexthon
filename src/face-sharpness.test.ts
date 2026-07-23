import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const sharpnessModuleUrl = pathToFileURL(resolve("base44/functions/face-index/sharpness.ts")).href;

interface DecodedImage {
  width: number;
  height: number;
  data: Uint8Array;
}

interface SharpnessModule {
  faceSharpness(image: DecodedImage, box: number[]): number;
}

function grayImage(width: number, height: number, valueAt: (x: number, y: number) => number): DecodedImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = valueAt(x, y);
      const offset = (y * width + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}

test("faceSharpness is zero on a flat image", async () => {
  const { faceSharpness } = (await import(sharpnessModuleUrl)) as SharpnessModule;
  const flat = grayImage(64, 64, () => 128);
  assert.equal(faceSharpness(flat, [0, 0, 1, 1]), 0);
});

test("faceSharpness ranks a high-contrast pattern above a smooth gradient", async () => {
  const { faceSharpness } = (await import(sharpnessModuleUrl)) as SharpnessModule;
  const checkerboard = grayImage(64, 64, (x, y) => ((x >> 2) + (y >> 2)) % 2 ? 255 : 0);
  const gradient = grayImage(64, 64, (x) => Math.round((x / 63) * 255));
  assert.ok(faceSharpness(checkerboard, [0, 0, 1, 1]) > faceSharpness(gradient, [0, 0, 1, 1]));
});

test("faceSharpness measures only the requested box", async () => {
  const { faceSharpness } = (await import(sharpnessModuleUrl)) as SharpnessModule;
  const halfSharp = grayImage(64, 64, (x, y) => x < 32 ? (((x >> 1) + (y >> 1)) % 2 ? 255 : 0) : 128);
  const sharpHalf = faceSharpness(halfSharp, [0, 0, 0.45, 1]);
  const flatHalf = faceSharpness(halfSharp, [0.55, 0, 1, 1]);
  assert.ok(sharpHalf > 0);
  assert.equal(flatHalf, 0);
});

test("faceSharpness returns zero for a degenerate box", async () => {
  const { faceSharpness } = (await import(sharpnessModuleUrl)) as SharpnessModule;
  const image = grayImage(16, 16, (x) => x * 16);
  assert.equal(faceSharpness(image, [0.5, 0.5, 0.5, 0.5]), 0);
  assert.equal(faceSharpness(image, [0.9, 0.2, 0.1, 0.8]), 0);
  assert.equal(faceSharpness(image, []), 0);
});
