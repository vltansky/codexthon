export type PhotosView = "all" | "mine";

export function toggleSelectedPhotoId(selectedPhotoIds: readonly string[], photoId: string): string[] {
  if (selectedPhotoIds.includes(photoId)) return selectedPhotoIds.filter((selectedId) => selectedId !== photoId);
  return [...selectedPhotoIds, photoId];
}

export function photosPagePath(view: PhotosView, page = 1): string {
  const pathname = view === "mine" ? "/photos/mine" : "/photos";
  return page > 1 ? `${pathname}?page=${page}` : pathname;
}

export function parsePhotosRoute(pathname: string, search: string): { view: PhotosView; page: number } | null {
  const view = pathname === "/photos" ? "all" : pathname === "/photos/mine" ? "mine" : null;
  if (!view) return null;
  const page = Number(new URLSearchParams(search).get("page"));
  return { view, page: Number.isInteger(page) && page > 1 ? page : 1 };
}
