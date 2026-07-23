import { useRef, useState } from "react";
import { Camera } from "lucide-react";

import { base44 } from "./base44Client";
import { participantAnalytics } from "./participantAnalytics";
import type { PersonClusterSummary, SelfieMatchData, SelfieSuggestion } from "./types";
import { unwrapBase44FunctionResponse } from "../src/base44-response";
import { ParticipantPeopleGrid } from "./ParticipantPeopleGrid";

interface SelfieFinderProps {
  accessToken?: string | undefined;
  claimedClusterKeys: string[];
  claimBusyKey: string;
  onToggleClaim: (person: PersonClusterSummary) => void;
}

export function SelfieFinder({ accessToken, claimedClusterKeys, claimBusyKey, onToggleClaim }: SelfieFinderProps) {
  const [status, setStatus] = useState<"idle" | "detecting" | "matching">("idle");
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<SelfieSuggestion[] | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function findMyFaces(file: File) {
    setError("");
    setSuggestions(null);
    setStatus("detecting");
    try {
      // The face models (~25 MB of ONNX + wasm) load lazily on first use so
      // the People tab stays light for everyone who never taps the button.
      const { detectAndEmbed } = await import("./face-index/engine");
      const faces = await detectAndEmbed(file);
      // Largest face only: in a group selfie the person holding the camera
      // fills the most frame, and claiming is personal.
      const best = faces.length === 0
        ? undefined
        : faces.reduce((largest, face) => boxArea(face.box) > boxArea(largest.box) ? face : largest);
      if (!best) {
        setError("No face was detected in that photo. Try a closer, well-lit selfie.");
        return;
      }
      setStatus("matching");
      const response = unwrapBase44FunctionResponse<SelfieMatchData>(
        await base44.functions.invoke("participant-photos", {
          ...(accessToken ? { token: accessToken } : {}),
          action: "match_selfie",
          embedding: best.embedding,
        }),
      );
      setSuggestions(response.suggestions);
      participantAnalytics.actionCompleted({ area: "photos", action: "selfie_matched", view: "people", selectedCount: response.suggestions.length });
    } catch (caught) {
      console.error("participant-photos: matching the selfie failed", caught);
      participantAnalytics.actionFailed({ area: "photos", action: "selfie_match", errorCategory: "service_unavailable", view: "people" });
      setError("Your selfie could not be checked. Please try again.");
    } finally {
      setStatus("idle");
    }
  }

  const claimed = new Set(claimedClusterKeys);
  const people = (suggestions ?? []).map((suggestion) => ({ ...suggestion, claimed: claimed.has(suggestion.clusterKey) }));
  return (
    <section className="selfie-finder">
      <div className="selfie-finder-row">
        <button type="button" className="selfie-finder-button" disabled={status !== "idle"} onClick={() => inputRef.current?.click()}>
          <Camera size={15} aria-hidden="true" />
          {status === "detecting" ? "Reading your selfie…" : status === "matching" ? "Searching the gallery…" : "Find me with a selfie"}
        </button>
        <span className="selfie-finder-hint">Your selfie is checked on this device and never uploaded.</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void findMyFaces(file);
        }}
      />
      {error ? <p className="photos-alert" role="alert">{error}</p> : null}
      {suggestions?.length === 0 ? (
        <p className="selfie-finder-empty">No matching face groups yet. More photos are indexed over time — try again later, or browse the grid below.</p>
      ) : null}
      {people.length > 0 ? (
        <div className="selfie-finder-results">
          <h2>Looks like you</h2>
          {people.every(({ strength }) => strength === "weak") ? (
            <p className="selfie-finder-empty">Close matches only — double-check before claiming.</p>
          ) : null}
          <ParticipantPeopleGrid people={people} claimBusyKey={claimBusyKey} onToggleClaim={onToggleClaim} />
        </div>
      ) : null}
    </section>
  );
}

function boxArea(box: number[]): number {
  const [left = 0, top = 0, right = 0, bottom = 0] = box;
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}
