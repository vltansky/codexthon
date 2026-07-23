import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const indexerModuleUrl = pathToFileURL(resolve("base44/functions/face-index/indexer.ts")).href;

interface CoverFace {
  face_id: string;
  score: number;
  sharpness?: number;
}

interface IndexerModule {
  pickCoverFace<T extends { score: number; sharpness?: number }>(faces: T[]): T;
  parseFaces(payload: unknown, photoId: string): { score: number; sharpness?: number }[];
}

function face(faceId: string, score: number, sharpness?: number): CoverFace {
  return sharpness === undefined ? { face_id: faceId, score } : { face_id: faceId, score, sharpness };
}

function unitEmbedding(): number[] {
  const embedding = Array.from({ length: 512 }, () => 0);
  embedding[0] = 1;
  return embedding;
}

test("pickCoverFace prefers a sharp face over a blurrier face with a higher detection score", async () => {
  const { pickCoverFace } = (await import(indexerModuleUrl)) as IndexerModule;
  const blurry = face("blurry", 0.93, 18);
  const sharp = face("sharp", 0.85, 420);
  assert.equal(pickCoverFace([blurry, sharp]), sharp);
});

test("pickCoverFace falls back to detection score when no face has sharpness", async () => {
  const { pickCoverFace } = (await import(indexerModuleUrl)) as IndexerModule;
  const best = face("best", 0.91);
  assert.equal(pickCoverFace([face("worst", 0.6), best, face("middle", 0.8)]), best);
});

test("pickCoverFace only considers faces with sharpness when the cluster mixes legacy faces", async () => {
  const { pickCoverFace } = (await import(indexerModuleUrl)) as IndexerModule;
  const measured = face("measured", 0.7, 300);
  assert.equal(pickCoverFace([face("legacy", 0.99), measured]), measured);
});

test("pickCoverFace falls back to detection score when every sharpness is zero", async () => {
  const { pickCoverFace } = (await import(indexerModuleUrl)) as IndexerModule;
  const best = face("best", 0.9, 0);
  assert.equal(pickCoverFace([face("other", 0.7, 0), best]), best);
});

test("parseFaces keeps a valid sharpness and drops invalid ones", async () => {
  const { parseFaces } = (await import(indexerModuleUrl)) as IndexerModule;
  const box = [0.1, 0.1, 0.4, 0.4];
  const embedding = unitEmbedding();
  const faces = parseFaces(
    [
      { score: 0.9, box, embedding, sharpness: 123.456 },
      { score: 0.8, box, embedding, sharpness: -5 },
      { score: 0.7, box, embedding, sharpness: "sharp" },
      { score: 0.6, box, embedding },
    ],
    "photo-1",
  );
  assert.equal(faces[0]?.sharpness, 123.46);
  assert.equal(faces[1]?.sharpness, undefined);
  assert.equal(faces[2]?.sharpness, undefined);
  assert.equal(faces[3]?.sharpness, undefined);
});
