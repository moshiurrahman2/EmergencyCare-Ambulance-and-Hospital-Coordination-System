import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import multer from "multer";
import pool from "../config/database.js";
import { authenticate, requireRole } from "../middleware/authenticate.js";
import { emitTripUpdate } from "../services/realtime.js";

const router = Router();
const uploadDirectory = fileURLToPath(
  new URL("../../uploads/ambulance-documents/", import.meta.url),
);
const maxPhotoBytes = 5 * 1024 * 1024;
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxPhotoBytes,
    files: 2,
    fields: 10,
    parts: 12,
  },
  fileFilter(_request, file, callback) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      callback(new Error("Upload NID and licence photos as JPG, PNG, or WebP images."));
      return;
    }
    callback(null, true);
  },
});
const activeTripStatuses = ["accepted", "picked_up", "at_hospital"];
const fieldRules = {
  driverName: { label: "Driver name", min: 2, max: 120 },
  vehicleNumber: { label: "Vehicle number", min: 2, max: 32 },
  permanentAddress: { label: "Permanent address", min: 3, max: 500 },
  presentAddress: { label: "Present address", min: 3, max: 500 },
  phone: { label: "Phone number", min: 7, max: 32 },
  nidNumber: { label: "NID number", min: 3, max: 64 },
  drivingLicenceNumber: { label: "Driving licence number", min: 3, max: 64 },
};

router.use(authenticate, requireRole("ambulance"));

function receivePhotos(request, response, next) {
  photoUpload.fields([
    { name: "nidPhoto", maxCount: 1 },
    { name: "licencePhoto", maxCount: 1 },
  ])(request, response, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      return response.status(status).json({
        message: error.code === "LIMIT_FILE_SIZE"
          ? "Each document photo must be 5 MB or smaller."
          : "Upload no more than one NID photo and one driving licence photo.",
      });
    }
    return response.status(400).json({ message: error.message });
  });
}

function imageExtension(buffer) {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return ".jpg";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return ".png";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return ".webp";
  }
  return null;
}

function validateFields(body) {
  for (const [key, rule] of Object.entries(fieldRules)) {
    const value = body[key];
    if (
      typeof value !== "string" ||
      value.trim().length < rule.min ||
      value.trim().length > rule.max
    ) {
      return `${rule.label} must be between ${rule.min} and ${rule.max} characters.`;
    }
  }
  const digits = body.phone.trim().replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    return "Phone number must contain 7 to 15 digits.";
  }
  return null;
}

function profileView(profile) {
  if (!profile) return null;
  return {
    driverName: profile.driver_name,
    vehicleNumber: profile.vehicle_number,
    permanentAddress: profile.permanent_address,
    presentAddress: profile.present_address,
    phone: profile.phone,
    nidNumber: profile.nid_number,
    drivingLicenceNumber: profile.driving_licence_number,
    approvalStatus: profile.approval_status,
    approvalReason: profile.approval_reason,
    isOnline: Boolean(profile.is_online),
    hasNidPhoto: Boolean(profile.nid_photo_path),
    hasLicencePhoto: Boolean(profile.licence_photo_path),
  };
}

async function savePhoto(file) {
  if (!file) return null;
  const extension = imageExtension(file.buffer);
  if (!extension) {
    const error = new Error("The uploaded document is not a valid JPG, PNG, or WebP image.");
    error.status = 400;
    throw error;
  }
  const filename = `${randomUUID()}${extension}`;
  await mkdir(uploadDirectory, { recursive: true });
  await writeFile(path.join(uploadDirectory, filename), file.buffer, { flag: "wx" });
  return filename;
}

async function removeUploadedFiles(filenames) {
  for (const filename of filenames) {
    try {
      await unlink(path.join(uploadDirectory, filename));
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.error("Could not remove an uncommitted ambulance document:", error.message);
      }
    }
  }
}

router.get("/profile", async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      "SELECT * FROM ambulance_profiles WHERE user_id = ? LIMIT 1",
      [request.user.id],
    );
    return response.json({ profile: profileView(rows[0]) });
  } catch (error) {
    return next(error);
  }
});

router.put("/profile", receivePhotos, async (request, response, next) => {
  const validationError = validateFields(request.body ?? {});
  if (validationError) {
    return response.status(400).json({ message: validationError });
  }

  const nidPhoto = request.files?.nidPhoto?.[0];
  const licencePhoto = request.files?.licencePhoto?.[0];
  const savedFiles = [];
  let connection;
  try {
    if (!nidPhoto || !licencePhoto) {
      return response.status(400).json({
        message: "Upload both your NID photo and driving licence photo.",
      });
    }

    const nidFilename = await savePhoto(nidPhoto);
    savedFiles.push(nidFilename);
    const licenceFilename = await savePhoto(licencePhoto);
    savedFiles.push(licenceFilename);

    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [users] = await connection.execute(
      "SELECT role FROM users WHERE id = ? AND account_status = 'active' FOR UPDATE",
      [request.user.id],
    );
    if (!users[0] || users[0].role !== "ambulance") {
      await connection.rollback();
      await removeUploadedFiles(savedFiles);
      return response.status(403).json({ message: "An active ambulance account is required." });
    }

    const [existingProfiles] = await connection.execute(
      "SELECT approval_status, is_online FROM ambulance_profiles WHERE user_id = ? FOR UPDATE",
      [request.user.id],
    );
    const existingProfile = existingProfiles[0];
    if (existingProfile?.approval_status === "approved") {
      await connection.rollback();
      await removeUploadedFiles(savedFiles);
      return response.status(409).json({
        message: "Your approved profile cannot be changed here. Contact an administrator if it needs correction.",
      });
    }

    const [oldPhotos] = await connection.execute(
      `SELECT nid_photo_path, licence_photo_path
       FROM ambulance_profiles WHERE user_id = ? LIMIT 1`,
      [request.user.id],
    );
    const [result] = await connection.execute(
      `INSERT INTO ambulance_profiles (
        user_id, driver_name, vehicle_number, permanent_address, present_address,
        phone, nid_number, driving_licence_number, nid_photo_path,
        licence_photo_path, approval_status, approval_reason, is_online,
        reviewed_by, reviewed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, FALSE, NULL, NULL)
      ON DUPLICATE KEY UPDATE
        driver_name = VALUES(driver_name),
        vehicle_number = VALUES(vehicle_number),
        permanent_address = VALUES(permanent_address),
        present_address = VALUES(present_address),
        phone = VALUES(phone),
        nid_number = VALUES(nid_number),
        driving_licence_number = VALUES(driving_licence_number),
        nid_photo_path = VALUES(nid_photo_path),
        licence_photo_path = VALUES(licence_photo_path),
        approval_status = 'pending',
        approval_reason = NULL,
        is_online = FALSE,
        reviewed_by = NULL,
        reviewed_at = NULL`,
      [
        request.user.id,
        request.body.driverName.trim(),
        request.body.vehicleNumber.trim(),
        request.body.permanentAddress.trim(),
        request.body.presentAddress.trim(),
        request.body.phone.trim(),
        request.body.nidNumber.trim(),
        request.body.drivingLicenceNumber.trim(),
        nidFilename,
        licenceFilename,
      ],
    );
    await connection.execute(
      "UPDATE users SET name = ?, phone = ? WHERE id = ?",
      [request.body.driverName.trim(), request.body.phone.trim(), request.user.id],
    );
    await connection.commit();

    for (const oldPhoto of oldPhotos) {
      await removeUploadedFiles([oldPhoto.nid_photo_path, oldPhoto.licence_photo_path].filter(Boolean));
    }
    return response.status(existingProfile ? 200 : 201).json({
      message: "Profile submitted. It will remain offline until an administrator approves it.",
      profile: {
        driverName: request.body.driverName.trim(),
        vehicleNumber: request.body.vehicleNumber.trim(),
        permanentAddress: request.body.permanentAddress.trim(),
        presentAddress: request.body.presentAddress.trim(),
        phone: request.body.phone.trim(),
        nidNumber: request.body.nidNumber.trim(),
        drivingLicenceNumber: request.body.drivingLicenceNumber.trim(),
        approvalStatus: "pending",
        approvalReason: null,
        isOnline: false,
        hasNidPhoto: true,
        hasLicencePhoto: true,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    await removeUploadedFiles(savedFiles);
    if (error.code === "ER_DUP_ENTRY") {
      return response.status(409).json({ message: "That vehicle number is already registered." });
    }
    return next(error);
  } finally {
    connection?.release();
  }
});

router.get("/work", async (request, response, next) => {
  try {
    const [profiles] = await pool.execute(
      `SELECT approval_status, approval_reason, is_online
       FROM ambulance_profiles WHERE user_id = ? LIMIT 1`,
      [request.user.id],
    );
    const profile = profiles[0];
    if (!profile || profile.approval_status !== "approved") {
      return response.json({
        activeTrip: null,
      });
    }

    const activePlaceholders = activeTripStatuses.map(() => "?").join(", ");
    const [activeRows] = await pool.execute(
      `SELECT r.id, r.patient_name AS patientName, r.patient_phone AS patientPhone,
        r.symptoms, r.current_location AS currentLocation,
        r.current_latitude AS currentLatitude,
        r.current_longitude AS currentLongitude,
        r.destination, r.ambulance_type AS ambulanceType,
        r.estimated_distance_km AS estimatedDistanceKm,
        r.fare_rate_per_km AS fareRatePerKm,
        r.fare_amount AS fareAmount,
        r.payment_method AS paymentMethod,
        r.payment_status AS paymentStatus,
        r.cash_collected_at AS cashCollectedAt,
        r.status, r.created_at AS createdAt
       FROM ambulance_requests r
       WHERE r.ambulance_id = ? AND r.dispatcher_id IS NOT NULL
         AND r.status IN (${activePlaceholders})
       ORDER BY r.updated_at DESC, r.id DESC
       LIMIT 1`,
      [request.user.id, ...activeTripStatuses],
    );
    const [pendingCashRows] = await pool.execute(
      `SELECT r.id, r.destination, r.ambulance_type AS ambulanceType,
        r.estimated_distance_km AS estimatedDistanceKm,
        r.fare_rate_per_km AS fareRatePerKm,
        r.fare_amount AS fareAmount,
        r.payment_status AS paymentStatus
       FROM ambulance_requests r
       WHERE r.ambulance_id = ? AND r.dispatcher_id IS NOT NULL
         AND r.status = 'completed' AND r.payment_status = 'pending'
       ORDER BY r.updated_at DESC, r.id DESC
       LIMIT 1`,
      [request.user.id],
    );
    return response.json({
      activeTrip: activeRows[0]
        ? { ...activeRows[0], id: String(activeRows[0].id) }
        : null,
      pendingCashTrip: pendingCashRows[0]
        ? { ...pendingCashRows[0], id: String(pendingCashRows[0].id) }
        : null,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/activity", async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT r.id, r.patient_name AS patientName, r.patient_phone AS patientPhone,
        r.symptoms, r.current_location AS currentLocation, r.destination,
        r.ambulance_type AS ambulanceType, r.status,
        r.estimated_distance_km AS estimatedDistanceKm,
        r.fare_rate_per_km AS fareRatePerKm,
        r.fare_amount AS fareAmount,
        r.payment_method AS paymentMethod,
        r.payment_status AS paymentStatus,
        r.cash_collected_at AS cashCollectedAt,
        r.created_at AS createdAt, r.updated_at AS updatedAt
       FROM ambulance_requests r
       WHERE r.ambulance_id = ? AND r.dispatcher_id IS NOT NULL
       ORDER BY r.updated_at DESC, r.id DESC
       LIMIT 100`,
      [request.user.id],
    );
    return response.json({
      activity: rows.map((item) => ({ ...item, id: String(item.id) })),
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/availability", async (request, response, next) => {
  const { isOnline, latitude, longitude } = request.body ?? {};
  if (typeof isOnline !== "boolean") {
    return response.status(400).json({ message: "Choose whether you want to go online or offline." });
  }
  if (
    isOnline &&
    (
      typeof latitude !== "number" ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      typeof longitude !== "number" ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    )
  ) {
    return response.status(400).json({ message: "A valid current location is required to go online." });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [profiles] = await connection.execute(
      `SELECT approval_status, is_online
       FROM ambulance_profiles WHERE user_id = ? FOR UPDATE`,
      [request.user.id],
    );
    const profile = profiles[0];
    if (!profile) {
      await connection.rollback();
      return response.status(409).json({ message: "Submit your ambulance profile before setting availability." });
    }
    if (profile.approval_status !== "approved") {
      await connection.rollback();
      return response.status(403).json({ message: "Only an approved ambulance can go online." });
    }
    if (profile.is_online && !isOnline) {
      const activePlaceholders = activeTripStatuses.map(() => "?").join(", ");
      const [activeTrips] = await connection.execute(
        `SELECT id FROM ambulance_requests
         WHERE ambulance_id = ? AND dispatcher_id IS NOT NULL
           AND status IN (${activePlaceholders})
         LIMIT 1 FOR UPDATE`,
        [request.user.id, ...activeTripStatuses],
      );
      if (activeTrips.length > 0) {
        await connection.rollback();
        return response.status(409).json({
          message: "Finish your active trip before going offline.",
        });
      }
    }

    await connection.execute(
      "UPDATE ambulance_profiles SET is_online = ? WHERE user_id = ?",
      [isOnline, request.user.id],
    );
    if (isOnline) {
      await connection.execute(
        `INSERT INTO ambulance_locations (ambulance_id, latitude, longitude)
         VALUES (?, ?, ?)`,
        [request.user.id, latitude, longitude],
      );
    }
    await connection.commit();
    return response.json({
      message: isOnline ? "You are online and sharing your location." : "You are offline.",
      isOnline,
    });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
});

router.post("/location", async (request, response, next) => {
  const { latitude, longitude } = request.body ?? {};
  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return response.status(400).json({ message: "Enter valid latitude and longitude coordinates." });
  }

  try {
    const [profiles] = await pool.execute(
      `SELECT approval_status, is_online
       FROM ambulance_profiles WHERE user_id = ? LIMIT 1`,
      [request.user.id],
    );
    if (!profiles[0] || profiles[0].approval_status !== "approved") {
      return response.status(403).json({ message: "Only an approved ambulance can share its location." });
    }

    let mayShare = Boolean(profiles[0].is_online);
    if (!mayShare) {
      const activePlaceholders = activeTripStatuses.map(() => "?").join(", ");
      const [activeTrips] = await pool.execute(
        `SELECT id FROM ambulance_requests
         WHERE ambulance_id = ? AND dispatcher_id IS NOT NULL
           AND status IN (${activePlaceholders})
         LIMIT 1`,
        [request.user.id, ...activeTripStatuses],
      );
      mayShare = activeTrips.length > 0;
    }
    if (!mayShare) {
      return response.status(409).json({ message: "Go online before sharing your location." });
    }

    const [result] = await pool.execute(
      `INSERT INTO ambulance_locations (ambulance_id, latitude, longitude)
       VALUES (?, ?, ?)`,
      [request.user.id, latitude, longitude],
    );
    const [locationRows] = await pool.execute(
      `SELECT recorded_at AS locationUpdatedAt
       FROM ambulance_locations WHERE id = ? LIMIT 1`,
      [result.insertId],
    );
    const [trips] = await pool.execute(
      `SELECT id FROM ambulance_requests
       WHERE ambulance_id = ? AND dispatcher_id IS NOT NULL
         AND status IN ('accepted', 'picked_up', 'at_hospital')`,
      [request.user.id],
    );
    trips.forEach((trip) => emitTripUpdate(String(trip.id), {
      ambulanceLatitude: latitude,
      ambulanceLongitude: longitude,
      ambulanceLocationUpdatedAt: locationRows[0].locationUpdatedAt,
    }));
    return response.status(201).json({ message: "Location shared." });
  } catch (error) {
    return next(error);
  }
});

router.patch("/requests/:requestId/accept", (_request, response) =>
  response.status(403).json({
    message: "Ambulances cannot accept or decline requests. A dispatcher assigns the closest ambulance.",
  }),
);

router.patch("/requests/:requestId/decline", (_request, response) =>
  response.status(403).json({
    message: "Ambulances cannot accept or decline requests. A dispatcher assigns the closest ambulance.",
  }),
);

router.patch("/requests/:requestId/step", async (request, response, next) => {
  const { requestId } = request.params;
  const { status: nextStatus } = request.body ?? {};
  const nextStatuses = {
    accepted: "picked_up",
    picked_up: "at_hospital",
    at_hospital: "completed",
  };
  if (!/^\d+$/.test(requestId) || !Object.values(nextStatuses).includes(nextStatus)) {
    return response.status(400).json({ message: "Choose a valid next trip step." });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [profiles] = await connection.execute(
      `SELECT approval_status FROM ambulance_profiles
       WHERE user_id = ? FOR UPDATE`,
      [request.user.id],
    );
    if (profiles[0]?.approval_status !== "approved") {
      await connection.rollback();
      return response.status(403).json({ message: "Only an approved ambulance can update trip steps." });
    }

    const [requests] = await connection.execute(
      `SELECT id, status FROM ambulance_requests
       WHERE id = ? AND ambulance_id = ? AND dispatcher_id IS NOT NULL
       FOR UPDATE`,
      [requestId, request.user.id],
    );
    const trip = requests[0];
    if (!trip) {
      await connection.rollback();
      return response.status(404).json({ message: "Active trip not found." });
    }
    if (nextStatuses[trip.status] !== nextStatus) {
      await connection.rollback();
      return response.status(409).json({ message: "Trip steps must be completed in order." });
    }

    await connection.execute(
      `UPDATE ambulance_requests SET status = ? WHERE id = ?`,
      [nextStatus, requestId],
    );
    await connection.commit();
    emitTripUpdate(requestId, { status: nextStatus });
    return response.json({ message: `Trip updated: ${nextStatus.replaceAll("_", " ")}.`, status: nextStatus });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
});

router.patch("/requests/:requestId/cash-collected", async (request, response, next) => {
  const { requestId } = request.params;
  if (!/^\d+$/.test(requestId)) {
    return response.status(400).json({ message: "The trip ID is invalid." });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [profiles] = await connection.execute(
      `SELECT approval_status FROM ambulance_profiles
       WHERE user_id = ? FOR UPDATE`,
      [request.user.id],
    );
    if (profiles[0]?.approval_status !== "approved") {
      await connection.rollback();
      return response.status(403).json({ message: "Only an approved ambulance can record cash collection." });
    }

    const [trips] = await connection.execute(
      `SELECT id, status, payment_status FROM ambulance_requests
       WHERE id = ? AND ambulance_id = ? AND dispatcher_id IS NOT NULL
       FOR UPDATE`,
      [requestId, request.user.id],
    );
    const trip = trips[0];
    if (!trip) {
      await connection.rollback();
      return response.status(404).json({ message: "Assigned trip not found." });
    }
    if (trip.status !== "completed") {
      await connection.rollback();
      return response.status(409).json({ message: "Cash can only be recorded after the trip is completed." });
    }
    if (trip.payment_status !== "pending") {
      await connection.rollback();
      return response.status(409).json({
        message: trip.payment_status === "paid"
          ? "Cash has already been recorded for this trip."
          : "This trip has no pending cash fare.",
      });
    }

    await connection.execute(
      `UPDATE ambulance_requests
       SET payment_status = 'paid', cash_collected_at = CURRENT_TIMESTAMP
       WHERE id = ? AND payment_status = 'pending'`,
      [requestId],
    );
    const [updatedTrips] = await connection.execute(
      `SELECT cash_collected_at AS cashCollectedAt
       FROM ambulance_requests WHERE id = ? LIMIT 1`,
      [requestId],
    );
    await connection.commit();
    emitTripUpdate(requestId, {
      paymentStatus: "paid",
      cashCollectedAt: updatedTrips[0].cashCollectedAt,
    });
    return response.json({
      message: "Cash collection recorded. Confirm this only after receiving the cash.",
      paymentStatus: "paid",
      cashCollectedAt: updatedTrips[0].cashCollectedAt,
    });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
});

export default router;
