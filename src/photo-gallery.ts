export type PhotosView = "all" | "mine" | "people" | "person";

export interface PhotosRoute {
  view: PhotosView;
  pages: number;
  clusterKey?: string;
}

export const photosPageSize = 24;
export const maximumRestorePages = 10;

export function toggleSelectedPhotoId(selectedPhotoIds: readonly string[], photoId: string): string[] {
  if (selectedPhotoIds.includes(photoId)) return selectedPhotoIds.filter((selectedId) => selectedId !== photoId);
  return [...selectedPhotoIds, photoId];
}

export function photosPagePath(view: PhotosView, pages = 1, clusterKey = ""): string {
  const pathname = view === "mine"
    ? "/photos/mine"
    : view === "people"
    ? "/photos/people"
    : view === "person"
    ? `/photos/people/${encodeURIComponent(clusterKey)}`
    : "/photos";
  return pages > 1 ? `${pathname}?pages=${pages}` : pathname;
}

export function parsePhotosRoute(pathname: string, search: string): PhotosRoute | null {
  const query = new URLSearchParams(search);
  // Legacy ?page= deep links predate infinite scroll; treat them as a depth.
  const requestedPages = Number(query.get("pages") ?? query.get("page"));
  const pages = Number.isInteger(requestedPages) && requestedPages > 1 ? requestedPages : 1;
  const personMatch = /^\/photos\/people\/([^/]+)$/.exec(pathname);
  if (personMatch) return { view: "person", pages, clusterKey: decodeURIComponent(personMatch[1]!) };
  const view = pathname === "/photos"
    ? "all"
    : pathname === "/photos/mine"
    ? "mine"
    : pathname === "/photos/people"
    ? "people"
    : null;
  if (!view) return null;
  return { view, pages };
}

export function clampRestoreDepth(pages: number): number {
  if (!Number.isInteger(pages) || pages < 1) return 1;
  return Math.min(pages, maximumRestorePages);
}

export function appendPhotos<Photo extends { id: string }>(existing: readonly Photo[], incoming: readonly Photo[]): Photo[] {
  const knownIds = new Set(existing.map(({ id }) => id));
  const fresh = incoming.filter(({ id }) => !knownIds.has(id));
  return fresh.length === 0 ? [...existing] : [...existing, ...fresh];
}
