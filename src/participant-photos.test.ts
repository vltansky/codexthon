import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const serviceModuleUrl = pathToFileURL(resolve("base44/functions/participant-photos/service.ts")).href;
const eventFolderId = "event-photo-folder";
Object.assign(globalThis, { Deno: { env: { get: (name: string) => name === "EVENT_PHOTO_FOLDER_ID" ? eventFolderId : undefined } } });

interface ServiceModule {
  listParticipantPhotos(base44: unknown, participant: unknown, request: Record<string, unknown>, fetcher: typeof fetch): Promise<{
    photos: Array<{ id: string }>;
    page: number;
    pageSize: number;
    pageCount: number;
    totalCount: number;
    selectedPhotoIds: string[];
    photosFolderLink: string | null;
    sourceFolderLink: string;
  }>;
  saveParticipantPhotoSelection(base44: unknown, participant: unknown, selection: unknown, fetcher: typeof fetch): Promise<{ selectedPhotoIds: string[] }>;
  downloadParticipantPhotosZip(base44: unknown, participant: unknown, fetcher: typeof fetch): Promise<ReadableStream<Uint8Array>>;
  exportParticipantPhotosFolder(base44: unknown, participant: unknown, fetcher: typeof fetch): Promise<{ folderLink: string; photoCount: number }>;
}

interface RecordedRequest {
  method: string;
  url: string;
  body: unknown;
}

function driveExportFetcher(routes: {
  folderLookup?: Response | null;
  picksParent?: string;
  existingCopies: Array<{ id: string; sourcePhotoId: string }>;
  eventFiles: unknown[];
}, requests: RecordedRequest[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes("/permissions")) return Response.json({});
    if (method === "PATCH") return Response.json({});
    if (url.endsWith("/copy")) return Response.json({});
    if (method === "POST") {
      const name = (JSON.parse(String(init?.body)) as { name?: string }).name;
      return Response.json({ id: name === "Build Week photo picks" ? "parent-1" : "folder-9" });
    }
    const query = decodeURIComponent(url.replaceAll("+", " "));
    if (query.includes("name = 'Build Week photo picks'")) {
      return Response.json({ files: routes.picksParent ? [{ id: routes.picksParent }] : [] });
    }
    if (query.includes("in parents")) {
      if (query.includes("'folder-9' in parents") || query.includes("'folder-old' in parents")) {
        return Response.json({ files: routes.existingCopies.map(({ id, sourcePhotoId }) => ({ id, appProperties: { sourcePhotoId } })) });
      }
      return Response.json({ files: routes.eventFiles });
    }
    return routes.folderLookup ?? Response.json({ id: "folder-9", mimeType: "application/vnd.google-apps.folder", trashed: false });
  }) as typeof fetch;
}

test("first export creates a shared Drive folder, stores it, and copies every selected photo", async () => {
  const { exportParticipantPhotosFolder } = await import(serviceModuleUrl) as ServiceModule;
  const updates: unknown[] = [];
  const requests: RecordedRequest[] = [];
  const result = await exportParticipantPhotosFolder(
    fakeBase44(updates),
    { id: "participant-1", display_name: "Ada Lovelace", selected_photo_ids: ["photo-1", "photo-3"] },
    driveExportFetcher({ existingCopies: [], eventFiles: [driveFile(1), driveFile(2), driveFile(3)] }, requests),
  );

  assert.equal(result.folderLink, "https://drive.google.com/drive/folders/folder-9");
  assert.equal(result.photoCount, 2);
  assert.deepEqual(updates, [{ photos_folder_id: "folder-9" }]);
  const folderCreate = requests.find(({ method, body }) => method === "POST" && (body as { mimeType?: string; parents?: string[] })?.mimeType === "application/vnd.google-apps.folder" && Boolean((body as { parents?: string[] }).parents));
  assert.ok(folderCreate, "folder should be created");
  assert.match((folderCreate?.body as { name: string }).name, /Ada Lovelace/);
  assert.deepEqual((folderCreate?.body as { parents?: string[] }).parents, ["parent-1"], "participant folder should nest under the picks parent");
  const parentCreate = requests.find(({ body }) => (body as { name?: string })?.name === "Build Week photo picks");
  assert.ok(parentCreate, "picks parent folder should be created when missing");
  assert.ok(requests.some(({ url }) => url.includes("/permissions")), "folder should be shared by link");
  const copyRequests = requests.filter(({ url }) => url.endsWith("/copy"));
  assert.deepEqual(copyRequests.map(({ url }) => /files\/(photo-\d+)\/copy/.exec(url)?.[1]).toSorted(), ["photo-1", "photo-3"]);
});

test("re-export reuses the stored folder, adds new copies, and trashes deselected ones", async () => {
  const { exportParticipantPhotosFolder } = await import(serviceModuleUrl) as ServiceModule;
  const updates: unknown[] = [];
  const requests: RecordedRequest[] = [];
  const result = await exportParticipantPhotosFolder(
    fakeBase44(updates),
    { id: "participant-1", display_name: "Ada Lovelace", photos_folder_id: "folder-9", selected_photo_ids: ["photo-1", "photo-3"] },
    driveExportFetcher({
      existingCopies: [{ id: "copy-a", sourcePhotoId: "photo-1" }, { id: "copy-b", sourcePhotoId: "photo-2" }],
      eventFiles: [driveFile(1), driveFile(2), driveFile(3)],
    }, requests),
  );

  assert.equal(result.folderLink, "https://drive.google.com/drive/folders/folder-9");
  assert.deepEqual(updates, []);
  const copyRequests = requests.filter(({ url }) => url.endsWith("/copy"));
  assert.deepEqual(copyRequests.map(({ url }) => /files\/(photo-\d+)\/copy/.exec(url)?.[1]), ["photo-3"]);
  const trashRequests = requests.filter(({ method }) => method === "PATCH");
  assert.equal(trashRequests.length, 1);
  assert.match(trashRequests[0]?.url ?? "", /files\/copy-b/);
  assert.deepEqual(trashRequests[0]?.body, { trashed: true });
});

test("recreates the folder when the stored one was deleted in Drive", async () => {
  const { exportParticipantPhotosFolder } = await import(serviceModuleUrl) as ServiceModule;
  const updates: unknown[] = [];
  const requests: RecordedRequest[] = [];
  const result = await exportParticipantPhotosFolder(
    fakeBase44(updates),
    { id: "participant-1", display_name: "Ada Lovelace", photos_folder_id: "folder-old", selected_photo_ids: ["photo-1"] },
    driveExportFetcher({
      folderLookup: new Response(null, { status: 404 }),
      picksParent: "parent-1",
      existingCopies: [],
      eventFiles: [driveFile(1)],
    }, requests),
  );

  assert.equal(result.folderLink, "https://drive.google.com/drive/folders/folder-9");
  assert.deepEqual(updates, [{ photos_folder_id: "folder-9" }]);
  assert.ok(!requests.some(({ body }) => (body as { name?: string })?.name === "Build Week photo picks"), "existing picks parent should be reused");
});

test("export with nothing selected fails loudly", async () => {
  const { exportParticipantPhotosFolder } = await import(serviceModuleUrl) as ServiceModule;
  await assert.rejects(
    exportParticipantPhotosFolder(fakeBase44(), { id: "participant-1", display_name: "Ada", selected_photo_ids: [] }, listFetcher(3)),
    /No photos selected/,
  );
});

function driveFile(index: number) {
  return {
    id: `photo-${index}`,
    name: `Photo ${index}.jpg`,
    mimeType: "image/jpeg",
    thumbnailLink: `https://example.test/${index}`,
    webViewLink: `https://drive.test/${index}`,
    createdTime: "2026-07-21T11:05:59.116Z",
  };
}

function fakeBase44(updates: unknown[] = []) {
  return {
    asServiceRole: {
      connectors: { getConnection: async () => ({ accessToken: "drive-token" }) },
      entities: { Participant: { update: async (_id: string, data: unknown) => updates.push(data) } },
    },
  };
}

function listFetcher(fileCount: number): typeof fetch {
  return (async () => Response.json({ files: Array.from({ length: fileCount }, (_, index) => driveFile(index + 1)) })) as typeof fetch;
}

test("paginates the folder listing and drops selections that left the folder", async () => {
  const { listParticipantPhotos } = await import(serviceModuleUrl) as ServiceModule;
  const result = await listParticipantPhotos(
    fakeBase44(),
    { id: "participant-1", selected_photo_ids: ["deleted-photo", "photo-30"] },
    { page: 2 },
    listFetcher(60),
  );

  assert.equal(result.page, 2);
  assert.equal(result.pageSize, 24);
  assert.equal(result.pageCount, 3);
  assert.equal(result.totalCount, 60);
  assert.deepEqual(result.photos.map(({ id }) => id), Array.from({ length: 24 }, (_, index) => `photo-${index + 25}`));
  assert.deepEqual(result.selectedPhotoIds, ["photo-30"]);
  assert.equal(result.photosFolderLink, null);
  assert.equal(result.sourceFolderLink, `https://drive.google.com/drive/folders/${eventFolderId}`);
});

test("listing returns the stored photos folder link so it survives refreshes", async () => {
  const { listParticipantPhotos } = await import(serviceModuleUrl) as ServiceModule;
  const result = await listParticipantPhotos(
    fakeBase44(),
    { id: "participant-1", selected_photo_ids: [], photos_folder_id: "folder-9" },
    {},
    listFetcher(3),
  );

  assert.equal(result.photosFolderLink, "https://drive.google.com/drive/folders/folder-9");
});

test("clamps out-of-range pages instead of returning an empty grid", async () => {
  const { listParticipantPhotos } = await import(serviceModuleUrl) as ServiceModule;
  const result = await listParticipantPhotos(
    fakeBase44(),
    { id: "participant-1", selected_photo_ids: [] },
    { page: 99 },
    listFetcher(30),
  );

  assert.equal(result.page, 2);
  assert.equal(result.photos.length, 6);
});

test("mine view returns only the participant's selected photos", async () => {
  const { listParticipantPhotos } = await import(serviceModuleUrl) as ServiceModule;
  const result = await listParticipantPhotos(
    fakeBase44(),
    { id: "participant-1", selected_photo_ids: ["photo-3", "photo-7"] },
    { view: "mine" },
    listFetcher(30),
  );

  assert.equal(result.totalCount, 2);
  assert.deepEqual(result.photos.map(({ id }) => id).toSorted(), ["photo-3", "photo-7"]);
});

test("saving verifies only newly added photos with a metadata probe instead of relisting the folder", async () => {
  const { saveParticipantPhotoSelection } = await import(serviceModuleUrl) as ServiceModule;
  const updates: unknown[] = [];
  const probedUrls: string[] = [];
  const result = await saveParticipantPhotoSelection(
    fakeBase44(updates),
    { id: "participant-1", selected_photo_ids: ["photo-1"] },
    ["photo-1", "photo-2"],
    (async (input: RequestInfo | URL) => {
      probedUrls.push(String(input));
      return Response.json({ id: "photo-2", mimeType: "image/jpeg", trashed: false, parents: [eventFolderId] });
    }) as typeof fetch,
  );

  assert.deepEqual(result.selectedPhotoIds, ["photo-1", "photo-2"]);
  assert.deepEqual(updates, [{ selected_photo_ids: ["photo-1", "photo-2"] }]);
  const fileProbes = probedUrls.filter((url) => /files\/photo-\d+\?/.test(url));
  assert.deepEqual(fileProbes.length, 1, "only the newly added photo should be probed");
  assert.match(fileProbes[0] ?? "", /files\/photo-2\?/);
  assert.ok(!probedUrls.some((url) => url.includes("alt=media")), "saving must never download photo bytes");
});

test("saving a removal-only change touches Drive zero times", async () => {
  const { saveParticipantPhotoSelection } = await import(serviceModuleUrl) as ServiceModule;
  const updates: unknown[] = [];
  let driveCalls = 0;
  const result = await saveParticipantPhotoSelection(
    fakeBase44(updates),
    { id: "participant-1", selected_photo_ids: ["photo-1", "photo-2"] },
    ["photo-2"],
    (async () => {
      driveCalls++;
      return Response.json({});
    }) as typeof fetch,
  );

  assert.deepEqual(result.selectedPhotoIds, ["photo-2"]);
  assert.equal(driveCalls, 0);
  assert.deepEqual(updates, [{ selected_photo_ids: ["photo-2"] }]);
});

test("rejects additions that do not live in the event folder", async () => {
  const { saveParticipantPhotoSelection } = await import(serviceModuleUrl) as ServiceModule;
  const updates: unknown[] = [];
  await assert.rejects(
    saveParticipantPhotoSelection(
      fakeBase44(updates),
      { id: "participant-1", selected_photo_ids: [] },
      ["foreign-photo"],
      (async () => Response.json({ id: "foreign-photo", mimeType: "image/jpeg", trashed: false, parents: ["another-folder"] })) as typeof fetch,
    ),
    /event folder/i,
  );
  assert.deepEqual(updates, []);
});

test("streams the stored selection as a zip archive in original quality", async () => {
  const { downloadParticipantPhotosZip } = await import(serviceModuleUrl) as ServiceModule;
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("alt=media")) {
      const photoId = /files\/(photo-\d+)\?/.exec(url)?.[1] ?? "";
      return new Response(`original-bytes-of-${photoId}`);
    }
    return Response.json({ files: [driveFile(1), driveFile(2), driveFile(3)] });
  }) as typeof fetch;

  const stream = await downloadParticipantPhotosZip(
    fakeBase44(),
    { id: "participant-1", selected_photo_ids: ["photo-1", "photo-3"] },
    fetcher,
  );
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const text = new TextDecoder("latin1").decode(bytes);

  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.match(text, /Photo 1\.jpg/);
  assert.match(text, /Photo 3\.jpg/);
  assert.doesNotMatch(text, /Photo 2\.jpg/);
  assert.match(text, /original-bytes-of-photo-1/);
  assert.match(text, /original-bytes-of-photo-3/);
  const endRecordIndex = text.lastIndexOf("PK");
  assert.ok(endRecordIndex > 0);
  assert.equal(bytes[endRecordIndex + 10], 2);
});

test("lists photos that failed to download in a MISSING.txt manifest instead of silently truncating", async () => {
  const { downloadParticipantPhotosZip } = await import(serviceModuleUrl) as ServiceModule;
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("alt=media")) {
      if (url.includes("photo-1")) return new Response(null, { status: 500 });
      return new Response("original-bytes-of-photo-3");
    }
    return Response.json({ files: [driveFile(1), driveFile(3)] });
  }) as typeof fetch;

  const stream = await downloadParticipantPhotosZip(
    fakeBase44(),
    { id: "participant-1", selected_photo_ids: ["photo-1", "photo-3"] },
    fetcher,
  );
  const text = new TextDecoder("latin1").decode(await new Response(stream).arrayBuffer());

  assert.match(text, /original-bytes-of-photo-3/);
  assert.match(text, /MISSING\.txt/);
  assert.match(text, /Photo 1\.jpg/);
});

test("refuses to build an empty archive", async () => {
  const { downloadParticipantPhotosZip } = await import(serviceModuleUrl) as ServiceModule;
  await assert.rejects(
    downloadParticipantPhotosZip(fakeBase44(), { id: "participant-1", selected_photo_ids: [] }, listFetcher(3)),
    /No photos selected/,
  );
});
