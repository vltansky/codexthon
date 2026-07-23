const drivePageSize = 1000;
const maximumListRequests = 3;
const maximumFolderCount = 30;
const maximumFolderDepth = 4;
const parentClauseBatchSize = 8;
const photoIdPattern = /^[\w-]{5,130}$/;

function eventPhotoFolderId(): string {
  const folderId = Deno.env.get("EVENT_PHOTO_FOLDER_ID")?.trim() ?? "";
  if (!photoIdPattern.test(folderId)) throw new Error("Event photo folder is not configured");
  return folderId;
}

export interface IndexablePhoto {
  id: string;
  name: string;
  thumbnailUrl: string;
  createdAt: string;
}

interface DriveFile {
  id?: string;
  name?: string;
  mimeType?: string;
  thumbnailLink?: string;
  createdTime?: string;
}

async function listFolderTreeIds(accessToken: string, fetcher: typeof fetch): Promise<string[]> {
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

export async function listIndexablePhotos(accessToken: string, fetcher: typeof fetch = fetch): Promise<IndexablePhoto[]> {
  const folderIds = await listFolderTreeIds(accessToken, fetcher);
  const photos: IndexablePhoto[] = [];
  for (let batchStart = 0; batchStart < folderIds.length; batchStart += parentClauseBatchSize) {
    const parentsClause = folderIds
      .slice(batchStart, batchStart + parentClauseBatchSize)
      .map((folderId) => `'${folderId}' in parents`)
      .join(" or ");
    let pageToken = "";
    for (let requestIndex = 0; requestIndex < maximumListRequests; requestIndex++) {
      const parameters = new URLSearchParams({
        q: `(${parentsClause}) and trashed = false and mimeType contains 'image/'`,
        fields: "nextPageToken,files(id,name,mimeType,thumbnailLink,createdTime)",
        orderBy: "createdTime desc",
        pageSize: String(drivePageSize),
      });
      if (pageToken) parameters.set("pageToken", pageToken);
      const response = await fetcher(`https://www.googleapis.com/drive/v3/files?${parameters}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error("Could not load event photos");

      const data = await response.json() as { nextPageToken?: string; files?: DriveFile[] };
      for (const file of data.files ?? []) {
        if (!file.id || !file.name || !file.mimeType?.startsWith("image/") || !file.thumbnailLink) continue;
        photos.push({
          id: file.id,
          name: file.name,
          // Drive issues =s220 thumbnails by default; 1000px keeps small faces detectable.
          thumbnailUrl: file.thumbnailLink.replace(/=s\d+$/, "=s1000"),
          createdAt: file.createdTime ?? "",
        });
      }
      pageToken = data.nextPageToken ?? "";
      if (!pageToken) break;
    }
  }
  return photos.toSorted((first, second) => second.createdAt.localeCompare(first.createdAt));
}

export async function fetchThumbnail(url: string, fetcher: typeof fetch = fetch): Promise<Uint8Array | null> {
  const response = await fetcher(url);
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("image/jpeg") && !contentType.includes("image/jpg")) return null;
  return new Uint8Array(await response.arrayBuffer());
}
