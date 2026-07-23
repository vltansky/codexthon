export interface OrderablePerson {
  clusterKey: string;
  claimed: boolean;
  photoCount: number;
  coverSharpness: number;
  centroid: number[];
}

// Below the 0.5 clustering threshold but high enough that two clusters are
// plausibly the same person split by pose or blur; such clusters render next
// to each other so a participant can claim both.
const nearDuplicateSimilarity = 0.4;

export function orderPeopleClusters<T extends OrderablePerson>(people: T[]): T[] {
  const base = people.toSorted((first, second) =>
    Number(second.claimed) - Number(first.claimed) ||
    second.coverSharpness - first.coverSharpness ||
    second.photoCount - first.photoCount
  );
  const placed = new Set<string>();
  const ordered: T[] = [];
  for (const person of base) {
    if (placed.has(person.clusterKey)) continue;
    placed.add(person.clusterKey);
    ordered.push(person);
    const neighbors = base
      .filter((candidate) => !placed.has(candidate.clusterKey))
      .map((candidate) => ({ candidate, similarity: centroidSimilarity(person.centroid, candidate.centroid) }))
      .filter(({ similarity }) => similarity >= nearDuplicateSimilarity)
      .toSorted((first, second) => second.similarity - first.similarity);
    for (const { candidate } of neighbors) {
      placed.add(candidate.clusterKey);
      ordered.push(candidate);
    }
  }
  return ordered;
}

function centroidSimilarity(first: number[], second: number[]): number {
  if (first.length === 0 || first.length !== second.length) return 0;
  let similarity = 0;
  for (let i = 0; i < first.length; i++) similarity += first[i]! * second[i]!;
  return similarity;
}
