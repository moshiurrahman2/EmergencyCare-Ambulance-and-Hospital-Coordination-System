import { useState } from "react";
import { apiUrl } from "./api.js";
import readApiResponse from "./readApiResponse.js";

function PasswordVisibilityIcon({ visible }) {
  return visible ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10.7 10.7 0 0 1 12 5c5.2 0 8.7 4.4 9.8 7a15.7 15.7 0 0 1-3.1 4.3M6.2 6.2A15.7 15.7 0 0 0 2.2 12c1.1 2.6 4.6 7 9.8 7 1.1 0 2.1-.2 3-.5" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.2 12C3.3 9.4 6.8 5 12 5s8.7 4.4 9.8 7c-1.1 2.6-4.6 7-9.8 7S3.3 14.6 2.2 12Z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

export default function AccountSettings({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [form, setForm] = useState({
    email: user.email,
    phone: user.phone,
    currentPassword: "",
    newPassword: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function update(event) {
    setForm({ ...form, [event.target.name]: event.target.value });
    setError("");
    setNotice("");
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(apiUrl("/api/auth/profile"), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("emergencycare-token")}`,
        },
        body: JSON.stringify(form),
      });
      const result = await readApiResponse(response, "Could not update your account.");
      setForm((current) => ({ ...current, currentPassword: "", newPassword: "" }));
      setNotice(result.message);
    } catch (requestError) {
      if (requestError.status === 401 && requestError.message.includes("session")) {
        onLogout();
        return;
      }
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="account-settings">
      <button className="text-button account-settings-trigger" onClick={() => setOpen(true)}>
        Account settings
      </button>
      {open && (
        <div className="account-settings-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}>
          <section className="account-settings-panel" role="dialog" aria-modal="true" aria-labelledby="account-settings-title">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Personal account</p>
                <h2 id="account-settings-title">Update profile</h2>
              </div>
              <button className="text-button" type="button" onClick={() => setOpen(false)}>Close</button>
            </div>
            <p className="intro">Update your email address, mobile number, or password.</p>
            <form className="account-settings-form" onSubmit={submit}>
              <label>
                Email
                <input name="email" type="email" value={form.email} onChange={update} maxLength={254} required />
              </label>
              <label>
                Mobile number
                <input name="phone" type="tel" value={form.phone} onChange={update} maxLength={32} required />
              </label>
              <label>
                Current password
                <span className="password-field">
                  <input
                    name="currentPassword"
                    type={showCurrentPassword ? "text" : "password"}
                    value={form.currentPassword}
                    onChange={update}
                    autoComplete="current-password"
                    required
                  />
                  <button
                    className="password-toggle"
                    type="button"
                    onClick={() => setShowCurrentPassword((visible) => !visible)}
                    aria-label={showCurrentPassword ? "Hide current password" : "Show current password"}
                    aria-pressed={showCurrentPassword}
                  >
                    <PasswordVisibilityIcon visible={showCurrentPassword} />
                  </button>
                </span>
              </label>
              <label>
                New password <span className="field-hint">(leave empty to keep it unchanged)</span>
                <span className="password-field">
                  <input
                    name="newPassword"
                    type={showNewPassword ? "text" : "password"}
                    value={form.newPassword}
                    onChange={update}
                    autoComplete="new-password"
                    minLength={8}
                  />
                  <button
                    className="password-toggle"
                    type="button"
                    onClick={() => setShowNewPassword((visible) => !visible)}
                    aria-label={showNewPassword ? "Hide new password" : "Show new password"}
                    aria-pressed={showNewPassword}
                  >
                    <PasswordVisibilityIcon visible={showNewPassword} />
                  </button>
                </span>
              </label>
              {error && <p className="form-error" role="alert">{error}</p>}
              {notice && <p className="notice" role="status">{notice}</p>}
              <div className="account-settings-actions">
                <button className="secondary-button" type="button" onClick={() => setOpen(false)}>Cancel</button>
                <button className="primary-button" type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
