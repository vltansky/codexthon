import type { ParticipantImportRow } from "./csv.ts";

export interface ExistingParticipant {
  id: string;
  email: string;
  display_name: string;
  team_key: string;
  team_name: string;
  mentor_key: string;
  checked_in: boolean;
  checked_in_at?: string;
  is_exception?: boolean;
  access_key?: string;
  access_version?: number;
  access_enabled?: boolean;
  access_expires_at?: string;
  access_email_status?: "unsent" | "pending" | "accepted" | "failed" | "unknown";
}

interface ParticipantMutation {
  email: string;
  display_name: string;
  team_key: string;
  team_name: string;
  mentor_key: string;
  checked_in?: boolean;
  checked_in_at?: string;
  active: boolean;
  is_exception?: boolean;
  access_key?: string;
  access_version?: number;
  access_enabled: boolean;
  access_expires_at?: string;
  access_email_status?: "unsent" | "pending" | "accepted" | "failed" | "unknown";
}

export interface ParticipantReconciliation {
  creates: ParticipantMutation[];
  updates: Array<{ id: string; data: Partial<ParticipantMutation> }>;
  deactivations: Array<{ id: string; data: { active: false; access_enabled: false } }>;
}

export function reconcileParticipants(
  imported: ParticipantImportRow[],
  existing: ExistingParticipant[],
  createAccessKey: () => string,
  accessExpiresAt: string,
): ParticipantReconciliation {
  const existingByEmail = new Map(existing.map((participant) => [participant.email.toLowerCase(), participant]));
  const importedEmails = new Set(imported.map((participant) => participant.email));
  const creates: ParticipantMutation[] = [];
  const updates: ParticipantReconciliation["updates"] = [];

  for (const participant of imported) {
    const previous = existingByEmail.get(participant.email);
    const common = {
      email: participant.email,
      display_name: participant.displayName,
      team_key: participant.teamKey,
      team_name: participant.teamName,
      mentor_key: participant.mentorKey,
      active: true,
      access_enabled: true,
    };
    if (previous) {
      updates.push({
        id: previous.id,
        data: {
          ...common,
          ...(previous.is_exception ? { is_exception: false } : {}),
          ...(!previous.access_key ? { access_key: createAccessKey() } : {}),
          ...(!previous.access_version ? { access_version: 1 } : {}),
          ...(!previous.access_expires_at ? { access_expires_at: accessExpiresAt } : {}),
          ...(!previous.access_email_status ? { access_email_status: "unsent" } : {}),
        },
      });
      continue;
    }
    creates.push({
      ...common,
      checked_in: false,
      checked_in_at: "",
      is_exception: false,
      access_key: createAccessKey(),
      access_version: 1,
      access_expires_at: accessExpiresAt,
      access_email_status: "unsent",
    });
  }

  const deactivations = existing
    .filter((participant) => !participant.is_exception && !importedEmails.has(participant.email.toLowerCase()))
    .map((participant) => ({
      id: participant.id,
      data: { active: false, access_enabled: false } as const,
    }));

  return { creates, updates, deactivations };
}
