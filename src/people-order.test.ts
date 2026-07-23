import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const orderModuleUrl = pathToFileURL(resolve("base44/functions/participant-photos/people-order.ts")).href;

interface OrderablePerson {
  clusterKey: string;
  claimed: boolean;
  photoCount: number;
  coverSharpness: number;
  centroid: number[];
}

interface OrderModule {
  orderPeopleClusters<T extends OrderablePerson>(people: T[]): T[];
}

function axisCentroid(axis: number, weight = 1): number[] {
  const centroid = Array.from({ length: 4 }, () => 0);
  centroid[axis] = weight;
  return centroid;
}

function person(overrides: Partial<OrderablePerson> & { clusterKey: string }): OrderablePerson {
  return { claimed: false, photoCount: 1, coverSharpness: 0, centroid: [], ...overrides };
}

test("orders unclaimed people from sharp to blurry", async () => {
  const { orderPeopleClusters } = (await import(orderModuleUrl)) as OrderModule;
  const ordered = orderPeopleClusters([
    person({ clusterKey: "blurry", coverSharpness: 40, centroid: axisCentroid(0) }),
    person({ clusterKey: "sharp", coverSharpness: 900, centroid: axisCentroid(1) }),
    person({ clusterKey: "medium", coverSharpness: 300, centroid: axisCentroid(2) }),
  ]);
  assert.deepEqual(ordered.map(({ clusterKey }) => clusterKey), ["sharp", "medium", "blurry"]);
});

test("keeps claimed people first regardless of sharpness", async () => {
  const { orderPeopleClusters } = (await import(orderModuleUrl)) as OrderModule;
  const ordered = orderPeopleClusters([
    person({ clusterKey: "sharp", coverSharpness: 900, centroid: axisCentroid(0) }),
    person({ clusterKey: "mine", claimed: true, coverSharpness: 10, centroid: axisCentroid(1) }),
  ]);
  assert.deepEqual(ordered.map(({ clusterKey }) => clusterKey), ["mine", "sharp"]);
});

test("pulls a probable same-person cluster next to its counterpart", async () => {
  const { orderPeopleClusters } = (await import(orderModuleUrl)) as OrderModule;
  const shared = [0.8, 0.6, 0, 0];
  const nearMiss = [0.7, 0.71, 0, 0];
  const ordered = orderPeopleClusters([
    person({ clusterKey: "sharp-me", coverSharpness: 900, centroid: shared }),
    person({ clusterKey: "other", coverSharpness: 500, centroid: axisCentroid(2) }),
    person({ clusterKey: "blurry-me", coverSharpness: 20, centroid: nearMiss }),
  ]);
  assert.deepEqual(ordered.map(({ clusterKey }) => clusterKey), ["sharp-me", "blurry-me", "other"]);
});

test("leaves dissimilar clusters in sharpness order", async () => {
  const { orderPeopleClusters } = (await import(orderModuleUrl)) as OrderModule;
  const ordered = orderPeopleClusters([
    person({ clusterKey: "first", coverSharpness: 900, centroid: axisCentroid(0) }),
    person({ clusterKey: "second", coverSharpness: 500, centroid: axisCentroid(1) }),
    person({ clusterKey: "third", coverSharpness: 100, centroid: axisCentroid(2) }),
  ]);
  assert.deepEqual(ordered.map(({ clusterKey }) => clusterKey), ["first", "second", "third"]);
});

test("falls back to photo count when sharpness is missing on legacy clusters", async () => {
  const { orderPeopleClusters } = (await import(orderModuleUrl)) as OrderModule;
  const ordered = orderPeopleClusters([
    person({ clusterKey: "few", photoCount: 2 }),
    person({ clusterKey: "many", photoCount: 9 }),
  ]);
  assert.deepEqual(ordered.map(({ clusterKey }) => clusterKey), ["many", "few"]);
});
