import { Check, UserRound } from "lucide-react";

import { photosPagePath } from "../src/photo-gallery";
import { faceCoverStyle } from "./face-cover";
import { internalLinkHandler } from "./navigation";
import type { PersonClusterSummary } from "./types";

export function ParticipantPeopleGrid({ people, claimBusyKey, onToggleClaim }: {
  people: PersonClusterSummary[];
  claimBusyKey: string;
  onToggleClaim: (person: PersonClusterSummary) => void;
}) {
  return (
    <div className="people-grid">
      {people.map((person) => (
        <article className={person.claimed ? "person-card claimed" : "person-card"} key={person.clusterKey}>
          <a
            className="person-card-face"
            style={faceCoverStyle(person.coverThumbnailUrl, person.coverBox, person.coverAspect)}
            href={photosPagePath("person", 1, person.clusterKey)}
            onClick={internalLinkHandler(photosPagePath("person", 1, person.clusterKey))}
            aria-label={`See all ${person.photoCount} photos of this person`}
          >
            {person.claimed ? <span className="person-card-flag"><UserRound size={11} aria-hidden="true" /> You</span> : null}
            <span className="person-card-count">{person.photoCount}</span>
          </a>
          <button
            className="person-card-claim"
            type="button"
            disabled={claimBusyKey === person.clusterKey}
            aria-pressed={person.claimed}
            onClick={() => onToggleClaim(person)}
          >
            {claimBusyKey === person.clusterKey
              ? "Saving…"
              : person.claimed
              ? <><Check size={12} aria-hidden="true" /> That’s me</>
              : "This is me"}
          </button>
        </article>
      ))}
    </div>
  );
}
