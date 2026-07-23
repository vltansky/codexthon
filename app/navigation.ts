export function navigateTo(path: string): void {
  if (`${window.location.pathname}${window.location.search}` === path) return;
  history.pushState(null, "", path);
  window.dispatchEvent(new Event("app:navigate"));
}

export function replacePath(path: string): void {
  if (`${window.location.pathname}${window.location.search}` === path) return;
  // Deliberately no app:navigate event: scroll-depth URL updates must not
  // re-render the app and refetch the gallery.
  history.replaceState(null, "", path);
}

export function adminTeamPath(teamKey: string): string {
  return `/admin/teams/${encodeURIComponent(teamKey)}`;
}

export function adminParticipantPath(participantId: string): string {
  return `/admin/participants/${encodeURIComponent(participantId)}`;
}

export function internalLinkHandler(path: string) {
  return (event: { preventDefault(): void }) => {
    event.preventDefault();
    navigateTo(path);
  };
}
