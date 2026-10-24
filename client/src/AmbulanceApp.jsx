import { useCallback, useEffect, useRef, useState } from "react";
import useTripSocket from "./useTripSocket.js";
import readApiResponse from "./readApiResponse.js";
import NotificationCenter from "./NotificationCenter.jsx";
import WorkspaceNavigation from "./WorkspaceNavigation.jsx";
import lookupLocationName from "./locationName.js";

async function ambulanceRequest(path, options = {}) {
  const token = localStorage.getItem("emergencycare-token");
  const response = await fetch(`/api/ambulance${path}`, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  return readApiResponse(response, "The ambulance request failed.");
}

function dateLabel(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

const emptyProfile = {
  driverName: "",
  vehicleNumber: "",
  permanentAddress: "",
  presentAddress: "",
  phone: "",
  nidNumber: "",
  drivingLicenceNumber: "",
};

export default function AmbulanceApp({ user, onLogout }) {
  const [tab, setTab] = useState("home");
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ ...emptyProfile, phone: user.phone });
  const [nidPhoto, setNidPhoto] = useState(null);
  const [licencePhoto, setLicencePhoto] = useState(null);
  const [activity, setActivity] = useState([]);
  const [expandedActivityId, setExpandedActivityId] = useState(null);
  const [activeTrip, setActiveTrip] = useState(null);
  const [pendingCashTrip, setPendingCashTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [locationStatus, setLocationStatus] = useState("");
  const lastLocationSent = useRef(0);

  const handleError = useCallback((requestError) => {
    if (requestError.status === 401 || requestError.status === 403) {
      onLogout();
      return;
    }
    setError(requestError.message);
  }, [onLogout]);

  const loadProfile = useCallback(async () => {
    try {
      const result = await ambulanceRequest("/profile");
      setProfile(result.profile);
      if (result.profile && result.profile.approvalStatus === "rejected") {
        setForm({
          driverName: result.profile.driverName,
          vehicleNumber: result.profile.vehicleNumber,
          permanentAddress: result.profile.permanentAddress,
          presentAddress: result.profile.presentAddress,
          phone: result.profile.phone,
          nidNumber: result.profile.nidNumber,
          drivingLicenceNumber: result.profile.drivingLicenceNumber,
        });
      } else if (!result.profile) {
        setForm((current) => ({
          ...current,
          driverName: user.name,
          phone: user.phone,
        }));
      }
      setError("");
    } catch (requestError) {
      handleError(requestError);
    } finally {
      setLoading(false);
    }
  }, [handleError, user.name, user.phone]);

  const loadWork = useCallback(async () => {
    try {
      const result = await ambulanceRequest("/work");
      setActiveTrip(result.activeTrip);
      setPendingCashTrip(result.pendingCashTrip);
    } catch (requestError) {
      handleError(requestError);
    }
  }, [handleError]);
  const loadActivity = useCallback(async () => {
    try {
      const result = await ambulanceRequest("/activity");
      setActivity(result.activity);
    } catch (requestError) {
      handleError(requestError);
    }
  }, [handleError]);
  const applyTripUpdate = useCallback((update) => {
    setActiveTrip((current) =>
      current?.id === update.requestId ? { ...current, ...update } : current,
    );
  }, []);
  useTripSocket(
    activeTrip ? [activeTrip.id] : [],
    applyTripUpdate,
  );

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (profile?.approvalStatus !== "approved") return undefined;
    loadWork();
    const interval = window.setInterval(loadWork, 10000);
    return () => window.clearInterval(interval);
  }, [loadWork, profile?.approvalStatus]);

  useEffect(() => {
    if (profile?.approvalStatus === "approved" && tab === "activity") loadActivity();
  }, [loadActivity, profile?.approvalStatus, tab]);

  useEffect(() => {
    if (profile?.approvalStatus !== "approved" || (!profile.isOnline && !activeTrip)) {
      return undefined;
    }
    if (!navigator.geolocation) {
      setLocationStatus("This browser does not support location sharing.");
      return undefined;
    }

    setLocationStatus("Sharing your latest location…");
    const watchId = navigator.geolocation.watchPosition(
      async ({ coords }) => {
        const now = Date.now();
        if (now - lastLocationSent.current < 10000) return;
        lastLocationSent.current = now;
        try {
          await ambulanceRequest("/location", {
            method: "POST",
            body: JSON.stringify({
              latitude: coords.latitude,
              longitude: coords.longitude,
            }),
          });
          try {
            const result = await lookupLocationName(coords.latitude, coords.longitude);
            setLocationStatus(result.placeName
              ? `Location shared near ${result.placeName} at ${new Date().toLocaleTimeString()}.`
              : `Location shared; no place name was found (${new Date().toLocaleTimeString()}).`);
          } catch (lookupError) {
            setLocationStatus(`${lookupError.message} Coordinates were shared successfully.`);
          }
        } catch (requestError) {
          handleError(requestError);
        }
      },
      () => setLocationStatus("Location access failed. Allow location permission to share your position."),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [activeTrip?.id, handleError, profile?.approvalStatus, profile?.isOnline]);

  function updateField(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
    setError("");
    setNotice("");
  }

  function updatePhoto(event, setPhoto) {
    const file = event.target.files?.[0] || null;
    if (file && file.size > 5 * 1024 * 1024) {
      setError("Each document photo must be 5 MB or smaller.");
      event.target.value = "";
      return;
    }
    setPhoto(file);
    setError("");
  }

  async function submitProfile(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    const data = new FormData();
    Object.entries(form).forEach(([key, value]) => data.append(key, value));
    if (nidPhoto) data.append("nidPhoto", nidPhoto);
    if (licencePhoto) data.append("licencePhoto", licencePhoto);

    try {
      const result = await ambulanceRequest("/profile", {
        method: "PUT",
        body: data,
      });
      setProfile(result.profile);
      setNidPhoto(null);
      setLicencePhoto(null);
      setNotice(result.message);
    } catch (requestError) {
      handleError(requestError);
    } finally {
      setBusy(false);
    }
  }

  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("This browser does not support location sharing."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => resolve({
          latitude: coords.latitude,
          longitude: coords.longitude,
        }),
        () => reject(new Error("Allow location access before going online.")),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 },
      );
    });
  }

  async function toggleAvailability() {
    const isOnline = !profile.isOnline;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const location = isOnline ? await getPosition() : {};
      const result = await ambulanceRequest("/availability", {
        method: "PATCH",
        body: JSON.stringify({ isOnline, ...location }),
      });
      setProfile((current) => ({ ...current, isOnline: result.isOnline }));
      setNotice(result.message);
      if (isOnline) await loadWork();
    } catch (requestError) {
      handleError(requestError);
    } finally {
      setBusy(false);
    }
  }

  async function advanceTrip() {
    if (!activeTrip) return;
    const nextStatus = {
      accepted: "picked_up",
      picked_up: "at_hospital",
      at_hospital: "completed",
    }[activeTrip.status];
    if (!nextStatus) return;

    setError("");
    setNotice("");
    setBusy(true);
    try {
      const result = await ambulanceRequest(`/requests/${activeTrip.id}/step`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      setNotice(result.message);
      await loadWork();
    } catch (requestError) {
      handleError(requestError);
    } finally {
      setBusy(false);
    }
  }

  async function markCashCollected(tripId) {
    if (!window.confirm("Confirm that you have received the cash fare from the patient?")) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const result = await ambulanceRequest(`/requests/${tripId}/cash-collected`, {
        method: "PATCH",
        body: JSON.stringify({}),
      });
      setNotice(result.message);
      await Promise.all([loadWork(), loadActivity()]);
    } catch (requestError) {
      handleError(requestError);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <main className="status-card" role="status">Loading your ambulance workspace…</main>;
  }

  const needsProfile = !profile || profile.approvalStatus === "rejected";

  return (
    <main className="ambulance-shell">
      <header className="ambulance-header">
        <a className="brand-link" href="/">
          <span className="brand-mark" aria-hidden="true">+</span>
          <span>EmergencyCare</span>
        </a>
        <div className="ambulance-header-actions">
          <NotificationCenter user={user} />
          <button className="text-button" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <section className="ambulance-content">
        <p className="eyebrow">Ambulance partner</p>
        <h1>{needsProfile ? "Complete your driver profile" : "Your ambulance workspace"}</h1>
        <p className="intro">
          {needsProfile
            ? "Submit your details and verification documents for admin review."
            : `Welcome, ${profile.driverName}.`}
        </p>
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="notice" role="status">{notice}</p>}

        {tab === "profile" && needsProfile ? (
          <>
            {profile?.approvalStatus === "rejected" && (
              <section className="ambulance-review-message">
                <span className="status-pill rejected">Application rejected</span>
                <h2>Update your details and resubmit</h2>
                <p>{profile.approvalReason || "Please review your information and submit it again."}</p>
              </section>
            )}
            <AmbulanceProfileForm
              form={form}
              nidPhoto={nidPhoto}
              licencePhoto={licencePhoto}
              busy={busy}
              onFieldChange={updateField}
              onNidPhoto={(event) => updatePhoto(event, setNidPhoto)}
              onLicencePhoto={(event) => updatePhoto(event, setLicencePhoto)}
              onSubmit={submitProfile}
            />
          </>
        ) : tab === "profile" && profile?.approvalStatus === "pending" ? (
          <section className="ambulance-panel">
            <div className="approval-waiting-mark" aria-hidden="true">✓</div>
            <span className="status-pill pending">Pending approval</span>
            <h2>Your details are with our admin team</h2>
            <p>
              Your profile and documents have been submitted. You will be able to
              go online after an administrator approves your application.
            </p>
            <ProfileSummary profile={profile} />
            <button className="secondary-button compact-button" onClick={loadProfile}>
              Refresh approval status
            </button>
          </section>
        ) : profile?.approvalStatus !== "approved" ? (
          <section className="ambulance-panel">
            <span className={`status-pill ${profile?.approvalStatus === "rejected" ? "rejected" : "pending"}`}>
              {profile?.approvalStatus === "rejected" ? "Application rejected" : "Profile required"}
            </span>
            <h2>{tab === "home" ? "Welcome to EmergencyCare" : "Your ambulance activity"}</h2>
            <p>
              {profile?.approvalStatus === "rejected"
                ? profile.approvalReason || "Update your driver profile before handling requests."
                : "Submit your driver profile and wait for administrator approval to access ambulance requests and activity."}
            </p>
            <button className="secondary-button compact-button" onClick={() => setTab("profile")}>
              Complete your profile
            </button>
          </section>
        ) : (
          <>
            {tab === "home" && <section className="ambulance-panel availability-panel">
              <div>
                <p className="eyebrow">Availability</p>
                <h2>{profile.isOnline ? "You are online" : "You are offline"}</h2>
                <p>
                  {profile.isOnline
                    ? "Dispatchers can assign you to the closest matching request."
                    : "Go online to become available for dispatcher assignments."}
                </p>
              </div>
              <button
                className={`availability-toggle ${profile.isOnline ? "online" : ""}`}
                role="switch"
                aria-checked={profile.isOnline}
                disabled={busy}
                onClick={toggleAvailability}
              >
                <span />
                {busy ? "Please wait…" : profile.isOnline ? "Go offline" : "Go online"}
              </button>
              <div className="location-status" role="status">
                {locationStatus}
                {locationStatus && (
                  <small>
                    Place names by{" "}
                    <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                      © OpenStreetMap contributors
                    </a>
                    .
                  </small>
                )}
              </div>
            </section>}

            {tab === "home" && activeTrip && <ActiveTrip trip={activeTrip} busy={busy} onAdvance={advanceTrip} />}

            {tab === "home" && pendingCashTrip && (
              <section className="ambulance-panel cash-collection-panel">
                <p className="eyebrow">Cash collection</p>
                <h2>Trip #{pendingCashTrip.id} · ৳{Number(pendingCashTrip.fareAmount).toFixed(0)}</h2>
                <p>
                  {pendingCashTrip.destination} · Route estimate: {Number(pendingCashTrip.estimatedDistanceKm).toFixed(2)} km
                  {" "}· {pendingCashTrip.ambulanceType.toUpperCase()} ambulance
                </p>
                <p className="phase-notice">
                  Collect this fare directly from the patient after completing the trip.
                  Record it only after you have received the cash.
                </p>
                <button
                  className="primary-button compact-button"
                  disabled={busy}
                  onClick={() => markCashCollected(pendingCashTrip.id)}
                >
                  {busy ? "Recording…" : "Confirm cash received"}
                </button>
              </section>
            )}

            {tab === "home" && !activeTrip && <section className="ambulance-panel">
              <p className="eyebrow">Dispatcher assignments</p>
              <h2>No active assignment</h2>
              <p className="empty-state">
                {profile.isOnline
                  ? "You are available. Patient information appears here only after a dispatcher assigns you a request."
                  : "Go online to become available for dispatcher assignments."}
              </p>
            </section>}

            {tab === "activity" && <section className="ambulance-panel">
              <div className="patient-panel-heading">
                <div>
                  <p className="eyebrow">History</p>
                  <h2>Ambulance activity</h2>
                </div>
                <button className="secondary-button compact-button" onClick={loadActivity}>Refresh</button>
              </div>
              {activity.length === 0 ? (
                <p className="empty-state">Requests you respond to will appear here.</p>
              ) : (
                <div className="record-list">
                  {activity.map((item) => (
                    <article className="record-card" key={item.id}>
                      <button
                        className="record-heading record-summary"
                        aria-expanded={expandedActivityId === item.id}
                        onClick={() => setExpandedActivityId(
                          (current) => current === item.id ? null : item.id,
                        )}
                      >
                        <span>
                          <span className="record-summary-title">Request #{item.id} · {item.patientName}</span>
                          <span className="record-summary-subtitle">{item.destination} · {dateLabel(item.updatedAt)} · {item.ambulanceType} ambulance</span>
                        </span>
                        <span className="record-summary-meta">
                          {item.fareAmount !== null && item.fareAmount !== undefined && (
                            <strong>৳{Number(item.fareAmount).toFixed(0)}</strong>
                          )}
                          <span className={`status-pill ${item.status}`}>
                            {item.status.replaceAll("_", " ")}
                          </span>
                        </span>
                      </button>
                      {expandedActivityId === item.id && (
                        <dl className="detail-grid">
                          <div><dt>Patient</dt><dd>{item.patientName}</dd></div>
                          <div><dt>Patient phone</dt><dd><a href={`tel:${item.patientPhone}`}>{item.patientPhone}</a></dd></div>
                          <div><dt>Pickup</dt><dd>{item.currentLocation}</dd></div>
                          <div><dt>Destination</dt><dd>{item.destination}</dd></div>
                          <div><dt>Symptoms</dt><dd>{item.symptoms}</dd></div>
                          <div><dt>Ambulance type</dt><dd>{item.ambulanceType}</dd></div>
                          <div><dt>Requested</dt><dd>{dateLabel(item.createdAt)}</dd></div>
                          <div><dt>Last updated</dt><dd>{dateLabel(item.updatedAt)}</dd></div>
                          {item.fareAmount !== null && item.fareAmount !== undefined && (
                            <>
                              <div><dt>Fare</dt><dd>৳{Number(item.fareAmount).toFixed(0)}</dd></div>
                              <div><dt>Estimated distance</dt><dd>{Number(item.estimatedDistanceKm).toFixed(2)} km</dd></div>
                              <div><dt>Cash status</dt><dd>
                                {item.status === "cancelled"
                                  ? "No fare due"
                                  : item.paymentStatus === "paid" ? "Collected" : "Pending"}
                              </dd></div>
                            </>
                          )}
                        </dl>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>}

            {tab === "profile" && <section className="ambulance-panel">
              <p className="eyebrow">Approved profile</p>
              <ProfileSummary profile={profile} />
              <dl className="detail-grid profile-details">
                <div><dt>Email</dt><dd>{user.email}</dd></div>
                <div><dt>Account type</dt><dd>Ambulance</dd></div>
              </dl>
              <button className="patient-logout" onClick={onLogout}>Log out of EmergencyCare</button>
            </section>}
          </>
        )}
      </section>
      <WorkspaceNavigation
        activeTab={tab}
        label="Ambulance navigation"
        onSelect={(value) => {
          setTab(value);
          setError("");
          setNotice("");
        }}
      />
    </main>
  );
}

function AmbulanceProfileForm({
  form,
  nidPhoto,
  licencePhoto,
  busy,
  onFieldChange,
  onNidPhoto,
  onLicencePhoto,
  onSubmit,
}) {
  return (
    <section className="ambulance-panel">
      <form className="ambulance-form" onSubmit={onSubmit}>
        <div className="ambulance-form-grid">
          <label>
            Driver name
            <input name="driverName" value={form.driverName} onChange={onFieldChange} minLength="2" maxLength="120" required />
          </label>
          <label>
            Vehicle number
            <input name="vehicleNumber" value={form.vehicleNumber} onChange={onFieldChange} minLength="2" maxLength="32" required />
          </label>
          <label>
            Phone number
            <input name="phone" type="tel" value={form.phone} onChange={onFieldChange} minLength="7" maxLength="32" required />
          </label>
          <label>
            NID number
            <input name="nidNumber" value={form.nidNumber} onChange={onFieldChange} minLength="3" maxLength="64" required />
          </label>
          <label className="wide-field">
            Driving licence number
            <input name="drivingLicenceNumber" value={form.drivingLicenceNumber} onChange={onFieldChange} minLength="3" maxLength="64" required />
          </label>
          <label className="wide-field">
            Permanent address
            <textarea name="permanentAddress" value={form.permanentAddress} onChange={onFieldChange} minLength="3" maxLength="500" rows="2" required />
          </label>
          <label className="wide-field">
            Present address
            <textarea name="presentAddress" value={form.presentAddress} onChange={onFieldChange} minLength="3" maxLength="500" rows="2" required />
          </label>
          <PhotoField label="NID photo" file={nidPhoto} onChange={onNidPhoto} />
          <PhotoField label="Driving licence photo" file={licencePhoto} onChange={onLicencePhoto} />
        </div>
        <p className="document-hint">Upload clear JPG, PNG, or WebP images up to 5 MB each.</p>
        <button className="primary-button" disabled={busy}>
          {busy ? "Submitting profile…" : "Submit for approval"}
        </button>
      </form>
    </section>
  );
}

function PhotoField({ label, file, onChange }) {
  return (
    <label className="photo-field">
      {label}
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={onChange}
        required
      />
      <small>{file ? file.name : "Select a photo (required)"}</small>
    </label>
  );
}

function ProfileSummary({ profile }) {
  return (
    <dl className="detail-grid ambulance-profile-summary">
      <div><dt>Driver</dt><dd>{profile.driverName}</dd></div>
      <div><dt>Vehicle</dt><dd>{profile.vehicleNumber}</dd></div>
      <div><dt>Phone</dt><dd>{profile.phone}</dd></div>
      <div><dt>NID</dt><dd>{profile.hasNidPhoto ? "Photo submitted" : "Not submitted"}</dd></div>
      <div><dt>Driving licence</dt><dd>{profile.hasLicencePhoto ? "Photo submitted" : "Not submitted"}</dd></div>
    </dl>
  );
}

function ActiveTrip({ trip, busy, onAdvance }) {
  const nextStep = {
    accepted: { label: "Patient picked up", button: "Mark patient picked up" },
    picked_up: { label: "Arrived at hospital", button: "Mark arrived at hospital" },
    at_hospital: { label: "Trip completed", button: "Complete trip" },
  }[trip.status];

  return (
    <section className="ambulance-panel active-ambulance-trip">
      <div className="patient-panel-heading">
        <div>
          <p className="eyebrow">Dispatcher assignment</p>
          <h2>Trip #{trip.id}</h2>
        </div>
        <span className={`status-pill ${trip.status}`}>
          {trip.status === "accepted" ? "Assigned by dispatcher" : trip.status.replaceAll("_", " ")}
        </span>
      </div>
      <dl className="detail-grid">
        <div><dt>Patient</dt><dd>{trip.patientName}</dd></div>
        <div><dt>Patient phone</dt><dd><a href={`tel:${trip.patientPhone}`}>{trip.patientPhone}</a></dd></div>
        <div><dt>Pickup</dt><dd>{trip.currentLocation}</dd></div>
        <div><dt>Destination</dt><dd>{trip.destination}</dd></div>
        <div><dt>Symptoms</dt><dd>{trip.symptoms}</dd></div>
        {trip.fareAmount !== null && trip.fareAmount !== undefined && (
          <>
            <div><dt>Cash fare</dt><dd>৳{Number(trip.fareAmount).toFixed(0)}</dd></div>
            <div><dt>Route Estimate</dt><dd>{Number(trip.estimatedDistanceKm).toFixed(2)} km</dd></div>
          </>
        )}
      </dl>
      {(trip.fareAmount === null || trip.fareAmount === undefined) && (
        <p className="phase-notice">
          No route-based fare was estimated. Agree on the cash amount with the patient before travel.
        </p>
      )}
      <p className="phase-notice">
        {trip.status === "accepted"
          ? "Heading to the patient. Keep location sharing enabled during the trip."
          : trip.status === "picked_up"
            ? "Patient picked up. Continue to the hospital and keep sharing your location."
            : "Patient arrived at the hospital. Complete the trip when handoff is done."}
      </p>
      {nextStep && (
        <button className="primary-button compact-button" disabled={busy} onClick={onAdvance}>
          {busy ? "Updating trip…" : nextStep.button}
        </button>
      )}
    </section>
  );
}
