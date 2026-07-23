import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const errorsModuleUrl = pathToFileURL(resolve("base44/functions/participant-photos/errors.ts")).href;

test("redacts connector errors while preserving safe auth and selection responses", async () => {
  const { toPhotoFunctionError } = await import(errorsModuleUrl) as {
    toPhotoFunctionError(error: unknown): { message: string; status: number };
  };

  assert.deepEqual(toPhotoFunctionError(new Error("Access link is invalid")), { message: "Access link is invalid", status: 401 });
  assert.deepEqual(toPhotoFunctionError(new Error("Selected photo is not in the event folder")), { message: "Selected photo is not in the event folder", status: 400 });
  assert.deepEqual(toPhotoFunctionError(new Error("No photos selected")), { message: "No photos selected", status: 400 });
  assert.deepEqual(toPhotoFunctionError(new Error("OAuth token for account secret@example.test expired")), { message: "Event photos are temporarily unavailable", status: 503 });
});
