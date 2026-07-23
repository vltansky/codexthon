import { base44 } from "./base44Client";

export function LoginScreen() {
  return (
    <main className="login-shell">
      <section className="login-poster">
        <img className="login-poster-art" src="/build-week-earth.jpg" alt="" />
        <div className="login-poster-copy">
          <p className="eyebrow">OpenAI Build Week · Community event</p>
          <h1>OpenAI<br />Build Week<br />Tel Aviv.</h1>
          <p>Codex community hackathon · Your team, mentor, agenda, and build credit are inside.</p>
        </div>
      </section>
      <section className="login-panel">
        <div>
          <p className="section-kicker">Participant portal</p>
          <h2>Pick up where<br />your team starts.</h2>
        </div>
        <button
          className="primary-button"
          onClick={() => base44.auth.loginWithProvider("google", window.location.origin)}
        >
          Continue with Google
        </button>
        <p className="fine-print">Use the Google account from your registration, or open the personal access link sent by the event team.</p>
      </section>
    </main>
  );
}
