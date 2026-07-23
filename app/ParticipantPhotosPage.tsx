import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ExternalLink, FolderDown, Images, UserRound } from "lucide-react";

import { base44 } from "./base44Client";
import { internalLinkHandler, replacePath } from "./navigation";
import { participantAnalytics } from "./participantAnalytics";
import type { ParticipantPeopleData, ParticipantPhoto, ParticipantPhotosPageData } from "./types";
import { unwrapBase44FunctionResponse } from "../src/base44-response";
import { appendPhotos, clampRestoreDepth, photosPagePath, photosPageSize, toggleSelectedPhotoId, type PhotosView } from "../src/photo-gallery";
import { clearGalleryCache, readGalleryCache, writeGalleryCache } from "./photoGalleryCache";
import { photoSelectionTarget } from "../src/participant-analytics";
import { ParticipantPeopleGrid } from "./ParticipantPeopleGrid";
import { SelfieFinder } from "./SelfieFinder";
import "./participant-photos.css";

// Each list call relists the whole Drive folder server-side, so a bigger
// slice costs the backend nothing extra; 4 pages per append means fewer
// round trips while scrolling.
const loadMoreChunkPages = 4;

interface ParticipantPhotosPageProps {
  view: PhotosView;
  pages: number;
  clusterKey?: string | undefined;
  accessToken?: string;
  preview?: boolean;
}

export function ParticipantPhotosPage({ view, pages, clusterKey = "", accessToken, preview = false }: ParticipantPhotosPageProps) {
  const [data, setData] = useState<ParticipantPhotosPageData | null>(null);
  const [photos, setPhotos] = useState<ParticipantPhoto[]>([]);
  const [reachedEnd, setReachedEnd] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [peopleData, setPeopleData] = useState<ParticipantPeopleData | null>(null);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [loadingPage, setLoadingPage] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [claimError, setClaimError] = useState("");
  const [claimBusyKey, setClaimBusyKey] = useState("");
  const [savingCount, setSavingCount] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [folderLink, setFolderLink] = useState("");
  const saveQueueRef = useRef<{ inflight: boolean; pending: string[] | null; lastSaved: string[] }>({ inflight: false, pending: null, lastSaved: [] });
  const loadVersionRef = useRef(0);
  const loadedPagesRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const loadingPageRef = useRef(false);
  const loadMoreFailedRef = useRef(false);
  const photosRef = useRef<ParticipantPhoto[]>([]);
  const restoredScrollRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Listings reset per route; the ?pages= depth in the URL is the source of
    // truth so refresh and deep links rebuild everything loaded before. The
    // `pages` prop is read once per route change on purpose: after that the
    // component owns the depth and mirrors it into the URL silently.
    if (preview) {
      const previewData = previewPageData(view, pages);
      setData(previewData);
      setPhotos(previewData.photos);
      photosRef.current = previewData.photos;
      setReachedEnd(true);
      setPeopleData(previewPeopleData);
      setSelectedPhotoIds(previewSelectedIds);
      return;
    }
    if (view === "people") {
      void loadPeople();
      return;
    }
    // Stale-while-revalidate: paint the cached grid instantly (refresh or tab
    // return), then refetch at the same depth to pick up new uploads.
    const cached = readGalleryCache(galleryCacheKey(view, clusterKey));
    if (cached) {
      setData(cached.data);
      setPhotos(cached.photos);
      photosRef.current = cached.photos;
      setReachedEnd(cached.reachedEnd);
      loadedPagesRef.current = cached.loadedPages;
      const queue = saveQueueRef.current;
      if (!queue.inflight && !queue.pending && queue.lastSaved.length === 0) setSelectedPhotoIds(cached.data.selectedPhotoIds);
    }
    void loadPhotos(clampRestoreDepth(Math.max(pages, cached?.loadedPages ?? 1)));
  }, [view, clusterKey, preview]);

  async function loadPhotos(depth: number) {
    const loadVersion = ++loadVersionRef.current;
    setError("");
    setLoadingPage(true);
    loadingPageRef.current = true;
    try {
      const response = unwrapBase44FunctionResponse<ParticipantPhotosPageData>(
        await base44.functions.invoke("participant-photos", {
          ...(accessToken ? { token: accessToken } : {}),
          action: "list",
          view,
          page: 1,
          pageSize: depth * photosPageSize,
          ...(view === "person" ? { clusterKey } : {}),
        }),
      );
      if (loadVersion !== loadVersionRef.current) return;
      const reachedLastPage = response.page >= response.pageCount;
      setData(response);
      setPhotos(response.photos);
      photosRef.current = response.photos;
      setReachedEnd(reachedLastPage);
      loadedPagesRef.current = Math.max(1, Math.min(depth, Math.ceil(response.totalCount / photosPageSize)));
      replacePath(photosPagePath(view, loadedPagesRef.current, clusterKey));
      writeGalleryCache(galleryCacheKey(view, clusterKey), {
        data: response,
        photos: response.photos,
        loadedPages: loadedPagesRef.current,
        reachedEnd: reachedLastPage,
        savedAt: Date.now(),
      });
      setFolderLink(response.photosFolderLink ?? "");
      loadMoreFailedRef.current = false;
      const queue = saveQueueRef.current;
      queue.lastSaved = response.selectedPhotoIds;
      // A save in flight means the local selection is newer than this listing.
      if (!queue.inflight && !queue.pending) setSelectedPhotoIds(response.selectedPhotoIds);
    } catch {
      if (loadVersion !== loadVersionRef.current) return;
      setError("Refresh the gallery or open the Drive folder directly.");
    } finally {
      if (loadVersion === loadVersionRef.current) {
        setLoadingPage(false);
        loadingPageRef.current = false;
      }
    }
  }

  async function loadMore() {
    if (loadingMoreRef.current || loadingPageRef.current || reachedEnd) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const loadVersion = loadVersionRef.current;
    try {
      const response = unwrapBase44FunctionResponse<ParticipantPhotosPageData>(
        await base44.functions.invoke("participant-photos", {
          ...(accessToken ? { token: accessToken } : {}),
          action: "list",
          view,
          // Chunked paging can overlap already-loaded photos when the current
          // depth is not a chunk multiple; appendPhotos dedupes the overlap.
          page: Math.floor(loadedPagesRef.current / loadMoreChunkPages) + 1,
          pageSize: loadMoreChunkPages * photosPageSize,
          ...(view === "person" ? { clusterKey } : {}),
        }),
      );
      if (loadVersion !== loadVersionRef.current) return;
      // The server clamps past-the-end pages, so trusting response.page keeps
      // the depth honest when photos were removed between fetches.
      const reachedLastPage = response.page >= response.pageCount;
      const nextPhotos = appendPhotos(photosRef.current, response.photos);
      setData(response);
      setPhotos(nextPhotos);
      photosRef.current = nextPhotos;
      setReachedEnd(reachedLastPage);
      loadedPagesRef.current = response.page * loadMoreChunkPages;
      replacePath(photosPagePath(view, loadedPagesRef.current, clusterKey));
      writeGalleryCache(galleryCacheKey(view, clusterKey), {
        data: response,
        photos: nextPhotos,
        loadedPages: loadedPagesRef.current,
        reachedEnd: reachedLastPage,
        savedAt: Date.now(),
      });
      const queue = saveQueueRef.current;
      queue.lastSaved = response.selectedPhotoIds;
      if (!queue.inflight && !queue.pending) setSelectedPhotoIds(response.selectedPhotoIds);
      loadMoreFailedRef.current = false;
    } catch {
      if (loadVersion === loadVersionRef.current) {
        loadMoreFailedRef.current = true;
        setError("Refresh the gallery or open the Drive folder directly.");
      }
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }

  async function loadPeople() {
    const loadVersion = ++loadVersionRef.current;
    setError("");
    setLoadingPage(true);
    try {
      const response = unwrapBase44FunctionResponse<ParticipantPeopleData>(
        await base44.functions.invoke("participant-photos", {
          ...(accessToken ? { token: accessToken } : {}),
          action: "people",
        }),
      );
      if (loadVersion !== loadVersionRef.current) return;
      setPeopleData(response);
    } catch {
      if (loadVersion !== loadVersionRef.current) return;
      setError("Refresh the gallery or open the Drive folder directly.");
    } finally {
      if (loadVersion === loadVersionRef.current) setLoadingPage(false);
    }
  }

  async function refreshMyPhotos() {
    // The people view has no photo listing of its own, but a claim changes
    // what "My photos" holds; refetch it in the background so the tab count
    // updates in place and the mine cache is warm before navigating there.
    const loadVersion = loadVersionRef.current;
    try {
      const response = unwrapBase44FunctionResponse<ParticipantPhotosPageData>(
        await base44.functions.invoke("participant-photos", {
          ...(accessToken ? { token: accessToken } : {}),
          action: "list",
          view: "mine",
          page: 1,
          pageSize: photosPageSize,
        }),
      );
      if (loadVersion !== loadVersionRef.current) return;
      setData(response);
      setFolderLink(response.photosFolderLink ?? "");
      writeGalleryCache(galleryCacheKey("mine", ""), {
        data: response,
        photos: response.photos,
        loadedPages: 1,
        reachedEnd: response.page >= response.pageCount,
        savedAt: Date.now(),
      });
      const queue = saveQueueRef.current;
      queue.lastSaved = response.selectedPhotoIds;
      if (!queue.inflight && !queue.pending) setSelectedPhotoIds(response.selectedPhotoIds);
    } catch {
      // The cleared cache already guarantees a fresh fetch on the next visit.
    }
  }

  useEffect(() => {
    // The sentinel is a DOM node, so observing it needs an effect. The margin
    // covers a few seconds of scrolling: each fetch relists the Drive folder
    // server-side (~1-2s), so loading must start well before the viewport
    // gets there. The visible button covers keyboard users.
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      // After a failed append the observer stops auto-firing; otherwise the
      // re-arm below would retry a dead backend once a second. The button
      // remains as the explicit retry path.
      if (loadMoreFailedRef.current) return;
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "3000px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
    // loadingMore re-arms the observer after each append: re-observing fires
    // immediately, so loading chains while the sentinel stays inside the margin.
  }, [reachedEnd, loadingPage, loadingMore, view, clusterKey, preview]);

  useEffect(() => {
    // Scroll depth is saved per route so a refresh can land back on the same
    // spot once the same depth of photos has been refetched.
    if (preview || view === "people") return;
    const storageKey = scrollStorageKey(view, clusterKey);
    const controller = new AbortController();
    let frame = 0;
    window.addEventListener("scroll", () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        sessionStorage.setItem(storageKey, String(Math.round(window.scrollY)));
      });
    }, { signal: controller.signal, passive: true });
    return () => {
      controller.abort();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [view, clusterKey, preview]);

  useEffect(() => {
    // Restores scroll once per full page load, as soon as a grid (cached or
    // fetched) has committed. Tile heights come from aspect-ratio metadata, so
    // scrollY is stable before images finish loading. In-app navigation never
    // restores — the ref stays set, matching default SPA behavior.
    if (preview || view === "people" || restoredScrollRef.current) return;
    if (photos.length === 0) return;
    restoredScrollRef.current = true;
    const stored = Number(sessionStorage.getItem(scrollStorageKey(view, clusterKey)) ?? "");
    if (!Number.isFinite(stored) || stored <= 0) return;
    requestAnimationFrame(() => window.scrollTo(0, stored));
  }, [preview, view, clusterKey, photos]);

  function togglePhoto(photoId: string) {
    const nextSelection = toggleSelectedPhotoId(selectedPhotoIds, photoId);
    setSelectedPhotoIds(nextSelection);
    setSaveError("");
    if (preview) return;
    void pushSelection(nextSelection);
  }

  async function pushSelection(selection: string[]) {
    const queue = saveQueueRef.current;
    if (queue.inflight) {
      queue.pending = selection;
      return;
    }
    queue.inflight = true;
    const previousSelection = queue.lastSaved;
    setSavingCount((count) => count + 1);
    try {
      const response = unwrapBase44FunctionResponse<{ selectedPhotoIds: string[] }>(
        await base44.functions.invoke("participant-photos", {
          ...(accessToken ? { token: accessToken } : {}),
          action: "save",
          selectedPhotoIds: selection,
        }),
      );
      queue.lastSaved = response.selectedPhotoIds;
      // Picks made on other views change the "mine" listing server-side; drop
      // its cache so My photos refetches instead of painting a stale grid.
      if (view !== "mine") clearGalleryCache(galleryCacheKey("mine", ""));
      participantAnalytics.actionCompleted({
        area: "photos",
        action: "selection_saved",
        target: photoSelectionTarget(previousSelection, response.selectedPhotoIds),
        view,
        selectedCount: response.selectedPhotoIds.length,
      });
    } catch (caught) {
      console.error("participant-photos: saving the photo selection failed", caught);
      participantAnalytics.actionFailed({
        area: "photos",
        action: "selection_save",
        errorCategory: "service_unavailable",
        view,
      });
      if (!queue.pending) {
        setSelectedPhotoIds(queue.lastSaved);
        setSaveError("Your selection was not saved. Please try again.");
      }
    } finally {
      queue.inflight = false;
      setSavingCount((count) => count - 1);
      const pending = queue.pending;
      queue.pending = null;
      if (pending) void pushSelection(pending);
    }
  }

  async function toggleClaim(targetClusterKey: string, currentlyClaimed: boolean) {
    if (preview) return;
    setClaimError("");
    setClaimBusyKey(targetClusterKey);
    try {
      const response = unwrapBase44FunctionResponse<{ claimedClusterKeys: string[] }>(
        await base44.functions.invoke("participant-photos", {
          ...(accessToken ? { token: accessToken } : {}),
          action: currentlyClaimed ? "unclaim" : "claim",
          clusterKey: targetClusterKey,
        }),
      );
      const claimedKeys = new Set(response.claimedClusterKeys);
      setPeopleData((current) => current
        ? {
          // Claimed faces surface first; the stable sort keeps the server's
          // sharpness/nearness ordering within each partition.
          people: current.people
            .map((person) => ({ ...person, claimed: claimedKeys.has(person.clusterKey) }))
            .sort((first, second) => Number(second.claimed) - Number(first.claimed)),
          claimedClusterKeys: response.claimedClusterKeys,
        }
        : current);
      setData((current) => current ? { ...current, claimedClusterKeys: response.claimedClusterKeys } : current);
      participantAnalytics.actionCompleted({
        area: "photos",
        action: currentlyClaimed ? "face_unclaimed" : "face_claimed",
        view,
        selectedCount: response.claimedClusterKeys.length,
      });
      // Matched photo ids changed server-side; refresh the current listing at
      // the depth already on screen so the scroll position stays meaningful.
      // The "mine" cache is stale either way — drop it so My photos refetches.
      if (view !== "mine") clearGalleryCache(galleryCacheKey("mine", ""));
      if (view === "people") void refreshMyPhotos();
      else void loadPhotos(clampRestoreDepth(Math.max(1, loadedPagesRef.current)));
    } catch (caught) {
      console.error("participant-photos: updating the face claim failed", caught);
      participantAnalytics.actionFailed({ area: "photos", action: "face_claim", errorCategory: "service_unavailable", view });
      setClaimError("Your face group was not saved. Please try again.");
    } finally {
      setClaimBusyKey("");
    }
  }

  async function exportToDrive() {
    const exportTarget = folderLink ? "updated" : "created";
    setExporting(true);
    setExportError("");
    try {
      const response = unwrapBase44FunctionResponse<{ folderLink: string; photoCount: number }>(
        await base44.functions.invoke("participant-photos", {
          ...(accessToken ? { token: accessToken } : {}),
          action: "export",
        }),
      );
      setFolderLink(response.folderLink);
      participantAnalytics.actionCompleted({
        area: "photos",
        action: "folder_exported",
        target: exportTarget,
        view,
        selectedCount: response.photoCount,
      });
      window.open(response.folderLink, "_blank", "noopener");
    } catch (caught) {
      console.error("participant-photos: exporting the photos folder failed", caught);
      participantAnalytics.actionFailed({
        area: "photos",
        action: "folder_export",
        errorCategory: "service_unavailable",
        target: exportTarget,
        view,
      });
      setExportError("Your photos folder could not be prepared. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  const selectedIds = new Set(selectedPhotoIds);
  const matchedIds = new Set(data?.matchedPhotoIds ?? []);
  const visiblePhotos = view === "mine"
    ? photos.filter((photo) => selectedIds.has(photo.id) || matchedIds.has(photo.id))
    : photos;
  const myPhotoCount = new Set([...selectedPhotoIds, ...(data?.matchedPhotoIds ?? [])]).size;
  const personClaimed = view === "person" && Boolean(clusterKey) && (data?.claimedClusterKeys ?? []).includes(clusterKey);
  const showPhotoGrid = view !== "people";

  return (
    <main className="photos-shell">
      <header className="photos-nav">
        <a href="/" onClick={internalLinkHandler("/")}><ArrowLeft size={15} aria-hidden="true" /> Event portal</a>
        <nav className="photos-tabs" aria-label="Photo views">
          <a href={photosPagePath("all")} onClick={internalLinkHandler(photosPagePath("all"))} aria-current={view === "all" ? "page" : undefined}>All photos</a>
          <a href={photosPagePath("people")} onClick={internalLinkHandler(photosPagePath("people"))} aria-current={view === "people" || view === "person" ? "page" : undefined}>People</a>
          <a href={photosPagePath("mine")} onClick={internalLinkHandler(photosPagePath("mine"))} aria-current={view === "mine" ? "page" : undefined}>
            My photos{myPhotoCount ? ` · ${myPhotoCount}` : ""}
          </a>
        </nav>
      </header>

      <section className="photos-heading">
        <div>
          <p className="section-kicker">Event photos</p>
          <h1>{headingForView(view)}</h1>
          <p className="photos-subtitle">{subtitleForView(view)}</p>
          {view === "person" ? (
            <button
              className={personClaimed ? "person-claim-button claimed" : "person-claim-button"}
              type="button"
              disabled={claimBusyKey === clusterKey || !data}
              aria-pressed={personClaimed}
              onClick={() => void toggleClaim(clusterKey, personClaimed)}
            >
              <UserRound size={14} aria-hidden="true" />
              {claimBusyKey === clusterKey ? "Saving…" : personClaimed ? "This is me · claimed" : "This is me"}
            </button>
          ) : null}
        </div>
        <div className="photos-heading-side">
          <div className="photos-summary">
            <strong>{String(myPhotoCount).padStart(2, "0")}</strong>
            <span>Yours so far</span>
          </div>
          <button
            className="photos-download"
            type="button"
            onClick={() => void exportToDrive()}
            disabled={exporting || preview || myPhotoCount === 0}
          >
            <FolderDown size={15} aria-hidden="true" />
            {exporting ? "Preparing your folder…" : folderLink ? "Update my photos folder" : "Create my photos folder"}
          </button>
          {folderLink ? (
            <a
              className="photos-folder-link"
              href={folderLink}
              target="_blank"
              rel="noreferrer"
              onClick={() => participantAnalytics.actionCompleted({ area: "photos", action: "folder_opened", target: "personal_folder", view })}
            >
              Open my photos folder <ExternalLink size={13} aria-hidden="true" />
            </a>
          ) : null}
          {savingCount > 0 ? <span className="photos-saving">Saving…</span> : null}
        </div>
      </section>

      {exportError ? <p className="photos-alert" role="alert">{exportError}</p> : null}
      {saveError ? <p className="photos-alert" role="alert">{saveError}</p> : null}
      {claimError ? <p className="photos-alert" role="alert">{claimError}</p> : null}

      {error ? (
        <div className="photos-state">
          <Images size={28} aria-hidden="true" />
          <div><strong>Photos are temporarily unavailable.</strong><p>{error}</p></div>
          <button type="button" onClick={() => view === "people" ? void loadPeople() : void loadPhotos(clampRestoreDepth(Math.max(1, loadedPagesRef.current)))}>Try again</button>
        </div>
      ) : null}

      {!error && view === "people" && !peopleData ? <div className="photos-state"><span className="photos-loader" /><strong>Loading people…</strong></div> : null}
      {!error && showPhotoGrid && !data ? <div className="photos-state"><span className="photos-loader" /><strong>Loading event photos…</strong></div> : null}

      {view === "people" && peopleData ? (
        peopleData.people.length === 0 ? (
          <div className="photos-state">
            <Images size={28} aria-hidden="true" />
            <div><strong>No people detected yet.</strong><p>Face groups appear here once the gallery has been analyzed.</p></div>
          </div>
        ) : (
          <>
            <p className="people-hint">Tap a face to see every photo of that person. Spot yourself? Claim the face and those photos join “My photos” automatically.</p>
            {!preview ? (
              <SelfieFinder
                accessToken={accessToken}
                claimedClusterKeys={peopleData.claimedClusterKeys}
                claimBusyKey={claimBusyKey}
                onToggleClaim={(person) => void toggleClaim(person.clusterKey, person.claimed)}
              />
            ) : null}
            <ParticipantPeopleGrid
              people={peopleData.people}
              claimBusyKey={claimBusyKey}
              onToggleClaim={(person) => void toggleClaim(person.clusterKey, person.claimed)}
            />
          </>
        )
      ) : null}

      {showPhotoGrid && data && visiblePhotos.length === 0 ? (
        <div className="photos-state">
          <Images size={28} aria-hidden="true" />
          {view === "mine" ? (
            <div>
              <strong>No photos yet.</strong>
              <p>
                <a href={photosPagePath("all")} onClick={internalLinkHandler(photosPagePath("all"))}>Browse all photos</a> and tap the ones that are yours, or{" "}
                <a href={photosPagePath("people")} onClick={internalLinkHandler(photosPagePath("people"))}>find your face</a> to collect them automatically.
              </p>
            </div>
          ) : view === "person" ? (
            <div>
              <strong>No photos for this person.</strong>
              <p><a href={photosPagePath("people")} onClick={internalLinkHandler(photosPagePath("people"))}>Back to all people</a>.</p>
            </div>
          ) : (
            <div><strong>Photos are coming soon.</strong><p>Refresh this page after the first uploads arrive.</p></div>
          )}
        </div>
      ) : null}

      {showPhotoGrid && visiblePhotos.length > 0 ? (
        <div className="photos-grid" aria-busy={loadingPage || loadingMore}>
          {visiblePhotos.map((photo, index) => (
            <PhotoTile
              key={photo.id}
              photo={photo}
              number={index + 1}
              selected={selectedIds.has(photo.id)}
              matched={matchedIds.has(photo.id)}
              onToggle={() => togglePhoto(photo.id)}
            />
          ))}
        </div>
      ) : null}

      {showPhotoGrid && data && visiblePhotos.length > 0 ? (
        <nav className="photos-pagination" aria-label="More photos">
          <span>
            {reachedEnd
              ? `All ${data.totalCount} photos loaded`
              : `${photos.length} of ${data.totalCount} photos loaded`}
          </span>
          {!reachedEnd ? (
            <div ref={sentinelRef}>
              <button
                className="photos-load-more"
                type="button"
                onClick={() => {
                  loadMoreFailedRef.current = false;
                  void loadMore();
                }}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading more photos…" : "Load more photos"}
              </button>
            </div>
          ) : null}
        </nav>
      ) : null}

      {data?.sourceFolderLink && view !== "people" ? (
        <a className="photos-folder" href={data.sourceFolderLink} target="_blank" rel="noreferrer">
          View the complete Google Drive folder <ExternalLink size={14} aria-hidden="true" />
        </a>
      ) : null}
    </main>
  );
}

function scrollStorageKey(view: PhotosView, clusterKey: string): string {
  return `photos-scroll:${photosPagePath(view, 1, clusterKey)}`;
}

function galleryCacheKey(view: PhotosView, clusterKey: string): string {
  return `photos-cache:${photosPagePath(view, 1, clusterKey)}`;
}

function headingForView(view: PhotosView): string {
  if (view === "mine") return "Your photos.";
  if (view === "people") return "Find your face.";
  if (view === "person") return "Every photo of this person.";
  return "Keep the frames that are yours.";
}

function subtitleForView(view: PhotosView): string {
  if (view === "mine") return "Everything you selected, plus photos where a face you claimed appears.";
  if (view === "people") return "Everyone the camera caught, grouped by face. Claim yours and your photos collect themselves.";
  if (view === "person") return "If this is you, claim the face — these photos join “My photos” automatically.";
  return "Tap a photo to add it to your shortlist. Selections save automatically.";
}

function PhotoTile({ photo, number, selected, matched, onToggle }: {
  photo: ParticipantPhoto;
  number: number;
  selected: boolean;
  matched: boolean;
  onToggle(): void;
}) {
  const aspectRatio = photo.width && photo.height ? photo.width / photo.height : 1.5;
  return (
    <article
      className={selected ? "participant-photo selected" : "participant-photo"}
      style={{ "--photo-aspect": aspectRatio.toFixed(4) } as React.CSSProperties}
    >
      <button type="button" aria-pressed={selected} onClick={onToggle}>
        <img src={photo.thumbnailUrl} alt={photo.name} loading="lazy" referrerPolicy="no-referrer" />
        <span className="participant-photo-number">{String(number).padStart(2, "0")}</span>
        {matched ? <span className="participant-photo-you"><UserRound size={11} aria-hidden="true" /> You</span> : null}
        <span className="participant-photo-check" aria-hidden="true"><Check size={17} /></span>
        <span className="participant-photo-name">{photo.name}</span>
      </button>
      <a
        className="participant-photo-drive"
        href={photo.viewUrl}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${photo.name} in Google Drive in full quality`}
      >
        <ExternalLink size={14} aria-hidden="true" />
      </a>
    </article>
  );
}

const previewSelectedIds = ["preview-earth"];
const previewMatchedIds = ["preview-horizon"];

function previewPageData(view: PhotosView, pages: number): ParticipantPhotosPageData {
  const photos: ParticipantPhoto[] = [
    { id: "preview-earth", name: "Opening moment", mimeType: "image/jpeg", thumbnailUrl: "/build-week-earth.jpg", viewUrl: "#", createdAt: "", width: 1600, height: 1067 },
    { id: "preview-horizon", name: "Build floor", mimeType: "image/jpeg", thumbnailUrl: "/build-week-horizon.jpg", viewUrl: "#", createdAt: "", width: 1200, height: 1600 },
  ];
  const source = view === "mine"
    ? photos.filter(({ id }) => previewSelectedIds.includes(id) || previewMatchedIds.includes(id))
    : photos;
  return {
    photos: source,
    page: Math.min(pages, 1),
    pageSize: 24,
    pageCount: 1,
    totalCount: source.length,
    selectedPhotoIds: previewSelectedIds,
    matchedPhotoIds: previewMatchedIds,
    claimedClusterKeys: ["preview-person"],
    photosFolderLink: null,
    sourceFolderLink: "https://example.test/photos",
  };
}

const previewPeopleData: ParticipantPeopleData = {
  people: [
    { clusterKey: "preview-person", faceCount: 4, photoCount: 1, coverThumbnailUrl: "/build-week-horizon.jpg", coverBox: [0.3, 0.2, 0.7, 0.65], coverAspect: 0.75, claimed: true },
    { clusterKey: "preview-person-2", faceCount: 2, photoCount: 1, coverThumbnailUrl: "/build-week-earth.jpg", coverBox: [0.35, 0.25, 0.65, 0.7], coverAspect: 1.5, claimed: false },
  ],
  claimedClusterKeys: ["preview-person"],
};
