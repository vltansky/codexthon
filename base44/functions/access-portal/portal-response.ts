export async function loadPortalResponse(base44: any, participant: any) {
  const email = participant.email.trim().toLowerCase();
  const [teamParticipantRecords, teamInfoRecords, mentors, settingsRecords] = await Promise.all([
    base44.asServiceRole.entities.Participant.filter({ team_key: participant.team_key }, "display_name", 100),
    base44.asServiceRole.entities.TeamInfo.filter({ team_key: participant.team_key }, undefined, 1),
    base44.asServiceRole.entities.Mentor.filter({ mentor_key: participant.mentor_key }, undefined, 1),
    base44.asServiceRole.entities.EventSettings.list("-updated_date", 1),
  ]);

  let promoLinks: { codexCredits: string | null; apiCredits: string | null } = { codexCredits: null, apiCredits: null };
  if (participant.checked_in) {
    const assignments = await base44.asServiceRole.entities.PromoCode.filter({ assigned_email: email }, undefined, 1);
    const assignment = assignments[0];
    promoLinks = {
      codexCredits: assignment?.codex_credit_url || assignment?.code || null,
      apiCredits: assignment?.api_credit_code || assignment?.api_credit_url || null,
    };
  }

  return portalResponse(participant, teamParticipantRecords, teamInfoRecords[0], mentors[0], settingsRecords[0], promoLinks, email);
}

function portalResponse(participant: any, teamMembers: any[], teamInfo: any, mentor: any, settings: any, promoLinks: { codexCredits: string | null; apiCredits: string | null }, email: string) {
  return {
    participant: { displayName: participant.display_name, email: participant.email, teamName: participant.team_name, checkedIn: participant.checked_in, checkedInAt: participant.checked_in_at || null },
    teamTable: teamInfo && (teamInfo.table_number || teamInfo.note) ? { tableNumber: teamInfo.table_number || "", note: teamInfo.note || "" } : null,
    teamMembers: teamMembers.filter((member) => member.active !== false).map((member) => ({ displayName: member.display_name, isCurrentUser: member.email.trim().toLowerCase() === email, checkedIn: member.checked_in, phone: member.phone || null, linkedin: member.linkedin || null })),
    mentor: mentor ? { displayName: mentor.display_name, email: mentor.email || null, phone: mentor.phone || null, details: mentor.details || null, linkedin: mentor.linkedin || null } : null,
    settings: settings ? { eventName: settings.event_name, eventUrl: settings.event_url || "", wifiNetwork: settings.wifi_network || "", wifiPassword: settings.wifi_password || "", wifiNetworkSecondary: settings.wifi_network_secondary || "", wifiPasswordSecondary: settings.wifi_password_secondary || "", eventDetails: settings.event_details || "", agenda: settings.agenda || "", questionsAndAnswers: settings.questions_and_answers || "", promoInstructions: settings.promo_instructions || "" } : null,
    promoLinks,
  };
}
