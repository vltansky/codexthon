export interface GalleryCacheEntry<Data, Photo> {
  data: Data;
  photos: Photo[];
  loadedPages: number;
  reachedEnd: boolean;
  savedAt: number;
}

export const galleryCacheMaxAgeMs = 10 * 60 * 1000;

export function parseGalleryCacheEntry<Data, Photo>(raw: string | null, now: number): GalleryCacheEntry<Data, Photo> | null {
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw) as Partial<GalleryCacheEntry<Data, Photo>> | null;
    if (!entry || typeof entry !== "object" || !entry.data) return null;
    if (!Array.isArray(entry.photos)) return null;
    if (typeof entry.loadedPages !== "number" || entry.loadedPages < 1) return null;
    if (typeof entry.savedAt !== "number" || now - entry.savedAt > galleryCacheMaxAgeMs) return null;
    return entry as GalleryCacheEntry<Data, Photo>;
  } catch {
    return null;
  }
}
