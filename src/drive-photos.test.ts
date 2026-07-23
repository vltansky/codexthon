import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const driveModuleUrl = pathToFileURL(resolve("base44/functions/participant-photos/drive.ts")).href;

interface DriveModule {
  listDrivePhotos(accessToken: string, fetcher: typeof fetch): Promise<Array<Record<string, string>>>;
  listEventFolderTreeIds(accessToken: string, fetcher: typeof fetch): Promise<string[]>;
  isDrivePhotoInEventFolder(accessToken: string, photoId: string, allowedParentIds: ReadonlySet<string>, fetcher: typeof fetch): Promise<boolean>;
  normalizeSelectedPhotoIds(selectedPhotoIds: unknown): string[];
}

const eventFolderId = "event-photo-folder";
Object.assign(globalThis, { Deno: { env: { get: (name: string) => name === "EVENT_PHOTO_FOLDER_ID" ? eventFolderId : undefined } } });

function isFolderQuery(url: string): boolean {
  return decodeURIComponent(url.replaceAll("+", " ")).includes("mimeType = 'application/vnd.google-apps.folder'");
}

test("lists image metadata from the configured event folder without exposing the Drive token", async () => {
  const { listDrivePhotos } = await import(driveModuleUrl) as DriveModule;
  let requestedUrl = "";
  let authorization = "";
  const photos = await listDrivePhotos("drive-access-token", async (input, init) => {
    requestedUrl = String(input);
    authorization = new Headers(init?.headers).get("Authorization") ?? "";
    return Response.json({
      files: [
        {
          id: "photo-1",
          name: "Team photo.png",
          mimeType: "image/png",
          thumbnailLink: "https://lh3.googleusercontent.com/thumbnail=s220",
          webViewLink: "https://drive.google.com/file/d/photo-1/view",
          createdTime: "2026-07-21T11:05:59.116Z",
        },
      ],
    });
  });

  const query = new URL(requestedUrl);
  assert.equal(authorization, "Bearer drive-access-token");
  assert.match(query.searchParams.get("q") ?? "", new RegExp(eventFolderId));
  assert.equal(query.searchParams.get("pageSize"), "1000");
  assert.match(query.searchParams.get("fields") ?? "", /imageMediaMetadata/);
  assert.deepEqual(photos, [{
    id: "photo-1",
    name: "Team photo.png",
    mimeType: "image/png",
    thumbnailUrl: "https://lh3.googleusercontent.com/thumbnail=s1000",
    viewUrl: "https://drive.google.com/file/d/photo-1/view",
    createdAt: "2026-07-21T11:05:59.116Z",
    width: 1600,
    height: 1067,
  }]);
});

test("maps real image dimensions and swaps them for EXIF-rotated photos", async () => {
  const { listDrivePhotos } = await import(driveModuleUrl) as DriveModule;
  const photos = await listDrivePhotos("drive-access-token", async (input) => {
    if (isFolderQuery(String(input))) return Response.json({ files: [] });
    return Response.json({
      files: [
        { id: "photo-landscape", name: "L.jpg", mimeType: "image/jpeg", thumbnailLink: "https://t/l", webViewLink: "https://v/l", imageMediaMetadata: { width: 4000, height: 3000 } },
        { id: "photo-rotated", name: "R.jpg", mimeType: "image/jpeg", thumbnailLink: "https://t/r", webViewLink: "https://v/r", imageMediaMetadata: { width: 4000, height: 3000, rotation: 1 } },
        { id: "photo-no-meta", name: "N.jpg", mimeType: "image/jpeg", thumbnailLink: "https://t/n", webViewLink: "https://v/n" },
      ],
    });
  });

  assert.deepEqual(photos.map(({ id, width, height }) => ({ id, width, height })), [
    { id: "photo-landscape", width: 4000, height: 3000 },
    { id: "photo-rotated", width: 3000, height: 4000 },
    { id: "photo-no-meta", width: 1600, height: 1067 },
  ]);
});

test("follows Drive pagination tokens so folders with hundreds of photos list fully", async () => {
  const { listDrivePhotos } = await import(driveModuleUrl) as DriveModule;
  const requestedPageTokens: Array<string | null> = [];
  const photos = await listDrivePhotos("drive-access-token", async (input) => {
    const url = String(input);
    if (isFolderQuery(url)) return Response.json({ files: [] });
    const pageToken = new URL(url).searchParams.get("pageToken");
    requestedPageTokens.push(pageToken);
    const pageNumber = requestedPageTokens.length;
    return Response.json({
      nextPageToken: pageNumber === 1 ? "token-2" : undefined,
      files: [{
        id: `photo-${pageNumber}`,
        name: `Photo ${pageNumber}.jpg`,
        mimeType: "image/jpeg",
        thumbnailLink: `https://example.test/${pageNumber}`,
        webViewLink: `https://drive.test/${pageNumber}`,
      }],
    });
  });

  assert.deepEqual(requestedPageTokens, [null, "token-2"]);
  assert.deepEqual(photos.map(({ id }) => id), ["photo-1", "photo-2"]);
});

test("includes photos from nested subfolders of the event folder", async () => {
  const { listDrivePhotos } = await import(driveModuleUrl) as DriveModule;
  const photos = await listDrivePhotos("drive-access-token", async (input) => {
    const url = String(input);
    const query = decodeURIComponent(url.replaceAll("+", " "));
    if (isFolderQuery(url)) {
      if (query.includes(`'${eventFolderId}' in parents`)) {
        return Response.json({ files: [{ id: "sub-folder-1", mimeType: "application/vnd.google-apps.folder" }] });
      }
      return Response.json({ files: [] });
    }
    assert.match(query, /'sub-folder-1' in parents/);
    assert.match(query, new RegExp(`'${eventFolderId}' in parents`));
    return Response.json({
      files: [
        { id: "root-photo", name: "Root.jpg", mimeType: "image/jpeg", thumbnailLink: "https://example.test/root", webViewLink: "https://drive.test/root", createdTime: "2026-07-21T10:00:00.000Z" },
        { id: "nested-photo", name: "Nested.jpg", mimeType: "image/jpeg", thumbnailLink: "https://example.test/nested", webViewLink: "https://drive.test/nested", createdTime: "2026-07-21T12:00:00.000Z" },
      ],
    });
  });

  assert.deepEqual(photos.map(({ id }) => id), ["nested-photo", "root-photo"]);
});

test("folder tree walk caps depth and returns the event folder first", async () => {
  const { listEventFolderTreeIds } = await import(driveModuleUrl) as DriveModule;
  const folderIds = await listEventFolderTreeIds("drive-access-token", async (input) => {
    const query = decodeURIComponent(String(input).replaceAll("+", " "));
    if (query.includes(`'${eventFolderId}' in parents`)) {
      return Response.json({ files: [{ id: "sub-a", mimeType: "application/vnd.google-apps.folder" }, { id: "sub-b", mimeType: "application/vnd.google-apps.folder" }] });
    }
    return Response.json({ files: [] });
  });

  assert.deepEqual(folderIds, [eventFolderId, "sub-a", "sub-b"]);
});

test("accepts a photo only when Drive confirms it is an image inside the event folder tree", async () => {
  const { isDrivePhotoInEventFolder } = await import(driveModuleUrl) as DriveModule;
  const folderFile = { mimeType: "image/jpeg", trashed: false, parents: [eventFolderId] };
  const allowed = new Set([eventFolderId, "sub-folder-1"]);

  assert.equal(await isDrivePhotoInEventFolder("token", "photo-12345", allowed, async () => Response.json(folderFile)), true);
  assert.equal(await isDrivePhotoInEventFolder("token", "photo-12345", allowed, async () => Response.json({ ...folderFile, parents: ["sub-folder-1"] })), true);
  assert.equal(await isDrivePhotoInEventFolder("token", "photo-12345", allowed, async () => Response.json({ ...folderFile, parents: ["another-folder"] })), false);
  assert.equal(await isDrivePhotoInEventFolder("token", "photo-12345", allowed, async () => Response.json({ ...folderFile, trashed: true })), false);
  assert.equal(await isDrivePhotoInEventFolder("token", "photo-12345", allowed, async () => new Response(null, { status: 404 })), false);
  assert.equal(await isDrivePhotoInEventFolder("token", "../escape", allowed, async () => Response.json(folderFile)), false);
});

test("reports transient Drive failures instead of calling a valid photo ineligible", async () => {
  const { isDrivePhotoInEventFolder } = await import(driveModuleUrl) as DriveModule;
  const allowed = new Set([eventFolderId]);
  await assert.rejects(
    isDrivePhotoInEventFolder("token", "photo-12345", allowed, async () => new Response(null, { status: 500 })),
    /Could not verify/,
  );
  await assert.rejects(
    isDrivePhotoInEventFolder("token", "photo-12345", allowed, async () => new Response(null, { status: 429 })),
    /Could not verify/,
  );
});

test("normalizes selection shapes and rejects invalid ids before any Drive call", async () => {
  const { normalizeSelectedPhotoIds } = await import(driveModuleUrl) as DriveModule;

  assert.deepEqual(normalizeSelectedPhotoIds(["photo-2", "photo-2", "photo-1"]), ["photo-2", "photo-1"]);
  assert.throws(() => normalizeSelectedPhotoIds("photo-1"), /selection is invalid/i);
  assert.throws(() => normalizeSelectedPhotoIds([42]), /selection is invalid/i);
  assert.throws(() => normalizeSelectedPhotoIds(["not/a/drive/id"]), /selection is invalid/i);
  assert.throws(() => normalizeSelectedPhotoIds(Array.from({ length: 501 }, (_, index) => `photo-${index}`)), /selection is invalid/i);
});
