import assert from "node:assert/strict";
import test from "node:test";

import {
  appendPhotos,
  clampRestoreDepth,
  maximumRestorePages,
  parsePhotosRoute,
  photosPagePath,
  toggleSelectedPhotoId,
} from "./photo-gallery.ts";

test("adds and removes one photo without reordering the rest of the shortlist", () => {
  assert.deepEqual(toggleSelectedPhotoId(["photo-1"], "photo-2"), ["photo-1", "photo-2"]);
  assert.deepEqual(toggleSelectedPhotoId(["photo-1", "photo-2"], "photo-1"), ["photo-2"]);
});

test("builds refresh-safe photo paths with the loaded depth in the query string", () => {
  assert.equal(photosPagePath("all"), "/photos");
  assert.equal(photosPagePath("all", 1), "/photos");
  assert.equal(photosPagePath("all", 3), "/photos?pages=3");
  assert.equal(photosPagePath("mine", 2), "/photos/mine?pages=2");
  assert.equal(photosPagePath("people"), "/photos/people");
  assert.equal(photosPagePath("person", 1, "person_abc"), "/photos/people/person_abc");
  assert.equal(photosPagePath("person", 3, "person_abc"), "/photos/people/person_abc?pages=3");
});

test("parses photo routes back from pathname and search", () => {
  assert.deepEqual(parsePhotosRoute("/photos", ""), { view: "all", pages: 1 });
  assert.deepEqual(parsePhotosRoute("/photos", "?pages=4"), { view: "all", pages: 4 });
  assert.deepEqual(parsePhotosRoute("/photos/mine", "?pages=2"), { view: "mine", pages: 2 });
  assert.deepEqual(parsePhotosRoute("/photos", "?pages=trash"), { view: "all", pages: 1 });
  assert.deepEqual(parsePhotosRoute("/photos", "?pages=-2"), { view: "all", pages: 1 });
  assert.deepEqual(parsePhotosRoute("/photos/people", ""), { view: "people", pages: 1 });
  assert.deepEqual(parsePhotosRoute("/photos/people/person_abc", "?pages=2"), { view: "person", pages: 2, clusterKey: "person_abc" });
  assert.equal(parsePhotosRoute("/", ""), null);
  assert.equal(parsePhotosRoute("/admin", "?pages=2"), null);
});

test("keeps legacy ?page= links working as a loaded depth", () => {
  assert.deepEqual(parsePhotosRoute("/photos", "?page=4"), { view: "all", pages: 4 });
  assert.deepEqual(parsePhotosRoute("/photos/mine", "?page=2"), { view: "mine", pages: 2 });
  // pages= wins when both are present.
  assert.deepEqual(parsePhotosRoute("/photos", "?page=9&pages=3"), { view: "all", pages: 3 });
});

test("clamps the restore depth between one and the maximum restore pages", () => {
  assert.equal(clampRestoreDepth(1), 1);
  assert.equal(clampRestoreDepth(7), 7);
  assert.equal(clampRestoreDepth(maximumRestorePages), maximumRestorePages);
  assert.equal(clampRestoreDepth(maximumRestorePages + 5), maximumRestorePages);
  assert.equal(clampRestoreDepth(0), 1);
  assert.equal(clampRestoreDepth(-3), 1);
  assert.equal(clampRestoreDepth(2.7), 1);
});

test("appends new photo pages without duplicating photos already loaded", () => {
  const first = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(appendPhotos(first, [{ id: "c" }]), [{ id: "a" }, { id: "b" }, { id: "c" }]);
  assert.deepEqual(appendPhotos(first, [{ id: "b" }, { id: "c" }]), [{ id: "a" }, { id: "b" }, { id: "c" }]);
  assert.deepEqual(appendPhotos([], first), first);
  assert.deepEqual(appendPhotos(first, []), first);
});
