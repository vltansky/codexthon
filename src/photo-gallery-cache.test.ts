import assert from "node:assert/strict";
import test from "node:test";

import { galleryCacheMaxAgeMs, parseGalleryCacheEntry } from "./photo-gallery-cache.ts";

const entry = {
  data: { photos: [], page: 1, pageSize: 24, pageCount: 1, totalCount: 1, selectedPhotoIds: [], matchedPhotoIds: [], claimedClusterKeys: [], photosFolderLink: null, sourceFolderLink: "" },
  photos: [{ id: "photo-1", name: "One", mimeType: "image/jpeg", thumbnailUrl: "t", viewUrl: "v", createdAt: "", width: 3, height: 2 }],
  loadedPages: 2,
  reachedEnd: false,
  savedAt: 1_000_000,
};

test("parses a fresh cache entry and rejects a stale one", () => {
  const raw = JSON.stringify(entry);
  assert.deepEqual(parseGalleryCacheEntry(raw, entry.savedAt + 1000), entry);
  assert.equal(parseGalleryCacheEntry(raw, entry.savedAt + galleryCacheMaxAgeMs + 1), null);
});

test("rejects missing, corrupt, and malformed cache payloads", () => {
  assert.equal(parseGalleryCacheEntry(null, 0), null);
  assert.equal(parseGalleryCacheEntry("not json", 0), null);
  assert.equal(parseGalleryCacheEntry("null", 0), null);
  assert.equal(parseGalleryCacheEntry(JSON.stringify({ ...entry, photos: "nope" }), entry.savedAt), null);
  assert.equal(parseGalleryCacheEntry(JSON.stringify({ ...entry, savedAt: "later" }), entry.savedAt), null);
  assert.equal(parseGalleryCacheEntry(JSON.stringify({ ...entry, loadedPages: 0 }), entry.savedAt), null);
  assert.equal(parseGalleryCacheEntry(JSON.stringify({ ...entry, data: undefined }), entry.savedAt), null);
});
