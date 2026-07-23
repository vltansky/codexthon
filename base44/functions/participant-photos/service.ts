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
}

export interface ParticipantPhotosPage {
  photos: DrivePhoto[];
  page: number;
  pageSize: number;
  pageCount: number;
  totalCount: number;
  selectedPhotoIds: string[];
  photosFolderLink: string | null;
  sourceFolderLink: string;
}

export async function listParticipantPhotos(
  base44: any,
  participant: any,
  request: PhotoListRequest,
  fetcher: typeof fetch = fetch,
): Promise<ParticipantPhotosPage> {
  const photos = await listDrivePhotos(await driveAccessToken(base44), fetcher);
  const availableIds = new Set(photos.map(({ id }) => id));
  const selectedPhotoIds = storedSelection(participant).filter((photoId) => availableIds.has(photoId));

  const selectedIds = new Set(selectedPhotoIds);
  const source = request.view === "mine" ? photos.filter(({ id }) => selectedIds.has(id)) : photos;
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
  const storedIds = storedSelection(participant);
  if (storedIds.length === 0) throw new Error("No photos selected");
  const accessToken = await driveAccessToken(base44);
  const photos = await listDrivePhotos(accessToken, fetcher);
  const selectedIds = new Set(storedIds);
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
