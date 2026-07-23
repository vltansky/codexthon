import { useEffect, useRef, useState } from "react";

import { unwrapBase44FunctionResponse } from "../src/base44-response";
import { AdminHeader, type AdminPage } from "./AdminHeader";
import { faceCoverStyle } from "./face-cover";
import { base44 } from "./base44Client";
import type { AppUser } from "./types";

interface FaceIndexStatus {
  totalPhotos: number;
  indexedPhotos: number;
  remainingPhotos: number;
  faceCount: number;
  clusterCount: number;
}

interface PendingPhoto {
  id: string;
  name: string;
  thumbnailUrl: string;
}

interface ClusterSummary {
  clusterKey: string;
  faceCount: number;
  photoIds: string[];
  coverBox: number[];
  coverThumbnailUrl: string;
  coverAspect: number;
}

async function invokeFaceIndex<T>(payload: Record<string, unknown>): Promise<T> {
  return unwrapBase44FunctionResponse<T>(await base44.functions.invoke("face-index", payload));
}

export function AdminFacesPage({ user, onNavigate }: { user: AppUser; onNavigate: (page: AdminPage) => void }) {
  const [status, setStatus] = useState<FaceIndexStatus | null>(null);
  const [clusters, setClusters] = useState<ClusterSummary[]>([]);
  const [indexing, setIndexing] = useState(false);
  const [notice, setNotice] = useState("Loading face index status…");
  const stopRef = useRef(false);

  useEffect(() => {
    // Index state lives in Base44 entities and must be loaded after authentication.
    void refresh();
  }, []);

  async function refresh(progressNotice = "") {
    try {
      const [statusResponse, clustersResponse] = await Promise.all([
        invokeFaceIndex<FaceIndexStatus>({}),
        invokeFaceIndex<{ clusters: ClusterSummary[] }>({ action: "clusters" }),
      ]);
      setStatus(statusResponse);
      setClusters(clustersResponse.clusters);
      setNotice(progressNotice || (statusResponse.remainingPhotos
        ? `${statusResponse.remainingPhotos} photos are waiting to be indexed`
        : "All photos are indexed"));
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not load face index status");
    }
  }

  async function runIndexing() {
    setIndexing(true);
    stopRef.current = false;
    let indexedCount = 0;
    let faceCount = 0;
    const failedNames: string[] = [];
    try {
      setNotice("Loading face models (~15MB, one time per session)…");
      // Dynamic import keeps onnxruntime-web out of the participant bundle.
      const { detectAndEmbed, loadFaceSessions } = await import("./face-index/engine");
      await loadFaceSessions();
      while (!stopRef.current) {
        const pending = await invokeFaceIndex<{ photos: PendingPhoto[]; remainingPhotos: number }>({ action: "pending" });
        if (pending.photos.length === 0) break;
        for (const [photoIndex, photo] of pending.photos.entries()) {
          if (stopRef.current) break;
          const blob = await loadThumbnail(photo);
          if (!blob) {
            failedNames.push(photo.name);
            continue;
          }
          const faces = await detectAndEmbed(blob);
          const result = await invokeFaceIndex<{ faceCount: number }>({
            action: "ingest",
            photoId: photo.id,
            photoName: photo.name,
            faces,
          });
          indexedCount += 1;
          faceCount += result.faceCount;
          const remaining = pending.remainingPhotos - photoIndex - 1;
          setNotice(`Indexing… ${indexedCount} photo${indexedCount === 1 ? "" : "s"}, ${faceCount} faces (${remaining} remaining)`);
        }
        // A photo that failed to load stays pending; break so a stuck photo
        // cannot loop this run forever. The next run retries it.
        if (failedNames.length > 0) break;
      }
      await refresh(summaryNotice(indexedCount, faceCount, failedNames, stopRef.current));
    } catch (caught) {
      await refresh(caught instanceof Error ? caught.message : "Face indexing failed");
    } finally {
      setIndexing(false);
    }
  }

  async function resetIndex() {
    if (!window.confirm("Delete the whole face index? Photos will need to be indexed again.")) return;
    setNotice("Resetting face index…");
    try {
      await invokeFaceIndex({ action: "reset" });
      await refresh("Face index was reset");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not reset the face index");
    }
  }

  return (
    <main className="admin-shell">
      <AdminHeader activePage="faces" user={user} onNavigate={onNavigate} />

      <section className="admin-stats">
        <div><span>Photos</span><strong>{status?.totalPhotos ?? "–"}</strong></div>
        <div><span>Indexed</span><strong>{status?.indexedPhotos ?? "–"}</strong></div>
        <div><span>Waiting</span><strong>{status?.remainingPhotos ?? "–"}</strong></div>
        <div><span>Faces</span><strong>{status?.faceCount ?? "–"}</strong></div>
        <div><span>People</span><strong>{status?.clusterCount ?? "–"}</strong></div>
      </section>

      <section className="face-index-controls">
        <p className="notice" role="status" aria-live="polite">{notice}</p>
        <div className="access-actions">
          {indexing ? (
            <button type="button" onClick={() => { stopRef.current = true; }}>Stop after current photo</button>
          ) : (
            <button className="primary" type="button" disabled={!status || status.remainingPhotos === 0} onClick={() => void runIndexing()}>
              Index photos
            </button>
          )}
          <button type="button" disabled={indexing || !status || status.indexedPhotos === 0} onClick={() => void resetIndex()}>
            Reset index
          </button>
        </div>
        <p className="face-index-hint">
          Photos are analyzed in this browser tab and grouped on the server. Keep the tab open while indexing runs; it is safe to stop and continue later.
        </p>
      </section>

      <section className="face-cluster-section">
        <div className="section-heading">
          <div><p className="section-kicker">People</p><h2>Detected groups</h2></div>
        </div>
        {clusters.length === 0 ? <p className="face-index-hint">No face groups yet. Run indexing to build them.</p> : (
          <div className="face-cluster-grid">
            {clusters.map((cluster) => (
              <figure className="face-tile" key={cluster.clusterKey}>
                <div className="face-tile-image" style={faceCoverStyle(cluster.coverThumbnailUrl, cluster.coverBox, cluster.coverAspect)} role="img" aria-label={`Person seen in ${cluster.photoIds.length} photos`} />
                <figcaption>{cluster.photoIds.length} photo{cluster.photoIds.length === 1 ? "" : "s"}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

async function loadThumbnail(photo: PendingPhoto): Promise<Blob | null> {
  const direct = await fetch(photo.thumbnailUrl).then((response) => response.ok ? response.blob() : null).catch(() => null);
  if (direct) return direct;
  try {
    const proxied = await invokeFaceIndex<{ base64: string; contentType: string }>({ action: "thumbnail", photoId: photo.id });
    const response = await fetch(`data:${proxied.contentType};base64,${proxied.base64}`);
    return await response.blob();
  } catch {
    return null;
  }
}

function summaryNotice(indexedCount: number, faceCount: number, failedNames: string[], stopped: boolean): string {
  const base = `Indexed ${indexedCount} photo${indexedCount === 1 ? "" : "s"} with ${faceCount} faces`;
  if (failedNames.length) return `${base}; could not load ${failedNames.length} (retried next run)`;
  if (stopped) return `${base}; stopped`;
  return base;
}

