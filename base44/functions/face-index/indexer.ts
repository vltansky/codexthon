import { fetchThumbnail, listIndexablePhotos, type IndexablePhoto } from "./drive.ts";
import { faceSharpness } from "./sharpness.ts";

// Threshold calibrated for buffalo_s embeddings (POC on 194 real event photos:
// same-person cross-photo cosine ~0.71, strangers well below 0.5).
const similarityThreshold = 0.5;
const embeddingLength = 512;
const maximumFacesPerPhoto = 60;
const pendingBatchLimit = 25;
const entityPageSize = 2000;

interface IndexedFace {
  face_id: string;
  cluster_key: string;
  score: number;
  sharpness?: number;
  box: number[];
  embedding: number[];
}

interface IndexRecord {
  id?: string;
  photo_id: string;
  photo_name?: string;
  faces?: IndexedFace[];
}

export interface IngestFacePayload {
  score?: unknown;
  sharpness?: unknown;
  box?: unknown;
  embedding?: unknown;
}

// Module-level cache so the thumbnail proxy does not re-list Drive per photo.
let photoCache: { photos: IndexablePhoto[]; fetchedAt: number } | null = null;
const photoCacheTtlMs = 5 * 60_000;

async function cachedPhotos(base44: any): Promise<IndexablePhoto[]> {
  if (photoCache && performance.now() - photoCache.fetchedAt < photoCacheTtlMs) return photoCache.photos;
  const photos = await listIndexablePhotos(await driveAccessToken(base44));
  photoCache = { photos, fetchedAt: performance.now() };
  return photos;
}

export async function indexStatus(base44: any) {
  const [photos, records, clusters] = await Promise.all([
    cachedPhotos(base44),
    listIndexRecords(base44),
    base44.asServiceRole.entities.FaceCluster.filter({}, undefined, entityPageSize),
  ]);
  const photoIds = new Set(photos.map(({ id }) => id));
  const indexedPhotos = records.filter((record) => photoIds.has(record.photo_id)).length;
  return {
    totalPhotos: photos.length,
    indexedPhotos,
    remainingPhotos: photos.length - indexedPhotos,
    faceCount: records.reduce((count, record) => count + (record.faces?.length ?? 0), 0),
    clusterCount: clusters.length,
  };
}

export async function pendingPhotos(base44: any) {
  const [photos, records] = await Promise.all([cachedPhotos(base44), listIndexRecords(base44)]);
  const indexedIds = new Set(records.map(({ photo_id }) => photo_id));
  const pending = photos.filter(({ id }) => !indexedIds.has(id));
  return {
    photos: pending.slice(0, pendingBatchLimit).map(({ id, name, thumbnailUrl }) => ({ id, name, thumbnailUrl })),
    remainingPhotos: pending.length,
  };
}

// Returns the thumbnail as base64 JSON because the SDK's invoke() only
// carries JSON; used when the browser cannot fetch Drive thumbnails directly.
export async function proxyThumbnail(base44: any, photoId: unknown) {
  if (typeof photoId !== "string") throw new Error("Unknown photo");
  const photos = await cachedPhotos(base44);
  const photo = photos.find(({ id }) => id === photoId);
  if (!photo) throw new Error("Unknown photo");
  const upstream = await fetch(photo.thumbnailUrl);
  if (!upstream.ok) throw new Error("Thumbnail unavailable");
  const bytes = new Uint8Array(await upstream.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return { base64: btoa(binary), contentType: upstream.headers.get("content-type") ?? "image/jpeg" };
}

export async function ingestPhoto(base44: any, body: { photoId?: unknown; photoName?: unknown; faces?: unknown }) {
  const photoId = body.photoId;
  if (typeof photoId !== "string" || !photoId) throw new Error("photoId is required");
  const photoName = typeof body.photoName === "string" ? body.photoName : "";
  const faces = parseFaces(body.faces, photoId);

  const records = await listIndexRecords(base44);
  if (records.some((record) => record.photo_id === photoId)) {
    return { alreadyIndexed: true, faceCount: 0, clusterCount: undefined };
  }

  // Noise faces are unreliable anchors and never join the match pool.
  const knownFaces = records.flatMap((record) =>
    (record.faces ?? [])
      .filter((face) => !face.cluster_key.startsWith(noiseClusterPrefix))
      .map((face) => ({ clusterKey: face.cluster_key, embedding: Float32Array.from(face.embedding) }))
  );
  const touchedClusterKeys = new Set<string>();
  for (const face of faces) {
    const matchedKey = assignCluster(Float32Array.from(face.embedding), knownFaces);
    // Join-not-seed gating: a tiny face may still match into an existing
    // person (badges keep working), but an unmatched tiny face becomes
    // invisible noise instead of a new one-face group. Measured on this
    // event: 151 of 271 singleton groups were faces under 6% of frame height.
    if (!matchedKey && faceHeight(face.box) < minimumSeedFaceHeight) {
      face.cluster_key = `${noiseClusterPrefix}${crypto.randomUUID().slice(0, 13)}`;
      continue;
    }
    face.cluster_key = matchedKey || `person_${crypto.randomUUID().slice(0, 13)}`;
    knownFaces.push({ clusterKey: face.cluster_key, embedding: Float32Array.from(face.embedding) });
    touchedClusterKeys.add(face.cluster_key);
  }

  const record = { photo_id: photoId, photo_name: photoName, indexed_at: new Date().toISOString(), faces };
  await base44.asServiceRole.entities.PhotoFaceIndex.create(record);
  records.push(record);
  const clusterCount = await upsertClusters(base44, records, touchedClusterKeys);
  return { alreadyIndexed: false, faceCount: faces.length, clusterCount };
}

export async function listClusters(base44: any) {
  const [photos, clusters] = await Promise.all([
    cachedPhotos(base44),
    base44.asServiceRole.entities.FaceCluster.filter({}, undefined, entityPageSize),
  ]);
  const photoById = new Map(photos.map((photo) => [photo.id, photo]));
  return {
    clusters: clusters
      .filter((cluster: any) => cluster.hidden !== true)
      .toSorted((first: any, second: any) => (second.face_count ?? 0) - (first.face_count ?? 0))
      .map((cluster: any) => {
        const cover = photoById.get(cluster.cover_photo_id);
        return {
          clusterKey: cluster.cluster_key,
          faceCount: cluster.face_count ?? 0,
          photoIds: cluster.photo_ids ?? [],
          coverBox: cluster.cover_box ?? [],
          coverThumbnailUrl: cover?.thumbnailUrl ?? "",
          coverAspect: cover && cover.height > 0 ? cover.width / cover.height : 1.5,
        };
      }),
  };
}

// Thumbnail fetch plus pure-JS jpeg decode runs ~1s per photo, so one request
// cannot process a whole event without hitting the platform request timeout.
// Each call handles one small batch; the caller loops until done.
const recomputeBatchLimit = 10;

// Backfills sharpness for faces indexed before the browser reported it (from
// Drive thumbnail crops), one batch per call. Once nothing is left to
// backfill, the final call re-picks every cover and centroid in place.
// Cluster keys never change, so participant claims survive — unlike a reset.
export async function recomputeClusters(
  base44: any,
  fetcher: typeof fetch = fetch,
): Promise<{ done: boolean; analyzedPhotos: number; failedPhotos: number; remainingPhotos: number; clusterCount?: number }> {
  // jpeg-js loads lazily: node-based tests import this module without npm: support.
  const { default: jpeg } = await import("npm:jpeg-js@0.4.4");
  // The cached listing keeps the ~20-call batch loop from re-walking the
  // Drive folder tree on every request.
  const [photos, records] = await Promise.all([
    cachedPhotos(base44),
    listIndexRecords(base44),
  ]);
  const photoById = new Map(photos.map((photo) => [photo.id, photo]));
  const pending = records.filter((record) => {
    const faces = record.faces ?? [];
    return faces.length > 0 && faces.some((face) => typeof face.sharpness !== "number") &&
      record.id && photoById.has(record.photo_id);
  });

  if (pending.length === 0) {
    const touchedClusterKeys = new Set(
      records.flatMap((record) => (record.faces ?? []).map((face) => face.cluster_key))
        .filter((key) => key && !key.startsWith(noiseClusterPrefix)),
    );
    const clusterCount = await upsertClusters(base44, records, touchedClusterKeys);
    return { done: true, analyzedPhotos: 0, failedPhotos: 0, remainingPhotos: 0, clusterCount };
  }

  let analyzedPhotos = 0;
  let failedPhotos = 0;
  for (const record of pending.slice(0, recomputeBatchLimit)) {
    const faces = record.faces ?? [];
    try {
      const bytes = await fetchThumbnail(photoById.get(record.photo_id)!.thumbnailUrl, fetcher);
      if (!bytes) throw new Error("Thumbnail unavailable");
      const image = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 128 });
      for (const face of faces) face.sharpness = round(faceSharpness(image, face.box), 100);
      analyzedPhotos += 1;
    } catch (error) {
      console.error(`face-index: sharpness backfill failed for ${record.photo_name || record.photo_id}: ${error}`);
      // Zero marks the record processed so a broken thumbnail cannot make the
      // caller loop forever; the face just ranks last for covers.
      for (const face of faces) face.sharpness = typeof face.sharpness === "number" ? face.sharpness : 0;
      failedPhotos += 1;
    }
    await base44.asServiceRole.entities.PhotoFaceIndex.update(record.id, { faces });
  }
  return {
    done: false,
    analyzedPhotos,
    failedPhotos,
    remainingPhotos: pending.length - Math.min(pending.length, recomputeBatchLimit),
  };
}

export async function resetIndex(base44: any): Promise<{ deletedRecords: number; deletedClusters: number }> {
  const [records, clusters] = await Promise.all([
    listIndexRecords(base44),
    base44.asServiceRole.entities.FaceCluster.filter({}, undefined, entityPageSize),
  ]);
  for (const record of records) {
    if (record.id) await base44.asServiceRole.entities.PhotoFaceIndex.delete(record.id);
  }
  for (const cluster of clusters) {
    await base44.asServiceRole.entities.FaceCluster.delete(cluster.id);
  }
  return { deletedRecords: records.length, deletedClusters: clusters.length };
}

export function parseFaces(payload: unknown, photoId: string): IndexedFace[] {
  if (payload === undefined || payload === null) return [];
  if (!Array.isArray(payload) || payload.length > maximumFacesPerPhoto) throw new Error("Face payload is invalid");
  return payload.map((face: IngestFacePayload, faceIndex) => {
    const box = face.box;
    const embedding = face.embedding;
    if (
      !Array.isArray(box) || box.length !== 4 || !box.every(isUnitNumber) ||
      !Array.isArray(embedding) || embedding.length !== embeddingLength ||
      !embedding.every((value) => typeof value === "number" && Number.isFinite(value))
    ) {
      throw new Error("Face payload is invalid");
    }
    const norm = Math.sqrt(embedding.reduce((sum: number, value: number) => sum + value * value, 0));
    if (Math.abs(norm - 1) > 0.05) throw new Error("Face embedding must be L2-normalized");
    const score = typeof face.score === "number" && Number.isFinite(face.score) ? clamp01(face.score) : 0;
    const sharpness = face.sharpness;
    const hasSharpness = typeof sharpness === "number" && Number.isFinite(sharpness) && sharpness >= 0;
    return {
      face_id: `${photoId}_${faceIndex}`,
      cluster_key: "",
      score: round(score, 100),
      ...(hasSharpness ? { sharpness: round(sharpness, 100) } : {}),
      box: box.map((value: number) => round(value, 1e4)),
      embedding: embedding.map((value: number) => round(value, 1e4)),
    };
  });
}

const noiseClusterPrefix = "noise_";
const minimumSeedFaceHeight = 0.06;

function faceHeight(box: number[]): number {
  return (box[3] ?? 0) - (box[1] ?? 0);
}

function assignCluster(embedding: Float32Array, knownFaces: { clusterKey: string; embedding: Float32Array }[]): string {
  let bestSimilarity = similarityThreshold;
  let bestClusterKey = "";
  for (const known of knownFaces) {
    let similarity = 0;
    for (let i = 0; i < embedding.length; i++) similarity += embedding[i] * known.embedding[i];
    if (similarity < bestSimilarity) continue;
    bestSimilarity = similarity;
    bestClusterKey = known.clusterKey;
  }
  return bestClusterKey;
}

// Detection score measures face-ness, not quality — a large motion-blurred
// face can outscore a sharp one, so the cover ranks by score weighted with
// sharpness (variance of Laplacian, relative to the sharpest cluster member).
export function pickCoverFace<T extends { score: number; sharpness?: number }>(faces: T[]): T {
  const measured = faces.filter((face) => typeof face.sharpness === "number");
  const maxSharpness = measured.reduce((max, face) => Math.max(max, face.sharpness ?? 0), 0);
  const candidates = maxSharpness > 0 ? measured : faces;
  const quality = (face: T) => maxSharpness > 0 ? face.score * ((face.sharpness ?? 0) / maxSharpness) : face.score;
  return candidates.toSorted((first, second) => quality(second) - quality(first))[0]!;
}

// L2-normalized mean embedding; lets listings compare whole clusters for
// probable same-person pairs that stayed below the merge threshold.
export function clusterCentroid(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];
  const centroid = new Array<number>(embeddings[0]!.length).fill(0);
  for (const embedding of embeddings) {
    for (let i = 0; i < centroid.length; i++) centroid[i] += embedding[i]!;
  }
  const norm = Math.sqrt(centroid.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return centroid.map(() => 0);
  return centroid.map((value) => round(value / norm, 1e4));
}

async function upsertClusters(base44: any, records: IndexRecord[], touchedClusterKeys: Set<string>): Promise<number> {
  const existing = await base44.asServiceRole.entities.FaceCluster.filter({}, undefined, entityPageSize);
  if (touchedClusterKeys.size === 0) return existing.length;
  const existingByKey = new Map<string, any>(existing.map((cluster: any) => [cluster.cluster_key, cluster]));

  const operations: (() => Promise<void>)[] = [];
  for (const clusterKey of touchedClusterKeys) {
    if (clusterKey.startsWith(noiseClusterPrefix)) continue;
    const memberFaces = records.flatMap((record) =>
      (record.faces ?? [])
        .filter((face) => face.cluster_key === clusterKey)
        .map((face) => ({ ...face, photoId: record.photo_id }))
    );
    const cover = pickCoverFace(memberFaces);
    const fields = {
      cluster_key: clusterKey,
      face_count: memberFaces.length,
      photo_ids: [...new Set(memberFaces.map(({ photoId }) => photoId))],
      cover_photo_id: cover.photoId,
      cover_box: cover.box,
      cover_score: cover.score,
      cover_sharpness: cover.sharpness ?? 0,
      centroid: clusterCentroid(memberFaces.map(({ embedding }) => embedding)),
    };
    const current = existingByKey.get(clusterKey);
    if (current) operations.push(() => base44.asServiceRole.entities.FaceCluster.update(current.id, fields));
    else operations.push(() => base44.asServiceRole.entities.FaceCluster.create({ ...fields, hidden: false }));
  }
  // A recompute touches every cluster at once; sequential writes would stack
  // into the request timeout, so writes run in small parallel batches.
  for (let batchStart = 0; batchStart < operations.length; batchStart += 8) {
    await Promise.all(operations.slice(batchStart, batchStart + 8).map((operation) => operation()));
  }
  return existing.length + [...touchedClusterKeys].filter((key) => !existingByKey.has(key)).length;
}

// Candidate pairs for admin-confirmed merging: clusters whose centroids sit
// above this cosine similarity are probably the same person split by pose or
// lighting. Sharing a photo is hard negative evidence (one person cannot
// appear twice in a frame), so such pairs are never offered.
const mergeCandidateThreshold = 0.55;

export async function listMergeCandidates(base44: any) {
  const [photos, records, clusters] = await Promise.all([
    cachedPhotos(base44),
    listIndexRecords(base44),
    base44.asServiceRole.entities.FaceCluster.filter({}, undefined, entityPageSize),
  ]);
  const photoById = new Map(photos.map((photo) => [photo.id, photo]));
  const visible = clusters.filter((cluster: any) => cluster.hidden !== true && Array.isArray(cluster.photo_ids));
  const centroidByKey = new Map<string, number[]>();
  for (const cluster of visible) {
    const stored = Array.isArray(cluster.centroid) && cluster.centroid.length > 0 ? cluster.centroid : null;
    centroidByKey.set(cluster.cluster_key, stored ?? clusterCentroid(memberEmbeddings(records, cluster.cluster_key)));
  }

  const side = (cluster: any) => {
    const cover = photoById.get(cluster.cover_photo_id);
    return {
      clusterKey: cluster.cluster_key,
      faceCount: cluster.face_count ?? 0,
      photoCount: (cluster.photo_ids ?? []).length,
      coverBox: cluster.cover_box ?? [],
      coverThumbnailUrl: cover?.thumbnailUrl ?? "",
      coverAspect: cover && cover.height > 0 ? cover.width / cover.height : 1.5,
    };
  };

  const candidates = [];
  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      const left = visible[i];
      const right = visible[j];
      const similarity = dotProduct(centroidByKey.get(left.cluster_key) ?? [], centroidByKey.get(right.cluster_key) ?? []);
      if (similarity < mergeCandidateThreshold) continue;
      if (sharesPhoto(left.photo_ids ?? [], right.photo_ids ?? [])) continue;
      // Merge the smaller cluster into the larger so the more established key survives.
      const [source, target] = (left.face_count ?? 0) <= (right.face_count ?? 0) ? [left, right] : [right, left];
      candidates.push({ similarity: round(similarity, 100), source: side(source), target: side(target) });
    }
  }
  return { candidates: candidates.toSorted((first, second) => second.similarity - first.similarity) };
}

export async function mergeClusterPair(base44: any, sourceKeyRaw: unknown, targetKeyRaw: unknown) {
  const sourceKey = typeof sourceKeyRaw === "string" ? sourceKeyRaw : "";
  const targetKey = typeof targetKeyRaw === "string" ? targetKeyRaw : "";
  if (!sourceKey || !targetKey || sourceKey === targetKey) throw new Error("Merge pair is invalid");

  const clusters = await base44.asServiceRole.entities.FaceCluster.filter({}, undefined, entityPageSize);
  const source = clusters.find((cluster: any) => cluster.cluster_key === sourceKey);
  const target = clusters.find((cluster: any) => cluster.cluster_key === targetKey);
  if (!source || !target) throw new Error("Merge pair is invalid");
  if (sharesPhoto(source.photo_ids ?? [], target.photo_ids ?? [])) {
    throw new Error("These groups appear together in a photo and cannot be the same person");
  }

  const records = await listIndexRecords(base44);
  let mergedFaces = 0;
  for (const record of records) {
    const faces = record.faces ?? [];
    if (!faces.some((face) => face.cluster_key === sourceKey)) continue;
    for (const face of faces) {
      if (face.cluster_key !== sourceKey) continue;
      face.cluster_key = targetKey;
      mergedFaces += 1;
    }
    if (record.id) await base44.asServiceRole.entities.PhotoFaceIndex.update(record.id, { faces });
  }

  // Claims are personal pointers at cluster keys; every owner type follows the merge.
  let migratedClaims = 0;
  for (const entityName of ["Participant", "Mentor", "Judge"]) {
    const entity = base44.asServiceRole.entities[entityName];
    if (!entity) continue;
    const owners = await entity.filter({}, undefined, 5000);
    for (const owner of owners) {
      const keys = Array.isArray(owner.claimed_cluster_keys) ? owner.claimed_cluster_keys : [];
      if (!keys.includes(sourceKey)) continue;
      const next = [...new Set(keys.map((key: string) => key === sourceKey ? targetKey : key))];
      await entity.update(owner.id, { claimed_cluster_keys: next });
      migratedClaims += 1;
    }
  }

  await base44.asServiceRole.entities.FaceCluster.delete(source.id);
  await upsertClusters(base44, records, new Set([targetKey]));
  return { mergedFaces, migratedClaims, targetKey };
}

function memberEmbeddings(records: IndexRecord[], clusterKey: string): number[][] {
  return records.flatMap((record) => (record.faces ?? []).filter((face) => face.cluster_key === clusterKey).map((face) => face.embedding));
}

function sharesPhoto(left: string[], right: string[]): boolean {
  const rightIds = new Set(right);
  return left.some((photoId) => rightIds.has(photoId));
}

function dotProduct(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let sum = 0;
  for (let i = 0; i < left.length; i++) sum += left[i]! * right[i]!;
  return sum;
}

async function listIndexRecords(base44: any): Promise<IndexRecord[]> {
  return await base44.asServiceRole.entities.PhotoFaceIndex.filter({}, undefined, entityPageSize);
}

async function driveAccessToken(base44: any): Promise<string> {
  const { accessToken } = await base44.asServiceRole.connectors.getConnection("googledrive");
  return accessToken;
}

function isUnitNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number, precision: number): number {
  return Math.round(value * precision) / precision;
}
