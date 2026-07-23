export type ParticipantAccessMode = "authenticated" | "signed_link";
export type ParticipantPhotosView = "all" | "mine" | "people" | "person";
export type ParticipantAnalyticsArea = "agent_setup" | "photos" | "promo" | "wifi";
export type ParticipantAnalyticsTarget =
  | "api"
  | "base44"
  | "client_config"
  | "codex"
  | "codex_command"
  | "created"
  | "deselected"
  | "install_prompt"
  | "manual_step"
  | "mixed"
  | "network"
  | "password"
  | "personal_folder"
  | "personal_key"
  | "server_url"
  | "selected"
  | "unchanged"
  | "updated";
export type ParticipantCompletedAction =
  | "apply_clicked"
  | "copy_succeeded"
  | "folder_exported"
  | "face_claimed"
  | "face_unclaimed"
  | "folder_opened"
  | "selection_saved";
export type ParticipantFailedAction = "copy" | "face_claim" | "folder_export" | "selection_save";
export type ParticipantErrorCategory = "clipboard_unavailable" | "service_unavailable";

export type ParticipantPageViewInput =
  | { page: "portal"; accessMode: ParticipantAccessMode }
  | {
    page: "photos";
    accessMode: ParticipantAccessMode;
    view: ParticipantPhotosView;
    pageNumber: number;
  };

export interface ParticipantActionCompletedInput {
  area: ParticipantAnalyticsArea;
  action: ParticipantCompletedAction;
  target?: ParticipantAnalyticsTarget;
  view?: ParticipantPhotosView;
  selectedCount?: number;
}

export interface ParticipantActionFailedInput {
  area: ParticipantAnalyticsArea;
  action: ParticipantFailedAction;
  errorCategory: ParticipantErrorCategory;
  target?: ParticipantAnalyticsTarget;
  view?: ParticipantPhotosView;
}

export type ParticipantAnalyticsEvent = ReturnType<
  typeof buildParticipantActionCompleted | typeof buildParticipantActionFailed
> | NonNullable<ReturnType<typeof buildParticipantPageView>>;

export function createParticipantAnalytics(track: (event: ParticipantAnalyticsEvent) => void) {
  let lastPageView = "";
  return {
    pageViewed(input: ParticipantPageViewInput) {
      const event = buildParticipantPageView(input);
      const eventKey = JSON.stringify(event);
      if (eventKey === lastPageView) return;
      lastPageView = eventKey;
      track(event);
    },
    actionCompleted(input: ParticipantActionCompletedInput) {
      track(buildParticipantActionCompleted(input));
    },
    actionFailed(input: ParticipantActionFailedInput) {
      track(buildParticipantActionFailed(input));
    },
  };
}

export function buildParticipantPageView(input: ParticipantPageViewInput) {
  return participantPageView(input);
}

export function buildParticipantActionCompleted({
  area,
  action,
  target,
  view,
  selectedCount,
}: ParticipantActionCompletedInput) {
  return {
    eventName: "participant_action_completed" as const,
    properties: {
      area,
      action,
      ...(target ? { target } : {}),
      ...(view ? { view } : {}),
      ...(selectedCount === undefined ? {} : { selected_count: selectedCount }),
    },
  };
}

export function buildParticipantActionFailed({
  area,
  action,
  errorCategory,
  target,
  view,
}: ParticipantActionFailedInput) {
  return {
    eventName: "participant_action_failed" as const,
    properties: {
      area,
      action,
      error_category: errorCategory,
      ...(target ? { target } : {}),
      ...(view ? { view } : {}),
    },
  };
}

export function photoSelectionTarget(previousIds: string[], nextIds: string[]): ParticipantAnalyticsTarget {
  const previous = new Set(previousIds);
  const next = new Set(nextIds);
  const added = nextIds.some((id) => !previous.has(id));
  const removed = previousIds.some((id) => !next.has(id));
  if (added && removed) return "mixed";
  if (added) return "selected";
  if (removed) return "deselected";
  return "unchanged";
}

function participantPageView(input: ParticipantPageViewInput) {
  if (input.page === "portal") {
    return {
      eventName: "participant_page_viewed" as const,
      properties: { page: input.page, access_mode: input.accessMode },
    };
  }

  return {
    eventName: "participant_page_viewed" as const,
    properties: {
      page: input.page,
      access_mode: input.accessMode,
      view: input.view,
      page_number: input.pageNumber,
    },
  };
}
