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
  peopleCount: number;
  singleFaceClusterCount: number;
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

interface MergeSide {
  clusterKey: string;
  faceCount: number;
  photoCount: number;
  coverBox: number[];
  coverThumbnailUrl: string;
  coverAspect: number;
}

interface MergeCandidate {
  similarity: number;
  source: MergeSide;
  target: MergeSide;
}

async function invokeFaceIndex<T>(payload: Record<string, unknown>): Promise<T> {
  return unwrapBase44FunctionResponse<T>(await base44.functions.invoke("face-index", payload));
}

export function AdminFacesPage({ user, onNavigate }: { user: AppUser; onNavigate: (page: AdminPage) => void }) {
  const [status, setStatus] = useState<FaceIndexStatus | null>(null);
  const [clusters, setClusters] = useState<ClusterSummary[]>([]);
  const [indexing, setIndexing] = useState(false);
  const [refreshingCovers, setRefreshingCovers] = useState(false);
  const [mergeCandidates, setMergeCandidates] = useState<MergeCandidate[] | null>(null);
  const [findingMerges, setFindingMerges] = useState(false);
  const [mergingKey, setMergingKey] = useState("");
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

  async function refreshCovers() {
    setRefreshingCovers(true);
    setNotice("Refreshing group covers and sorting (analyzing photo sharpness on the server)…");
    try {
      let analyzedTotal = 0;
      let failedTotal = 0;
      let previousRemaining = Infinity;
      // The server analyzes a small batch per request to stay inside the
      // function timeout; keep calling until it reports done.
      while (true) {
        const result = await invokeFaceIndex<{
          done: boolean;
          analyzedPhotos: number;
          failedPhotos: number;
          remainingPhotos: number;
          clusterCount?: number;
        }>({ action: "recompute" });
        analyzedTotal += result.analyzedPhotos;
        failedTotal += result.failedPhotos;
        if (result.done) {
          const failed = failedTotal ? `; ${failedTotal} photo${failedTotal === 1 ? "" : "s"} could not be analyzed` : "";
          await refresh(`Refreshed covers and sorting for ${result.clusterCount} groups (${analyzedTotal} photos analyzed${failed})`);
          break;
        }
        if (result.remainingPhotos >= previousRemaining) throw new Error("Cover refresh is not making progress; please try again");
        previousRemaining = result.remainingPhotos;
        setNotice(`Refreshing group covers… ${analyzedTotal + failedTotal} photos analyzed, ${result.remainingPhotos} remaining`);
      }
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not refresh the group covers");
    } finally {
      setRefreshingCovers(false);
    }
  }

  async function findMergeCandidates() {
    setFindingMerges(true);
    setNotice("Comparing all face groups for probable duplicates…");
    try {
      const result = await invokeFaceIndex<{ candidates: MergeCandidate[] }>({ action: "merge-candidates" });
      setMergeCandidates(result.candidates);
      setNotice(result.candidates.length
        ? `${result.candidates.length} probable duplicate pair${result.candidates.length === 1 ? "" : "s"} found — confirm each merge below`
        : "No probable duplicates found");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not compare face groups");
    } finally {
      setFindingMerges(false);
    }
  }

  async function mergePair(candidate: MergeCandidate) {
    setMergingKey(candidate.source.clusterKey);
    try {
      const result = await invokeFaceIndex<{ mergedFaces: number; migratedClaims: number }>({
        action: "merge",
        sourceKey: candidate.source.clusterKey,
        targetKey: candidate.target.clusterKey,
      });
      setMergeCandidates((current) => (current ?? []).filter((pair) =>
        pair.source.clusterKey !== candidate.source.clusterKey &&
        pair.target.clusterKey !== candidate.source.clusterKey
      ));
      await refresh(`Merged ${result.mergedFaces} face${result.mergedFaces === 1 ? "" : "s"}${result.migratedClaims ? ` and moved ${result.migratedClaims} claim${result.migratedClaims === 1 ? "" : "s"}` : ""}`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Merge failed");
    } finally {
      setMergingKey("");
    }
  }

  function dismissPair(candidate: MergeCandidate) {
    setMergeCandidates((current) => (current ?? []).filter((pair) => pair !== candidate));
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
        <div><span>People</span><strong>{status?.peopleCount ?? "–"}</strong></div>
        <div><span>Hidden singles</span><strong>{status?.singleFaceClusterCount ?? "–"}</strong></div>
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
          <button type="button" disabled={indexing || refreshingCovers || !status || status.indexedPhotos === 0} onClick={() => void refreshCovers()}>
            {refreshingCovers ? "Refreshing covers…" : "Refresh group covers & sorting"}
          </button>
          <button type="button" disabled={indexing || refreshingCovers || findingMerges || !status || status.indexedPhotos === 0} onClick={() => void findMergeCandidates()}>
            {findingMerges ? "Comparing groups…" : "Find duplicate groups"}
          </button>
          <button type="button" disabled={indexing || refreshingCovers || !status || status.indexedPhotos === 0} onClick={() => void resetIndex()}>
            Reset index
          </button>
        </div>
        <p className="face-index-hint">
          Photos are analyzed in this browser tab and grouped on the server. Keep the tab open while indexing runs; it is safe to stop and continue later.
        </p>
      </section>

      {mergeCandidates && mergeCandidates.length > 0 ? (
        <section className="face-cluster-section">
          <div className="section-heading">
            <div><p className="section-kicker">Review</p><h2>Probable duplicates</h2></div>
          </div>
          <p className="face-index-hint">Same person split by pose or lighting. Merging moves all photos and claims onto the larger group; this cannot be undone.</p>
          <div className="merge-pair-list">
            {mergeCandidates.map((candidate) => (
              <div className="merge-pair" key={`${candidate.source.clusterKey}:${candidate.target.clusterKey}`}>
                <div className="merge-pair-faces">
                  <figure className="face-tile">
                    <div className="face-tile-image" style={faceCoverStyle(candidate.source.coverThumbnailUrl, candidate.source.coverBox, candidate.source.coverAspect)} role="img" aria-label={`Group with ${candidate.source.faceCount} faces`} />
                    <figcaption>{candidate.source.photoCount} photos</figcaption>
                  </figure>
                  <figure className="face-tile">
                    <div className="face-tile-image" style={faceCoverStyle(candidate.target.coverThumbnailUrl, candidate.target.coverBox, candidate.target.coverAspect)} role="img" aria-label={`Group with ${candidate.target.faceCount} faces`} />
                    <figcaption>{candidate.target.photoCount} photos</figcaption>
                  </figure>
                </div>
                <span className="merge-pair-similarity">{Math.round(candidate.similarity * 100)}% match</span>
                <div className="merge-pair-actions">
                  <button className="primary" type="button" disabled={Boolean(mergingKey)} onClick={() => void mergePair(candidate)}>
                    {mergingKey === candidate.source.clusterKey ? "Merging…" : "Same person"}
                  </button>
                  <button type="button" disabled={Boolean(mergingKey)} onClick={() => dismissPair(candidate)}>Different people</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

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

