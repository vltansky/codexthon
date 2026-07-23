import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, ExternalLink, FolderDown, Images, UserRound } from "lucide-react";

import { base44 } from "./base44Client";
import { internalLinkHandler, navigateTo } from "./navigation";
import { participantAnalytics } from "./participantAnalytics";
import type { ParticipantPeopleData, ParticipantPhoto, ParticipantPhotosPageData } from "./types";
import { unwrapBase44FunctionResponse } from "../src/base44-response";
import { photosPagePath, toggleSelectedPhotoId, type PhotosView } from "../src/photo-gallery";
import { photoSelectionTarget } from "../src/participant-analytics";
import { ParticipantPeopleGrid } from "./ParticipantPeopleGrid";
import "./participant-photos.css";

interface ParticipantPhotosPageProps {
  view: PhotosView;
  page: number;
  clusterKey?: string | undefined;
  accessToken?: string;
  preview?: boolean;
}

export function ParticipantPhotosPage({ view, page, clusterKey = "", accessToken, preview = false }: ParticipantPhotosPageProps) {
  const [data, setData] = useState<ParticipantPhotosPageData | null>(null);
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

  useEffect(() => {
    // Photo pages are fetched from the backend per route change; the query
    // params are the source of truth so refresh and deep links keep working.
    if (preview) {
      setData(previewPageData(view, page));
      setPeopleData(previewPeopleData);
      setSelectedPhotoIds(previewSelectedIds);
      return;
    }
    if (view === "people") {
      void loadPeople();
      return;
    }
    void loadPhotos();
  }, [view, page, clusterKey, preview]);

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
          ...(view === "person" ? { clusterKey } : {}),
        }),
      );
      if (loadVersion !== loadVersionRef.current) return;
      setData(response);
      setFolderLink(response.photosFolderLink ?? "");
      const queue = saveQueueRef.current;
      queue.lastSaved = response.selectedPhotoIds;
      // A save in flight means the local selection is newer than this listing.
      if (!queue.inflight && !queue.pending) setSelectedPhotoIds(response.selectedPhotoIds);
      if (response.page !== page) navigateTo(photosPagePath(view, response.page, clusterKey));
    } catch {
      if (loadVersion !== loadVersionRef.current) return;
      setError("Refresh the gallery or open the Drive folder directly.");
    } finally {
      if (loadVersion === loadVersionRef.current) setLoadingPage(false);
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
      // Matched photo ids changed server-side; refresh the current listing.
      if (view !== "people") void loadPhotos();
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
    ? (data?.photos ?? []).filter((photo) => selectedIds.has(photo.id) || matchedIds.has(photo.id))
    : data?.photos ?? [];
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
          <button type="button" onClick={() => view === "people" ? void loadPeople() : void loadPhotos()}>Try again</button>
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

      {showPhotoGrid && visiblePhotos.length > 0 && data ? (
        <div className="photos-grid" aria-busy={loadingPage}>
          {visiblePhotos.map((photo, index) => (
            <PhotoTile
              key={photo.id}
              photo={photo}
              number={(data.page - 1) * data.pageSize + index + 1}
              selected={selectedIds.has(photo.id)}
              matched={matchedIds.has(photo.id)}
              onToggle={() => togglePhoto(photo.id)}
            />
          ))}
        </div>
      ) : null}

      {showPhotoGrid && data && data.pageCount > 1 ? (
        <nav className="photos-pagination" aria-label="Photo pages">
          <a
            className={data.page <= 1 ? "disabled" : ""}
            href={photosPagePath(view, Math.max(1, data.page - 1), clusterKey)}
            onClick={internalLinkHandler(photosPagePath(view, Math.max(1, data.page - 1), clusterKey))}
            aria-disabled={data.page <= 1}
          >
            <ChevronLeft size={15} aria-hidden="true" /> Previous
          </a>
          <span>Page {data.page} of {data.pageCount} · {data.totalCount} photos</span>
          <a
            className={data.page >= data.pageCount ? "disabled" : ""}
            href={photosPagePath(view, Math.min(data.pageCount, data.page + 1), clusterKey)}
            onClick={internalLinkHandler(photosPagePath(view, Math.min(data.pageCount, data.page + 1), clusterKey))}
            aria-disabled={data.page >= data.pageCount}
          >
            Next <ChevronRight size={15} aria-hidden="true" />
          </a>
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

function previewPageData(view: PhotosView, page: number): ParticipantPhotosPageData {
  const photos: ParticipantPhoto[] = [
    { id: "preview-earth", name: "Opening moment", mimeType: "image/jpeg", thumbnailUrl: "/build-week-earth.jpg", viewUrl: "#", createdAt: "", width: 1600, height: 1067 },
    { id: "preview-horizon", name: "Build floor", mimeType: "image/jpeg", thumbnailUrl: "/build-week-horizon.jpg", viewUrl: "#", createdAt: "", width: 1200, height: 1600 },
  ];
  const source = view === "mine"
    ? photos.filter(({ id }) => previewSelectedIds.includes(id) || previewMatchedIds.includes(id))
    : photos;
  return {
    photos: source,
    page: Math.min(page, 1),
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
