import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, ExternalLink, FolderDown, Images } from "lucide-react";

import { base44 } from "./base44Client";
import { internalLinkHandler, navigateTo } from "./navigation";
import { participantAnalytics } from "./participantAnalytics";
import type { ParticipantPhoto, ParticipantPhotosPageData } from "./types";
import { unwrapBase44FunctionResponse } from "../src/base44-response";
import { photosPagePath, toggleSelectedPhotoId, type PhotosView } from "../src/photo-gallery";
import { photoSelectionTarget } from "../src/participant-analytics";
import "./participant-photos.css";

interface ParticipantPhotosPageProps {
  view: PhotosView;
  page: number;
  accessToken?: string;
  preview?: boolean;
}

export function ParticipantPhotosPage({ view, page, accessToken, preview = false }: ParticipantPhotosPageProps) {
  const [data, setData] = useState<ParticipantPhotosPageData | null>(null);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [loadingPage, setLoadingPage] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [savingCount, setSavingCount] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [folderLink, setFolderLink] = useState("");
  const saveQueueRef = useRef<{ inflight: boolean; pending: string[] | null; lastSaved: string[] }>({ inflight: false, pending: null, lastSaved: [] });
  const loadVersionRef = useRef(0);

  useEffect(() => {
    // Photo pages are fetched from the backend per route change; the query
    // params are the source of truth so refresh and deep links keep working.
    if (preview) {
      setData(previewPageData(view, page));
      setSelectedPhotoIds(previewSelectedIds);
      return;
    }
    void loadPhotos();
  }, [view, page, preview]);

  async function loadPhotos() {
    const loadVersion = ++loadVersionRef.current;
    setError("");
    setLoadingPage(true);
    try {
      const response = unwrapBase44FunctionResponse<ParticipantPhotosPageData>(
        await base44.functions.invoke("participant-photos", {
          ...(accessToken ? { token: accessToken } : {}),
          action: "list",
          view,
          page,
        }),
      );
      if (loadVersion !== loadVersionRef.current) return;
      setData(response);
      setFolderLink(response.photosFolderLink ?? "");
      const queue = saveQueueRef.current;
      queue.lastSaved = response.selectedPhotoIds;
      // A save in flight means the local selection is newer than this listing.
      if (!queue.inflight && !queue.pending) setSelectedPhotoIds(response.selectedPhotoIds);
      if (response.page !== page) navigateTo(photosPagePath(view, response.page));
    } catch {
      if (loadVersion !== loadVersionRef.current) return;
      setError("Refresh the gallery or open the Drive folder directly.");
    } finally {
      if (loadVersion === loadVersionRef.current) setLoadingPage(false);
    }
  }

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
  const visiblePhotos = view === "mine"
    ? (data?.photos ?? []).filter((photo) => selectedIds.has(photo.id))
    : data?.photos ?? [];

  return (
    <main className="photos-shell">
      <header className="photos-nav">
        <a href="/" onClick={internalLinkHandler("/")}><ArrowLeft size={15} aria-hidden="true" /> Event portal</a>
        <nav className="photos-tabs" aria-label="Photo views">
          <a href={photosPagePath("all")} onClick={internalLinkHandler(photosPagePath("all"))} aria-current={view === "all" ? "page" : undefined}>All photos</a>
          <a href={photosPagePath("mine")} onClick={internalLinkHandler(photosPagePath("mine"))} aria-current={view === "mine" ? "page" : undefined}>
            My photos{selectedPhotoIds.length ? ` · ${selectedPhotoIds.length}` : ""}
          </a>
        </nav>
      </header>

      <section className="photos-heading">
        <div>
          <p className="section-kicker">Event photos</p>
          <h1>{view === "mine" ? "Your shortlist." : "Keep the frames that are yours."}</h1>
          <p className="photos-subtitle">
            {view === "mine"
              ? "Everything you selected. Your photos folder holds the originals, ready to download."
              : "Tap a photo to add it to your shortlist. Selections save automatically."}
          </p>
        </div>
        <div className="photos-heading-side">
          <div className="photos-summary">
            <strong>{String(selectedPhotoIds.length).padStart(2, "0")}</strong>
            <span>Selected for you</span>
          </div>
          <button
            className="photos-download"
            type="button"
            onClick={() => void exportToDrive()}
            disabled={exporting || preview || selectedPhotoIds.length === 0}
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

      {error ? (
        <div className="photos-state">
          <Images size={28} aria-hidden="true" />
          <div><strong>Photos are temporarily unavailable.</strong><p>{error}</p></div>
          <button type="button" onClick={() => void loadPhotos()}>Try again</button>
        </div>
      ) : null}

      {!error && !data ? <div className="photos-state"><span className="photos-loader" /><strong>Loading event photos…</strong></div> : null}

      {data && visiblePhotos.length === 0 ? (
        <div className="photos-state">
          <Images size={28} aria-hidden="true" />
          {view === "mine" ? (
            <div>
              <strong>No photos selected yet.</strong>
              <p><a href={photosPagePath("all")} onClick={internalLinkHandler(photosPagePath("all"))}>Browse all photos</a> and tap the ones that are yours.</p>
            </div>
          ) : (
            <div><strong>Photos are coming soon.</strong><p>Refresh this page after the first uploads arrive.</p></div>
          )}
        </div>
      ) : null}

      {visiblePhotos.length > 0 && data ? (
        <div className="photos-grid" aria-busy={loadingPage}>
          {visiblePhotos.map((photo, index) => (
            <PhotoTile
              key={photo.id}
              photo={photo}
              number={(data.page - 1) * data.pageSize + index + 1}
              selected={selectedIds.has(photo.id)}
              onToggle={() => togglePhoto(photo.id)}
            />
          ))}
        </div>
      ) : null}

      {data && data.pageCount > 1 ? (
        <nav className="photos-pagination" aria-label="Photo pages">
          <a
            className={data.page <= 1 ? "disabled" : ""}
            href={photosPagePath(view, Math.max(1, data.page - 1))}
            onClick={internalLinkHandler(photosPagePath(view, Math.max(1, data.page - 1)))}
            aria-disabled={data.page <= 1}
          >
            <ChevronLeft size={15} aria-hidden="true" /> Previous
          </a>
          <span>Page {data.page} of {data.pageCount} · {data.totalCount} photos</span>
          <a
            className={data.page >= data.pageCount ? "disabled" : ""}
            href={photosPagePath(view, Math.min(data.pageCount, data.page + 1))}
            onClick={internalLinkHandler(photosPagePath(view, Math.min(data.pageCount, data.page + 1)))}
            aria-disabled={data.page >= data.pageCount}
          >
            Next <ChevronRight size={15} aria-hidden="true" />
          </a>
        </nav>
      ) : null}

      {data?.sourceFolderLink ? (
        <a className="photos-folder" href={data.sourceFolderLink} target="_blank" rel="noreferrer">
          View the complete Google Drive folder <ExternalLink size={14} aria-hidden="true" />
        </a>
      ) : null}
    </main>
  );
}

function PhotoTile({ photo, number, selected, onToggle }: {
  photo: ParticipantPhoto;
  number: number;
  selected: boolean;
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

function previewPageData(view: PhotosView, page: number): ParticipantPhotosPageData {
  const photos: ParticipantPhoto[] = [
    { id: "preview-earth", name: "Opening moment", mimeType: "image/jpeg", thumbnailUrl: "/build-week-earth.jpg", viewUrl: "#", createdAt: "", width: 1600, height: 1067 },
    { id: "preview-horizon", name: "Build floor", mimeType: "image/jpeg", thumbnailUrl: "/build-week-horizon.jpg", viewUrl: "#", createdAt: "", width: 1200, height: 1600 },
  ];
  const source = view === "mine" ? photos.filter(({ id }) => previewSelectedIds.includes(id)) : photos;
  return { photos: source, page: Math.min(page, 1), pageSize: 24, pageCount: 1, totalCount: source.length, selectedPhotoIds: previewSelectedIds, photosFolderLink: null, sourceFolderLink: "https://example.test/photos" };
}
