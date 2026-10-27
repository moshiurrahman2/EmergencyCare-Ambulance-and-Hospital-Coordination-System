import { Router } from "express";
import pool from "../config/database.js";
import { authenticateHospital } from "../middleware/authenticateHospital.js";
import { emitTripUpdate } from "../services/realtime.js";

const router = Router();
const ambulanceTypes = ["basic", "icu", "freezer"];
const requestSelect = `
  SELECT r.id, r.patient_name AS patientName, r.patient_phone AS patientPhone,
    r.symptoms, r.current_location AS pickupLocation,
    r.current_latitude AS pickupLatitude, r.current_longitude AS pickupLongitude,
    r.destination, r.ambulance_type AS ambulanceType, r.status,
    r.created_at AS createdAt, r.updated_at AS updatedAt,
    ap.driver_name AS driverName, ap.vehicle_number AS vehicleNumber,
    u.phone AS driverPhone,
    loc.latitude AS ambulanceLatitude, loc.longitude AS ambulanceLongitude,
    loc.recorded_at AS ambulanceLocationUpdatedAt
  FROM ambulance_requests r
  LEFT JOIN ambulance_profiles ap ON ap.user_id = r.ambulance_id
  LEFT JOIN users u ON u.id = ap.user_id
  LEFT JOIN ambulance_locations loc
    ON loc.id = (
      SELECT l.id FROM ambulance_locations l
      WHERE l.ambulance_id = r.ambulance_id
      ORDER BY l.recorded_at DESC, l.id DESC LIMIT 1
    )
`;

router.use(authenticateHospital);

function isValidCoordinate(value, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value) &&
    value >= minimum && value <= maximum;
}

function validateRequest(body) {
  if (
    typeof body.patientName !== "string" ||
    body.patientName.trim().length < 2 ||
    body.patientName.trim().length > 120
  ) {
    return "Patient name must be between 2 and 120 characters.";
  }
  if (typeof body.patientPhone !== "string" || body.patientPhone.trim().length > 32) {
    return "Enter a valid patient phone number.";
  }
  const phoneDigits = body.patientPhone.replace(/\D/g, "");
  if (phoneDigits.length < 7 || phoneDigits.length > 15) {
    return "Patient phone number must contain 7 to 15 digits.";
  }
  if (
    typeof body.symptoms !== "string" ||
    body.symptoms.trim().length < 3 ||
    body.symptoms.trim().length > 2000
  ) {
    return "Symptoms must be between 3 and 2,000 characters.";
  }
  if (
    typeof body.pickupLocation !== "string" ||
    body.pickupLocation.trim().length < 3 ||
    body.pickupLocation.trim().length > 500
  ) {
    return "Pickup location must be between 3 and 500 characters.";
  }
  if (
    !isValidCoordinate(body.pickupLatitude, -90, 90) ||
    !isValidCoordinate(body.pickupLongitude, -180, 180)
  ) {
    return "Enter valid pickup latitude and longitude coordinates.";
  }
  if (!ambulanceTypes.includes(body.ambulanceType)) {
    return "Choose Basic, ICU, or Freezer ambulance type.";
  }
  return null;
}

router.get("/requests", async (request, response, next) => {
  const rawLimit = request.query.limit;
  const limit = rawLimit === undefined
    ? 50
    : typeof rawLimit === "string" && /^\d+$/.test(rawLimit)
      ? Number(rawLimit)
      : Number.NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return response.status(400).json({ message: "Limit must be a whole number between 1 and 100." });
  }

  try {
    const [rows] = await pool.execute(
      `${requestSelect}
       WHERE r.hospital_id = ? AND r.request_source = 'hospital'
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ?`,
      [request.hospital.id, limit],
    );
    return response.json({
      requests: rows.map((row) => ({
        ...row,
        id: String(row.id),
        pickupLatitude: Number(row.pickupLatitude),
        pickupLongitude: Number(row.pickupLongitude),
        ambulanceLatitude: row.ambulanceLatitude === null
          ? null
          : Number(row.ambulanceLatitude),
        ambulanceLongitude: row.ambulanceLongitude === null
          ? null
          : Number(row.ambulanceLongitude),
      })),
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/requests", async (request, response, next) => {
  const validationError = validateRequest(request.body ?? {});
  if (validationError) {
    return response.status(400).json({ message: validationError });
  }

  const body = request.body;
  try {
    const [result] = await pool.execute(
      `INSERT INTO ambulance_requests (
        patient_id, hospital_id, request_source, patient_name, patient_phone, symptoms,
        current_location, current_latitude, current_longitude,
        destination, destination_latitude, destination_longitude,
        ambulance_type, payment_status, status
      ) VALUES (NULL, ?, 'hospital', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_required', 'searching')`,
      [
        request.hospital.id,
        body.patientName.trim(),
        body.patientPhone.trim(),
        body.symptoms.trim(),
        body.pickupLocation.trim(),
        body.pickupLatitude,
        body.pickupLongitude,
        request.hospital.address,
        request.hospital.latitude,
        request.hospital.longitude,
        body.ambulanceType,
      ],
    );

    const requestId = String(result.insertId);
    emitTripUpdate(requestId, { status: "searching" });
    return response.status(201).json({
      message: "Hospital ambulance request submitted to the dispatcher queue.",
      requestId,
      status: "searching",
      destination: request.hospital.address,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/requests/:requestId", async (request, response, next) => {
  const { requestId } = request.params;
  if (!/^\d+$/.test(requestId)) {
    return response.status(400).json({ message: "The request ID is invalid." });
  }

  try {
    const [rows] = await pool.execute(
      `${requestSelect}
       WHERE r.id = ? AND r.hospital_id = ? AND r.request_source = 'hospital'
       LIMIT 1`,
      [requestId, request.hospital.id],
    );
    if (!rows[0]) {
      return response.status(404).json({ message: "Hospital request not found." });
    }
    const item = rows[0];
    return response.json({
      request: {
        ...item,
        id: String(item.id),
        pickupLatitude: Number(item.pickupLatitude),
        pickupLongitude: Number(item.pickupLongitude),
        ambulanceLatitude: item.ambulanceLatitude === null
          ? null
          : Number(item.ambulanceLatitude),
        ambulanceLongitude: item.ambulanceLongitude === null
          ? null
          : Number(item.ambulanceLongitude),
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/requests/:requestId/cancel", async (request, response, next) => {
  const { requestId } = request.params;
  if (!/^\d+$/.test(requestId)) {
    return response.status(400).json({ message: "The request ID is invalid." });
  }

  try {
    const [result] = await pool.execute(
      `UPDATE ambulance_requests SET status = 'cancelled'
       WHERE id = ? AND hospital_id = ? AND request_source = 'hospital'
         AND status = 'searching' AND dispatcher_id IS NULL`,
      [requestId, request.hospital.id],
    );
    if (result.affectedRows === 0) {
      return response.status(409).json({
        message: "This request can no longer be cancelled through the hospital API.",
      });
    }
    emitTripUpdate(requestId, { status: "cancelled" });
    return response.json({ message: "Hospital ambulance request cancelled." });
  } catch (error) {
    return next(error);
  }
});

export default router;
