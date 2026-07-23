const drivePageSize = 1000;
const maximumListRequests = 3;
const maximumSelectionCount = 500;
const photoIdPattern = /^[\w-]{5,130}$/;

function eventPhotoFolderId(): string {
  const folderId = Deno.env.get("EVENT_PHOTO_FOLDER_ID")?.trim() ?? "";
  if (!photoIdPattern.test(folderId)) throw new Error("Event photo folder is not configured");
  return folderId;
}

export interface DrivePhoto {
  id: string;
  name: string;
  mimeType: string;
  thumbnailUrl: string;
  viewUrl: string;
  createdAt: string;
  width: number;
  height: number;
}

interface DriveFile {
  id?: string;
  name?: string;
  mimeType?: string;
  thumbnailLink?: string;
  webViewLink?: string;
  createdTime?: string;
  imageMediaMetadata?: { width?: number; height?: number; rotation?: number };
}

const fallbackPhotoWidth = 1600;
const fallbackPhotoHeight = 1067;

const maximumFolderCount = 30;
const maximumFolderDepth = 4;
const parentClauseBatchSize = 8;

export async function listEventFolderTreeIds(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<string[]> {
  const rootFolderId = eventPhotoFolderId();
  const folderIds = new Set([rootFolderId]);
  let frontier = [rootFolderId];
  for (let depth = 0; depth < maximumFolderDepth && frontier.length > 0 && folderIds.size < maximumFolderCount; depth++) {
    const nextFrontier: string[] = [];
    for (let batchStart = 0; batchStart < frontier.length; batchStart += parentClauseBatchSize) {
      const parentsClause = frontier
        .slice(batchStart, batchStart + parentClauseBatchSize)
        .map((folderId) => `'${folderId}' in parents`)
        .join(" or ");
      const parameters = new URLSearchParams({
        q: `(${parentsClause}) and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: "files(id,mimeType)",
        pageSize: String(drivePageSize),
      });
      const response = await fetcher(`https://www.googleapis.com/drive/v3/files?${parameters}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error("Could not load event photos");

      const data = await response.json() as { files?: DriveFile[] };
      for (const file of data.files ?? []) {
        if (!file.id || file.mimeType !== "application/vnd.google-apps.folder" || folderIds.has(file.id)) continue;
        if (folderIds.size >= maximumFolderCount) break;
        folderIds.add(file.id);
        nextFrontier.push(file.id);
      }
    }
    frontier = nextFrontier;
  }
  return [...folderIds];
}

export async function listDrivePhotos(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<DrivePhoto[]> {
  const folderIds = await listEventFolderTreeIds(accessToken, fetcher);
  const photos: DrivePhoto[] = [];
  for (let batchStart = 0; batchStart < folderIds.length; batchStart += parentClauseBatchSize) {
    const parentsClause = folderIds
      .slice(batchStart, batchStart + parentClauseBatchSize)
      .map((folderId) => `'${folderId}' in parents`)
      .join(" or ");
    let pageToken = "";
    for (let requestIndex = 0; requestIndex < maximumListRequests; requestIndex++) {
      const parameters = new URLSearchParams({
        q: `(${parentsClause}) and trashed = false and mimeType contains 'image/'`,
        fields: "nextPageToken,files(id,name,mimeType,thumbnailLink,webViewLink,createdTime,imageMediaMetadata(width,height,rotation))",
        orderBy: "createdTime desc",
        pageSize: String(drivePageSize),
      });
      if (pageToken) parameters.set("pageToken", pageToken);
      const response = await fetcher(`https://www.googleapis.com/drive/v3/files?${parameters}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error("Could not load event photos");

      const data = await response.json() as { nextPageToken?: string; files?: DriveFile[] };
      photos.push(...(data.files ?? []).flatMap(toDrivePhoto));
      pageToken = data.nextPageToken ?? "";
      if (!pageToken) break;
    }
  }
  return photos.toSorted((first, second) => second.createdAt.localeCompare(first.createdAt));
}

function toDrivePhoto(file: DriveFile): DrivePhoto[] {
  if (!file.id || !file.name || !file.mimeType?.startsWith("image/") || !file.thumbnailLink || !file.webViewLink) return [];
  const metadata = file.imageMediaMetadata ?? {};
  const rawWidth = metadata.width ?? fallbackPhotoWidth;
  const rawHeight = metadata.height ?? fallbackPhotoHeight;
  // Drive reports pre-rotation sensor dimensions; odd EXIF rotations render swapped.
  const rotated = (metadata.rotation ?? 0) % 2 === 1;
  return [{
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    // Drive issues =s220 thumbnails by default, too small for the gallery grid.
    thumbnailUrl: file.thumbnailLink.replace(/=s\d+$/, "=s1000"),
    viewUrl: file.webViewLink,
    createdAt: file.createdTime ?? "",
    width: rotated ? rawHeight : rawWidth,
    height: rotated ? rawWidth : rawHeight,
  }];
}

export async function isDrivePhotoInEventFolder(
  accessToken: string,
  photoId: string,
  allowedParentIds: ReadonlySet<string>,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (!photoIdPattern.test(photoId)) return false;
  const parameters = new URLSearchParams({ fields: "id,mimeType,trashed,parents" });
  const response = await fetcher(`https://www.googleapis.com/drive/v3/files/${photoId}?${parameters}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  // Only confirmed-absent or inaccessible files count as "not in the folder";
  // transient Drive failures must not masquerade as an invalid selection.
  if (response.status === 404 || response.status === 403) return false;
  if (!response.ok) throw new Error(`Could not verify the selected photo (Drive responded ${response.status})`);

  const file = await response.json() as { mimeType?: string; trashed?: boolean; parents?: string[] };
  return Boolean(file.mimeType?.startsWith("image/")) &&
    file.trashed !== true &&
    (file.parents ?? []).some((parentId) => allowedParentIds.has(parentId));
}

export interface DriveFolder {
  id: string;
  link: string;
}

export function driveFolderLink(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

export function eventPhotoFolderLink(): string {
  return driveFolderLink(eventPhotoFolderId());
}

export async function getDriveFolder(
  accessToken: string,
  folderId: string,
  fetcher: typeof fetch = fetch,
): Promise<DriveFolder | null> {
  if (!photoIdPattern.test(folderId)) return null;
  const parameters = new URLSearchParams({ fields: "id,mimeType,trashed" });
  const response = await fetcher(`https://www.googleapis.com/drive/v3/files/${folderId}?${parameters}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 404 || response.status === 403) return null;
  if (!response.ok) throw new Error("Could not prepare your Drive folder");

  const file = await response.json() as { mimeType?: string; trashed?: boolean };
  if (file.mimeType !== "application/vnd.google-apps.folder" || file.trashed === true) return null;
  return { id: folderId, link: driveFolderLink(folderId) };
}

const picksParentFolderName = "Build Week photo picks";

export async function findOrCreatePicksParentFolder(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const parameters = new URLSearchParams({
    q: `name = '${picksParentFolderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id)",
    pageSize: "1",
  });
  const searchResponse = await fetcher(`https://www.googleapis.com/drive/v3/files?${parameters}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!searchResponse.ok) throw new Error("Could not prepare your Drive folder");
  const data = await searchResponse.json() as { files?: Array<{ id?: string }> };
  const existingId = data.files?.[0]?.id;
  if (existingId) return existingId;

  const createResponse = await fetcher("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: picksParentFolderName, mimeType: "application/vnd.google-apps.folder" }),
  });
  if (!createResponse.ok) throw new Error("Could not prepare your Drive folder");
  const { id } = await createResponse.json() as { id?: string };
  if (!id) throw new Error("Could not prepare your Drive folder");
  return id;
}

export async function createSharedDriveFolder(
  accessToken: string,
  name: string,
  parentFolderId: string,
  fetcher: typeof fetch = fetch,
): Promise<DriveFolder> {
  const createResponse = await fetcher("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentFolderId] }),
  });
  if (!createResponse.ok) throw new Error("Could not prepare your Drive folder");
  const { id } = await createResponse.json() as { id?: string };
  if (!id) throw new Error("Could not prepare your Drive folder");

  const permissionResponse = await fetcher(`https://www.googleapis.com/drive/v3/files/${id}/permissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  if (!permissionResponse.ok) throw new Error("Could not prepare your Drive folder");
  return { id, link: driveFolderLink(id) };
}

export async function listDriveFolderCopies(
  accessToken: string,
  folderId: string,
  fetcher: typeof fetch = fetch,
): Promise<Array<{ id: string; sourcePhotoId: string }>> {
  const parameters = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "files(id,appProperties)",
    pageSize: String(drivePageSize),
  });
  const response = await fetcher(`https://www.googleapis.com/drive/v3/files?${parameters}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("Could not prepare your Drive folder");

  const data = await response.json() as { files?: Array<{ id?: string; appProperties?: { sourcePhotoId?: string } }> };
  return (data.files ?? []).flatMap((file) => {
    if (!file.id) return [];
    return [{ id: file.id, sourcePhotoId: file.appProperties?.sourcePhotoId ?? "" }];
  });
}

export async function copyDrivePhotoToFolder(
  accessToken: string,
  photoId: string,
  folderId: string,
  name: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher(`https://www.googleapis.com/drive/v3/files/${photoId}/copy`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, parents: [folderId], appProperties: { sourcePhotoId: photoId } }),
  });
  if (!response.ok) throw new Error("Could not prepare your Drive folder");
}

export async function trashDriveFile(
  accessToken: string,
  fileId: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
  if (!response.ok) throw new Error("Could not prepare your Drive folder");
}

export function normalizeSelectedPhotoIds(selectedPhotoIds: unknown): string[] {
  if (!Array.isArray(selectedPhotoIds) || selectedPhotoIds.length > maximumSelectionCount) {
    throw new Error("Photo selection is invalid");
  }

  const selectedIds = new Set<string>();
  for (const photoId of selectedPhotoIds) {
    if (typeof photoId !== "string" || !photoIdPattern.test(photoId)) {
      throw new Error("Photo selection is invalid");
    }
    selectedIds.add(photoId);
  }
  return [...selectedIds];
}
