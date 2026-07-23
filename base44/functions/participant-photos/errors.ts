const safeErrors = new Map<string, number>([
  ["Access link is invalid", 401],
  ["Authentication required", 401],
  ["Participant access unavailable", 403],
  ["Photo selection is invalid", 400],
  ["Selected photo is not in the event folder", 400],
  ["No photos selected", 400],
  ["Could not prepare your Drive folder", 502],
]);

export function toPhotoFunctionError(error: unknown): { message: string; status: number } {
  const message = error instanceof Error ? error.message : "";
  const status = safeErrors.get(message);
  if (status) return { message, status };
  return { message: "Event photos are temporarily unavailable", status: 503 };
}
