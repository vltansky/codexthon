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
    matchedPhotoIds: string[];
    claimedClusterKeys: string[];
    photosFolderLink: string | null;
    sourceFolderLink: string;
  }>;
  saveParticipantPhotoSelection(base44: unknown, participant: unknown, selection: unknown, fetcher: typeof fetch): Promise<{ selectedPhotoIds: string[] }>;
  exportParticipantPhotosFolder(base44: unknown, participant: unknown, fetcher: typeof fetch): Promise<{ folderLink: string; photoCount: number }>;
  listPeopleClusters(base44: unknown, participant: unknown, fetcher: typeof fetch): Promise<{ people: Array<{ clusterKey: string; photoCount: number; claimed: boolean }>; claimedClusterKeys: string[] }>;
  claimFaceCluster(base44: unknown, participant: unknown, clusterKey: unknown, claimed: boolean): Promise<{ claimedClusterKeys: string[] }>;
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

function fakeBase44(updates: unknown[] = [], clusters?: unknown[], mentorUpdates: unknown[] = []) {
  return {
    asServiceRole: {
      connectors: { getConnection: async () => ({ accessToken: "drive-token" }) },
      entities: {
        Participant: { update: async (_id: string, data: unknown) => updates.push(data) },
        Mentor: { update: async (_id: string, data: unknown) => mentorUpdates.push(data) },
        ...(clusters ? { FaceCluster: { filter: async () => clusters } } : {}),
      },
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

test("honors a restore-sized page so a refreshed infinite scroll loads in one request", async () => {
  const { listParticipantPhotos } = await import(serviceModuleUrl) as ServiceModule;
  const result = await listParticipantPhotos(
    fakeBase44(),
    { id: "participant-1", selected_photo_ids: [] },
    { page: 1, pageSize: 240 },
    listFetcher(300),
  );

  assert.equal(result.pageSize, 240);
  assert.equal(result.photos.length, 240);
  assert.equal(result.pageCount, 2);

  const clamped = await listParticipantPhotos(
    fakeBase44(),
    { id: "participant-1", selected_photo_ids: [] },
    { page: 1, pageSize: 500 },
    listFetcher(300),
  );
  assert.equal(clamped.pageSize, 240);
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

test("mine view unions manual selections with claimed face-group matches", async () => {
  const { listParticipantPhotos } = await import(serviceModuleUrl) as ServiceModule;
  const clusters = [
    { cluster_key: "person_a", photo_ids: ["photo-2", "photo-3", "gone-photo"], hidden: false },
    { cluster_key: "person_b", photo_ids: ["photo-4"], hidden: false },
  ];
  const result = await listParticipantPhotos(
    fakeBase44([], clusters),
    { id: "participant-1", selected_photo_ids: ["photo-1"], claimed_cluster_keys: ["person_a"] },
    { view: "mine" },
    listFetcher(5),
  );

  assert.deepEqual(result.photos.map(({ id }) => id).toSorted(), ["photo-1", "photo-2", "photo-3"]);
  assert.deepEqual(result.matchedPhotoIds.toSorted(), ["photo-2", "photo-3"]);
  assert.deepEqual(result.selectedPhotoIds, ["photo-1"]);
  assert.deepEqual(result.claimedClusterKeys, ["person_a"]);
});

test("person view lists only the photos of one visible face group", async () => {
  const { listParticipantPhotos } = await import(serviceModuleUrl) as ServiceModule;
  const clusters = [
    { cluster_key: "person_a", photo_ids: ["photo-2", "photo-5"], hidden: false },
    { cluster_key: "person_hidden", photo_ids: ["photo-3"], hidden: true },
  ];
  const result = await listParticipantPhotos(
    fakeBase44([], clusters),
    { id: "participant-1", selected_photo_ids: [] },
    { view: "person", clusterKey: "person_a" },
    listFetcher(5),
  );
  assert.deepEqual(result.photos.map(({ id }) => id).toSorted(), ["photo-2", "photo-5"]);

  const hidden = await listParticipantPhotos(
    fakeBase44([], clusters),
    { id: "participant-1", selected_photo_ids: [] },
    { view: "person", clusterKey: "person_hidden" },
    listFetcher(5),
  );
  assert.deepEqual(hidden.photos, []);
});

test("people listing marks claimed groups and drops empty or hidden ones", async () => {
  const { listPeopleClusters } = await import(serviceModuleUrl) as ServiceModule;
  const clusters = [
    { cluster_key: "person_a", face_count: 3, photo_ids: ["photo-1", "photo-2"], cover_photo_id: "photo-1", cover_box: [0.1, 0.1, 0.2, 0.3], hidden: false },
    { cluster_key: "person_b", face_count: 9, photo_ids: ["photo-3", "photo-4", "photo-5"], cover_photo_id: "photo-3", cover_box: [0, 0, 1, 1], hidden: false },
    { cluster_key: "person_hidden", face_count: 5, photo_ids: ["photo-1"], cover_photo_id: "photo-1", cover_box: [], hidden: true },
    { cluster_key: "person_gone", face_count: 2, photo_ids: ["gone-photo"], cover_photo_id: "gone-photo", cover_box: [], hidden: false },
  ];
  const result = await listPeopleClusters(
    fakeBase44([], clusters),
    { id: "participant-1", claimed_cluster_keys: ["person_a"] },
    listFetcher(5),
  );

  assert.deepEqual(result.people.map(({ clusterKey }) => clusterKey), ["person_a", "person_b"], "claimed groups come first");
  assert.deepEqual(result.people.map(({ claimed }) => claimed), [true, false]);
  assert.deepEqual(result.people.map(({ photoCount }) => photoCount), [2, 3]);
});

test("people listing hides single-face groups unless the viewer claimed them", async () => {
  const { listPeopleClusters } = await import(serviceModuleUrl) as ServiceModule;
  const clusters = [
    { cluster_key: "person_real", face_count: 4, photo_ids: ["photo-1", "photo-2"], cover_photo_id: "photo-1", cover_box: [0.1, 0.1, 0.2, 0.3], hidden: false },
    { cluster_key: "person_noise", face_count: 1, photo_ids: ["photo-3"], cover_photo_id: "photo-3", cover_box: [0, 0, 1, 1], hidden: false },
    { cluster_key: "person_claimed_single", face_count: 1, photo_ids: ["photo-4"], cover_photo_id: "photo-4", cover_box: [0, 0, 1, 1], hidden: false },
  ];
  const result = await listPeopleClusters(
    fakeBase44([], clusters),
    { id: "participant-1", claimed_cluster_keys: ["person_claimed_single"] },
    listFetcher(5),
  );
  assert.deepEqual(result.people.map(({ clusterKey }) => clusterKey).toSorted(), ["person_claimed_single", "person_real"]);
});

test("claiming validates the face group and unclaiming works without one", async () => {
  const { claimFaceCluster } = await import(serviceModuleUrl) as ServiceModule;
  const clusters = [{ cluster_key: "person_a", photo_ids: ["photo-1"], hidden: false }];

  const updates: unknown[] = [];
  const claimResult = await claimFaceCluster(
    fakeBase44(updates, clusters),
    { id: "participant-1", claimed_cluster_keys: [] },
    "person_a",
    true,
  );
  assert.deepEqual(claimResult.claimedClusterKeys, ["person_a"]);
  assert.deepEqual(updates, [{ claimed_cluster_keys: ["person_a"] }]);

  await assert.rejects(
    claimFaceCluster(fakeBase44([], clusters), { id: "participant-1", claimed_cluster_keys: [] }, "person_unknown", true),
    /invalid/i,
  );

  const unclaimUpdates: unknown[] = [];
  const unclaimResult = await claimFaceCluster(
    fakeBase44(unclaimUpdates, clusters),
    { id: "participant-1", claimed_cluster_keys: ["person_a", "person_b"] },
    "person_b",
    false,
  );
  assert.deepEqual(unclaimResult.claimedClusterKeys, ["person_a"]);
});

test("export copies the union of selected and face-matched photos", async () => {
  const { exportParticipantPhotosFolder } = await import(serviceModuleUrl) as ServiceModule;
  const requests: RecordedRequest[] = [];
  const clusters = [{ cluster_key: "person_a", photo_ids: ["photo-2"], hidden: false }];
  const fetcher = driveExportFetcher({
    picksParent: "parent-1",
    existingCopies: [],
    eventFiles: [driveFile(1), driveFile(2), driveFile(3)],
  }, requests);

  const result = await exportParticipantPhotosFolder(
    fakeBase44([], clusters),
    { id: "participant-1", display_name: "Casey", selected_photo_ids: ["photo-1"], claimed_cluster_keys: ["person_a"], photos_folder_id: "folder-9" },
    fetcher,
  );

  assert.equal(result.photoCount, 2);
  const copiedIds = requests.filter(({ url }) => url.endsWith("/copy")).map(({ url }) => url.split("/").at(-2));
  assert.deepEqual(copiedIds.toSorted(), ["photo-1", "photo-2"]);
});

test("mentor owners save selections and claims onto the Mentor entity", async () => {
  const { saveParticipantPhotoSelection, claimFaceCluster } = await import(serviceModuleUrl) as ServiceModule & {
    saveParticipantPhotoSelection(base44: unknown, owner: unknown, selection: unknown, fetcher: typeof fetch, ownerEntity: string): Promise<{ selectedPhotoIds: string[] }>;
    claimFaceCluster(base44: unknown, owner: unknown, clusterKey: unknown, claimed: boolean, ownerEntity: string): Promise<{ claimedClusterKeys: string[] }>;
  };
  const participantUpdates: unknown[] = [];
  const mentorUpdates: unknown[] = [];
  const clusters = [{ cluster_key: "person_a", photo_ids: ["photo-1"], hidden: false }];
  const mentor = { id: "mentor-1", mentor_key: "m1", display_name: "Morgan", selected_photo_ids: ["photo-1", "photo-2"], claimed_cluster_keys: [] };

  const saved = await saveParticipantPhotoSelection(
    fakeBase44(participantUpdates, clusters, mentorUpdates),
    mentor,
    ["photo-2"],
    (async () => Response.json({})) as typeof fetch,
    "Mentor",
  );
  assert.deepEqual(saved.selectedPhotoIds, ["photo-2"]);

  const claimed = await claimFaceCluster(
    fakeBase44(participantUpdates, clusters, mentorUpdates),
    mentor,
    "person_a",
    true,
    "Mentor",
  );
  assert.deepEqual(claimed.claimedClusterKeys, ["person_a"]);
  assert.deepEqual(participantUpdates, []);
  assert.deepEqual(mentorUpdates, [
    { selected_photo_ids: ["photo-2"] },
    { claimed_cluster_keys: ["person_a"] },
  ]);
});
