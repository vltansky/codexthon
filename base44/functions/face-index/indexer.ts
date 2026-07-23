import { alignFace, alignedSize, embeddingTensorData, normalizeEmbedding } from "./align.ts";
import { fetchThumbnail, listIndexablePhotos, type IndexablePhoto } from "./drive.ts";
import { decodeJpeg } from "./imaging.ts";
import { faceSessions, ort } from "./models.ts";
import { decodeDetections, preprocessForDetection } from "./scrfd.ts";

// Threshold calibrated for buffalo_s embeddings (POC on 194 real event photos:
// same-person cross-photo cosine ~0.71, strangers well below 0.5).
const similarityThreshold = 0.5;
const detectionThreshold = 0.5;
export const defaultBatchSize = 6;
export const maximumBatchSize = 20;
// Stop picking up new photos once an invocation runs this long; the admin UI
// keeps calling "run" until remaining is 0.
const invocationBudgetMs = 40_000;
const entityPageSize = 2000;

interface IndexedFace {
  face_id: string;
  cluster_key: string;
  score: number;
  box: number[];
  embedding: number[];
}

interface IndexRecord {
  id?: string;
  photo_id: string;
  photo_name?: string;
  faces?: IndexedFace[];
}

interface KnownFace {
  clusterKey: string;
  embedding: Float32Array;
}

export interface IndexStatus {
  totalPhotos: number;
  indexedPhotos: number;
  remainingPhotos: number;
  faceCount: number;
  clusterCount: number;
}

export async function indexStatus(base44: any): Promise<IndexStatus> {
  const [photos, records, clusters] = await Promise.all([
    listIndexablePhotos(await driveAccessToken(base44)),
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

export interface IndexRunResult {
  indexedNow: number;
  facesAdded: number;
  remainingPhotos: number;
  clusterCount: number;
  skippedPhotos: string[];
  tookMs: number;
}

export async function runIndexBatch(base44: any, requestedBatchSize: unknown): Promise<IndexRunResult> {
  const startedAt = performance.now();
  const batchSize = clampBatchSize(requestedBatchSize);
  const accessToken = await driveAccessToken(base44);
  const [photos, records, sessions] = await Promise.all([
    listIndexablePhotos(accessToken),
    listIndexRecords(base44),
    faceSessions(),
  ]);

  const indexedIds = new Set(records.map(({ photo_id }) => photo_id));
  const pending = photos.filter(({ id }) => !indexedIds.has(id));
  const batch = pending.slice(0, batchSize);

  const knownFaces: KnownFace[] = records.flatMap((record) =>
    (record.faces ?? []).map((face) => ({ clusterKey: face.cluster_key, embedding: Float32Array.from(face.embedding) }))
  );

  let indexedNow = 0;
  let facesAdded = 0;
  const skippedPhotos: string[] = [];
  const touchedClusterKeys = new Set<string>();

  for (const photo of batch) {
    if (performance.now() - startedAt > invocationBudgetMs) break;
    const record = await indexPhoto(photo, sessions, knownFaces);
    if (!record) {
      skippedPhotos.push(photo.name);
      continue;
    }
    await base44.asServiceRole.entities.PhotoFaceIndex.create(record);
    records.push(record);
    indexedNow++;
    facesAdded += record.faces.length;
    for (const face of record.faces) touchedClusterKeys.add(face.cluster_key);
  }

  const clusterCount = await upsertClusters(base44, records, touchedClusterKeys);
  return {
    indexedNow,
    facesAdded,
    remainingPhotos: pending.length - indexedNow - skippedPhotos.length,
    clusterCount,
    skippedPhotos,
    tookMs: Math.round(performance.now() - startedAt),
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

async function indexPhoto(
  photo: IndexablePhoto,
  sessions: Awaited<ReturnType<typeof faceSessions>>,
  knownFaces: KnownFace[],
): Promise<(IndexRecord & { faces: IndexedFace[]; indexed_at: string }) | null> {
  const thumbnailBytes = await fetchThumbnail(photo.thumbnailUrl);
  // Transient fetch failures skip the photo so a later run retries it.
  if (!thumbnailBytes) return null;

  let faces: IndexedFace[];
  try {
    faces = await detectAndEmbed(thumbnailBytes, sessions, knownFaces, photo.id);
  } catch (error) {
    // Deterministic decode/inference failures record an empty index entry so
    // the photo is not retried forever.
    console.error(`face-index: could not process ${photo.name}: ${error}`);
    faces = [];
  }
  return { photo_id: photo.id, photo_name: photo.name, indexed_at: new Date().toISOString(), faces };
}

async function detectAndEmbed(
  imageBytes: Uint8Array,
  sessions: Awaited<ReturnType<typeof faceSessions>>,
  knownFaces: KnownFace[],
  photoId: string,
): Promise<IndexedFace[]> {
  const image = decodeJpeg(imageBytes);
  const detectionInput = preprocessForDetection(image);
  const detectionOutput = await sessions.detector.run({
    [sessions.detector.inputNames[0]]: new ort.Tensor("float32", detectionInput.tensorData, [1, 3, detectionInput.size, detectionInput.size]),
  });
  const detections = decodeDetections(
    sessions.detector.outputNames.map((name: string) => detectionOutput[name] as { dims: readonly number[]; data: Float32Array }),
    detectionInput,
    detectionThreshold,
  );

  const faces: IndexedFace[] = [];
  for (const [faceIndex, detection] of detections.entries()) {
    const aligned = alignFace(image, detection.keypoints);
    const embeddingOutput = await sessions.recognizer.run({
      [sessions.recognizer.inputNames[0]]: new ort.Tensor("float32", embeddingTensorData(aligned), [1, 3, alignedSize, alignedSize]),
    });
    const embedding = normalizeEmbedding((embeddingOutput[sessions.recognizer.outputNames[0]] as { data: Float32Array }).data);

    const clusterKey = assignCluster(embedding, knownFaces);
    knownFaces.push({ clusterKey, embedding });
    faces.push({
      face_id: `${photoId}_${faceIndex}`,
      cluster_key: clusterKey,
      score: round(detection.score, 100),
      box: relativeBox(detection.box, image.width, image.height),
      embedding: [...embedding].map((value) => round(value, 1e4)),
    });
  }
  return faces;
}

function assignCluster(embedding: Float32Array, knownFaces: KnownFace[]): string {
  let bestSimilarity = similarityThreshold;
  let bestClusterKey = "";
  for (const known of knownFaces) {
    let similarity = 0;
    for (let i = 0; i < embedding.length; i++) similarity += embedding[i] * known.embedding[i];
    if (similarity < bestSimilarity) continue;
    bestSimilarity = similarity;
    bestClusterKey = known.clusterKey;
  }
  return bestClusterKey || `person_${crypto.randomUUID().slice(0, 13)}`;
}

async function upsertClusters(base44: any, records: IndexRecord[], touchedClusterKeys: Set<string>): Promise<number> {
  const existing = await base44.asServiceRole.entities.FaceCluster.filter({}, undefined, entityPageSize);
  if (touchedClusterKeys.size === 0) return existing.length;
  const existingByKey = new Map<string, any>(existing.map((cluster: any) => [cluster.cluster_key, cluster]));

  for (const clusterKey of touchedClusterKeys) {
    const memberFaces = records.flatMap((record) =>
      (record.faces ?? [])
        .filter((face) => face.cluster_key === clusterKey)
        .map((face) => ({ ...face, photoId: record.photo_id }))
    );
    const cover = memberFaces.toSorted((first, second) => second.score - first.score)[0];
    const fields = {
      cluster_key: clusterKey,
      face_count: memberFaces.length,
      photo_ids: [...new Set(memberFaces.map(({ photoId }) => photoId))],
      cover_photo_id: cover.photoId,
      cover_box: cover.box,
      cover_score: cover.score,
    };
    const current = existingByKey.get(clusterKey);
    if (current) await base44.asServiceRole.entities.FaceCluster.update(current.id, fields);
    else await base44.asServiceRole.entities.FaceCluster.create({ ...fields, hidden: false });
  }
  return existing.length + [...touchedClusterKeys].filter((key) => !existingByKey.has(key)).length;
}

async function listIndexRecords(base44: any): Promise<IndexRecord[]> {
  return await base44.asServiceRole.entities.PhotoFaceIndex.filter({}, undefined, entityPageSize);
}

async function driveAccessToken(base44: any): Promise<string> {
  const { accessToken } = await base44.asServiceRole.connectors.getConnection("googledrive");
  return accessToken;
}

function relativeBox(box: [number, number, number, number], width: number, height: number): number[] {
  return [box[0] / width, box[1] / height, box[2] / width, box[3] / height].map((value) => round(clamp01(value), 1e4));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number, precision: number): number {
  return Math.round(value * precision) / precision;
}

function clampBatchSize(batchSize: unknown): number {
  if (typeof batchSize !== "number" || !Number.isInteger(batchSize) || batchSize < 1) return defaultBatchSize;
  return Math.min(batchSize, maximumBatchSize);
}
