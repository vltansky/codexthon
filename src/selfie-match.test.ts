import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const matchModuleUrl = pathToFileURL(resolve("base44/functions/participant-photos/selfie-match.ts")).href;

interface ProbeFace {
  clusterKey: string;
  embedding: number[];
}

interface ProbeMatch {
  clusterKey: string;
  similarity: number;
  strength: "strong" | "weak";
}

interface MatchModule {
  probeEmbeddingLength: number;
  normalizeProbe(value: unknown): number[] | null;
  matchProbeToClusters(probe: number[], faces: ProbeFace[]): ProbeMatch[];
}

function axisEmbedding(axis: number, weight = 1, length = 4): number[] {
  const embedding = Array.from({ length }, () => 0);
  embedding[axis] = weight;
  return embedding;
}

function probeOfLength(length: number): number[] {
  const probe = Array.from({ length }, () => 0);
  probe[0] = 1;
  return probe;
}

test("normalizeProbe rejects values that are not a 512-number vector", async () => {
  const { normalizeProbe, probeEmbeddingLength } = (await import(matchModuleUrl)) as MatchModule;
  assert.equal(normalizeProbe("not-a-vector"), null);
  assert.equal(normalizeProbe(probeOfLength(probeEmbeddingLength - 1)), null);
  assert.equal(normalizeProbe([...probeOfLength(probeEmbeddingLength - 1), Number.NaN]), null);
  assert.equal(normalizeProbe(Array.from({ length: probeEmbeddingLength }, () => 0)), null);
});

test("normalizeProbe returns a unit-length copy of a scaled vector", async () => {
  const { normalizeProbe, probeEmbeddingLength } = (await import(matchModuleUrl)) as MatchModule;
  const scaled = probeOfLength(probeEmbeddingLength).map((value) => value * 3);
  const normalized = normalizeProbe(scaled);
  assert.ok(normalized);
  const norm = Math.sqrt(normalized.reduce((sum, value) => sum + value * value, 0));
  assert.ok(Math.abs(norm - 1) < 1e-6);
  assert.equal(scaled[0], 3);
});

test("ranks clusters by their best member face, not their average", async () => {
  const { matchProbeToClusters } = (await import(matchModuleUrl)) as MatchModule;
  const matches = matchProbeToClusters(axisEmbedding(0), [
    { clusterKey: "steady", embedding: axisEmbedding(0, 0.6) },
    { clusterKey: "spiky", embedding: axisEmbedding(0, 0.1) },
    { clusterKey: "spiky", embedding: axisEmbedding(0, 0.9) },
  ]);
  assert.deepEqual(matches.map(({ clusterKey }) => clusterKey), ["spiky", "steady"]);
  assert.equal(matches[0]?.similarity, 0.9);
});

test("drops clusters below the weak threshold and labels strength", async () => {
  const { matchProbeToClusters } = (await import(matchModuleUrl)) as MatchModule;
  const matches = matchProbeToClusters(axisEmbedding(0), [
    { clusterKey: "strong", embedding: axisEmbedding(0, 0.8) },
    { clusterKey: "weak", embedding: axisEmbedding(0, 0.4) },
    { clusterKey: "noise", embedding: axisEmbedding(0, 0.2) },
    { clusterKey: "sideways", embedding: axisEmbedding(1) },
  ]);
  assert.deepEqual(
    matches.map(({ clusterKey, strength }) => [clusterKey, strength]),
    [["strong", "strong"], ["weak", "weak"]],
  );
});

test("caps the suggestions at five clusters", async () => {
  const { matchProbeToClusters } = (await import(matchModuleUrl)) as MatchModule;
  const faces = Array.from({ length: 8 }, (_, index) => ({
    clusterKey: `cluster-${index}`,
    embedding: axisEmbedding(0, 0.5 + index * 0.05, 8),
  }));
  const matches = matchProbeToClusters(axisEmbedding(0, 1, 8), faces);
  assert.equal(matches.length, 5);
  assert.equal(matches[0]?.clusterKey, "cluster-7");
});

test("ignores member embeddings whose length does not match the probe", async () => {
  const { matchProbeToClusters } = (await import(matchModuleUrl)) as MatchModule;
  const matches = matchProbeToClusters(axisEmbedding(0), [
    { clusterKey: "mismatched", embedding: axisEmbedding(0, 1, 8) },
    { clusterKey: "aligned", embedding: axisEmbedding(0, 0.7) },
  ]);
  assert.deepEqual(matches.map(({ clusterKey }) => clusterKey), ["aligned"]);
});
