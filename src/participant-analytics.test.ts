import assert from "node:assert/strict";
import test from "node:test";

import {
  buildParticipantActionCompleted,
  buildParticipantActionFailed,
  buildParticipantPageView,
  createParticipantAnalytics,
  photoSelectionTarget,
} from "./participant-analytics.ts";

test("describes participant SPA page views without copying URLs or participant identifiers", () => {
  assert.deepEqual(buildParticipantPageView({ page: "portal", accessMode: "signed_link" }), {
    eventName: "participant_page_viewed",
    properties: { page: "portal", access_mode: "signed_link" },
  });
  assert.deepEqual(buildParticipantPageView({ page: "photos", accessMode: "authenticated", view: "mine", pageNumber: 3 }), {
    eventName: "participant_page_viewed",
    properties: { page: "photos", access_mode: "authenticated", view: "mine", page_number: 3 },
  });
});

test("describes completed actions with only approved aggregate properties", () => {
  assert.deepEqual(buildParticipantActionCompleted({
    area: "promo",
    action: "apply_clicked",
    target: "codex",
  }), {
    eventName: "participant_action_completed",
    properties: { area: "promo", action: "apply_clicked", target: "codex" },
  });
  assert.deepEqual(buildParticipantActionCompleted({
    area: "photos",
    action: "selection_saved",
    target: "selected",
    view: "all",
    selectedCount: 4,
  }), {
    eventName: "participant_action_completed",
    properties: {
      area: "photos",
      action: "selection_saved",
      target: "selected",
      view: "all",
      selected_count: 4,
    },
  });
});

test("uses coarse failure categories instead of raw errors", () => {
  assert.deepEqual(buildParticipantActionFailed({
    area: "photos",
    action: "folder_export",
    errorCategory: "service_unavailable",
    view: "mine",
  }), {
    eventName: "participant_action_failed",
    properties: {
      area: "photos",
      action: "folder_export",
      error_category: "service_unavailable",
      view: "mine",
    },
  });
});

test("summarizes selection changes without exposing photo ids", () => {
  assert.equal(photoSelectionTarget(["photo-1"], ["photo-1", "photo-2"]), "selected");
  assert.equal(photoSelectionTarget(["photo-1", "photo-2"], ["photo-2"]), "deselected");
  assert.equal(photoSelectionTarget(["photo-1", "photo-2"], ["photo-2", "photo-3"]), "mixed");
});

test("dispatches each resolved SPA page once and forwards action events", () => {
  const events: unknown[] = [];
  const analytics = createParticipantAnalytics((event) => events.push(event));

  analytics.pageViewed({ page: "portal", accessMode: "signed_link" });
  analytics.pageViewed({ page: "portal", accessMode: "signed_link" });
  analytics.pageViewed({ page: "photos", accessMode: "signed_link", view: "all", pageNumber: 1 });
  analytics.actionCompleted({ area: "promo", action: "copy_succeeded", target: "api" });
  analytics.actionFailed({ area: "wifi", action: "copy", errorCategory: "clipboard_unavailable", target: "password" });

  assert.deepEqual(events, [
    buildParticipantPageView({ page: "portal", accessMode: "signed_link" }),
    buildParticipantPageView({ page: "photos", accessMode: "signed_link", view: "all", pageNumber: 1 }),
    buildParticipantActionCompleted({ area: "promo", action: "copy_succeeded", target: "api" }),
    buildParticipantActionFailed({ area: "wifi", action: "copy", errorCategory: "clipboard_unavailable", target: "password" }),
  ]);
});
