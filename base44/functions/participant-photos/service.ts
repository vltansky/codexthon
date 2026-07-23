import {
  copyDrivePhotoToFolder,
  createSharedDriveFolder,
  driveFolderLink,
  eventPhotoFolderLink,
  findOrCreatePicksParentFolder,
  getDriveFolder,
  isDrivePhotoInEventFolder,
  listDriveFolderCopies,
  listDrivePhotos,
  listEventFolderTreeIds,
  normalizeSelectedPhotoIds,
  trashDriveFile,
  type DrivePhoto,
} from "./drive.ts";

const defaultPageSize = 24;
const maximumPageSize = 60;

export interface PhotoListRequest {
  view?: unknown;
  page?: unknown;
  pageSize?: unknown;
  clusterKey?: unknown;
}

export interface ParticipantPhotosPage {
  photos: DrivePhoto[];
  page: number;
  pageSize: number;
  pageCount: number;
  totalCount: number;
  selectedPhotoIds: string[];
  matchedPhotoIds: string[];
  claimedClusterKeys: string[];
  photosFolderLink: string | null;
  sourceFolderLink: string;
}

export async function listParticipantPhotos(
  base44: any,
  participant: any,
  request: PhotoListRequest,
  fetcher: typeof fetch = fetch,
): Promise<ParticipantPhotosPage> {
  const [photos, clusters] = await Promise.all([
    listDrivePhotos(await driveAccessToken(base44), fetcher),
    loadFaceClusters(base44),
  ]);
  const availableIds = new Set(photos.map(({ id }) => id));
  const selectedPhotoIds = storedSelection(participant).filter((photoId) => availableIds.has(photoId));
  const claimedKeys = claimedClusterKeys(participant);
  const matchedPhotoIds = matchedIdsFromClusters(clusters, claimedKeys, availableIds);

  const selectedIds = new Set(selectedPhotoIds);
  const matchedIds = new Set(matchedPhotoIds);
  const source = photoSource(photos, request, selectedIds, matchedIds, clusters);
  const pageSize = clampPageSize(request.pageSize);
  const pageCount = Math.max(1, Math.ceil(source.length / pageSize));
  const page = clampPage(request.page, pageCount);
  return {
    photos: source.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageSize,
    pageCount,
    totalCount: source.length,
    selectedPhotoIds,
    matchedPhotoIds,
    claimedClusterKeys: claimedKeys,
    photosFolderLink: typeof participant.photos_folder_id === "string" && participant.photos_folder_id
      ? driveFolderLink(participant.photos_folder_id)
      : null,
    sourceFolderLink: eventPhotoFolderLink(),
  };
}

export async function saveParticipantPhotoSelection(
  base44: any,
  participant: any,
  requestedSelection: unknown,
  fetcher: typeof fetch = fetch,
): Promise<{ selectedPhotoIds: string[] }> {
  const selectedPhotoIds = normalizeSelectedPhotoIds(requestedSelection);
  const storedIds = new Set(storedSelection(participant));
  const addedIds = selectedPhotoIds.filter((photoId) => !storedIds.has(photoId));

  // Only additions hit Drive, one metadata probe each, so toggles stay fast
  // even when the event folder holds hundreds of photos.
  if (addedIds.length > 0) {
    const accessToken = await driveAccessToken(base44);
    const allowedParentIds = new Set(await listEventFolderTreeIds(accessToken, fetcher));
    const checks = await Promise.all(addedIds.map((photoId) => isDrivePhotoInEventFolder(accessToken, photoId, allowedParentIds, fetcher)));
    if (checks.includes(false)) throw new Error("Selected photo is not in the event folder");
  }

  await base44.asServiceRole.entities.Participant.update(participant.id, { selected_photo_ids: selectedPhotoIds });
  return { selectedPhotoIds };
}

export async function exportParticipantPhotosFolder(
  base44: any,
  participant: any,
  fetcher: typeof fetch = fetch,
): Promise<{ folderLink: string; photoCount: number }> {
  const accessToken = await driveAccessToken(base44);
  const [photos, clusters] = await Promise.all([listDrivePhotos(accessToken, fetcher), loadFaceClusters(base44)]);
  const availableIds = new Set(photos.map(({ id }) => id));
  // The folder mirrors "my photos": manual picks plus photos matched through
  // claimed face groups.
  const selectedIds = new Set([
    ...storedSelection(participant).filter((photoId) => availableIds.has(photoId)),
    ...matchedIdsFromClusters(clusters, claimedClusterKeys(participant), availableIds),
  ]);
  const selectedPhotos = photos.filter(({ id }) => selectedIds.has(id));
  if (selectedPhotos.length === 0) throw new Error("No photos selected");

  const storedFolderId = typeof participant.photos_folder_id === "string" ? participant.photos_folder_id : "";
  let folder = storedFolderId ? await getDriveFolder(accessToken, storedFolderId, fetcher) : null;
  if (!folder) {
    const parentFolderId = await findOrCreatePicksParentFolder(accessToken, fetcher);
    folder = await createSharedDriveFolder(accessToken, `Build Week photos – ${participant.display_name}`, parentFolderId, fetcher);
    await base44.asServiceRole.entities.Participant.update(participant.id, { photos_folder_id: folder.id });
  }

  const folderId = folder.id;
  const copies = await listDriveFolderCopies(accessToken, folderId, fetcher);
  const copiedSourceIds = new Set(copies.map(({ sourcePhotoId }) => sourcePhotoId));
  const operations = [
    ...selectedPhotos
      .filter(({ id }) => !copiedSourceIds.has(id))
      .map((photo) => () => copyDrivePhotoToFolder(accessToken, photo.id, folderId, photo.name, fetcher)),
    ...copies
      .filter(({ sourcePhotoId }) => !selectedIds.has(sourcePhotoId))
      .map((copy) => () => trashDriveFile(accessToken, copy.id, fetcher)),
  ];
  // Drive rate limits sit around 10 requests/second per user, so large syncs
  // run in small batches instead of one unbounded Promise.all.
  for (let batchStart = 0; batchStart < operations.length; batchStart += 8) {
    await Promise.all(operations.slice(batchStart, batchStart + 8).map((operation) => operation()));
  }
  return { folderLink: folder.link, photoCount: selectedPhotos.length };
}

export interface PersonCluster {
  clusterKey: string;
  faceCount: number;
  photoCount: number;
  coverThumbnailUrl: string;
  coverBox: number[];
  coverAspect: number;
  claimed: boolean;
}

export async function listPeopleClusters(
  base44: any,
  participant: any,
  fetcher: typeof fetch = fetch,
): Promise<{ people: PersonCluster[]; claimedClusterKeys: string[] }> {
  const [photos, clusters] = await Promise.all([
    listDrivePhotos(await driveAccessToken(base44), fetcher),
    loadFaceClusters(base44),
  ]);
  const availableIds = new Set(photos.map(({ id }) => id));
  const photoById = new Map(photos.map((photo) => [photo.id, photo]));
  const claimedKeys = claimedClusterKeys(participant);
  const claimed = new Set(claimedKeys);
  const people = clusters
    .filter((cluster: any) => cluster.hidden !== true)
    .map((cluster: any) => {
      const cover = photoById.get(cluster.cover_photo_id);
      return {
        clusterKey: String(cluster.cluster_key ?? ""),
        faceCount: cluster.face_count ?? 0,
        photoCount: (cluster.photo_ids ?? []).filter((photoId: string) => availableIds.has(photoId)).length,
        coverThumbnailUrl: cover?.thumbnailUrl ?? "",
        coverBox: Array.isArray(cluster.cover_box) ? cluster.cover_box : [],
        coverAspect: cover && cover.height > 0 ? cover.width / cover.height : 1.5,
        claimed: claimed.has(cluster.cluster_key),
      };
    })
    .filter((person: PersonCluster) => person.clusterKey && person.photoCount > 0 && person.coverThumbnailUrl)
    .toSorted((first: PersonCluster, second: PersonCluster) =>
      Number(second.claimed) - Number(first.claimed) || second.photoCount - first.photoCount);
  return { people, claimedClusterKeys: claimedKeys };
}

const maximumClaimedClusters = 25;

export async function claimFaceCluster(
  base44: any,
  participant: any,
  clusterKey: unknown,
  claimed: boolean,
): Promise<{ claimedClusterKeys: string[] }> {
  if (typeof clusterKey !== "string" || !clusterKey || clusterKey.length > 64) throw new Error("Face group is invalid");
  const current = claimedClusterKeys(participant);
  if (claimed) {
    const clusters = await loadFaceClusters(base44);
    if (!clusters.some((cluster: any) => cluster.cluster_key === clusterKey && cluster.hidden !== true)) {
      throw new Error("Face group is invalid");
    }
  }
  const next = claimed
    ? [...new Set([...current, clusterKey])]
    : current.filter((key) => key !== clusterKey);
  if (next.length > maximumClaimedClusters) throw new Error("Too many claimed face groups");
  await base44.asServiceRole.entities.Participant.update(participant.id, { claimed_cluster_keys: next });
  return { claimedClusterKeys: next };
}

function photoSource(
  photos: DrivePhoto[],
  request: PhotoListRequest,
  selectedIds: ReadonlySet<string>,
  matchedIds: ReadonlySet<string>,
  clusters: any[],
): DrivePhoto[] {
  if (request.view === "mine") return photos.filter(({ id }) => selectedIds.has(id) || matchedIds.has(id));
  if (request.view === "person") {
    const cluster = typeof request.clusterKey === "string"
      ? clusters.find((candidate: any) => candidate.cluster_key === request.clusterKey && candidate.hidden !== true)
      : undefined;
    const clusterPhotoIds = new Set<string>(cluster?.photo_ids ?? []);
    return photos.filter(({ id }) => clusterPhotoIds.has(id));
  }
  return photos;
}

async function loadFaceClusters(base44: any): Promise<any[]> {
  // The face index is optional: before the first indexing run (or in tests)
  // the FaceCluster entity may be absent, which simply means no matches.
  const entity = base44.asServiceRole.entities.FaceCluster;
  if (!entity) return [];
  return await entity.filter({}, undefined, 2000);
}

function claimedClusterKeys(participant: any): string[] {
  const keys = Array.isArray(participant.claimed_cluster_keys) ? participant.claimed_cluster_keys : [];
  return keys.filter((key: unknown): key is string => typeof key === "string" && key.length > 0);
}

function matchedIdsFromClusters(clusters: any[], claimedKeys: readonly string[], availableIds: ReadonlySet<string>): string[] {
  const claimed = new Set(claimedKeys);
  const matched = new Set<string>();
  for (const cluster of clusters) {
    if (!claimed.has(cluster.cluster_key)) continue;
    for (const photoId of cluster.photo_ids ?? []) {
      if (availableIds.has(photoId)) matched.add(photoId);
    }
  }
  return [...matched];
}

function storedSelection(participant: any): string[] {
  const storedIds = Array.isArray(participant.selected_photo_ids) ? participant.selected_photo_ids : [];
  return storedIds.filter((photoId: unknown): photoId is string => typeof photoId === "string");
}

async function driveAccessToken(base44: any): Promise<string> {
  const { accessToken } = await base44.asServiceRole.connectors.getConnection("googledrive");
  return accessToken;
}

function clampPageSize(pageSize: unknown): number {
  if (typeof pageSize !== "number" || !Number.isInteger(pageSize) || pageSize < 1) return defaultPageSize;
  return Math.min(pageSize, maximumPageSize);
}

function clampPage(page: unknown, pageCount: number): number {
  if (typeof page !== "number" || !Number.isInteger(page) || page < 1) return 1;
  return Math.min(page, pageCount);
}
