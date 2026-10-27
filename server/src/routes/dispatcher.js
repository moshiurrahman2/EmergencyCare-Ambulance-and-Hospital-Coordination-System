import { Router } from "express";
import pool from "../config/database.js";
import { authenticate, requireRole } from "../middleware/authenticate.js";
import { getAvailableAmbulances } from "../services/ambulanceMatching.js";
import { notifyTripAssigned } from "../services/pushNotifications.js";
import { emitTripUpdate } from "../services/realtime.js";

const router = Router();
const fieldRules = {
  name: { label: "Name", min: 2, max: 120 },
  age: { label: "Age", min: 18, max: 100 },
  permanentAddress: { label: "Permanent address", min: 3, max: 500 },
  presentAddress: { label: "Present address", min: 3, max: 500 },
  phone: { label: "Phone number", min: 7, max: 32 },
  nidNumber: { label: "NID number", min: 3, max: 64 },
};
const activeTripStatuses = ["accepted", "picked_up", "at_hospital"];
const dispatchableStatuses = ["searching"];
const requestSelect = `
  SELECT r.id, r.patient_name AS patientName, r.patient_phone AS patientPhone,
    r.request_source AS requestSource, h.name AS hospitalName,
    r.symptoms, r.current_location AS currentLocation,
    r.current_latitude AS currentLatitude,
    r.current_longitude AS currentLongitude,
    r.destination, r.ambulance_type AS ambulanceType, r.status,
    r.estimated_distance_km AS estimatedDistanceKm,
    r.fare_rate_per_km AS fareRatePerKm,
    r.fare_amount AS fareAmount,
    r.payment_method AS paymentMethod,
    r.payment_status AS paymentStatus,
    r.created_at AS createdAt, r.updated_at AS updatedAt,
    r.dispatcher_id AS dispatcherId, r.ambulance_id AS ambulanceId,
    ap.driver_name AS driverName, ap.vehicle_number AS vehicleNumber,
    au.phone AS driverPhone,
    loc.latitude AS ambulanceLatitude, loc.longitude AS ambulanceLongitude,
    loc.recorded_at AS ambulanceLocationUpdatedAt
  FROM ambulance_requests r
  LEFT JOIN hospital_partners h ON h.id = r.hospital_id
  LEFT JOIN ambulance_profiles ap ON ap.user_id = r.ambulance_id
  LEFT JOIN users au ON au.id = ap.user_id
  LEFT JOIN ambulance_locations loc
    ON loc.id = (
      SELECT l.id FROM ambulance_locations l
      WHERE l.ambulance_id = r.ambulance_id
      ORDER BY l.recorded_at DESC, l.id DESC LIMIT 1
    )
`;

router.use(authenticate, requireRole("dispatcher"));

function validateProfile(body) {
  for (const [key, rule] of Object.entries(fieldRules)) {
    const value = body[key];
    if (typeof value !== "string" && key !== "age") {
      return `${rule.label} is required.`;
    }
    if (key === "age") {
      if (!Number.isInteger(value) || value < rule.min || value > rule.max) {
        return "Age must be a whole number between 18 and 100.";
      }
    } else if (value.trim().length < rule.min || value.trim().length > rule.max) {
      return `${rule.label} must be between ${rule.min} and ${rule.max} characters.`;
    }
  }
  const digits = body.phone.trim().replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    return "Phone number must contain 7 to 15 digits.";
  }
  return null;
}

async function dispatcherStatus(dispatcherId) {
  const [rows] = await pool.execute(
    `SELECT approval_status, is_online,
       (last_seen_at >= CURRENT_TIMESTAMP - INTERVAL 60 SECOND) AS presenceFresh
     FROM dispatcher_profiles
     WHERE user_id = ? LIMIT 1`,
    [dispatcherId],
  );
  const dispatcher = rows[0];
  return {
    approved: dispatcher?.approval_status === "approved",
    online: Boolean(dispatcher?.is_online) && Boolean(dispatcher?.presenceFresh),
  };
}

router.get("/profile", async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT u.name, u.email, u.phone,
        p.age, p.permanent_address AS permanentAddress,
        p.present_address AS presentAddress, p.nid_number AS nidNumber,
        p.approval_status AS approvalStatus, p.approval_reason AS approvalReason,
        p.reviewed_at AS reviewedAt,
        (p.is_online AND p.last_seen_at >= CURRENT_TIMESTAMP - INTERVAL 60 SECOND) AS isOnline
       FROM users u
       LEFT JOIN dispatcher_profiles p ON p.user_id = u.id
       WHERE u.id = ? AND u.role = 'dispatcher'
       LIMIT 1`,
      [request.user.id],
    );
    if (!rows[0]) {
      return response.status(404).json({ message: "Dispatcher account not found." });
    }
    return response.json({ profile: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.put("/profile", async (request, response, next) => {
  const validationError = validateProfile(request.body ?? {});
  if (validationError) {
    return response.status(400).json({ message: validationError });
  }

  const profile = request.body;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [accounts] = await connection.execute(
      `SELECT name, phone, account_status FROM users
       WHERE id = ? AND role = 'dispatcher' FOR UPDATE`,
      [request.user.id],
    );
    if (!accounts[0] || accounts[0].account_status !== "active") {
      await connection.rollback();
      return response.status(403).json({ message: "An active dispatcher account is required." });
    }

    const [existingRows] = await connection.execute(
      `SELECT approval_status FROM dispatcher_profiles
       WHERE user_id = ? FOR UPDATE`,
      [request.user.id],
    );
    if (existingRows[0]?.approval_status === "approved") {
      await connection.rollback();
      return response.status(409).json({
        message: "Your approved profile cannot be changed here. Contact an administrator if it needs correction.",
      });
    }

    await connection.execute(
      `INSERT INTO dispatcher_profiles (
        user_id, age, permanent_address, present_address, phone, nid_number,
        approval_status, approval_reason, reviewed_by, reviewed_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL)
      ON DUPLICATE KEY UPDATE
        age = VALUES(age),
        permanent_address = VALUES(permanent_address),
        present_address = VALUES(present_address),
        phone = VALUES(phone),
        nid_number = VALUES(nid_number),
        approval_status = 'pending',
        approval_reason = NULL,
        reviewed_by = NULL,
        reviewed_at = NULL`,
      [
        request.user.id,
        profile.age,
        profile.permanentAddress.trim(),
        profile.presentAddress.trim(),
        profile.phone.trim(),
        profile.nidNumber.trim(),
      ],
    );
    await connection.execute(
      "UPDATE users SET name = ?, phone = ? WHERE id = ?",
      [profile.name.trim(), profile.phone.trim(), request.user.id],
    );
    await connection.execute(
      `UPDATE dispatcher_profiles SET is_online = FALSE, last_seen_at = NULL
       WHERE user_id = ?`,
      [request.user.id],
    );
    await connection.commit();

    return response.json({
      message: "Dispatcher profile submitted. It will remain inactive until an administrator approves it.",
      profile: {
        name: profile.name.trim(),
        email: request.user.email,
        phone: profile.phone.trim(),
        age: profile.age,
        permanentAddress: profile.permanentAddress.trim(),
        presentAddress: profile.presentAddress.trim(),
        nidNumber: profile.nidNumber.trim(),
        approvalStatus: "pending",
        approvalReason: null,
        reviewedAt: null,
      },
    });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
});

router.patch("/presence", async (request, response, next) => {
  const { isOnline } = request.body ?? {};
  if (typeof isOnline !== "boolean") {
    return response.status(400).json({ message: "Choose whether you are available for dispatch." });
  }

  try {
    const [dispatchers] = await pool.execute(
      `SELECT approval_status FROM dispatcher_profiles WHERE user_id = ? LIMIT 1`,
      [request.user.id],
    );
    if (dispatchers[0]?.approval_status !== "approved") {
      return response.status(403).json({ message: "Only an approved dispatcher can change availability." });
    }
    await pool.execute(
      `UPDATE dispatcher_profiles
       SET is_online = ?, last_seen_at = IF(?, CURRENT_TIMESTAMP, NULL)
       WHERE user_id = ? AND approval_status = 'approved'`,
      [isOnline, isOnline, request.user.id],
    );
    return response.json({ isOnline, message: isOnline ? "You are online for dispatch." : "You are offline." });
  } catch (error) {
    return next(error);
  }
});

router.get("/work", async (request, response, next) => {
  try {
    const status = await dispatcherStatus(request.user.id);
    if (!status.approved) {
      return response.json({ requests: [], activeTrips: [] });
    }

    let rows = [];
    if (status.online) {
      const placeholders = dispatchableStatuses.map(() => "?").join(", ");
      [rows] = await pool.execute(
        `${requestSelect}
         WHERE r.status IN (${placeholders})
           AND (
             r.dispatcher_id = ?
             OR (r.dispatcher_id IS NULL AND r.status = 'searching')
           )
         ORDER BY
           CASE WHEN r.dispatcher_id = ? THEN 0 ELSE 1 END,
           r.created_at ASC, r.id ASC
         LIMIT 100`,
        [
          ...dispatchableStatuses,
          request.user.id,
          request.user.id,
        ],
      );
    }
    const requests = rows.map((row) => ({
      ...row,
      id: String(row.id),
      dispatcherId: row.dispatcherId === null ? null : String(row.dispatcherId),
      ambulanceId: row.ambulanceId === null ? null : String(row.ambulanceId),
    }));

    const [activeRows] = await pool.execute(
      `${requestSelect}
       WHERE r.dispatcher_id = ?
         AND r.status IN (?, ?, ?)
       ORDER BY r.updated_at DESC, r.id DESC
       LIMIT 100`,
      [request.user.id, ...activeTripStatuses],
    );
    return response.json({
      requests,
      activeTrips: activeRows.map((row) => ({
        ...row,
        id: String(row.id),
        dispatcherId: String(row.dispatcherId),
        ambulanceId: row.ambulanceId === null ? null : String(row.ambulanceId),
      })),
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/activity", async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `${requestSelect}
       WHERE r.dispatcher_id = ?
       ORDER BY r.updated_at DESC, r.id DESC
       LIMIT 100`,
      [request.user.id],
    );
    return response.json({
      activity: rows.map((row) => ({
        ...row,
        id: String(row.id),
        dispatcherId: String(row.dispatcherId),
        ambulanceId: row.ambulanceId === null ? null : String(row.ambulanceId),
      })),
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/requests/:requestId/claim", async (request, response, next) => {
  const { requestId } = request.params;
  if (!/^\d+$/.test(requestId)) {
    return response.status(400).json({ message: "The request ID is invalid." });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [dispatchers] = await connection.execute(
      `SELECT approval_status, is_online,
         (last_seen_at >= CURRENT_TIMESTAMP - INTERVAL 60 SECOND) AS presenceFresh
       FROM dispatcher_profiles
       WHERE user_id = ? FOR UPDATE`,
      [request.user.id],
    );
    if (
      dispatchers[0]?.approval_status !== "approved" ||
      !dispatchers[0]?.is_online ||
      !dispatchers[0]?.presenceFresh
    ) {
      await connection.rollback();
      return response.status(403).json({ message: "Go online as an approved dispatcher before taking a request." });
    }

    const [requests] = await connection.execute(
      `SELECT id, status, dispatcher_id AS dispatcherId, ambulance_id AS ambulanceId
       FROM ambulance_requests WHERE id = ? FOR UPDATE`,
      [requestId],
    );
    const item = requests[0];
    if (!item) {
      await connection.rollback();
      return response.status(404).json({ message: "Request not found." });
    }
    if (item.status !== "searching" || item.ambulanceId !== null) {
      await connection.rollback();
      return response.status(409).json({ message: "This request is no longer available to assign." });
    }
    if (item.dispatcherId !== null && String(item.dispatcherId) !== request.user.id) {
      await connection.rollback();
      return response.status(409).json({ message: "Another dispatcher is already handling this request." });
    }

    await connection.execute(
      `UPDATE ambulance_requests SET dispatcher_id = ?
       WHERE id = ? AND status = 'searching' AND ambulance_id IS NULL`,
      [request.user.id, requestId],
    );
    await connection.commit();
    emitTripUpdate(requestId, { status: "searching", dispatcherId: request.user.id });
    return response.json({ message: "You are now handling this request." });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
});

router.get("/requests/:requestId/ambulances", async (request, response, next) => {
  const { requestId } = request.params;
  if (!/^\d+$/.test(requestId)) {
    return response.status(400).json({ message: "The request ID is invalid." });
  }

  try {
    const status = await dispatcherStatus(request.user.id);
    if (!status.approved || !status.online) {
      return response.status(403).json({ message: "Go online as an approved dispatcher to find ambulances." });
    }
    const [requests] = await pool.execute(
      `SELECT dispatcher_id AS dispatcherId, status, ambulance_id AS ambulanceId
       FROM ambulance_requests WHERE id = ? LIMIT 1`,
      [requestId],
    );
    const item = requests[0];
    if (!item) {
      return response.status(404).json({ message: "Request not found." });
    }
    if (String(item.dispatcherId) !== request.user.id) {
      return response.status(403).json({ message: "Only the dispatcher handling this request can assign an ambulance." });
    }
    if (item.status !== "searching" || item.ambulanceId !== null) {
      return response.status(409).json({
        message: "This request has already been assigned or is no longer available.",
      });
    }

    const [coordinates] = await pool.execute(
      `SELECT current_latitude AS latitude, current_longitude AS longitude
       FROM ambulance_requests WHERE id = ? LIMIT 1`,
      [requestId],
    );
    const ambulances = await getAvailableAmbulances(pool, {
      latitude: coordinates[0].latitude,
      longitude: coordinates[0].longitude,
    });
    return response.json({ ambulances });
  } catch (error) {
    return next(error);
  }
});

router.post("/requests/:requestId/assign", async (request, response, next) => {
  const { requestId } = request.params;
  const { ambulanceId } = request.body ?? {};
  if (!/^\d+$/.test(requestId) || typeof ambulanceId !== "string" || !/^\d+$/.test(ambulanceId)) {
    return response.status(400).json({ message: "Choose a valid request and ambulance." });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [dispatchers] = await connection.execute(
      `SELECT approval_status, is_online,
         (last_seen_at >= CURRENT_TIMESTAMP - INTERVAL 60 SECOND) AS presenceFresh
       FROM dispatcher_profiles
       WHERE user_id = ? FOR UPDATE`,
      [request.user.id],
    );
    if (
      dispatchers[0]?.approval_status !== "approved" ||
      !dispatchers[0]?.is_online ||
      !dispatchers[0]?.presenceFresh
    ) {
      await connection.rollback();
      return response.status(403).json({ message: "Go online as an approved dispatcher before assigning an ambulance." });
    }

    const [requests] = await connection.execute(
      `SELECT id, patient_id AS patientId, status,
        dispatcher_id AS dispatcherId, ambulance_id AS ambulanceId
       FROM ambulance_requests WHERE id = ? FOR UPDATE`,
      [requestId],
    );
    const item = requests[0];
    if (!item) {
      await connection.rollback();
      return response.status(404).json({ message: "Request not found." });
    }
    if (String(item.dispatcherId) !== request.user.id) {
      await connection.rollback();
      return response.status(403).json({ message: "Only the dispatcher handling this request can assign an ambulance." });
    }
    if (item.status !== "searching" || item.ambulanceId !== null) {
      await connection.rollback();
      return response.status(409).json({
        message: "This request is no longer available for assignment.",
      });
    }

    const [coordinates] = await connection.execute(
      `SELECT current_latitude AS latitude, current_longitude AS longitude
       FROM ambulance_requests WHERE id = ? LIMIT 1`,
      [requestId],
    );
    const candidates = await getAvailableAmbulances(connection, {
      latitude: coordinates[0].latitude,
      longitude: coordinates[0].longitude,
    });
    const closest = candidates?.[0];
    if (!closest || closest.id !== ambulanceId) {
      await connection.rollback();
      return response.status(409).json({
        message: "That ambulance is no longer the closest available option. Refresh the list and try again.",
      });
    }

    const [ambulances] = await connection.execute(
      `SELECT approval_status, is_online FROM ambulance_profiles
       WHERE user_id = ? FOR UPDATE`,
      [ambulanceId],
    );
    if (!ambulances[0] || ambulances[0].approval_status !== "approved" || !ambulances[0].is_online) {
      await connection.rollback();
      return response.status(409).json({ message: "That ambulance is no longer available." });
    }

    const activePlaceholders = activeTripStatuses.map(() => "?").join(", ");
    const [busyTrips] = await connection.execute(
      `SELECT id FROM ambulance_requests
       WHERE ambulance_id = ? AND status IN (${activePlaceholders})
       LIMIT 1 FOR UPDATE`,
      [ambulanceId, ...activeTripStatuses],
    );
    const [otherOffers] = await connection.execute(
      `SELECT id FROM ambulance_requests
       WHERE ambulance_id = ? AND status = 'requested_to_ambulance' AND id <> ?
       LIMIT 1 FOR UPDATE`,
      [ambulanceId, requestId],
    );
    if (busyTrips.length > 0 || otherOffers.length > 0) {
      await connection.rollback();
      return response.status(409).json({ message: "That ambulance has just become busy. Refresh the list." });
    }

    await connection.execute(
      `UPDATE ambulance_requests
       SET ambulance_id = ?, status = 'accepted'
       WHERE id = ? AND status = 'searching' AND ambulance_id IS NULL`,
      [ambulanceId, requestId],
    );
    await connection.commit();
    emitTripUpdate(requestId, {
      status: "accepted",
      ambulanceId,
      driverName: closest.driverName,
      vehicleNumber: closest.vehicleNumber,
      driverPhone: closest.phone,
    });
    void notifyTripAssigned({
      requestId,
      patientId: item.patientId === null ? null : String(item.patientId),
      dispatcherId: request.user.id,
      ambulanceId,
    }).catch((error) => {
      console.error(`Could not create notifications for assigned trip ${requestId}:`, error.message);
    });
    return response.json({
      message: `Assigned to the closest ambulance: ${closest.driverName} (${closest.vehicleNumber}).`,
      ambulance: closest,
    });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
});

export default router;
