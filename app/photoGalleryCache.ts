import type { ParticipantPhoto, ParticipantPhotosPageData } from "./types";
import { parseGalleryCacheEntry, type GalleryCacheEntry } from "../src/photo-gallery-cache";

export type PhotoGalleryCacheEntry = GalleryCacheEntry<ParticipantPhotosPageData, ParticipantPhoto>;

export function readGalleryCache(cacheKey: string): PhotoGalleryCacheEntry | null {
  try {
    return parseGalleryCacheEntry(sessionStorage.getItem(cacheKey), Date.now());
  } catch {
    return null;
  }
}

export function writeGalleryCache(cacheKey: string, entry: PhotoGalleryCacheEntry): void {
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify(entry));
  } catch {
    // Quota failures only cost the instant rehydrate; the URL depth still restores.
  }
}

export function clearGalleryCache(cacheKey: string): void {
  try {
    sessionStorage.removeItem(cacheKey);
  } catch {
    // Same tolerance as writes: losing the cache only costs the instant rehydrate.
  }
}
