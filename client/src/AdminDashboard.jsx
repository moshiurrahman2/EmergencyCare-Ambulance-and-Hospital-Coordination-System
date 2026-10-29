import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "./api.js";
import readApiResponse from "./readApiResponse.js";
import NotificationCenter from "./NotificationCenter.jsx";
import AccountSettings from "./AccountSettings.jsx";
import WorkspaceNavigation from "./WorkspaceNavigation.jsx";

const initialCounts = {
  patients: 0,
  dispatchers: 0,
  ambulances: 0,
  activeTrips: 0,
  pendingDispatchers: 0,
  pendingAmbulances: 0,
};
const defaultFareRates = {
  basicPerKm: "60",
  icuPerKm: "80",
  freezerPerKm: "100",
};

const approvalFields = {
  dispatcher: [
    ["age", "Age"],
    ["permanentAddress", "Permanent address"],
    ["presentAddress", "Present address"],
    ["profilePhone", "Profile phone"],
    ["nidNumber", "NID number"],
  ],
  ambulance: [
    ["driverName", "Driver name"],
    ["vehicleNumber", "Vehicle number"],
    ["permanentAddress", "Permanent address"],
    ["presentAddress", "Present address"],
    ["profilePhone", "Profile phone"],
    ["nidNumber", "NID number"],
    ["drivingLicenceNumber", "Driving licence number"],
  ],
};

async function adminRequest(path, options = {}) {
  const token = localStorage.getItem("emergencycare-token");
  const response = await fetch(apiUrl(`/api/admin${path}`), {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  return readApiResponse(response, "The admin request failed.");
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function labelForStatus(status) {
  return status.replaceAll("_", " ");
}

export default function AdminDashboard({ user, onLogout }) {
  const [tab, setTab] = useState("overview");
  const [counts, setCounts] = useState(initialCounts);
  const [approvalRole, setApprovalRole] = useState("ambulance");
  const [approvals, setApprovals] = useState([]);
  const [rejectionReasons, setRejectionReasons] = useState({});
  const [users, setUsers] = useState([]);
  const [userSearch, setUserSearch] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [userRole, setUserRole] = useState("");
  const [userStatus, setUserStatus] = useState("");
  const [userPage, setUserPage] = useState(1);
  const [userPagination, setUserPagination] = useState({ pages: 1, total: 0 });
  const [selectedUser, setSelectedUser] = useState(null);
  const [trips, setTrips] = useState([]);
  const [tripStatus, setTripStatus] = useState("");
  const [tripPage, setTripPage] = useState(1);
  const [tripPagination, setTripPagination] = useState({ pages: 1, total: 0 });
  const [fareRates, setFareRates] = useState(defaultFareRates);
  const [hospitals, setHospitals] = useState([]);
  const [hospitalForm, setHospitalForm] = useState({
    name: "",
    address: "",
    latitude: "",
    longitude: "",
  });
  const [createdHospitalKey, setCreatedHospitalKey] = useState("");
  const [copiedHospitalKey, setCopiedHospitalKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [documentPreview, setDocumentPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState("");
  const [actionBusy, setActionBusy] = useState("");

  const showError = useCallback((requestError) => {
    if (requestError.status === 401 || requestError.status === 403) {
      onLogout();
      return;
    }
    setError(requestError.message);
  }, [onLogout]);

  useEffect(() => {
    return () => {
      if (documentPreview?.url) URL.revokeObjectURL(documentPreview.url);
    };
  }, [documentPreview]);

  const loadDashboard = useCallback(async () => {
    try {
      const result = await adminRequest("/dashboard");
      setCounts(result.counts);
    } catch (requestError) {
      showError(requestError);
    }
  }, [showError]);

  const loadApprovals = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await adminRequest(`/approvals?role=${approvalRole}`);
      setApprovals(result.approvals);
    } catch (requestError) {
      showError(requestError);
    } finally {
      setLoading(false);
    }
  }, [approvalRole, showError]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      page: String(userPage),
      limit: "20",
    });
    if (userQuery) params.set("search", userQuery);
    if (userRole) params.set("role", userRole);
    if (userStatus) params.set("status", userStatus);
    try {
      const result = await adminRequest(`/users?${params}`);
      setUsers(result.users);
      setUserPagination(result.pagination);
      if (selectedUser && !result.users.some((item) => item.id === selectedUser.user.id)) {
        setSelectedUser(null);
      }
    } catch (requestError) {
      showError(requestError);
    } finally {
      setLoading(false);
    }
  }, [selectedUser, showError, userPage, userQuery, userRole, userStatus]);

  const loadTrips = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      page: String(tripPage),
      limit: "20",
    });
    if (tripStatus) params.set("status", tripStatus);
    try {
      const result = await adminRequest(`/trips?${params}`);
      setTrips(result.trips);
      setTripPagination(result.pagination);
    } catch (requestError) {
      showError(requestError);
    } finally {
      setLoading(false);
    }
  }, [showError, tripPage, tripStatus]);

  const loadFareRates = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await adminRequest("/fare-rates");
      setFareRates({
        basicPerKm: String(result.fareRates.basicPerKm),
        icuPerKm: String(result.fareRates.icuPerKm),
        freezerPerKm: String(result.fareRates.freezerPerKm),
      });
    } catch (requestError) {
      showError(requestError);
    } finally {
      setLoading(false);
    }
  }, [showError]);

  const loadHospitals = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await adminRequest("/hospitals");
      setHospitals(result.hospitals);
    } catch (requestError) {
      showError(requestError);
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (tab === "approvals") loadApprovals();
    if (tab === "users") loadUsers();
    if (tab === "trips") loadTrips();
    if (tab === "pricing") loadFareRates();
    if (tab === "hospitals") loadHospitals();
  }, [tab, loadApprovals, loadUsers, loadTrips, loadFareRates, loadHospitals]);

  async function reviewApplication(item, decision) {
    const reason = rejectionReasons[item.id] || "";
    if (decision === "rejected" && !reason.trim()) {
      setError("Enter a reason before rejecting this application.");
      return;
    }
    setError("");
    setNotice("");
    const actionId = `${item.id}-${decision}`;
    setActionBusy(actionId);
    try {
      const result = await adminRequest(`/approvals/${approvalRole}/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ decision, reason }),
      });
      setNotice(result.message);
      setRejectionReasons((current) => ({ ...current, [item.id]: "" }));
      await Promise.all([loadApprovals(), loadDashboard()]);
    } catch (requestError) {
      showError(requestError);
    } finally {
      setActionBusy("");
    }
  }

  async function saveFareRates(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setActionBusy("fare-rates");
    try {
      const result = await adminRequest("/fare-rates", {
        method: "PUT",
        body: JSON.stringify({
          basicPerKm: Number(fareRates.basicPerKm),
          icuPerKm: Number(fareRates.icuPerKm),
          freezerPerKm: Number(fareRates.freezerPerKm),
        }),
      });
      setNotice(result.message);
      await loadFareRates();
    } catch (requestError) {
      showError(requestError);
    } finally {
      setActionBusy("");
    }
  }

  async function copyHospitalKey() {
    if (!createdHospitalKey) return;
    setError("");
    try {
      await navigator.clipboard.writeText(createdHospitalKey);
      setCopiedHospitalKey(true);
      setNotice("Hospital API key copied to the clipboard.");
    } catch {
      setError("The API key could not be copied. Please select and copy it manually.");
    }
  }

  async function createHospital(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setCreatedHospitalKey("");
    setCopiedHospitalKey(false);
    setActionBusy("hospital-create");
    try {
      const result = await adminRequest("/hospitals", {
        method: "POST",
        body: JSON.stringify({
          ...hospitalForm,
          latitude: Number(hospitalForm.latitude),
          longitude: Number(hospitalForm.longitude),
        }),
      });
      setNotice(result.message);
      setCreatedHospitalKey(result.apiKey);
      setCopiedHospitalKey(false);
      setHospitalForm({ name: "", address: "", latitude: "", longitude: "" });
      await loadHospitals();
    } catch (requestError) {
      showError(requestError);
    } finally {
      setActionBusy("");
    }
  }

  async function rotateHospitalKey(hospital) {
    if (!window.confirm(`Rotate the API key for ${hospital.name}? Its current key will stop working immediately.`)) {
      return;
    }
    setError("");
    setNotice("");
    setCreatedHospitalKey("");
    setCopiedHospitalKey(false);
    setActionBusy(`hospital-${hospital.id}`);
    try {
      const result = await adminRequest(`/hospitals/${hospital.id}/rotate-key`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setNotice(result.message);
      setCreatedHospitalKey(result.apiKey);
      setCopiedHospitalKey(false);
    } catch (requestError) {
      showError(requestError);
    } finally {
      setActionBusy("");
    }
  }

  async function setHospitalActive(hospital) {
    const isActive = !hospital.isActive;
    if (!isActive && !window.confirm(`Disable API access for ${hospital.name}?`)) return;
    setError("");
    setNotice("");
    setCreatedHospitalKey("");
    setCopiedHospitalKey(false);
    setActionBusy(`hospital-${hospital.id}`);
    try {
      const result = await adminRequest(`/hospitals/${hospital.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ isActive }),
      });
      setNotice(result.message);
      await loadHospitals();
    } catch (requestError) {
      showError(requestError);
    } finally {
      setActionBusy("");
    }
  }

  async function previewAmbulanceDocument(item, type, label) {
    setError("");
    setPreviewLoading(`${item.id}-${type}`);
    try {
      const token = localStorage.getItem("emergencycare-token");
      const response = await fetch(
        apiUrl(`/api/admin/documents/ambulance/${item.id}/${type}`),
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) {
        await readApiResponse(response, "Could not load this document.");
      }
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) {
        throw new Error("The document response was not a supported image.");
      }
      setDocumentPreview({
        url: URL.createObjectURL(blob),
        label: `${item.name} · ${label}`,
      });
    } catch (requestError) {
      showError(requestError);
    } finally {
      setPreviewLoading("");
    }
  }

  async function viewUser(userId) {
    setError("");
    try {
      const result = await adminRequest(`/users/${userId}`);
      setSelectedUser(result);
    } catch (requestError) {
      showError(requestError);
    }
  }

  async function changeUserStatus(user) {
    const accountStatus = user.accountStatus === "active" ? "suspended" : "active";
    if (
      accountStatus === "suspended" &&
      !window.confirm(`Suspend ${user.name}'s account? They will no longer be able to log in.`)
    ) {
      return;
    }
    setError("");
    setNotice("");
    setActionBusy(`${user.id}-status`);
    try {
      const result = await adminRequest(`/users/${user.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ accountStatus }),
      });
      setNotice(result.message);
      setSelectedUser(null);
      await Promise.all([loadUsers(), loadDashboard()]);
    } catch (requestError) {
      showError(requestError);
    } finally {
      setActionBusy("");
    }
  }

  async function deleteUser(user) {
    if (
      !window.confirm(
        `Permanently delete ${user.name} (${user.email})? This cannot be undone.`,
      )
    ) {
      return;
    }
    setError("");
    setNotice("");
    setActionBusy(`${user.id}-delete`);
    try {
      const result = await adminRequest(`/users/${user.id}`, { method: "DELETE" });
      setNotice(result.message);
      setSelectedUser(null);
      await Promise.all([loadUsers(), loadDashboard()]);
    } catch (requestError) {
      showError(requestError);
    } finally {
      setActionBusy("");
    }
  }

  function applyUserFilters(event) {
    event.preventDefault();
    setUserQuery(userSearch.trim());
    setUserPage(1);
  }

  function setTabAndClear(nextTab) {
    setError("");
    setNotice("");
    setTab(nextTab);
  }

  const summaryCards = [
    ["Patients", counts.patients],
    ["Dispatchers", counts.dispatchers],
    ["Ambulances", counts.ambulances],
    ["Active trips", counts.activeTrips],
  ];

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <a className="brand-link" href="/">
          <span className="brand-mark" aria-hidden="true">+</span>
          <span>EmergencyCare <small>Admin</small></span>
        </a>
        <div className="admin-account">
          <NotificationCenter user={user} />
          <span>{user.name}</span>
          <button className="text-button" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <section className="admin-heading">
        <div>
          <p className="eyebrow">Control center</p>
          <h1>Admin dashboard</h1>
        </div>
      </section>

      <nav className="admin-tabs" aria-label="Admin sections">
        {[
          ["overview", "Overview"],
          ["approvals", "Approvals", counts.pendingAmbulances + counts.pendingDispatchers],
          ["users", "Users"],
          ["trips", "Trips"],
          ["pricing", "Pricing"],
          ["hospitals", "Hospitals"],
        ].map(([value, label, badge]) => (
          <button
            key={value}
            className={`admin-tab ${tab === value ? "selected" : ""}`}
            onClick={() => setTabAndClear(value)}
          >
            {label}
            {badge > 0 && <span className="tab-badge">{badge}</span>}
          </button>
        ))}
      </nav>

      <section className="admin-content">
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="notice" role="status">{notice}</p>}

        {tab === "overview" && (
          <>
            <div className="summary-grid">
              {summaryCards.map(([label, value]) => (
                <article className="summary-card" key={label}>
                  <p>{label}</p>
                  <strong>{value}</strong>
                </article>
              ))}
            </div>
            <div className="admin-panel overview-panel">
              <div>
                <p className="eyebrow">Needs review</p>
                <h2>Pending applications</h2>
                <p className="intro">
                  Ambulances: <strong>{counts.pendingAmbulances}</strong>
                  <span className="overview-separator">·</span>
                  Dispatchers: <strong>{counts.pendingDispatchers}</strong>
                </p>
              </div>
              <button className="primary-button compact-button" onClick={() => setTabAndClear("approvals")}>
                Review applications
              </button>
            </div>
          </>
        )}

        {tab === "approvals" && (
          <section className="admin-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Applications</p>
                <h2>Approval queue</h2>
              </div>
              <label className="compact-filter">
                Account type
                <select
                  value={approvalRole}
                  onChange={(event) => {
                    setApprovalRole(event.target.value);
                    setNotice("");
                  }}
                >
                  <option value="ambulance">Ambulances ({counts.pendingAmbulances})</option>
                  <option value="dispatcher">Dispatchers ({counts.pendingDispatchers})</option>
                </select>
              </label>
            </div>

            {loading ? <p className="empty-state">Loading applications…</p> : approvals.length === 0 ? (
              <p className="empty-state">There are no pending {approvalRole} applications.</p>
            ) : (
              <div className="record-list">
                {approvals.map((item) => (
                  <article className="record-card" key={item.id}>
                    <div className="record-heading">
                      <div>
                        <h3>{item.name}</h3>
                        <p>{item.email} · {item.phone}</p>
                      </div>
                      <span className="status-pill pending">Pending</span>
                    </div>
                    <dl className="detail-grid">
                      {approvalFields[approvalRole].map(([key, label]) => (
                        <div key={key}>
                          <dt>{label}</dt>
                          <dd>{item[key] || "Not provided"}</dd>
                        </div>
                      ))}
                      <div>
                        <dt>Submitted</dt>
                        <dd>{formatDate(item.createdAt)}</dd>
                      </div>
                    </dl>
                    {approvalRole === "ambulance" && (
                      <div className="document-actions">
                        {item.nidPhotoPath && (
                          <button
                            className="secondary-button compact-button"
                            disabled={previewLoading === `${item.id}-nid`}
                            onClick={() => previewAmbulanceDocument(item, "nid", "NID photo")}
                          >
                            {previewLoading === `${item.id}-nid` ? "Loading NID…" : "View NID photo"}
                          </button>
                        )}
                        {item.licencePhotoPath && (
                          <button
                            className="secondary-button compact-button"
                            disabled={previewLoading === `${item.id}-licence`}
                            onClick={() => previewAmbulanceDocument(item, "licence", "Driving licence photo")}
                          >
                            {previewLoading === `${item.id}-licence` ? "Loading licence…" : "View licence photo"}
                          </button>
                        )}
                      </div>
                    )}
                    <label className="reason-field">
                      Rejection reason
                      <textarea
                        rows="2"
                        maxLength="500"
                        placeholder="Required only when rejecting"
                        value={rejectionReasons[item.id] || ""}
                        onChange={(event) => setRejectionReasons((current) => ({
                          ...current,
                          [item.id]: event.target.value,
                        }))}
                      />
                    </label>
                    <div className="record-actions">
                      <button
                        className="primary-button compact-button"
                        disabled={Boolean(actionBusy)}
                        onClick={() => reviewApplication(item, "approved")}
                      >
                        {actionBusy === `${item.id}-approved` ? "Approving…" : "Approve"}
                      </button>
                      <button
                        className="danger-button compact-button"
                        disabled={Boolean(actionBusy)}
                        onClick={() => reviewApplication(item, "rejected")}
                      >
                        {actionBusy === `${item.id}-rejected` ? "Rejecting…" : "Reject"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === "users" && (
          <section className="admin-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Accounts</p>
                <h2>Manage users <span className="muted-count">({userPagination.total})</span></h2>
              </div>
            </div>
            <form className="user-filters" onSubmit={applyUserFilters}>
              <label className="search-field">
                Search
                <input
                  value={userSearch}
                  onChange={(event) => setUserSearch(event.target.value)}
                  placeholder="Name, email, or phone"
                  maxLength="100"
                />
              </label>
              <label className="compact-filter">
                Role
                <select
                  value={userRole}
                  onChange={(event) => {
                    setUserRole(event.target.value);
                    setUserPage(1);
                  }}
                >
                  <option value="">All roles</option>
                  <option value="patient">Patient</option>
                  <option value="dispatcher">Dispatcher</option>
                  <option value="ambulance">Ambulance</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <label className="compact-filter">
                Status
                <select
                  value={userStatus}
                  onChange={(event) => {
                    setUserStatus(event.target.value);
                    setUserPage(1);
                  }}
                >
                  <option value="">All statuses</option>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </select>
              </label>
              <button className="primary-button compact-button" type="submit">Search</button>
            </form>

            {selectedUser && (
              <section className="selected-user">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Account details</p>
                    <h3>{selectedUser.user.name}</h3>
                  </div>
                  <button className="text-button" onClick={() => setSelectedUser(null)}>Close</button>
                </div>
                <dl className="detail-grid">
                  <div><dt>Email</dt><dd>{selectedUser.user.email}</dd></div>
                  <div><dt>Phone</dt><dd>{selectedUser.user.phone}</dd></div>
                  <div><dt>Role</dt><dd>{selectedUser.user.role}</dd></div>
                  <div><dt>Account status</dt><dd>{selectedUser.user.accountStatus}</dd></div>
                  <div><dt>Joined</dt><dd>{formatDate(selectedUser.user.createdAt)}</dd></div>
                  {selectedUser.profile && Object.entries(selectedUser.profile)
                    .filter(([key]) => key !== "has_nid_photo" && key !== "has_licence_photo")
                    .map(([key, value]) => (
                      <div key={key}>
                        <dt>{key.replaceAll("_", " ")}</dt>
                        <dd>{value === null || value === "" ? "Not provided" : String(value)}</dd>
                      </div>
                    ))}
                  {selectedUser.profile?.has_nid_photo && (
                    <div><dt>NID photo</dt><dd>Verification document submitted</dd></div>
                  )}
                  {selectedUser.profile?.has_licence_photo && (
                    <div><dt>Licence photo</dt><dd>Verification document submitted</dd></div>
                  )}
                </dl>
              </section>
            )}

            {loading ? <p className="empty-state">Loading users…</p> : users.length === 0 ? (
              <p className="empty-state">No accounts match those filters.</p>
            ) : (
              <div className="record-list">
                {users.map((item) => (
                  <article className="user-row" key={item.id}>
                    <div className="user-main">
                      <div>
                        <h3>{item.name}</h3>
                        <p>{item.email} · {item.phone}</p>
                      </div>
                      <div className="user-tags">
                        <span className="role-pill">{item.role}</span>
                        <span className={`status-pill ${item.accountStatus}`}>
                          {item.accountStatus}
                        </span>
                      </div>
                    </div>
                    <div className="record-actions">
                      <button
                        className="secondary-button compact-button"
                        disabled={Boolean(actionBusy)}
                        onClick={() => viewUser(item.id)}
                      >
                        {actionBusy === `${item.id}-status` || actionBusy === `${item.id}-delete`
                          ? "Updating…"
                          : "View details"}
                      </button>
                      <button
                        className="secondary-button compact-button"
                        disabled={item.id === user.id || Boolean(actionBusy)}
                        onClick={() => changeUserStatus(item)}
                      >
                        {actionBusy === `${item.id}-status`
                          ? "Updating…"
                          : item.accountStatus === "active" ? "Suspend" : "Activate"}
                      </button>
                      <button
                        className="danger-button compact-button"
                        disabled={item.id === user.id || Boolean(actionBusy)}
                        onClick={() => deleteUser(item)}
                      >
                        {actionBusy === `${item.id}-delete` ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <Pagination
              page={userPage}
              pages={userPagination.pages}
              onChange={setUserPage}
            />
          </section>
        )}

        {tab === "trips" && (
          <section className="admin-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Activity</p>
                <h2>All trips <span className="muted-count">({tripPagination.total})</span></h2>
              </div>
              <label className="compact-filter">
                Trip status
                <select
                  value={tripStatus}
                  onChange={(event) => {
                    setTripStatus(event.target.value);
                    setTripPage(1);
                  }}
                >
                  <option value="">All statuses</option>
                  {["searching", "requested_to_ambulance", "accepted", "picked_up", "at_hospital", "completed", "cancelled"].map((status) => (
                    <option key={status} value={status}>{labelForStatus(status)}</option>
                  ))}
                </select>
              </label>
            </div>
            {loading ? <p className="empty-state">Loading trips…</p> : trips.length === 0 ? (
              <p className="empty-state">No trips to display yet.</p>
            ) : (
              <div className="record-list">
                {trips.map((trip) => (
                  <article className="record-card trip-card" key={trip.id}>
                    <div className="record-heading">
                      <div>
                        <h3>
                          Trip #{trip.id} · {trip.patientName}
                          {trip.requestSource === "hospital" ? ` · ${trip.hospitalName}` : ""}
                        </h3>
                        <p>{trip.patientPhone} · {formatDate(trip.createdAt)}</p>
                      </div>
                      <span className={`status-pill ${trip.status}`}>{labelForStatus(trip.status)}</span>
                    </div>
                    <dl className="detail-grid">
                      <div><dt>Pickup</dt><dd>{trip.currentLocation}</dd></div>
                      <div><dt>Destination</dt><dd>{trip.destination}</dd></div>
                      <div><dt>Ambulance type</dt><dd>{trip.ambulanceType}</dd></div>
                      <div><dt>Dispatcher</dt><dd>{trip.dispatcherName || "Not assigned"}</dd></div>
                      <div><dt>Driver</dt><dd>{trip.driverName || "Not assigned"}</dd></div>
                      <div><dt>Vehicle</dt><dd>{trip.vehicleNumber || "Not assigned"}</dd></div>
                      {trip.fareAmount !== null && trip.fareAmount !== undefined && (
                        <>
                          <div><dt>Cash fare</dt><dd>৳{Number(trip.fareAmount).toFixed(0)}</dd></div>
                          <div><dt>Payment status</dt><dd>
                            {trip.status === "cancelled" ? "No fare due" : trip.paymentStatus}
                          </dd></div>
                        </>
                      )}
                    </dl>
                  </article>
                ))}
              </div>
            )}
            <Pagination page={tripPage} pages={tripPagination.pages} onChange={setTripPage} />
          </section>
        )}

        {tab === "pricing" && (
          <section className="admin-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Cash fares</p>
                <h2>Per-kilometer rates</h2>
              </div>
            </div>
            <p className="intro">
              Rates apply to the estimated road distance. Each trip saves the rate and
              fare used when the patient requested it; changing these values will not
              alter existing trips.
            </p>
            {loading ? (
              <p className="empty-state" role="status">Loading fare rates…</p>
            ) : (
              <form className="patient-form pricing-form" onSubmit={saveFareRates}>
                {[
                  ["basicPerKm", "Basic ambulance"],
                  ["icuPerKm", "ICU ambulance"],
                  ["freezerPerKm", "Freezer ambulance"],
                ].map(([key, label]) => (
                  <label key={key}>
                    {label} (BDT per road kilometer)
                    <input
                      type="number"
                      min="0.01"
                      max="100000"
                      step="0.01"
                      required
                      value={fareRates[key]}
                      onChange={(event) => setFareRates((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))}
                    />
                  </label>
                ))}
                <button className="primary-button" disabled={Boolean(actionBusy)}>
                  {actionBusy === "fare-rates" ? "Saving rates…" : "Save fare rates"}
                </button>
              </form>
            )}
          </section>
        )}

        {tab === "hospitals" && (
          <section className="admin-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">External integrations</p>
                <h2>Hospital API access</h2>
              </div>
            </div>
            <p className="intro">
              Add a hospital and issue its system a private API key. Hospital requests
              go to the dispatcher queue with this facility as the destination.
            </p>
            {createdHospitalKey && (
              <div className="hospital-key-notice" role="status">
                <strong>Copy this API key now. It will not be shown again.</strong>
                <code>{createdHospitalKey}</code>
                <button
                  type="button"
                  className="secondary-button compact-button"
                  onClick={copyHospitalKey}
                >
                  {copiedHospitalKey ? "Copied API key" : "Copy API key"}
                </button>
                <span>Send it securely and store it as <code>HOSPITAL_API_KEY</code> in the hospital software.</span>
              </div>
            )}
            <form className="patient-form hospital-form" onSubmit={createHospital}>
              <label>
                Hospital name
                <input
                  value={hospitalForm.name}
                  onChange={(event) => setHospitalForm((current) => ({ ...current, name: event.target.value }))}
                  minLength="2"
                  maxLength="160"
                  required
                />
              </label>
              <label>
                Hospital address
                <input
                  value={hospitalForm.address}
                  onChange={(event) => setHospitalForm((current) => ({ ...current, address: event.target.value }))}
                  minLength="3"
                  maxLength="500"
                  required
                />
              </label>
              <div className="coordinate-fields">
                <label>
                  Latitude
                  <input
                    type="number"
                    min="-90"
                    max="90"
                    step="any"
                    value={hospitalForm.latitude}
                    onChange={(event) => setHospitalForm((current) => ({ ...current, latitude: event.target.value }))}
                    required
                  />
                </label>
                <label>
                  Longitude
                  <input
                    type="number"
                    min="-180"
                    max="180"
                    step="any"
                    value={hospitalForm.longitude}
                    onChange={(event) => setHospitalForm((current) => ({ ...current, longitude: event.target.value }))}
                    required
                  />
                </label>
              </div>
              <button className="primary-button" disabled={Boolean(actionBusy)}>
                {actionBusy === "hospital-create" ? "Creating…" : "Add hospital and issue API key"}
              </button>
            </form>

            <div className="hospital-api-guide">
              <strong>API base URL</strong>
              <code>{apiUrl("/api/hospital") || `${window.location.origin}/api/hospital`}</code>
              <span>Send the key in the <code>X-Hospital-API-Key</code> header. Hospital requests are shown to online dispatchers for ambulance assignment.</span>
            </div>

            <div className="hospital-list">
              <div className="panel-heading">
                <h3>Connected hospitals</h3>
                <button className="secondary-button compact-button" onClick={loadHospitals}>Refresh</button>
              </div>
              {loading ? <p className="empty-state">Loading hospitals…</p> : hospitals.length === 0 ? (
                <p className="empty-state">No hospitals are connected yet.</p>
              ) : (
                <div className="record-list">
                  {hospitals.map((hospital) => (
                    <article className="record-card" key={hospital.id}>
                      <div className="record-heading">
                        <div>
                          <h3>{hospital.name}</h3>
                          <p>{hospital.address}</p>
                        </div>
                        <span className={`status-pill ${hospital.isActive ? "active" : "suspended"}`}>
                          {hospital.isActive ? "API enabled" : "API disabled"}
                        </span>
                      </div>
                      <p className="hospital-coordinates">
                        Facility coordinates: {hospital.latitude}, {hospital.longitude}
                      </p>
                      <div className="record-actions">
                        <button
                          className="secondary-button compact-button"
                          disabled={Boolean(actionBusy)}
                          onClick={() => rotateHospitalKey(hospital)}
                        >
                          {actionBusy === `hospital-${hospital.id}` ? "Updating…" : "Rotate API key"}
                        </button>
                        <button
                          className={hospital.isActive ? "danger-button compact-button" : "secondary-button compact-button"}
                          disabled={Boolean(actionBusy)}
                          onClick={() => setHospitalActive(hospital)}
                        >
                          {hospital.isActive ? "Disable API" : "Enable API"}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {tab === "profile" && (
          <section className="admin-panel profile-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Account details</p>
                <h2>Admin profile</h2>
              </div>
              <span className="role-pill">Admin</span>
            </div>
            <dl className="detail-grid profile-details">
              <div><dt>Full name</dt><dd>{user.name}</dd></div>
              <div><dt>Email</dt><dd>{user.email}</dd></div>
              <div><dt>Role</dt><dd>Administrator</dd></div>
            </dl>
            <AccountSettings user={user} onLogout={onLogout} />
            <button className="patient-logout" onClick={onLogout}>Log out of EmergencyCare</button>
          </section>
        )}
      </section>

      <WorkspaceNavigation
        activeTab={tab === "trips" ? "activity" : tab === "profile" ? "profile" : "home"}
        variant="admin"
        label="Admin navigation"
        onSelect={(value) => setTabAndClear(
          value === "activity" ? "trips" : value === "profile" ? "profile" : "overview",
        )}
      />

      {documentPreview && (
        <div
          className="document-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDocumentPreview(null);
          }}
        >
          <section className="document-modal" role="dialog" aria-modal="true" aria-label={documentPreview.label}>
            <div className="panel-heading">
              <h2>{documentPreview.label}</h2>
              <button className="text-button" onClick={() => setDocumentPreview(null)}>Close</button>
            </div>
            <img src={documentPreview.url} alt={documentPreview.label} />
          </section>
        </div>
      )}
    </main>
  );
}

function Pagination({ page, pages, onChange }) {
  if (pages <= 1) return null;
  return (
    <div className="pagination">
      <button
        className="secondary-button compact-button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </button>
      <span>Page {page} of {pages}</span>
      <button
        className="secondary-button compact-button"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </div>
  );
}
