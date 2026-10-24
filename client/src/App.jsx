import { useEffect, useState } from "react";
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
  const response = await fetch(`/api/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return readApiResponse(response, "Unable to complete your request.");
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
            <input
              name="password"
              type="password"
              value={form.password}
              onChange={update}
              autoComplete={isSignup ? "new-password" : "off"}
              minLength={isSignup ? 8 : undefined}
              required
            />
          </label>
          {isSignup && (
            <label>
              Retype password
              <input
                name="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  setError("");
                }}
                autoComplete="new-password"
                minLength={8}
                required
              />
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
    fetch("/api/auth/me", {
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
