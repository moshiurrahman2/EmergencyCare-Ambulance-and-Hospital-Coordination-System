import { useCallback, useEffect, useRef, useState } from "react";
import useTripSocket from "./useTripSocket.js";
import readApiResponse from "./readApiResponse.js";
import NotificationCenter from "./NotificationCenter.jsx";
import WorkspaceNavigation from "./WorkspaceNavigation.jsx";
import LocationName from "./LocationName.jsx";

async function dispatcherRequest(path, options = {}) {
  const token = localStorage.getItem("emergencycare-token");
  const response = await fetch(`/api/dispatcher${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  return readApiResponse(response, "The dispatcher request failed.");
}

function dateLabel(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

const emptyForm = {
  name: "",
  age: "",
  permanentAddress: "",
  presentAddress: "",
  phone: "",
  nidNumber: "",
};

export default function DispatcherApp({ user, onLogout }) {
  const [tab, setTab] = useState("home");
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ ...emptyForm, name: user.name, phone: user.phone });
  const [requests, setRequests] = useState([]);
  const [activeTrips, setActiveTrips] = useState([]);
  const [activity, setActivity] = useState([]);
  const [expandedActivityId, setExpandedActivityId] = useState(null);
  const [candidatesByRequest, setCandidatesByRequest] = useState({});
  const [expandedRequest, setExpandedRequest] = useState("");
  const [loadingCandidates, setLoadingCandidates] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const presenceInitialized = useRef(false);

  const handleError = useCallback((requestError) => {
    if (requestError.status === 401 || requestError.status === 403) {
      onLogout();
      return;
    }
    setError(requestError.message);
  }, [onLogout]);

  const loadProfile = useCallback(async () => {
    try {
      const result = await dispatcherRequest("/profile");
      setProfile(result.profile);
      setForm({
        name: result.profile.name || user.name,
        age: result.profile.age ?? "",
        permanentAddress: result.profile.permanentAddress || "",
        presentAddress: result.profile.presentAddress || "",
        phone: result.profile.phone || user.phone,
        nidNumber: result.profile.nidNumber || "",
      });
      setError("");
    } catch (requestError) {
      handleError(requestError);
    } finally {
      setLoading(false);
    }
  }, [handleError, user.name, user.phone]);

  const loadWork = useCallback(async () => {
    try {
      const result = await dispatcherRequest("/work");
      setRequests(result.requests);
      setActiveTrips(result.activeTrips);
      setError("");
    } catch (requestError) {
      handleError(requestError);
    }
  }, [handleError]);
  const loadActivity = useCallback(async () => {
    try {
      const result = await dispatcherRequest("/activity");
      setActivity(result.activity);
    } catch (requestError) {
      handleError(requestError);
    }
  }, [handleError]);
  const applyTripUpdate = useCallback((update) => {
    if (update.status) {
      loadWork();
      return;
    }
    const mergeUpdate = (items) => items.map((item) =>
      item.id === update.requestId ? { ...item, ...update } : item,
    );
    setRequests(mergeUpdate);
    setActiveTrips(mergeUpdate);
  }, [loadWork]);
  useTripSocket(
    [
      ...requests.filter((item) => item.dispatcherId === user.id),
      ...activeTrips,
    ].map((item) => item.id),
    applyTripUpdate,
  );

  const setAvailability = useCallback(async (isOnline) => {
    try {
      const result = await dispatcherRequest("/presence", {
        method: "PATCH",
        body: JSON.stringify({ isOnline }),
      });
      setProfile((current) => current ? { ...current, isOnline: result.isOnline } : current);
      setNotice(result.message);
      setError("");
    } catch (requestError) {
      handleError(requestError);
    }
  }, [handleError]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (profile?.approvalStatus === "approved" && !presenceInitialized.current) {
      presenceInitialized.current = true;
      setAvailability(true);
    }
  }, [profile?.approvalStatus, setAvailability]);

  useEffect(() => {
    if (profile?.approvalStatus !== "approved" || !profile.isOnline) return undefined;
    const interval = window.setInterval(() => {
      dispatcherRequest("/presence", {
        method: "PATCH",
        body: JSON.stringify({ isOnline: true }),
      }).catch(handleError);
    }, 20000);
    return () => window.clearInterval(interval);
  }, [handleError, profile?.approvalStatus, profile?.isOnline]);

  useEffect(() => {
    if (profile?.approvalStatus !== "approved") return undefined;
    loadWork();
    const interval = window.setInterval(loadWork, 10000);
    return () => window.clearInterval(interval);
  }, [loadWork, profile?.approvalStatus]);

  useEffect(() => {
    if (profile?.approvalStatus === "approved" && tab === "activity") loadActivity();
  }, [loadActivity, profile?.approvalStatus, tab]);

  function updateForm(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
    setError("");
    setNotice("");
  }

  async function submitProfile(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const result = await dispatcherRequest("/profile", {
        method: "PUT",
        body: JSON.stringify({ ...form, age: Number(form.age) }),
      });
      setProfile(result.profile);
      setNotice(result.message);
    } catch (requestError) {
      handleError(requestError);
    } finally {
      setBusy(false);
    }
  }

  async function claimRequest(item) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await dispatcherRequest(`/requests/${item.id}/claim`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setNotice(result.message);
      await loadWork();
    } catch (requestError) {
      handleError(requestError);
    } finally {
      setBusy(false);
    }
  }

  async function loadCandidates(item) {
    if (expandedRequest === item.id) {
      setExpandedRequest("");
      return;
    }
    setLoadingCandidates(item.id);
    setExpandedRequest(item.id);
    setError("");
    try {
      const result = await dispatcherRequest(`/requests/${item.id}/ambulances`);
      setCandidatesByRequest((current) => ({
        ...current,
        [item.id]: result.ambulances,
      }));
    } catch (requestError) {
      handleError(requestError);
    } finally {
      setLoadingCandidates("");
    }
  }

  async function assignAmbulance(item, ambulance) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await dispatcherRequest(`/requests/${item.id}/assign`, {
        method: "POST",
        body: JSON.stringify({ ambulanceId: ambulance.id }),
      });
      setNotice(result.message);
      setExpandedRequest("");
      setCandidatesByRequest((current) => ({ ...current, [item.id]: [] }));
      await loadWork();
    } catch (requestError) {
      handleError(requestError);
      if (requestError.status === 409) {
        try {
          const result = await dispatcherRequest(`/requests/${item.id}/ambulances`);
          setCandidatesByRequest((current) => ({
            ...current,
            [item.id]: result.ambulances,
          }));
        } catch (refreshError) {
          handleError(refreshError);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function logOut() {
    if (profile?.approvalStatus === "approved" && profile.isOnline) {
      try {
        await dispatcherRequest("/presence", {
          method: "PATCH",
          body: JSON.stringify({ isOnline: false }),
        });
      } catch (requestError) {
        setError(requestError.message);
      }
    }
    onLogout();
  }

  if (loading) {
    return <main className="status-card" role="status">Loading your dispatcher workspace…</main>;
  }

  const needsProfile = !profile?.approvalStatus || profile.approvalStatus === "rejected";

  return (
    <main className="dispatcher-shell">
      <header className="dispatcher-header">
        <a className="brand-link" href="/">
          <span className="brand-mark" aria-hidden="true">+</span>
          <span>EmergencyCare <small>Dispatch</small></span>
        </a>
        <div className="dispatcher-header-actions">
          <NotificationCenter user={user} />
          {profile?.approvalStatus === "approved" && (
            <button
              className={`dispatcher-presence ${profile.isOnline ? "online" : "offline"}`}
              disabled={busy}
              onClick={() => setAvailability(!profile.isOnline)}
            >
              <span aria-hidden="true" />
              {profile.isOnline ? "Online for dispatch" : "Offline"}
            </button>
          )}
          <button className="text-button" onClick={logOut}>Log out</button>
        </div>
      </header>

      <section className="dispatcher-content">
        <p className="eyebrow">Dispatcher workspace</p>
        <h1>{needsProfile ? "Complete your dispatcher profile" : `Welcome, ${profile.name}`}</h1>
        <p className="intro">
          {needsProfile
            ? "Submit your details for admin review before handling requests."
            : "Coordinate emergency requests and available ambulances."}
        </p>
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="notice" role="status">{notice}</p>}

        {tab === "profile" && needsProfile ? (
          <>
            {profile?.approvalStatus === "rejected" && (
              <section className="dispatcher-panel rejected-dispatcher">
                <span className="status-pill rejected">Application rejected</span>
                <h2>Update your details and resubmit</h2>
                <p>{profile.approvalReason || "Please review your information and submit it again."}</p>
              </section>
            )}
            <section className="dispatcher-panel">
              <form className="dispatcher-form" onSubmit={submitProfile}>
                <div className="dispatcher-form-grid">
                  <label>
                    Full name
                    <input name="name" value={form.name} onChange={updateForm} minLength="2" maxLength="120" required />
                  </label>
                  <label>
                    Age
                    <input name="age" type="number" min="18" max="100" step="1" value={form.age} onChange={updateForm} required />
                  </label>
                  <label>
                    Phone number
                    <input name="phone" type="tel" value={form.phone} onChange={updateForm} minLength="7" maxLength="32" required />
                  </label>
                  <label>
                    NID number
                    <input name="nidNumber" value={form.nidNumber} onChange={updateForm} minLength="3" maxLength="64" required />
                  </label>
                  <label className="wide-field">
                    Permanent address
                    <textarea name="permanentAddress" value={form.permanentAddress} onChange={updateForm} minLength="3" maxLength="500" rows="2" required />
                  </label>
                  <label className="wide-field">
                    Present address
                    <textarea name="presentAddress" value={form.presentAddress} onChange={updateForm} minLength="3" maxLength="500" rows="2" required />
                  </label>
                  <label className="wide-field">
                    Email
                    <input value={profile?.email || user.email} readOnly />
                    <small>Email cannot be changed in this phase.</small>
                  </label>
                </div>
                <button className="primary-button" disabled={busy}>
                  {busy ? "Submitting…" : "Submit for approval"}
                </button>
              </form>
            </section>
          </>
        ) : tab === "profile" && profile.approvalStatus === "pending" ? (
          <section className="dispatcher-panel dispatcher-pending">
            <span className="status-pill pending">Pending approval</span>
            <h2>Your application is being reviewed</h2>
            <p>You can handle patient requests after an administrator approves your dispatcher profile.</p>
            <dl className="detail-grid">
              <div><dt>Name</dt><dd>{profile.name}</dd></div>
              <div><dt>Age</dt><dd>{profile.age}</dd></div>
              <div><dt>Phone</dt><dd>{profile.phone}</dd></div>
              <div><dt>NID number</dt><dd>{profile.nidNumber}</dd></div>
              <div><dt>Permanent address</dt><dd>{profile.permanentAddress}</dd></div>
              <div><dt>Present address</dt><dd>{profile.presentAddress}</dd></div>
            </dl>
            <button className="secondary-button compact-button" onClick={loadProfile}>
              Refresh approval status
            </button>
          </section>
        ) : profile?.approvalStatus !== "approved" ? (
          <section className="dispatcher-panel dispatcher-pending">
            <span className={`status-pill ${profile?.approvalStatus === "rejected" ? "rejected" : "pending"}`}>
              {profile?.approvalStatus === "rejected" ? "Application rejected" : "Profile required"}
            </span>
            <h2>{tab === "home" ? "Welcome to EmergencyCare" : "Your dispatcher activity"}</h2>
            <p>
              {profile?.approvalStatus === "rejected"
                ? profile.approvalReason || "Update your profile before handling dispatcher work."
                : "Submit your dispatcher profile and wait for administrator approval to access requests and activity."}
            </p>
            <button className="secondary-button compact-button" onClick={() => setTab("profile")}>
              Complete your profile
            </button>
          </section>
        ) : (
          <>
            {tab === "home" && (
              <section className="dispatcher-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Dispatch queue</p>
                    <h2>Patient requests</h2>
                  </div>
                  <button className="secondary-button compact-button" onClick={loadWork}>Refresh</button>
                </div>
                {requests.length === 0 ? (
                  <p className="empty-state">No searching requests are waiting right now.</p>
                ) : (
                  <div className="record-list">
                    {requests.map((item) => {
                      const assignedToMe = item.dispatcherId === user.id;
                      const unassigned = item.dispatcherId === null;
                      const candidates = candidatesByRequest[item.id] || [];
                      return (
                        <article className="record-card" key={item.id}>
                          <div className="record-heading">
                            <div>
                              <h3>Request #{item.id} · {item.patientName}</h3>
                              <p>{item.patientPhone} · {dateLabel(item.createdAt)}</p>
                            </div>
                            <span className={`status-pill ${item.status}`}>
                              {item.status.replaceAll("_", " ")}
                            </span>
                          </div>
                          <dl className="detail-grid">
                            <div><dt>Pickup</dt><dd>{item.currentLocation}</dd></div>
                            <div>
                              <dt>Pickup coordinates</dt>
                              <dd>{item.currentLatitude}, {item.currentLongitude}</dd>
                            </div>
                            <div><dt>Destination</dt><dd>{item.destination}</dd></div>
                            {item.fareAmount !== null && item.fareAmount !== undefined && (
                              <>
                                <div>
                                  <dt>Estimated Cash Fare (Taka)</dt>
                                  <dd>৳{Number(item.fareAmount).toFixed(0)}</dd>
                                </div>
                                <div>
                                  <dt>Estimated Distance</dt>
                                  <dd>{Number(item.estimatedDistanceKm).toFixed(2)} Km</dd>
                                </div>
                              </>
                            )}
                            {item.fareAmount === null && (
                              <div><dt>Cash fare</dt><dd>No route-based estimate; agree directly with the patient.</dd></div>
                            )}
                            <div><dt>Ambulance type</dt><dd>{item.ambulanceType}</dd></div>
                            <div className="wide-detail"><dt>Symptoms</dt><dd>{item.symptoms}</dd></div>
                          </dl>

                          {item.driverName && (
                            <div className="offered-ambulance">
                              <strong>Assigned to {item.driverName}</strong>
                              <span>{item.vehicleNumber} · {item.driverPhone}</span>
                            </div>
                          )}

                          <div className="record-actions">
                            {unassigned && (
                              <button
                                className="primary-button compact-button"
                                disabled={busy}
                                onClick={() => claimRequest(item)}
                              >
                                Take request
                              </button>
                            )}
                            {assignedToMe && item.status === "searching" && (
                              <button
                                className="secondary-button compact-button"
                                disabled={Boolean(loadingCandidates)}
                                onClick={() => loadCandidates(item)}
                              >
                                {loadingCandidates === item.id
                                  ? "Finding ambulances…"
                                  : expandedRequest === item.id
                                    ? "Hide nearest ambulances"
                                    : "Find nearest ambulance"}
                              </button>
                            )}
                          </div>

                          {expandedRequest === item.id && (
                            <div className="candidate-list">
                              <h4>Available ambulances, nearest first</h4>
                              {loadingCandidates === item.id ? (
                                <p className="empty-state">Calculating distance and ETA…</p>
                              ) : candidates.length === 0 ? (
                                <p className="empty-state">
                                  No other approved, online ambulance is available right now.
                                </p>
                              ) : (
                                candidates.map((ambulance, index) => (
                                  <div className="candidate-row" key={ambulance.id}>
                                    <div>
                                      <strong>{index === 0 ? "Closest · " : ""}{ambulance.driverName}</strong>
                                      <span>{ambulance.vehicleNumber} · {ambulance.phone}</span>
                                      <small>{ambulance.distanceKm} km away · about {ambulance.etaMinutes} min</small>
                                    </div>
                                    <button
                                      className="primary-button compact-button"
                                      disabled={busy || index !== 0}
                                      onClick={() => assignAmbulance(item, ambulance)}
                                    >
                                      Assign ambulance
                                    </button>
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {tab === "activity" && (
              <section className="dispatcher-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">History</p>
                    <h2>Dispatcher activity</h2>
                    <small className="location-timestamp">
                      Requests assigned to you, including completed and cancelled trips.
                    </small>
                  </div>
                  <button className="secondary-button compact-button" onClick={loadActivity}>Refresh</button>
                </div>
                {activity.length === 0 ? (
                  <p className="empty-state">Your assigned requests will appear here.</p>
                ) : (
                  <div className="record-list">
                    {activity.map((trip) => (
                      <article className="record-card" key={trip.id}>
                        <button
                          className="record-heading record-summary"
                          aria-expanded={expandedActivityId === trip.id}
                          onClick={() => setExpandedActivityId(
                            (current) => current === trip.id ? null : trip.id,
                          )}
                        >
                          <span>
                            <span className="record-summary-title">Request #{trip.id} · {trip.patientName}</span>
                            <span className="record-summary-subtitle">{trip.destination} · Updated {dateLabel(trip.updatedAt)}</span>
                          </span>
                          <span className={`status-pill ${trip.status}`}>
                            {trip.status === "accepted" ? "Ambulance assigned" : trip.status.replaceAll("_", " ")}
                          </span>
                        </button>
                        {expandedActivityId === trip.id && (
                          <>
                            <dl className="detail-grid">
                              <div><dt>Pickup</dt><dd>{trip.currentLocation}</dd></div>
                              <div><dt>Destination</dt><dd>{trip.destination}</dd></div>
                              <div><dt>Ambulance type</dt><dd>{trip.ambulanceType}</dd></div>
                              <div><dt>Symptoms</dt><dd>{trip.symptoms}</dd></div>
                              <div><dt>Requested</dt><dd>{dateLabel(trip.createdAt)}</dd></div>
                              {trip.fareAmount !== null && trip.fareAmount !== undefined && (
                                <>
                                  <div><dt>Estimated Cash Fare (Taka)</dt><dd>৳{Number(trip.fareAmount).toFixed(0)}</dd></div>
                                  <div><dt>Estimated Distance</dt><dd>{Number(trip.estimatedDistanceKm).toFixed(2)} Km</dd></div>
                                  <div><dt>Payment status</dt><dd>
                                    {trip.status === "cancelled" ? "No fare due" : trip.paymentStatus}
                                  </dd></div>
                                </>
                              )}
                              {trip.fareAmount === null && (
                                <div><dt>Cash fare</dt><dd>No route-based estimate was saved.</dd></div>
                              )}
                              <div><dt>Driver</dt><dd>{trip.driverName || "Not assigned"}</dd></div>
                              <div><dt>Vehicle</dt><dd>{trip.vehicleNumber || "Not assigned"}</dd></div>
                              <div><dt>Patient contact</dt><dd><a href={`tel:${trip.patientPhone}`}>{trip.patientPhone}</a></dd></div>
                              <div><dt>Driver contact</dt><dd>{trip.driverPhone ? <a href={`tel:${trip.driverPhone}`}>{trip.driverPhone}</a> : "Not assigned"}</dd></div>
                            </dl>
                            {trip.ambulanceLatitude !== null && trip.ambulanceLatitude !== undefined &&
                              trip.ambulanceLongitude !== null && trip.ambulanceLongitude !== undefined && (
                              <>
                                <a
                                  className="dispatcher-map-link"
                                  href={`https://www.google.com/maps?q=${trip.ambulanceLatitude},${trip.ambulanceLongitude}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  View latest ambulance coordinates
                                </a>
                                <LocationName
                                  latitude={trip.ambulanceLatitude}
                                  longitude={trip.ambulanceLongitude}
                                />
                              </>
                            )}
                          </>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}

            {tab === "profile" && (
              <section className="dispatcher-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Approved dispatcher</p>
                    <h2>Profile details</h2>
                  </div>
                  <span className="status-pill approved">Approved</span>
                </div>
                <dl className="detail-grid">
                  <div><dt>Name</dt><dd>{profile.name}</dd></div>
                  <div><dt>Email</dt><dd>{profile.email}</dd></div>
                  <div><dt>Age</dt><dd>{profile.age}</dd></div>
                  <div><dt>Phone</dt><dd>{profile.phone}</dd></div>
                  <div><dt>NID number</dt><dd>{profile.nidNumber}</dd></div>
                  <div><dt>Permanent address</dt><dd>{profile.permanentAddress}</dd></div>
                  <div><dt>Present address</dt><dd>{profile.presentAddress}</dd></div>
                </dl>
              </section>
            )}
          </>
        )}
      </section>
      <WorkspaceNavigation
        activeTab={tab}
        label="Dispatcher navigation"
        onSelect={(value) => {
          setTab(value);
          setError("");
          setNotice("");
        }}
      />
    </main>
  );
}
