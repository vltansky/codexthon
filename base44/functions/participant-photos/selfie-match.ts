export interface ProbeFace {
  clusterKey: string;
  embedding: number[];
}

export interface ProbeMatch {
  clusterKey: string;
  similarity: number;
  strength: "strong" | "weak";
}

// buffalo_s recognition output; the client embeds on-device with the same
// model the indexer uses, so any other length is a malformed probe.
export const probeEmbeddingLength = 512;

// A selfie probe (front camera, indoor light) sits in a different domain than
// gallery faces, so the floor is looser than the 0.5 clustering threshold.
export const strongMatchThreshold = 0.45;
export const weakMatchThreshold = 0.35;
const maximumSuggestions = 5;

export function normalizeProbe(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== probeEmbeddingLength) return null;
  if (!value.every((entry) => typeof entry === "number" && Number.isFinite(entry))) return null;
  const norm = Math.sqrt(value.reduce((sum, entry) => sum + entry * entry, 0));
  if (norm === 0) return null;
  return value.map((entry) => entry / norm);
}

// Max similarity over member faces, not the centroid: a cluster spanning poses
// only needs one member shot in a selfie-like pose to match the probe.
export function matchProbeToClusters(probe: number[], faces: ProbeFace[]): ProbeMatch[] {
  const bestByCluster = new Map<string, number>();
  for (const face of faces) {
    if (face.embedding.length !== probe.length) continue;
    let similarity = 0;
    for (let i = 0; i < probe.length; i++) similarity += probe[i]! * face.embedding[i]!;
    const best = bestByCluster.get(face.clusterKey);
    if (best === undefined || similarity > best) bestByCluster.set(face.clusterKey, similarity);
  }
  return [...bestByCluster.entries()]
    .filter(([, similarity]) => similarity >= weakMatchThreshold)
    .toSorted(([, first], [, second]) => second - first)
    .slice(0, maximumSuggestions)
    .map(([clusterKey, similarity]) => ({
      clusterKey,
      similarity: Math.round(similarity * 1000) / 1000,
      strength: similarity >= strongMatchThreshold ? "strong" : "weak",
    }));
}
