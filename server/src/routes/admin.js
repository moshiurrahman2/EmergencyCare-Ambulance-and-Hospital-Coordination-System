import { createHash, randomBytes } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import pool from "../config/database.js";
import { authenticate, requireRole } from "../middleware/authenticate.js";
import { disconnectUserSockets } from "../services/realtime.js";

const router = Router();
const ambulanceDocumentDirectory = fileURLToPath(
  new URL("../../uploads/ambulance-documents/", import.meta.url),
);
const profileTables = {
  dispatcher: "dispatcher_profiles",
  ambulance: "ambulance_profiles",
};
const approvalRoles = Object.keys(profileTables);
const accountStatuses = ["active", "suspended"];
const tripStatuses = [
  "searching",
  "requested_to_ambulance",
  "accepted",
  "picked_up",
  "at_hospital",
  "completed",
  "cancelled",
];
const openRequestStatuses = [
  "searching",
  "requested_to_ambulance",
  "accepted",
  "picked_up",
  "at_hospital",
];
const activeAssignmentColumns = {
  patient: "patient_id",
  dispatcher: "dispatcher_id",
  ambulance: "ambulance_id",
};

async function removeAmbulanceDocuments(filenames) {
  for (const filename of filenames.filter(Boolean)) {
    if (
      path.basename(filename) !== filename ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/.test(filename)
    ) {
      console.error("Skipped deleting an ambulance document with an invalid stored filename.");
      continue;
    }
    try {
      await unlink(path.join(ambulanceDocumentDirectory, filename));
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.error("Could not remove a deleted ambulance document:", error.message);
      }
    }
  }
}

router.use(authenticate, requireRole("admin"));

function makeHospitalApiKey() {
  const apiKey = `ech_live_${randomBytes(32).toString("base64url")}`;
  return {
    apiKey,
    keyHash: createHash("sha256").update(apiKey).digest("hex"),
  };
}

function isValidCoordinate(value, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value) &&
    value >= minimum && value <= maximum;
}

router.get("/hospitals", async (_request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, name, address, latitude, longitude,
        is_active AS isActive, created_at AS createdAt
       FROM hospital_partners
       ORDER BY created_at DESC, id DESC`,
    );
    return response.json({
      hospitals: rows.map((hospital) => ({
        ...hospital,
        id: String(hospital.id),
        latitude: Number(hospital.latitude),
        longitude: Number(hospital.longitude),
        isActive: Boolean(hospital.isActive),
      })),
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/hospitals", async (request, response, next) => {
  const { name, address, latitude, longitude } = request.body ?? {};
  if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 160) {
    return response.status(400).json({ message: "Hospital name must be between 2 and 160 characters." });
  }
  if (typeof address !== "string" || address.trim().length < 3 || address.trim().length > 500) {
    return response.status(400).json({ message: "Hospital address must be between 3 and 500 characters." });
  }
  if (!isValidCoordinate(latitude, -90, 90) || !isValidCoordinate(longitude, -180, 180)) {
    return response.status(400).json({ message: "Enter valid hospital latitude and longitude coordinates." });
  }

  const { apiKey, keyHash } = makeHospitalApiKey();
  try {
    const [result] = await pool.execute(
      `INSERT INTO hospital_partners (name, address, latitude, longitude, api_key_hash)
       VALUES (?, ?, ?, ?, ?)`,
      [name.trim(), address.trim(), latitude, longitude, keyHash],
    );
    return response.status(201).json({
      message: "Hospital added. Copy the API key now; it will not be shown again.",
      hospital: {
        id: String(result.insertId),
        name: name.trim(),
        address: address.trim(),
        latitude,
        longitude,
        isActive: true,
      },
      apiKey,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/hospitals/:hospitalId/rotate-key", async (request, response, next) => {
  const { hospitalId } = request.params;
  if (!/^\d+$/.test(hospitalId)) {
    return response.status(400).json({ message: "The hospital ID is invalid." });
  }

  const { apiKey, keyHash } = makeHospitalApiKey();
  try {
    const [result] = await pool.execute(
      `UPDATE hospital_partners SET api_key_hash = ?
       WHERE id = ?`,
      [keyHash, hospitalId],
    );
    if (result.affectedRows === 0) {
      return response.status(404).json({ message: "Hospital not found." });
    }
    return response.json({
      message: "API key rotated. The previous key is no longer valid; copy the new key now.",
      apiKey,
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/hospitals/:hospitalId/status", async (request, response, next) => {
  const { hospitalId } = request.params;
  const { isActive } = request.body ?? {};
  if (!/^\d+$/.test(hospitalId) || typeof isActive !== "boolean") {
    return response.status(400).json({ message: "Choose a valid hospital and active status." });
  }

  try {
    const [result] = await pool.execute(
      `UPDATE hospital_partners SET is_active = ?
       WHERE id = ?`,
      [isActive, hospitalId],
    );
    if (result.affectedRows === 0) {
      const [rows] = await pool.execute(
        "SELECT id FROM hospital_partners WHERE id = ? LIMIT 1",
        [hospitalId],
      );
      if (!rows[0]) {
        return response.status(404).json({ message: "Hospital not found." });
      }
    }
    return response.json({
      message: isActive ? "Hospital API access enabled." : "Hospital API access disabled.",
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/fare-rates", async (_request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT basic_per_km AS basicPerKm,
        icu_per_km AS icuPerKm,
        freezer_per_km AS freezerPerKm,
        updated_at AS updatedAt
       FROM fare_settings WHERE id = 1 LIMIT 1`,
    );
    if (!rows[0]) {
      return response.status(503).json({ message: "Fare settings are missing. Apply the latest database schema." });
    }
    return response.json({ fareRates: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.put("/fare-rates", async (request, response, next) => {
  const { basicPerKm, icuPerKm, freezerPerKm } = request.body ?? {};
  const rates = [basicPerKm, icuPerKm, freezerPerKm];
  if (rates.some((rate) =>
    typeof rate !== "number" ||
    !Number.isFinite(rate) ||
    rate <= 0 ||
    rate > 100000 ||
    Math.abs(rate * 100 - Math.round(rate * 100)) > 1e-8
  )) {
    return response.status(400).json({
      message: "Enter positive rates with up to two decimal places, no greater than ৳100,000 per kilometer.",
    });
  }

  try {
    await pool.execute(
      `INSERT INTO fare_settings (id, basic_per_km, icu_per_km, freezer_per_km, updated_by)
       VALUES (1, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         basic_per_km = VALUES(basic_per_km),
         icu_per_km = VALUES(icu_per_km),
         freezer_per_km = VALUES(freezer_per_km),
         updated_by = VALUES(updated_by)`,
      [basicPerKm, icuPerKm, freezerPerKm, request.user.id],
    );
    return response.json({
      message: "Ambulance fare rates updated. New rates apply to new fare estimates; existing trip fares are unchanged.",
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/dashboard", async (_request, response, next) => {
  try {
    const [patientRows] = await pool.query(
      "SELECT COUNT(*) AS count FROM users WHERE role = 'patient'",
    );
    const [dispatcherRows] = await pool.query(
      "SELECT COUNT(*) AS count FROM users WHERE role = 'dispatcher'",
    );
    const [ambulanceRows] = await pool.query(
      "SELECT COUNT(*) AS count FROM users WHERE role = 'ambulance'",
    );
    const [tripRows] = await pool.query(
      `SELECT COUNT(*) AS count FROM ambulance_requests
       WHERE status IN ('requested_to_ambulance', 'accepted', 'picked_up', 'at_hospital')`,
    );
    const [pendingRows] = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM dispatcher_profiles WHERE approval_status = 'pending') AS dispatchers,
        (SELECT COUNT(*) FROM ambulance_profiles WHERE approval_status = 'pending') AS ambulances`,
    );

    return response.json({
      counts: {
        patients: Number(patientRows[0].count),
        dispatchers: Number(dispatcherRows[0].count),
        ambulances: Number(ambulanceRows[0].count),
        activeTrips: Number(tripRows[0].count),
        pendingDispatchers: Number(pendingRows[0].dispatchers),
        pendingAmbulances: Number(pendingRows[0].ambulances),
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/approvals", async (request, response, next) => {
  const { role } = request.query;
  if (typeof role !== "string" || !approvalRoles.includes(role)) {
    return response.status(400).json({ message: "Choose dispatcher or ambulance approvals." });
  }

  const profileTable = profileTables[role];
  const profileColumns = role === "dispatcher"
    ? `p.age, p.permanent_address AS permanentAddress,
       p.present_address AS presentAddress, p.phone AS profilePhone,
       p.nid_number AS nidNumber`
    : `p.driver_name AS driverName, p.vehicle_number AS vehicleNumber,
       p.permanent_address AS permanentAddress,
       p.present_address AS presentAddress, p.phone AS profilePhone,
       p.nid_number AS nidNumber,
       p.driving_licence_number AS drivingLicenceNumber,
       p.nid_photo_path AS nidPhotoPath,
       p.licence_photo_path AS licencePhotoPath`;

  try {
    const [rows] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.phone, u.account_status,
        u.created_at AS createdAt,
        p.approval_status AS approvalStatus,
        p.approval_reason AS approvalReason,
        p.reviewed_at AS reviewedAt,
        ${profileColumns}
       FROM ${profileTable} p
       INNER JOIN users u ON u.id = p.user_id
       WHERE p.approval_status = 'pending'
       ORDER BY p.created_at ASC`,
    );
    return response.json({ approvals: rows.map((row) => ({ ...row, id: String(row.id) })) });
  } catch (error) {
    return next(error);
  }
});

router.patch("/approvals/:role/:userId", async (request, response, next) => {
  const { role, userId } = request.params;
  const { decision, reason } = request.body ?? {};

  if (!approvalRoles.includes(role)) {
    return response.status(400).json({ message: "Choose a dispatcher or ambulance account." });
  }
  if (!/^\d+$/.test(userId)) {
    return response.status(400).json({ message: "The selected account ID is invalid." });
  }
  if (!["approved", "rejected"].includes(decision)) {
    return response.status(400).json({ message: "Choose approve or reject." });
  }
  if (decision === "rejected" && (typeof reason !== "string" || !reason.trim())) {
    return response.status(400).json({ message: "Enter a reason before rejecting this application." });
  }
  if (reason !== undefined && (typeof reason !== "string" || reason.trim().length > 500)) {
    return response.status(400).json({ message: "The review reason must be 500 characters or fewer." });
  }

  const profileTable = profileTables[role];
  try {
    const [result] = await pool.execute(
      `UPDATE ${profileTable}
       SET approval_status = ?, approval_reason = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND approval_status = 'pending'`,
      [
        decision,
        decision === "rejected" ? reason.trim() : null,
        request.user.id,
        userId,
      ],
    );
    if (result.affectedRows === 0) {
      return response.status(404).json({ message: "This pending application was not found or has already been reviewed." });
    }
    return response.json({ message: `Application ${decision}.` });
  } catch (error) {
    return next(error);
  }
});

router.get("/documents/ambulance/:userId/:documentType", async (request, response, next) => {
  const { userId, documentType } = request.params;
  const columns = {
    nid: "nid_photo_path",
    licence: "licence_photo_path",
  };
  if (!/^\d+$/.test(userId)) {
    return response.status(400).json({ message: "The selected account ID is invalid." });
  }
  if (!Object.hasOwn(columns, documentType)) {
    return response.status(400).json({ message: "Choose a valid ambulance document." });
  }

  try {
    const [profiles] = await pool.execute(
      `SELECT ${columns[documentType]} AS documentPath
       FROM ambulance_profiles WHERE user_id = ? LIMIT 1`,
      [userId],
    );
    const filename = profiles[0]?.documentPath;
    if (!filename) {
      return response.status(404).json({ message: "The requested document was not found." });
    }
    if (
      path.basename(filename) !== filename ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/.test(filename)
    ) {
      return response.status(404).json({ message: "The requested document was not found." });
    }

    const contentTypes = {
      ".jpg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
    };
    const document = await readFile(path.join(ambulanceDocumentDirectory, filename));
    response.set({
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    });
    return response.type(contentTypes[path.extname(filename)]).send(document);
  } catch (error) {
    if (error.code === "ENOENT") {
      return response.status(404).json({ message: "The requested document file is missing." });
    }
    return next(error);
  }
});

router.get("/users", async (request, response, next) => {
  const page = Number(request.query.page ?? 1);
  const limit = Number(request.query.limit ?? 25);
  const search = typeof request.query.search === "string"
    ? request.query.search.trim().slice(0, 100)
    : "";
  const role = typeof request.query.role === "string" ? request.query.role : "";
  const status = typeof request.query.status === "string" ? request.query.status : "";

  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return response.status(400).json({ message: "Page or page size is invalid." });
  }
  if (role && !["patient", "dispatcher", "ambulance", "admin"].includes(role)) {
    return response.status(400).json({ message: "Choose a valid user role." });
  }
  if (status && !accountStatuses.includes(status)) {
    return response.status(400).json({ message: "Choose a valid account status." });
  }

  const filters = [];
  const values = [];
  if (role) {
    filters.push("role = ?");
    values.push(role);
  }
  if (status) {
    filters.push("account_status = ?");
    values.push(status);
  }
  if (search) {
    filters.push("(name LIKE ? OR email LIKE ? OR phone LIKE ?)");
    const pattern = `%${search}%`;
    values.push(pattern, pattern, pattern);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  try {
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS count FROM users ${where}`,
      values,
    );
    const offset = (page - 1) * limit;
    const [users] = await pool.execute(
      `SELECT id, name, email, phone, role, account_status AS accountStatus,
        created_at AS createdAt
       FROM users ${where}
       ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...values, limit, offset],
    );

    return response.json({
      users: users.map((user) => ({ ...user, id: String(user.id) })),
      pagination: {
        page,
        limit,
        total: Number(countRows[0].count),
        pages: Math.ceil(Number(countRows[0].count) / limit),
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/users/:userId", async (request, response, next) => {
  const { userId } = request.params;
  if (!/^\d+$/.test(userId)) {
    return response.status(400).json({ message: "The selected account ID is invalid." });
  }

  try {
    const [users] = await pool.execute(
      `SELECT id, name, email, phone, role, account_status AS accountStatus,
        created_at AS createdAt
       FROM users WHERE id = ? LIMIT 1`,
      [userId],
    );
    const user = users[0];
    if (!user) {
      return response.status(404).json({ message: "User not found." });
    }

    let profile = null;
    if (user.role === "dispatcher") {
      const [profiles] = await pool.execute(
        `SELECT age, permanent_address, present_address, phone, nid_number,
          approval_status, approval_reason
         FROM dispatcher_profiles WHERE user_id = ? LIMIT 1`,
        [userId],
      );
      profile = profiles[0] ?? null;
    } else if (user.role === "ambulance") {
      const [profiles] = await pool.execute(
        `SELECT driver_name, vehicle_number, permanent_address, present_address,
          phone, nid_number, driving_licence_number, approval_status,
          approval_reason,
          (nid_photo_path IS NOT NULL) AS has_nid_photo,
          (licence_photo_path IS NOT NULL) AS has_licence_photo
         FROM ambulance_profiles WHERE user_id = ? LIMIT 1`,
        [userId],
      );
      profile = profiles[0] ?? null;
    }
    return response.json({
      user: { ...user, id: String(user.id) },
      profile,
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/users/:userId/status", async (request, response, next) => {
  const { userId } = request.params;
  const { accountStatus } = request.body ?? {};
  if (!/^\d+$/.test(userId)) {
    return response.status(400).json({ message: "The selected account ID is invalid." });
  }
  if (!accountStatuses.includes(accountStatus)) {
    return response.status(400).json({ message: "Choose active or suspended." });
  }
  if (userId === request.user.id && accountStatus === "suspended") {
    return response.status(400).json({ message: "You cannot suspend your own admin account." });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.execute(
      "SELECT id, role, account_status FROM users WHERE id = ? FOR UPDATE",
      [userId],
    );
    const user = users[0];
    if (!user) {
      await connection.rollback();
      return response.status(404).json({ message: "User not found." });
    }
    const assignmentColumn = activeAssignmentColumns[user.role];
    if (accountStatus === "suspended" && assignmentColumn) {
      const [activeTrips] = await connection.execute(
        `SELECT id FROM ambulance_requests
         WHERE ${assignmentColumn} = ?
           AND status IN (${openRequestStatuses.map(() => "?").join(", ")})
         LIMIT 1 FOR UPDATE`,
        [userId, ...openRequestStatuses],
      );
      if (activeTrips.length > 0) {
        await connection.rollback();
        return response.status(409).json({
          message: "This account is assigned to an open request or active trip. Resolve it before suspending the account.",
        });
      }
    }
    if (
      user.role === "admin" &&
      user.account_status === "active" &&
      accountStatus === "suspended"
    ) {
      const [activeAdmins] = await connection.query(
        "SELECT id FROM users WHERE role = 'admin' AND account_status = 'active' FOR UPDATE",
      );
      if (activeAdmins.length <= 1) {
        await connection.rollback();
        return response.status(409).json({ message: "The last active admin account cannot be suspended." });
      }
    }
    await connection.execute(
      "UPDATE users SET account_status = ? WHERE id = ?",
      [accountStatus, userId],
    );
    await connection.commit();
    if (accountStatus === "suspended") disconnectUserSockets(userId);
    return response.json({ message: `User ${accountStatus}.` });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
});

router.delete("/users/:userId", async (request, response, next) => {
  const { userId } = request.params;
  if (!/^\d+$/.test(userId)) {
    return response.status(400).json({ message: "The selected account ID is invalid." });
  }
  if (userId === request.user.id) {
    return response.status(400).json({ message: "You cannot delete your own admin account." });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.execute(
      "SELECT id, role, account_status FROM users WHERE id = ? FOR UPDATE",
      [userId],
    );
    const user = users[0];
    if (!user) {
      await connection.rollback();
      return response.status(404).json({ message: "User not found." });
    }
    const assignmentColumn = activeAssignmentColumns[user.role];
    if (assignmentColumn) {
      const [activeTrips] = await connection.execute(
        `SELECT id FROM ambulance_requests
         WHERE ${assignmentColumn} = ?
           AND status IN (${openRequestStatuses.map(() => "?").join(", ")})
         LIMIT 1 FOR UPDATE`,
        [userId, ...openRequestStatuses],
      );
      if (activeTrips.length > 0) {
        await connection.rollback();
        return response.status(409).json({
          message: "This account is assigned to an open request or active trip. Resolve it before deleting the account.",
        });
      }
    }
    if (user.role === "admin" && user.account_status === "active") {
      const [activeAdmins] = await connection.query(
        "SELECT id FROM users WHERE role = 'admin' AND account_status = 'active' FOR UPDATE",
      );
      if (activeAdmins.length <= 1) {
        await connection.rollback();
        return response.status(409).json({ message: "The last active admin account cannot be deleted." });
      }
    }
    let ambulanceDocuments = [];
    if (user.role === "ambulance") {
      const [profiles] = await connection.execute(
        `SELECT nid_photo_path, licence_photo_path
         FROM ambulance_profiles WHERE user_id = ? FOR UPDATE`,
        [userId],
      );
      ambulanceDocuments = profiles.flatMap((profile) => [
        profile.nid_photo_path,
        profile.licence_photo_path,
      ]);
    }
    await connection.execute("DELETE FROM users WHERE id = ?", [userId]);
    await connection.commit();
    disconnectUserSockets(userId);
    await removeAmbulanceDocuments(ambulanceDocuments);
    return response.json({ message: "User deleted." });
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_ROW_IS_REFERENCED_2") {
      return response.status(409).json({
        message: "This patient has trip history and cannot be deleted without removing those records. Suspend the account instead.",
      });
    }
    return next(error);
  } finally {
    connection.release();
  }
});

router.get("/trips", async (request, response, next) => {
  const page = Number(request.query.page ?? 1);
  const limit = Number(request.query.limit ?? 25);
  const status = typeof request.query.status === "string" ? request.query.status : "";
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return response.status(400).json({ message: "Page or page size is invalid." });
  }
  if (status && !tripStatuses.includes(status)) {
    return response.status(400).json({ message: "Choose a valid trip status." });
  }

  const where = status ? "WHERE r.status = ?" : "";
  const values = status ? [status] : [];
  try {
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS count FROM ambulance_requests r ${where}`,
      values,
    );
    const offset = (page - 1) * limit;
    const [trips] = await pool.execute(
      `SELECT r.id, r.patient_name AS patientName, r.patient_phone AS patientPhone,
        r.request_source AS requestSource, h.name AS hospitalName,
        r.current_location AS currentLocation, r.destination,
        r.ambulance_type AS ambulanceType, r.status,
        r.estimated_distance_km AS estimatedDistanceKm,
        r.fare_rate_per_km AS fareRatePerKm,
        r.fare_amount AS fareAmount,
        r.payment_method AS paymentMethod,
        r.payment_status AS paymentStatus,
        r.cash_collected_at AS cashCollectedAt,
        r.created_at AS createdAt,
        d.name AS dispatcherName,
        a.driver_name AS driverName, a.vehicle_number AS vehicleNumber
       FROM ambulance_requests r
       LEFT JOIN hospital_partners h ON h.id = r.hospital_id
       LEFT JOIN users d ON d.id = r.dispatcher_id
       LEFT JOIN ambulance_profiles a ON a.user_id = r.ambulance_id
       ${where}
       ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`,
      [...values, limit, offset],
    );
    return response.json({
      trips: trips.map((trip) => ({ ...trip, id: String(trip.id) })),
      pagination: {
        page,
        limit,
        total: Number(countRows[0].count),
        pages: Math.ceil(Number(countRows[0].count) / limit),
      },
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
