import { base44 } from "./base44Client";
import { createParticipantAnalytics } from "../src/participant-analytics";

export const participantAnalytics = createParticipantAnalytics((event) => base44.analytics.track(event));
