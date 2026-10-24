import { Router } from "express";
import pool from "../config/database.js";
import { authenticate, requireRole } from "../middleware/authenticate.js";
import { emitTripUpdate } from "../services/realtime.js";
import { createFareQuote, FareQuoteError, verifyFareQuote } from "../services/fare.js";

const router = Router();
const phonePattern = /^\+?[0-9\s().-]{7,32}$/;
const ambulanceTypes = ["basic", "icu", "freezer"];
const activeStatuses = [
  "searching",
  "requested_to_ambulance",
  "accepted",
  "picked_up",
  "at_hospital",
];

function handleRequestReadError(error, response, next) {
  if (error.code === "ER_BAD_FIELD_ERROR") {
    console.error("Patient requests could not be loaded because the database schema is outdated.");
    return response.status(503).json({
      message: "The database is missing the latest trip and fare columns. Back up the database, import server/database/schema.sql into the existing emergency_care database, then restart the API.",
    });
  }
  return next(error);
}

router.use(authenticate, requireRole("patient"));

router.get("/profile", async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, name, email, phone, created_at AS createdAt
       FROM users WHERE id = ? AND role = 'patient' LIMIT 1`,
      [request.user.id],
    );
    if (!rows[0]) {
      return response.status(404).json({ message: "Patient profile not found." });
    }
    return response.json({
      profile: { ...rows[0], id: String(rows[0].id) },
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/profile", async (request, response, next) => {
  const { name, phone } = request.body ?? {};
  if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 120) {
    return response.status(400).json({ message: "Name must be between 2 and 120 characters." });
  }
  if (typeof phone !== "string" || !phonePattern.test(phone.trim())) {
    return response.status(400).json({ message: "Enter a valid phone number." });
  }
  const digitCount = phone.trim().replace(/\D/g, "").length;
  if (digitCount < 7 || digitCount > 15) {
    return response.status(400).json({ message: "Phone number must contain 7 to 15 digits." });
  }

  try {
    await pool.execute(
      `UPDATE users SET name = ?, phone = ?
       WHERE id = ? AND role = 'patient'`,
      [name.trim(), phone.trim(), request.user.id],
    );
    return response.json({
      message: "Profile updated.",
      profile: {
        id: request.user.id,
        name: name.trim(),
        email: request.user.email,
        phone: phone.trim(),
      },
    });
  } catch (error) {
    return next(error);
  }
});

const requestSelect = `
  SELECT r.id, r.patient_name AS patientName, r.patient_phone AS patientPhone,
    r.symptoms, r.current_location AS currentLocation,
    r.current_latitude AS currentLatitude,
    r.current_longitude AS currentLongitude,
    r.destination, r.destination_latitude AS destinationLatitude,
    r.destination_longitude AS destinationLongitude,
    r.ambulance_type AS ambulanceType, r.status,
    r.estimated_distance_km AS estimatedDistanceKm,
    r.fare_rate_per_km AS fareRatePerKm,
    r.fare_amount AS fareAmount,
    r.payment_method AS paymentMethod,
    r.payment_status AS paymentStatus,
    r.cash_collected_at AS cashCollectedAt,
    r.created_at AS createdAt, r.updated_at AS updatedAt,
    ap.driver_name AS driverName, ap.vehicle_number AS vehicleNumber,
    au.phone AS driverPhone,
    du.name AS dispatcherName,
    loc.latitude AS ambulanceLatitude,
    loc.longitude AS ambulanceLongitude,
    loc.recorded_at AS ambulanceLocationUpdatedAt
  FROM ambulance_requests r
  LEFT JOIN ambulance_profiles ap ON ap.user_id = r.ambulance_id
  LEFT JOIN users au ON au.id = ap.user_id
  LEFT JOIN users du ON du.id = r.dispatcher_id
  LEFT JOIN ambulance_locations loc
    ON loc.id = (
      SELECT l.id
      FROM ambulance_locations l
      WHERE l.ambulance_id = r.ambulance_id
      ORDER BY l.recorded_at DESC, l.id DESC
      LIMIT 1
    )
`;

router.get("/requests", async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `${requestSelect}
       WHERE r.patient_id = ?
       ORDER BY r.created_at DESC, r.id DESC`,
      [request.user.id],
    );
    return response.json({
      requests: rows.map((item) => ({ ...item, id: String(item.id) })),
    });
  } catch (error) {
    return handleRequestReadError(error, response, next);
  }
});

router.post("/fare-estimate", async (request, response) => {
  const { currentLatitude, currentLongitude, destination, ambulanceType } = request.body ?? {};
  if (
    typeof currentLatitude !== "number" ||
    !Number.isFinite(currentLatitude) ||
    currentLatitude < -90 ||
    currentLatitude > 90 ||
    typeof currentLongitude !== "number" ||
    !Number.isFinite(currentLongitude) ||
    currentLongitude < -180 ||
    currentLongitude > 180
  ) {
    return response.status(400).json({ message: "Capture or enter valid pickup coordinates before estimating the fare." });
  }
  if (typeof destination !== "string" || destination.trim().length < 3 || destination.trim().length > 500) {
    return response.status(400).json({ message: "Enter a destination between 3 and 500 characters." });
  }
  if (!ambulanceTypes.includes(ambulanceType)) {
    return response.status(400).json({ message: "Choose Basic, ICU, or Freezer ambulance type." });
  }

  try {
    const quote = await createFareQuote({
      userId: request.user.id,
      pickupLatitude: currentLatitude,
      pickupLongitude: currentLongitude,
      destination,
      ambulanceType,
    });
    return response.json(quote);
  } catch (error) {
    console.error("Ambulance fare estimate failed:", error.message);
    return response.status(502).json({
      message: `${error instanceof FareQuoteError
        ? error.message
        : "The place-name, routing, or fare service is unavailable right now."
      } The request was not submitted.`,
    });
  }
});

router.post("/requests", async (request, response, next) => {
  const {
    symptoms,
    currentLocation,
    currentLatitude,
    currentLongitude,
    destination,
    destinationLatitude,
    destinationLongitude,
    ambulanceType,
    fareQuoteToken,
  } = request.body ?? {};

  if (typeof symptoms !== "string" || symptoms.trim().length < 3 || symptoms.trim().length > 2000) {
    return response.status(400).json({ message: "Describe the symptoms in 3 to 2,000 characters." });
  }
  if (
    typeof currentLocation !== "string" ||
    currentLocation.trim().length < 3 ||
    currentLocation.trim().length > 500
  ) {
    return response.status(400).json({ message: "Enter a current location between 3 and 500 characters." });
  }
  if (
    typeof destination !== "string" ||
    destination.trim().length < 3 ||
    destination.trim().length > 500
  ) {
    return response.status(400).json({ message: "Enter a destination between 3 and 500 characters." });
  }
  if (
    typeof currentLatitude !== "number" ||
    !Number.isFinite(currentLatitude) ||
    currentLatitude < -90 ||
    currentLatitude > 90 ||
    typeof currentLongitude !== "number" ||
    !Number.isFinite(currentLongitude) ||
    currentLongitude < -180 ||
    currentLongitude > 180
  ) {
    return response.status(400).json({ message: "Capture or enter valid current-location coordinates." });
  }
  if (!ambulanceTypes.includes(ambulanceType)) {
    return response.status(400).json({ message: "Choose Basic, ICU, or Freezer ambulance type." });
  }
  const hasDestinationCoordinates =
    typeof destinationLatitude === "number" &&
    Number.isFinite(destinationLatitude) &&
    destinationLatitude >= -90 &&
    destinationLatitude <= 90 &&
    typeof destinationLongitude === "number" &&
    Number.isFinite(destinationLongitude) &&
    destinationLongitude >= -180 &&
    destinationLongitude <= 180;
  if (
    (destinationLatitude !== undefined || destinationLongitude !== undefined) &&
    !hasDestinationCoordinates
  ) {
    return response.status(400).json({ message: "Destination coordinates must both be valid when provided." });
  }
  const fareQuote = typeof fareQuoteToken === "string" && fareQuoteToken
    ? verifyFareQuote(fareQuoteToken, request.user.id, {
      currentLatitude,
      currentLongitude,
      destination,
      ambulanceType,
    })
    : null;
  if (
    (fareQuoteToken && !fareQuote) ||
    (fareQuote && (
      fareQuote.destinationLatitude !== destinationLatitude ||
      fareQuote.destinationLongitude !== destinationLongitude
    ))
  ) {
    return response.status(409).json({ message: "The fare estimate expired or no longer matches this request. Calculate it again." });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [patients] = await connection.execute(
      `SELECT name, phone FROM users
       WHERE id = ? AND role = 'patient' AND account_status = 'active'
       FOR UPDATE`,
      [request.user.id],
    );
    const patient = patients[0];
    if (!patient) {
      await connection.rollback();
      return response.status(404).json({ message: "Patient profile not found." });
    }

    const placeholders = activeStatuses.map(() => "?").join(", ");
    const [activeRequests] = await connection.execute(
      `SELECT id, status FROM ambulance_requests
       WHERE patient_id = ? AND status IN (${placeholders})
       LIMIT 1`,
      [request.user.id, ...activeStatuses],
    );
    if (activeRequests.length > 0) {
      await connection.rollback();
      return response.status(409).json({
        message: "You already have an active request. Check its status before creating another.",
        activeRequest: {
          id: String(activeRequests[0].id),
          status: activeRequests[0].status,
        },
      });
    }

    const [result] = await connection.execute(
      `INSERT INTO ambulance_requests (
        patient_id, patient_name, patient_phone, symptoms,
        current_location, current_latitude, current_longitude,
        destination, destination_latitude, destination_longitude,
        ambulance_type, estimated_distance_km, fare_rate_per_km, fare_amount,
        payment_method, payment_status, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cash', ?, 'searching')`,
      [
        request.user.id,
        patient.name,
        patient.phone,
        symptoms.trim(),
        currentLocation.trim(),
        currentLatitude,
        currentLongitude,
        destination.trim(),
        fareQuote?.destinationLatitude ?? null,
        fareQuote?.destinationLongitude ?? null,
        ambulanceType,
        fareQuote?.distanceKm ?? null,
        fareQuote?.ratePerKm ?? null,
        fareQuote?.fareAmount ?? null,
        fareQuote ? "pending" : "not_required",
      ],
    );

    await connection.commit();
    emitTripUpdate(String(result.insertId), {
      status: "searching",
    });
    return response.status(201).json({
      message: fareQuote
        ? `Ambulance request submitted. Estimated cash fare: ৳${fareQuote.fareAmount} for ${fareQuote.distanceKm} km. A dispatcher will assign the closest available ambulance.`
        : "Ambulance request submitted without a route-based fare estimate. Agree on the cash fare directly with the assigned driver before travel.",
      requestId: String(result.insertId),
      fareAmount: fareQuote?.fareAmount ?? null,
      distanceKm: fareQuote?.distanceKm ?? null,
    });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
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
       WHERE r.patient_id = ? AND r.id = ?
       LIMIT 1`,
      [request.user.id, requestId],
    );
    if (!rows[0]) {
      return response.status(404).json({ message: "Request not found." });
    }
    return response.json({
      request: { ...rows[0], id: String(rows[0].id) },
    });
  } catch (error) {
    return handleRequestReadError(error, response, next);
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
       WHERE id = ? AND patient_id = ?
         AND status IN ('searching', 'requested_to_ambulance')`,
      [requestId, request.user.id],
    );
    if (result.affectedRows === 0) {
      return response.status(409).json({
        message: "This request cannot be cancelled now. Contact the dispatcher if help is already on the way.",
      });
    }
    emitTripUpdate(requestId, { status: "cancelled" });
    return response.json({ message: "Request cancelled." });
  } catch (error) {
    return next(error);
  }
});

export default router;
