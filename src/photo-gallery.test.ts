import assert from "node:assert/strict";
import test from "node:test";

import { parsePhotosRoute, photosPagePath, toggleSelectedPhotoId } from "./photo-gallery.ts";

test("adds and removes one photo without reordering the rest of the shortlist", () => {
  assert.deepEqual(toggleSelectedPhotoId(["photo-1"], "photo-2"), ["photo-1", "photo-2"]);
  assert.deepEqual(toggleSelectedPhotoId(["photo-1", "photo-2"], "photo-1"), ["photo-2"]);
});

test("builds refresh-safe photo page paths with the page in the query string", () => {
  assert.equal(photosPagePath("all"), "/photos");
  assert.equal(photosPagePath("all", 1), "/photos");
  assert.equal(photosPagePath("all", 3), "/photos?page=3");
  assert.equal(photosPagePath("mine", 2), "/photos/mine?page=2");
});

test("parses photo routes back from pathname and search", () => {
  assert.deepEqual(parsePhotosRoute("/photos", ""), { view: "all", page: 1 });
  assert.deepEqual(parsePhotosRoute("/photos", "?page=4"), { view: "all", page: 4 });
  assert.deepEqual(parsePhotosRoute("/photos/mine", "?page=2"), { view: "mine", page: 2 });
  assert.deepEqual(parsePhotosRoute("/photos", "?page=trash"), { view: "all", page: 1 });
  assert.deepEqual(parsePhotosRoute("/photos", "?page=-2"), { view: "all", page: 1 });
  assert.equal(parsePhotosRoute("/", ""), null);
  assert.equal(parsePhotosRoute("/admin", "?page=2"), null);
});
