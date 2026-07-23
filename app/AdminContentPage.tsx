import { useEffect, useState } from "react";

import { AdminHeader, type AdminPage } from "./AdminHeader";
import { base44 } from "./base44Client";
import { defaultPromoInstructions } from "./promo-instructions";
import type { AppUser, EventSettingsRecord } from "./types";
import { parseQuestionsAndAnswers, serializeQuestionsAndAnswers, type QuestionAndAnswer } from "../src/questions-and-answers";

interface SettingsDraft {
  eventName: string;
  eventUrl: string;
  wifiNetwork: string;
  wifiPassword: string;
  wifiNetworkSecondary: string;
  wifiPasswordSecondary: string;
  eventDetails: string;
  agenda: string;
  questionsAndAnswers: QuestionAndAnswerDraft[];
  promoInstructions: string;
  partnerCouponCode: string;
  partnerRegistrationUrl: string;
}

interface QuestionAndAnswerDraft extends QuestionAndAnswer {
  id: string;
  question: string;
  answer: string;
}

const settingsEntity = base44.entities.EventSettings!;

const emptySettings: SettingsDraft = {
  eventName: "Community event",
  eventUrl: "",
  wifiNetwork: "",
  wifiPassword: "",
  wifiNetworkSecondary: "",
  wifiPasswordSecondary: "",
  eventDetails: "",
  agenda: "",
  questionsAndAnswers: [],
  promoInstructions: defaultPromoInstructions,
  partnerCouponCode: "",
  partnerRegistrationUrl: "",
};

export function AdminContentPage({ user, onNavigate }: { user: AppUser; onNavigate: (page: AdminPage) => void }) {
  const [settingsRecord, setSettingsRecord] = useState<EventSettingsRecord | null>(null);
  const [settings, setSettings] = useState<SettingsDraft>(emptySettings);
  const [notice, setNotice] = useState("Loading participant content…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Participant content is remote Base44 state and must be loaded after authentication.
    void loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const rows = await settingsEntity.list("-updated_date", 1);
      const current = rows[0] as EventSettingsRecord | undefined;
      setSettingsRecord(current ?? null);
      setSettings(current ? toDraft(current) : emptySettings);
      setNotice("Participant content is current");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not load participant content");
    }
  }

  async function saveSettings() {
    setBusy(true);
    try {
      const payload = {
        event_name: settings.eventName.trim(),
        event_url: settings.eventUrl.trim(),
        wifi_network: settings.wifiNetwork.trim(),
        wifi_password: settings.wifiPassword.trim(),
        wifi_network_secondary: settings.wifiNetworkSecondary.trim(),
        wifi_password_secondary: settings.wifiPasswordSecondary.trim(),
        event_details: settings.eventDetails.trim(),
        agenda: settings.agenda,
        questions_and_answers: serializeQuestionsAndAnswers(settings.questionsAndAnswers),
        promo_instructions: settings.promoInstructions.trim(),
        partner_coupon_code: settings.partnerCouponCode.trim(),
        partner_registration_url: settings.partnerRegistrationUrl.trim(),
      };
      const saved = settingsRecord
        ? await settingsEntity.update(settingsRecord.id, payload)
        : await settingsEntity.create(payload);
      setSettingsRecord(saved as EventSettingsRecord);
      setNotice("Participant content saved");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not save participant content");
    } finally {
      setBusy(false);
    }
  }

  function addQuestion() {
    setSettings((current) => ({
      ...current,
      questionsAndAnswers: [...current.questionsAndAnswers, { id: crypto.randomUUID(), question: "", answer: "" }],
    }));
  }

  function updateQuestion(id: string, field: "question" | "answer", value: string) {
    setSettings((current) => ({
      ...current,
      questionsAndAnswers: current.questionsAndAnswers.map((item) => item.id === id ? { ...item, [field]: value } : item),
    }));
  }

  function deleteQuestion(id: string) {
    setSettings((current) => ({
      ...current,
      questionsAndAnswers: current.questionsAndAnswers.filter((item) => item.id !== id),
    }));
  }

  return (
    <main className="admin-shell content-admin-shell">
      <AdminHeader activePage="content" user={user} onNavigate={onNavigate} />
      <div className="content-page-intro">
        <div><p className="section-kicker">Participant view</p><h2>Portal copy and logistics</h2></div>
        <p>Changes appear in every participant’s personal event portal.</p>
      </div>
      <p className="content-notice" role="status" aria-live="polite">{notice}</p>
      <form className="content-editor content-editor-page" onSubmit={(event) => { event.preventDefault(); void saveSettings(); }}>
        <section>
          <p className="section-kicker">Event</p>
          <label>Event name<input value={settings.eventName} onChange={(event) => setSettings({ ...settings, eventName: event.target.value })} /></label>
          <label>Event page URL<input type="url" placeholder="https://luma.com/your-event" value={settings.eventUrl} onChange={(event) => setSettings({ ...settings, eventUrl: event.target.value })} /></label>
          <label>Event details<textarea rows={5} value={settings.eventDetails} onChange={(event) => setSettings({ ...settings, eventDetails: event.target.value })} /></label>
        </section>
        <section>
          <p className="section-kicker">Venue</p>
          <div className="settings-field-group">
            <div className="settings-wifi-row">
              <strong>Wi-Fi 1</strong>
              <label>Network<input autoComplete="off" value={settings.wifiNetwork} onChange={(event) => setSettings({ ...settings, wifiNetwork: event.target.value })} /></label>
              <label>Password<input autoComplete="off" value={settings.wifiPassword} onChange={(event) => setSettings({ ...settings, wifiPassword: event.target.value })} /></label>
            </div>
            <div className="settings-wifi-row">
              <strong>Wi-Fi 2 <small>Optional</small></strong>
              <label>Network<input autoComplete="off" value={settings.wifiNetworkSecondary} onChange={(event) => setSettings({ ...settings, wifiNetworkSecondary: event.target.value })} /></label>
              <label>Password<input autoComplete="off" value={settings.wifiPasswordSecondary} onChange={(event) => setSettings({ ...settings, wifiPasswordSecondary: event.target.value })} /></label>
            </div>
          </div>
        </section>
        <section className="content-editor-wide">
          <p className="section-kicker">Schedule and help</p>
          <label>Agenda — one item per line<textarea rows={8} placeholder="5:00 PM — Doors open and check-in" value={settings.agenda} onChange={(event) => setSettings({ ...settings, agenda: event.target.value })} /></label>
          <label>How to apply the promo<textarea rows={6} value={settings.promoInstructions} onChange={(event) => setSettings({ ...settings, promoInstructions: event.target.value })} /></label>
          <label>Partner coupon code<input autoComplete="off" value={settings.partnerCouponCode} onChange={(event) => setSettings({ ...settings, partnerCouponCode: event.target.value })} /></label>
          <label>Partner registration URL<input type="url" placeholder="https://example.com/register" value={settings.partnerRegistrationUrl} onChange={(event) => setSettings({ ...settings, partnerRegistrationUrl: event.target.value })} /></label>
        </section>
        <section className="qa-editor-section">
          <div className="qa-editor-heading">
            <div><p className="section-kicker">Participant help</p><h3>Questions &amp; answers</h3></div>
            <button className="qa-add-button" type="button" onClick={addQuestion}>+ Add question</button>
          </div>
          {settings.questionsAndAnswers.length === 0 ? (
            <button className="qa-empty-state" type="button" onClick={addQuestion}>No questions yet. Add the first question.</button>
          ) : (
            <div className="qa-editor-list">
              {settings.questionsAndAnswers.map((item, index) => (
                <div className="qa-editor-row" key={item.id}>
                  <span className="qa-editor-index">{String(index + 1).padStart(2, "0")}</span>
                  <div className="qa-editor-fields">
                    <label>Question<input placeholder="What should participants know?" value={item.question} onChange={(event) => updateQuestion(item.id, "question", event.target.value)} /></label>
                    <label>Answer<textarea rows={3} placeholder="Give a concise answer." value={item.answer} onChange={(event) => updateQuestion(item.id, "answer", event.target.value)} /></label>
                  </div>
                  <button className="qa-delete-button" type="button" aria-label={`Delete question ${index + 1}`} onClick={() => deleteQuestion(item.id)}>Delete</button>
                </div>
              ))}
            </div>
          )}
        </section>
        <div className="content-save-bar"><span>{notice}</span><button className="primary-button" disabled={busy} type="submit">{busy ? "Saving…" : "Save participant content"}</button></div>
      </form>
    </main>
  );
}

function toDraft(settings: EventSettingsRecord): SettingsDraft {
  return {
    eventName: settings.event_name,
    eventUrl: settings.event_url ?? "",
    wifiNetwork: settings.wifi_network ?? emptySettings.wifiNetwork,
    wifiPassword: settings.wifi_password ?? emptySettings.wifiPassword,
    wifiNetworkSecondary: settings.wifi_network_secondary ?? "",
    wifiPasswordSecondary: settings.wifi_password_secondary ?? "",
    eventDetails: settings.event_details ?? "",
    agenda: settings.agenda ?? "",
    questionsAndAnswers: parseQuestionsAndAnswers(settings.questions_and_answers ?? "").map((item) => ({ ...item, id: crypto.randomUUID() })),
    promoInstructions: settings.promo_instructions?.trim() || defaultPromoInstructions,
    partnerCouponCode: settings.partner_coupon_code ?? "",
    partnerRegistrationUrl: settings.partner_registration_url ?? "",
  };
}
