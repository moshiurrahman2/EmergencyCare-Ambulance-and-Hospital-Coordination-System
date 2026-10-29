import { useEffect, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { API_BASE_URL, apiUrl } from "./api.js";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import AdminDashboard from "./AdminDashboard.jsx";
import AmbulanceApp from "./AmbulanceApp.jsx";
import DispatcherApp from "./DispatcherApp.jsx";
import HomePage from "./HomePage.jsx";
import PatientApp from "./PatientApp.jsx";
import readApiResponse from "./readApiResponse.js";

const rolePaths = {
  patient: "/patient",
  dispatcher: "/dispatcher",
  ambulance: "/ambulance",
  admin: "/admin",
};

const roleLabels = {
  patient: "Patient",
  dispatcher: "Dispatcher",
  ambulance: "Ambulance",
  admin: "Admin",
};

async function sendAuthRequest(path, data) {
  const response = await fetch(apiUrl(`/api/auth/${path}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return readApiResponse(response, "Unable to complete your request.");
}

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

function AuthPage({ mode }) {
  const isSignup = mode === "signup";
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    role: "patient",
  });
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const registered = location.state?.registered;

  function update(event) {
    setForm({ ...form, [event.target.name]: event.target.value });
    setError("");
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (isSignup && form.password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      if (isSignup) {
        const result = await sendAuthRequest("signup", form);
        setForm({
          name: "",
          email: "",
          phone: "",
          password: "",
          role: "patient",
        });
        setConfirmPassword("");
        navigate("/signup", {
          replace: true,
          state: { registered: result.message },
        });
        return;
      }

      const result = await sendAuthRequest("login", {
        email: form.email,
        password: form.password,
      });
      localStorage.setItem("emergencycare-token", result.token);
      navigate(rolePaths[result.user.role], { replace: true });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link className="brand-link" to="/">
          <span className="brand-mark" aria-hidden="true">+</span>
          <span>EmergencyCare</span>
        </Link>
        <p className="eyebrow">{isSignup ? "Create your account" : "Welcome back"}</p>
        <h1>{isSignup ? "Join EmergencyCare" : "Log in"}</h1>
        <p className="intro">
          {isSignup
            ? "Create a patient, dispatcher, or ambulance account."
            : "Use the same email and password you registered with."}
        </p>

        {registered && isSignup && <p className="notice" role="status">{registered}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}

        <form className="auth-form" onSubmit={submit} autoComplete="off">
          {isSignup && (
            <>
              <label>
                Full name
                <input
                  name="name"
                  value={form.name}
                  onChange={update}
                  autoComplete="name"
                  minLength={2}
                  maxLength={120}
                  required
                />
              </label>
              <label>
                Phone number
                <input
                  name="phone"
                  type="tel"
                  value={form.phone}
                  onChange={update}
                  autoComplete="tel"
                  required
                />
              </label>
              <label>
                Account type
                <select name="role" value={form.role} onChange={update}>
                  <option value="patient">Patient</option>
                  <option value="dispatcher">Dispatcher</option>
                  <option value="ambulance">Ambulance</option>
                </select>
              </label>
            </>
          )}
          <label>
            Email
            <input
              name="email"
              type="email"
              value={form.email}
              onChange={update}
              autoComplete={isSignup ? "email" : "off"}
              maxLength={254}
              required
            />
          </label>
          <label>
            Password
            <span className="password-field">
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                value={form.password}
                onChange={update}
                autoComplete={isSignup ? "new-password" : "off"}
                minLength={isSignup ? 8 : undefined}
                required
              />
              <button
                className="password-toggle"
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
              >
                <PasswordVisibilityIcon visible={showPassword} />
              </button>
            </span>
          </label>
          {isSignup && (
            <label>
              Retype password
              <span className="password-field">
                <input
                  name="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value);
                    setError("");
                  }}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
                <button
                  className="password-toggle"
                  type="button"
                  onClick={() => setShowConfirmPassword((visible) => !visible)}
                  aria-label={showConfirmPassword ? "Hide password confirmation" : "Show password confirmation"}
                  aria-pressed={showConfirmPassword}
                >
                  <PasswordVisibilityIcon visible={showConfirmPassword} />
                </button>
              </span>
            </label>
          )}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Please wait…" : isSignup ? "Create account" : "Log in"}
          </button>
        </form>

        <p className="form-switch">
          {isSignup ? "Already registered?" : "New to EmergencyCare?"}{" "}
          <Link to={isSignup ? "/login" : "/signup"}>
            {isSignup ? "Log in" : "Create an account"}
          </Link>
        </p>
        <Link className="auth-back-link" to="/">
          ← Back to home
        </Link>
      </section>
    </main>
  );
}

function RoleHome({ role }) {
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem("emergencycare-token");
    if (!token) {
      navigate("/login", { replace: true });
      return undefined;
    }

    const controller = new AbortController();
    fetch(apiUrl("/api/auth/me"), {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then((response) => readApiResponse(response, "Could not verify your session."))
      .then((result) => result.user)
      .then((currentUser) => {
        setUser(currentUser);
        setError("");
      })
      .catch((requestError) => {
        if (requestError.name === "AbortError") return;
        if (requestError.message.includes("session") || requestError.message.includes("account")) {
          localStorage.removeItem("emergencycare-token");
          navigate("/login", { replace: true });
          return;
        }
        setError(requestError.message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [attempt, navigate]);

  function logOut() {
    localStorage.removeItem("emergencycare-token");
    navigate("/login", { replace: true });
  }

  if (loading) {
    return <main className="status-card" role="status">Checking your account…</main>;
  }
  if (error) {
    return (
      <main className="status-card">
        <p className="form-error" role="alert">{error}</p>
        <button className="primary-button" onClick={() => {
          setLoading(true);
          setAttempt((value) => value + 1);
        }}>
          Try again
        </button>
        <button className="text-button" onClick={logOut}>Log out</button>
      </main>
    );
  }
  if (!user) return null;
  if (user.role !== role) return <Navigate to={rolePaths[user.role]} replace />;
  if (role === "patient") {
    return <PatientApp user={user} onLogout={logOut} />;
  }
  if (role === "ambulance") {
    return <AmbulanceApp user={user} onLogout={logOut} />;
  }
  if (role === "dispatcher") {
    return <DispatcherApp user={user} onLogout={logOut} />;
  }
  if (role === "admin") {
    return <AdminDashboard user={user} onLogout={logOut} />;
  }

  const nextPhase = {
    dispatcher: "Phase 6",
  }[role];

  return (
    <main className="role-shell">
      <header className="role-header">
        <a className="brand-link" href="/">
          <span className="brand-mark" aria-hidden="true">+</span>
          <span>EmergencyCare</span>
        </a>
        <button className="text-button" onClick={logOut}>Log out</button>
      </header>
      <section className="role-card">
        <p className="eyebrow">{roleLabels[role]} account</p>
        <h1>Welcome, {user.name}</h1>
        <p className="intro">
          You are logged in as <strong>{user.email}</strong>.
        </p>
        <div className="phase-notice">
          Your {roleLabels[role].toLowerCase()} workspace will be built in{" "}
          {nextPhase}. Your account and role-based login are working.
        </div>
      </section>
    </main>
  );
}

function AppRoutes() {
  const token = localStorage.getItem("emergencycare-token");
  const navigate = useNavigate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    let listener;
    let active = true;
    CapacitorApp.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) navigate(-1);
      else CapacitorApp.exitApp();
    }).then((handle) => {
      if (active) listener = handle;
      else handle.remove();
    }).catch((error) => {
      console.error("Could not register Android back-button handling:", error.message);
    });
    return () => {
      active = false;
      listener?.remove();
    };
  }, [navigate]);

  if (Capacitor.isNativePlatform() && !API_BASE_URL) {
    return (
      <main className="status-card">
        <p className="form-error" role="alert">
          The EmergencyCare API address is not configured for this app. Set
          VITE_API_BASE_URL in client/.env to your deployed HTTPS API address,
          then rebuild the Android app.
        </p>
      </main>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/" replace /> : <AuthPage mode="login" />} />
      <Route path="/signup" element={token ? <Navigate to="/" replace /> : <AuthPage mode="signup" />} />
      <Route path="/patient" element={<RoleHome role="patient" />} />
      <Route path="/dispatcher" element={<RoleHome role="dispatcher" />} />
      <Route path="/ambulance" element={<RoleHome role="ambulance" />} />
      <Route path="/admin" element={<RoleHome role="admin" />} />
      <Route path="/" element={token ? <Navigate to="/patient" replace /> : <HomePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
