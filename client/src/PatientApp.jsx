import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl } from "./api.js";
import { getCurrentLocation } from "./geolocation.js";
import useTripSocket from "./useTripSocket.js";
import readApiResponse from "./readApiResponse.js";
import NotificationCenter from "./NotificationCenter.jsx";
import AccountSettings from "./AccountSettings.jsx";
import WorkspaceNavigation from "./WorkspaceNavigation.jsx";
import LocationName from "./LocationName.jsx";
import lookupLocationName from "./locationName.js";

const requestStatuses = {
  searching: "Finding an available ambulance",
  requested_to_ambulance: "Waiting for ambulance response",
  accepted: "Ambulance is on the way",
  picked_up: "Patient picked up",
  at_hospital: "Arrived at hospital",
  completed: "Trip completed",
  cancelled: "Request cancelled",
};
const terminalStatuses = ["completed", "cancelled"];

async function patientRequest(path, options = {}) {
  const token = localStorage.getItem("emergencycare-token");
  const response = await fetch(apiUrl(`/api/patient${path}`), {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  return readApiResponse(response, "The request could not be completed.");
}

function dateLabel(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

export default function PatientApp({ user, onLogout }) {
  const [tab, setTab] = useState("home");
  const [profile, setProfile] = useState({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
  });
  const [requests, setRequests] = useState([]);
  const [selectedRequestId, setSelectedRequestId] = useState(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({ name: user.name, phone: user.phone });
  const [requestForm, setRequestForm] = useState({
    symptoms: "",
    currentLocation: "",
    currentLatitude: "",
    currentLongitude: "",
    destination: "",
    destinationLatitude: "",
    destinationLongitude: "",
    ambulanceType: "basic",
  });
  const [locationMessage, setLocationMessage] = useState("");
  const [fareQuote, setFareQuote] = useState(null);
  const [fareQuoteBusy, setFareQuoteBusy] = useState(false);
  const [fareError, setFareError] = useState("");
  const [allowNoFareEstimate, setAllowNoFareEstimate] = useState(false);
  const fareQuoteRequestId = useRef(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestLoadError, setRequestLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);

  const handleError = useCallback((requestError) => {
    if (requestError.status === 401 || requestError.status === 403) {
      onLogout();
      return;
    }
    setError(requestError.message);
  }, [onLogout]);

  const loadPatientData = useCallback(async () => {
    try {
      const [profileOutcome, requestsOutcome] = await Promise.allSettled([
        patientRequest("/profile"),
        patientRequest("/requests"),
      ]);
      if (profileOutcome.status === "rejected") throw profileOutcome.reason;
      if (requestsOutcome.status === "rejected") throw requestsOutcome.reason;
      const profileResult = profileOutcome.value;
      const requestsResult = requestsOutcome.value;
      setProfile(profileResult.profile);
      setProfileForm({
        name: profileResult.profile.name,
        phone: profileResult.profile.phone,
      });
      setRequests(requestsResult.requests);
      setRequestLoadError("");
      setError("");
      return true;
    } catch (requestError) {
      handleError(requestError);
      setRequestLoadError(requestError.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [handleError]);

  useEffect(() => {
    loadPatientData();
  }, [loadPatientData, reload]);

  const activeRequest = requests.find((request) => !terminalStatuses.includes(request.status));
  const applyTripUpdate = useCallback((update) => {
    setRequests((current) => current.map((request) =>
      request.id === update.requestId ? { ...request, ...update } : request,
    ));
  }, []);
  const liveUpdatesConnected = useTripSocket(
    activeRequest ? [activeRequest.id] : [],
    applyTripUpdate,
  );

  useEffect(() => {
    if (!activeRequest) return undefined;
    const timer = window.setInterval(() => {
      loadPatientData();
    }, 10000);
    return () => window.clearInterval(timer);
  }, [activeRequest?.id, loadPatientData]);

  function updateRequestForm(event) {
    fareQuoteRequestId.current += 1;
    setRequestForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
    setError("");
    setNotice("");
    setFareQuote(null);
    setFareQuoteBusy(false);
    setFareError("");
    setAllowNoFareEstimate(false);
  }

  function useCurrentLocation() {
    fareQuoteRequestId.current += 1;
    setFareQuote(null);
    setFareQuoteBusy(false);
    setFareError("");
    setAllowNoFareEstimate(false);
    setLocationMessage("Getting your location…");
    getCurrentLocation({ enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }).then(
      async ({ latitude: currentLatitude, longitude: currentLongitude }) => {
        const latitude = currentLatitude.toFixed(6);
        const longitude = currentLongitude.toFixed(6);
        const coordinateLabel = `Current location (${latitude}, ${longitude})`;
        setRequestForm((current) => ({
          ...current,
          currentLatitude: latitude,
          currentLongitude: longitude,
          currentLocation: current.currentLocation.trim() &&
            !current.currentLocation.startsWith("Current location (")
            ? current.currentLocation
            : coordinateLabel,
        }));
        setFareQuote(null);
        setFareQuoteBusy(false);
        await lookupPickupLocation(latitude, longitude);
      },
    ).catch(() => {
      setLocationMessage("Could not get your location. Allow location access or enter coordinates manually.");
    });
  }

  async function lookupPickupLocation(latitudeValue = requestForm.currentLatitude, longitudeValue = requestForm.currentLongitude) {
    if (!String(latitudeValue).trim() || !String(longitudeValue).trim()) {
      setLocationMessage("Enter valid latitude and longitude before looking up a place name.");
      return;
    }
    const latitude = Number(latitudeValue);
    const longitude = Number(longitudeValue);
    if (
      !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    ) {
      setLocationMessage("Enter valid latitude and longitude before looking up a place name.");
      return;
    }

    setLocationMessage("Looking up the place name…");
    try {
      const result = await lookupLocationName(latitude, longitude);
      if (!result.placeName) {
        setLocationMessage("No place name was found. Coordinates are saved; enter the pickup address manually.");
        return;
      }
      setRequestForm((current) => ({
        ...current,
        currentLocation: current.currentLocation.trim() &&
          !current.currentLocation.startsWith("Current location (")
          ? current.currentLocation
          : result.placeName,
      }));
      setLocationMessage(`Place name found: ${result.placeName}. You can edit the address before sending.`);
    } catch (requestError) {
      setLocationMessage(`${requestError.message} Coordinates are still available; enter the pickup address manually.`);
    }
  }

  const estimateFare = useCallback(async ({
    currentLatitude,
    currentLongitude,
    destination,
    ambulanceType,
  }) => {
    const requestId = ++fareQuoteRequestId.current;
    setFareQuote(null);
    setFareError("");
    setAllowNoFareEstimate(false);
    if (
      !String(currentLatitude).trim() ||
      !String(currentLongitude).trim() ||
      !destination.trim()
    ) {
      return;
    }
    setFareQuoteBusy(true);
    try {
      const quote = await patientRequest("/fare-estimate", {
        method: "POST",
        body: JSON.stringify({
          currentLatitude: Number(currentLatitude),
          currentLongitude: Number(currentLongitude),
          destination,
          ambulanceType,
        }),
      });
      if (requestId !== fareQuoteRequestId.current) return;
      setFareQuote(quote);
      setRequestForm((current) => ({
        ...current,
        destinationLatitude: String(quote.destinationLatitude),
        destinationLongitude: String(quote.destinationLongitude),
      }));
    } catch (requestError) {
      if (requestId !== fareQuoteRequestId.current) return;
      if (requestError.status === 401 || requestError.status === 403) {
        handleError(requestError);
      } else {
        setFareError(requestError.message);
      }
    } finally {
      if (requestId === fareQuoteRequestId.current) setFareQuoteBusy(false);
    }
  }, [handleError]);

  useEffect(() => {
    if (
      !String(requestForm.currentLatitude).trim() ||
      !String(requestForm.currentLongitude).trim() ||
      requestForm.destination.trim().length < 3
    ) {
      return undefined;
    }

    const destinationSnapshot = {
      currentLatitude: requestForm.currentLatitude,
      currentLongitude: requestForm.currentLongitude,
      destination: requestForm.destination,
      ambulanceType: requestForm.ambulanceType,
    };
    const timer = window.setTimeout(() => {
      estimateFare(destinationSnapshot);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [
    estimateFare,
    requestForm.ambulanceType,
    requestForm.currentLatitude,
    requestForm.currentLongitude,
    requestForm.destination,
  ]);

  async function submitRequest(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    const latitude = Number(requestForm.currentLatitude);
    const longitude = Number(requestForm.currentLongitude);
    if (!fareQuote?.quoteToken) {
      if (!allowNoFareEstimate) {
        setBusy(false);
        setError("Estimate the fare or confirm that you want to continue without an estimate.");
        return;
      }
    }
    if (!requestForm.currentLatitude || !requestForm.currentLongitude) {
      setBusy(false);
      setError("Capture your current location or enter its latitude and longitude.");
      return;
    }

    try {
      const result = await patientRequest("/requests", {
        method: "POST",
        body: JSON.stringify({
          symptoms: requestForm.symptoms,
          currentLocation: requestForm.currentLocation,
          currentLatitude: latitude,
          currentLongitude: longitude,
          destination: requestForm.destination,
          ambulanceType: requestForm.ambulanceType,
          ...(fareQuote ? {
            destinationLatitude: Number(requestForm.destinationLatitude),
            destinationLongitude: Number(requestForm.destinationLongitude),
            fareQuoteToken: fareQuote.quoteToken,
          } : {}),
        }),
      });
      setNotice(result.message);
      setSelectedRequestId(result.requestId);
      setRequestForm((current) => ({
        ...current,
        symptoms: "",
        destination: "",
        destinationLatitude: "",
        destinationLongitude: "",
      }));
      setFareQuote(null);
      setFareError("");
      setAllowNoFareEstimate(false);
      setReload((value) => value + 1);
    } catch (requestError) {
      handleError(requestError);
      if (
        requestError.status === 409 &&
        requestError.message.toLowerCase().includes("fare estimate")
      ) {
        setFareQuote(null);
        setFareError(requestError.message);
        setAllowNoFareEstimate(false);
      }
      if (requestError.status === 409) {
        const refreshed = await loadPatientData();
        if (refreshed) {
          setError("");
          setNotice("An active ambulance request already exists. Its current status is shown below.");
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const result = await patientRequest("/profile", {
        method: "PATCH",
        body: JSON.stringify(profileForm),
      });
      setProfile(result.profile);
      setProfileForm({ name: result.profile.name, phone: result.profile.phone });
      setEditingProfile(false);
      setNotice(result.message);
    } catch (requestError) {
      handleError(requestError);
    } finally {
      setBusy(false);
    }
  }

  async function cancelRequest(request) {
    if (!window.confirm("Cancel this ambulance request?")) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const result = await patientRequest(`/requests/${request.id}/cancel`, {
        method: "PATCH",
        body: JSON.stringify({}),
      });
      setNotice(result.message);
      setReload((value) => value + 1);
    } catch (requestError) {
      handleError(requestError);
    } finally {
      setBusy(false);
    }
  }

  function openRequest(request) {
    setSelectedRequestId(request.id);
    setError("");
    setNotice("");
  }

  return (
    <main className="patient-shell">
      <header className="patient-header">
        <a className="brand-link" href="/">
          <span className="brand-mark" aria-hidden="true">+</span>
          <span>EmergencyCare</span>
        </a>
        <div className="patient-header-actions">
          <NotificationCenter user={user} />
          <button className="text-button" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <section className="patient-content">
        <div className="patient-title">
          <p className="eyebrow">{tab === "home" ? "Patient care" : tab}</p>
          <h1>{tab === "home" ? "How can we help?" : tab === "activity" ? "Your activity" : "Your profile"}</h1>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="notice" role="status">{notice}</p>}
        {loading ? (
          <section className="patient-panel loading-panel" role="status">Loading your account…</section>
        ) : (
          <>
            {tab === "home" && (
              requestLoadError ? (
                <section className="patient-panel" role="alert">
                  <h2>Could not load your requests</h2>
                  <p>{requestLoadError}</p>
                  <p>
                    An active request may already exist, so the app is pausing new requests
                    until it can check your trip history.
                  </p>
                  <button
                    className="secondary-button compact-button"
                    onClick={() => loadPatientData()}
                  >
                    Reload requests
                  </button>
                </section>
              ) : activeRequest ? (
                <RequestStatus
                  request={activeRequest}
                  onCancel={cancelRequest}
                  liveUpdatesConnected={liveUpdatesConnected}
                  busy={busy}
                />
              ) : (
                <RequestForm
                  profile={profile}
                  form={requestForm}
                  busy={busy}
                  locationMessage={locationMessage}
                  fareQuote={fareQuote}
                  fareQuoteBusy={fareQuoteBusy}
                  fareError={fareError}
                  allowNoFareEstimate={allowNoFareEstimate}
                  onChange={updateRequestForm}
                  onLocate={useCurrentLocation}
                  onLookupLocation={lookupPickupLocation}
                  onEstimateFare={() => estimateFare(requestForm)}
                  onAllowNoFareEstimateChange={(event) =>
                    setAllowNoFareEstimate(event.target.checked)
                  }
                  onSubmit={submitRequest}
                />
              )
            )}
            {tab === "activity" && (
              <section className="patient-panel">
                <div className="patient-panel-heading">
                  <div>
                    <p className="eyebrow">History</p>
                    <h2>Past and current requests</h2>
                  </div>
                  <button className="secondary-button compact-button" onClick={() => setReload((value) => value + 1)}>
                    Refresh
                  </button>
                </div>
                {requestLoadError ? (
                  <div role="alert">
                    <p>{requestLoadError}</p>
                    <button
                      className="secondary-button compact-button"
                      onClick={() => loadPatientData()}
                    >
                      Reload requests
                    </button>
                  </div>
                ) : requests.length === 0 ? (
                  <p className="empty-state">Your ambulance requests will appear here.</p>
                ) : (
                  <div className="patient-request-list">
                    {requests.map((request) => (
                      <div className="patient-request-item" key={request.id}>
                        <button
                          className="patient-request-row"
                          aria-expanded={selectedRequestId === request.id}
                          onClick={() => openRequest(request)}
                        >
                          <span>
                            <strong>{request.destination}</strong>
                            <small>{dateLabel(request.createdAt)} · {request.ambulanceType}</small>
                          </span>
                          <span className={`status-pill ${request.status}`}>
                            {requestStatuses[request.status] || request.status}
                          </span>
                        </button>
                        {selectedRequestId === request.id && (
                          <RequestStatus
                            request={request}
                            onCancel={cancelRequest}
                            liveUpdatesConnected={liveUpdatesConnected}
                            busy={busy}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
            {tab === "profile" && (
              <section className="patient-panel profile-panel">
                <div className="patient-panel-heading">
                  <div>
                    <p className="eyebrow">Account details</p>
                    <h2>Profile</h2>
                  </div>
                  {!editingProfile && (
                    <button className="secondary-button compact-button" onClick={() => setEditingProfile(true)}>
                      Edit profile
                    </button>
                  )}
                </div>
                {editingProfile ? (
                  <form className="patient-form profile-form" onSubmit={saveProfile}>
                    <label>
                      Full name
                      <input
                        value={profileForm.name}
                        onChange={(event) => setProfileForm({ ...profileForm, name: event.target.value })}
                        minLength={2}
                        maxLength={120}
                        required
                      />
                    </label>
                    <label>
                      Phone number
                      <input
                        type="tel"
                        value={profileForm.phone}
                        onChange={(event) => setProfileForm({ ...profileForm, phone: event.target.value })}
                        required
                      />
                    </label>
                    <label>
                      Email
                      <input value={profile.email} readOnly />
                      <small>Email editing is not available in this phase.</small>
                    </label>
                    <div className="record-actions">
                      <button className="primary-button compact-button" disabled={busy}>
                        {busy ? "Saving…" : "Save changes"}
                      </button>
                      <button
                        className="secondary-button compact-button"
                        type="button"
                        onClick={() => {
                          setProfileForm({ name: profile.name, phone: profile.phone });
                          setEditingProfile(false);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <dl className="detail-grid profile-details">
                    <div><dt>Full name</dt><dd>{profile.name}</dd></div>
                    <div><dt>Email</dt><dd>{profile.email}</dd></div>
                    <div><dt>Phone</dt><dd>{profile.phone}</dd></div>
                    <div><dt>Member since</dt><dd>{dateLabel(profile.createdAt)}</dd></div>
                  </dl>
                )}
                <AccountSettings user={user} onLogout={onLogout} />
                <button className="patient-logout" onClick={onLogout}>Log out of EmergencyCare</button>
              </section>
            )}
          </>
        )}
      </section>

      <WorkspaceNavigation
        activeTab={tab}
        label="Patient navigation"
        onSelect={(value) => {
          setTab(value);
          setError("");
          setNotice("");
        }}
      />
    </main>
  );
}

function RequestForm({
  profile,
  form,
  busy,
  locationMessage,
  fareQuote,
  fareQuoteBusy,
  fareError,
  allowNoFareEstimate,
  onChange,
  onLocate,
  onLookupLocation,
  onEstimateFare,
  onAllowNoFareEstimateChange,
  onSubmit,
}) {
  const [editingCoordinates, setEditingCoordinates] = useState(false);
  const hasPickupCoordinates = Boolean(form.currentLatitude && form.currentLongitude);

  return (
    <section className="patient-panel request-panel">
      <div className="patient-panel-heading">
        <div>
          <p className="eyebrow">New emergency request</p>
          <h2>Request an ambulance</h2>
        </div>
        <span className="secure-tag">Patient verified</span>
      </div>
      <div className="patient-contact-summary">
        <span><small>Patient</small><strong>{profile.name}</strong></span>
        <span><small>Contact</small><strong>{profile.phone}</strong></span>
      </div>
      <form className="patient-form" onSubmit={onSubmit}>
        <label>
          Symptoms and medical needs
          <textarea
            name="symptoms"
            rows="3"
            minLength={3}
            maxLength={2000}
            value={form.symptoms}
            onChange={onChange}
            placeholder="Briefly describe what is happening"
            required
          />
        </label>
        <label>
          Current pickup location
          <input
            name="currentLocation"
            value={form.currentLocation}
            onChange={onChange}
            minLength={3}
            maxLength={500}
            placeholder="Street, area, or nearby landmark"
            required
          />
        </label>
        <div className="location-controls">
          <button className="secondary-button compact-button" type="button" onClick={onLocate}>
            Use my current location
          </button>
          {locationMessage && <span role="status">{locationMessage}</span>}
        </div>
        {hasPickupCoordinates && !editingCoordinates ? (
          <div className="coordinate-summary">
            <small>Pickup coordinates: {form.currentLatitude}, {form.currentLongitude}</small>
            <button
              className="text-button"
              type="button"
              onClick={() => setEditingCoordinates(true)}
            >
              Edit coordinates
            </button>
          </div>
        ) : (
          <>
            <div className="coordinate-fields">
              <label>
                Latitude
                <input
                  name="currentLatitude"
                  type="number"
                  min="-90"
                  max="90"
                  step="any"
                  value={form.currentLatitude}
                  onChange={onChange}
                  placeholder="e.g. 23.8103"
                  required
                />
              </label>
              <label>
                Longitude
                <input
                  name="currentLongitude"
                  type="number"
                  min="-180"
                  max="180"
                  step="any"
                  value={form.currentLongitude}
                  onChange={onChange}
                  placeholder="e.g. 90.4125"
                  required
                />
              </label>
            </div>
            {hasPickupCoordinates && (
              <button
                className="text-button"
                type="button"
                onClick={() => setEditingCoordinates(false)}
              >
                Done editing coordinates
              </button>
            )}
          </>
        )}
        <button
          className="secondary-button compact-button"
          type="button"
          onClick={() => onLookupLocation(form.currentLatitude, form.currentLongitude)}
        >
          Find place name from coordinates
        </button>
        <label>
          Hospital or destination
          <input
            name="destination"
            value={form.destination}
            onChange={onChange}
            minLength={3}
            maxLength={500}
            placeholder="Enter a destination"
            required
          />
        </label>
        <label>
          Ambulance type
          <select name="ambulanceType" value={form.ambulanceType} onChange={onChange}>
            <option value="basic">Basic ambulance</option>
            <option value="icu">ICU ambulance</option>
            <option value="freezer">Freezer ambulance</option>
          </select>
        </label>
        <div className="fare-estimate-panel">
          <button
            className="secondary-button compact-button"
            type="button"
            disabled={fareQuoteBusy}
            onClick={onEstimateFare}
          >
            {fareQuoteBusy ? "Finding destination and calculating fare…" : "Recalculate fare"}
          </button>
          {fareError && <p className="form-error" role="alert">{fareError}</p>}
          {!fareQuote && !fareQuoteBusy && !fareError && (
            <small>Enter a destination and pause; its coordinates and fare will be calculated automatically.</small>
          )}
          {!fareQuote && (
            <label className="fare-fallback-choice">
              <input
                type="checkbox"
                checked={allowNoFareEstimate}
                onChange={onAllowNoFareEstimateChange}
              />
              If fare routing is unavailable, continue without an in-app fare quote
              and agree on cash directly with the assigned driver.
            </label>
          )}
          {fareQuote && (
            <>
              <p className="fare-quote" role="status">
                Estimated cash fare: <strong>৳{Number(fareQuote.fareAmount).toFixed(0)}</strong>
                {" "}· Estimated distance: {Number(fareQuote.distanceKm).toFixed(2)} Km
              </p>
              <small>Route destination: {fareQuote.destinationDisplayName}</small>
              <small>
                Destination coordinates: {Number(fareQuote.destinationLatitude).toFixed(6)},
                {" "}{Number(fareQuote.destinationLongitude).toFixed(6)}
              </small>
            </>
          )}
        </div>
        <button
          className="primary-button patient-submit"
          disabled={busy || (!fareQuote && !allowNoFareEstimate)}
        >
          {busy ? "Sending request…" : "Request ambulance"}
        </button>
      </form>
    </section>
  );
}

function RequestStatus({ request, onCancel, liveUpdatesConnected, busy }) {
  const hasAmbulance = Boolean(request.driverName || request.vehicleNumber);
  const hasLocation = request.ambulanceLatitude !== null &&
    request.ambulanceLatitude !== undefined &&
    request.ambulanceLongitude !== null &&
    request.ambulanceLongitude !== undefined;
  const canCancel = ["searching", "requested_to_ambulance"].includes(request.status);
  const statusSteps = [
    ["searching", "Finding ambulance"],
    ["accepted", "Heading to you"],
    ["picked_up", "Patient picked up"],
    ["at_hospital", "At hospital"],
    ["completed", "Completed"],
  ];
  const currentStep = request.status === "requested_to_ambulance"
    ? 0
    : statusSteps.findIndex(([status]) => status === request.status);

  return (
    <section className="patient-panel request-status-panel">
      <div className="patient-panel-heading">
        <div>
          <p className="eyebrow">Request #{request.id}</p>
          <h2>{requestStatuses[request.status] || request.status}</h2>
        </div>
        <span className={`status-pill ${request.status}`}>{request.status.replaceAll("_", " ")}</span>
      </div>
      {!terminalStatuses.includes(request.status) && (
        <div className="trip-progress">
          {statusSteps.map(([status, label], index) => (
            <div className={`trip-step ${index <= currentStep ? "reached" : ""}`} key={status}>
              <span>{index + 1}</span>
              <small>{label}</small>
            </div>
          ))}
        </div>
      )}
      <dl className="detail-grid status-details">
        <div><dt>Pickup</dt><dd>{request.currentLocation}</dd></div>
        <div><dt>Destination</dt><dd>{request.destination}</dd></div>
        <div><dt>Ambulance type</dt><dd>{request.ambulanceType}</dd></div>
        <div><dt>Symptoms</dt><dd>{request.symptoms}</dd></div>
        <div><dt>Requested</dt><dd>{dateLabel(request.createdAt)}</dd></div>
        {request.fareAmount !== null && request.fareAmount !== undefined && (
          <>
            <div><dt>Cash fare</dt><dd>৳{Number(request.fareAmount).toFixed(0)}</dd></div>
            <div><dt>Estimated distance</dt><dd>{Number(request.estimatedDistanceKm).toFixed(2)} Km</dd></div>
            <div className="wide-detail">
              <dt>Payment</dt>
              <dd>
                {request.status === "cancelled"
                  ? "No fare is due for a cancelled request."
                  : request.paymentStatus === "paid"
                    ? `Cash recorded as collected ${request.cashCollectedAt ? `on ${dateLabel(request.cashCollectedAt)}` : ""}.`
                    : request.status === "completed"
                      ? "Cash collection is still pending. Pay the driver directly."
                      : "Cash is due to the ambulance after the trip."}
              </dd>
            </div>
          </>
        )}
        {request.fareAmount === null && request.status !== "cancelled" && (
          <div className="wide-detail">
            <dt>Cash fare</dt>
            <dd>No route-based fare was estimated. Agree on the cash amount with the driver before travel.</dd>
          </div>
        )}
      </dl>
      {hasAmbulance ? (
        <section className="driver-card">
          <p className="eyebrow">Assigned ambulance</p>
          <h3>{request.driverName || "Driver"}</h3>
          <p>{request.vehicleNumber || "Vehicle details pending"}</p>
          {request.driverPhone && (
            <a className="driver-call" href={`tel:${request.driverPhone}`}>
              Call driver · {request.driverPhone}
            </a>
          )}
          {hasLocation ? (
            <>
              <a
                className="location-link"
                href={`https://www.google.com/maps?q=${request.ambulanceLatitude},${request.ambulanceLongitude}`}
                target="_blank"
                rel="noreferrer"
              >
                Latest ambulance coordinates · {request.ambulanceLatitude}, {request.ambulanceLongitude}
              </a>
              <LocationName
                latitude={request.ambulanceLatitude}
                longitude={request.ambulanceLongitude}
              />
            </>
          ) : (
            <p className="location-waiting">Waiting for the ambulance's first location update.</p>
          )}
          {request.ambulanceLocationUpdatedAt && (
            <small className="location-timestamp">
              Location updated {dateLabel(request.ambulanceLocationUpdatedAt)}.
            </small>
          )}
          {!terminalStatuses.includes(request.status) && (
            <small className="location-timestamp" role="status">
              {liveUpdatesConnected
                ? "Live trip updates connected."
                : "Reconnecting to live updates. Periodic refresh remains active."}
            </small>
          )}
        </section>
      ) : (
        <p className="phase-notice">
          {request.status === "cancelled"
            ? "This request has been cancelled."
            : request.status === "completed"
              ? "This trip is complete."
              : `We are finding an ambulance. ${liveUpdatesConnected ? "Live updates are connected." : "Periodic refresh remains active."}`}
        </p>
      )}
      {canCancel && (
        <button
          className="danger-button compact-button cancel-request"
          disabled={busy}
          onClick={() => onCancel(request)}
        >
          {busy ? "Cancelling…" : "Cancel request"}
        </button>
      )}
    </section>
  );
}
