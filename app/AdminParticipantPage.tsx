import { useEffect, useState, type FormEvent } from "react";

import { AdminHeader, type AdminPage } from "./AdminHeader";
import { base44 } from "./base44Client";
import { adminTeamPath, internalLinkHandler } from "./navigation";
import type { AppUser, MentorRecord, ParticipantRecord } from "./types";

const participantEntity = base44.entities.Participant!;
const mentorEntity = base44.entities.Mentor!;

interface CustomFieldRow {
  label: string;
  value: string;
}

export function AdminParticipantPage({ user, participantId, onNavigate }: { user: AppUser; participantId: string; onNavigate: (page: AdminPage) => void }) {
  const [participant, setParticipant] = useState<ParticipantRecord | null>(null);
  const [mentor, setMentor] = useState<MentorRecord | null>(null);
  const [phone, setPhone] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [customFields, setCustomFields] = useState<CustomFieldRow[]>([]);
  const [notice, setNotice] = useState("Loading participant…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Participant profiles are authenticated remote state resolved from the route id.
    void load();
  }, [participantId]);

  async function load() {
    try {
      const [participantRows, mentorRows] = await Promise.all([
        participantEntity.list("display_name", 5000),
        mentorEntity.list("display_name", 5000),
      ]);
      const record = (participantRows as ParticipantRecord[]).find(({ id }) => id === participantId) ?? null;
      if (!record) {
        setNotice("Participant not found");
        return;
      }
      setParticipant(record);
      setMentor((mentorRows as MentorRecord[]).find(({ mentor_key }) => mentor_key === record.mentor_key) ?? null);
      setPhone(record.phone ?? "");
      setLinkedin(record.linkedin ?? "");
      setCustomFields(Object.entries(record.custom_fields ?? {}).map(([label, value]) => ({ label, value })));
      setNotice("Profile is current");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not load the participant");
    }
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!participant) return;
    setBusy(true);
    try {
      const custom_fields = Object.fromEntries(customFields
        .map(({ label, value }) => [label.trim(), value.trim()] as const)
        .filter(([label]) => label));
      await participantEntity.update(participant.id, { phone: phone.trim(), linkedin: linkedin.trim(), custom_fields });
      await load();
      setNotice(`Updated ${participant.display_name}`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Profile update failed");
    } finally {
      setBusy(false);
    }
  }

  function setCustomField(index: number, patch: Partial<CustomFieldRow>) {
    setCustomFields((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  if (!participant) {
    return (
      <main className="admin-shell">
        <AdminHeader activePage="teams" user={user} onNavigate={onNavigate} />
        <p className="directory-notice" role="status" aria-live="polite">{notice}</p>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <AdminHeader activePage="teams" user={user} onNavigate={onNavigate} />
      <section className="directory-intro">
        <div>
          <p className="section-kicker">
            <a className="team-back-link" href={adminTeamPath(participant.team_key)} onClick={internalLinkHandler(adminTeamPath(participant.team_key))}>{participant.team_name || "Team"}</a>
          </p>
          <h2>{participant.display_name}</h2>
          <p>{participant.email} · {participant.checked_in ? "Checked in" : "Not checked in"}{mentor ? ` · Mentor: ${mentor.display_name}` : ""}</p>
        </div>
      </section>
      <p className="directory-notice" role="status" aria-live="polite">{notice}</p>
      <section className="directory-layout">
        <form className="directory-form" autoComplete="off" onSubmit={(event) => void saveProfile(event)}>
          <div><p className="section-kicker">Profile</p><h2>Contact details</h2></div>
          <label>Phone<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
          <label>LinkedIn<input type="url" placeholder="https://linkedin.com/in/..." value={linkedin} onChange={(event) => setLinkedin(event.target.value)} /></label>
          <div><p className="section-kicker">Custom fields</p></div>
          {customFields.map((row, index) => (
            <div className="custom-field-row" key={index}>
              <input aria-label={`Custom field ${index + 1} name`} placeholder="Field name" value={row.label} onChange={(event) => setCustomField(index, { label: event.target.value })} />
              <input aria-label={`Custom field ${index + 1} value`} placeholder="Value" value={row.value} onChange={(event) => setCustomField(index, { value: event.target.value })} />
              <button type="button" aria-label={`Remove custom field ${index + 1}`} disabled={busy} onClick={() => setCustomFields((current) => current.filter((_, rowIndex) => rowIndex !== index))}>Remove</button>
            </div>
          ))}
          <button className="secondary-button" type="button" disabled={busy} onClick={() => setCustomFields((current) => [...current, { label: "", value: "" }])}>Add custom field</button>
          <div className="directory-form-actions"><button className="primary-button" disabled={busy}>Save profile</button></div>
        </form>
        <div className="directory-list">
          <div><p className="section-kicker">Status</p><h2>Event state</h2></div>
          <article className="mentor-row">
            <div><strong>Check-in</strong><small>{participant.checked_in ? `Checked in${participant.checked_in_at ? ` · ${participant.checked_in_at}` : ""}` : "Not checked in"}</small></div>
            <div><strong>Access email</strong><small>{participant.access_email_status ?? "unsent"}</small></div>
            <div><strong>Portal</strong><small>{participant.portal_first_seen_at ? `First opened ${participant.portal_first_seen_at}` : "Never opened"}</small></div>
            {participant.linkedin ? <a href={participant.linkedin} target="_blank" rel="noreferrer">{participant.linkedin}</a> : null}
          </article>
        </div>
      </section>
    </main>
  );
}
