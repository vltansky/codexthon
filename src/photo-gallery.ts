export type PhotosView = "all" | "mine" | "people" | "person";

export interface PhotosRoute {
  view: PhotosView;
  page: number;
  clusterKey?: string;
}

export function toggleSelectedPhotoId(selectedPhotoIds: readonly string[], photoId: string): string[] {
  if (selectedPhotoIds.includes(photoId)) return selectedPhotoIds.filter((selectedId) => selectedId !== photoId);
  return [...selectedPhotoIds, photoId];
}

export function photosPagePath(view: PhotosView, page = 1, clusterKey = ""): string {
  const pathname = view === "mine"
    ? "/photos/mine"
    : view === "people"
    ? "/photos/people"
    : view === "person"
    ? `/photos/people/${encodeURIComponent(clusterKey)}`
    : "/photos";
  return page > 1 ? `${pathname}?page=${page}` : pathname;
}

export function parsePhotosRoute(pathname: string, search: string): PhotosRoute | null {
  const requestedPage = Number(new URLSearchParams(search).get("page"));
  const page = Number.isInteger(requestedPage) && requestedPage > 1 ? requestedPage : 1;
  const personMatch = /^\/photos\/people\/([^/]+)$/.exec(pathname);
  if (personMatch) return { view: "person", page, clusterKey: decodeURIComponent(personMatch[1]!) };
  const view = pathname === "/photos"
    ? "all"
    : pathname === "/photos/mine"
    ? "mine"
    : pathname === "/photos/people"
    ? "people"
    : null;
  if (!view) return null;
  return { view, page };
}
