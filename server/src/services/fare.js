import jwt from "jsonwebtoken";
import pool from "../config/database.js";
import { geocodeAddress } from "./reverseGeocoding.js";

const ratesByType = {
  basic: "basic_per_km",
  icu: "icu_per_km",
  freezer: "freezer_per_km",
};

export class FareQuoteError extends Error {}

export function calculateFare(distanceKm, ratePerKm) {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
    throw new Error("A positive route distance is required to calculate a fare.");
  }
  if (!Number.isFinite(ratePerKm) || ratePerKm <= 0) {
    throw new Error("A positive per-kilometer rate is required to calculate a fare.");
  }
  const roundedDistanceKm = Math.round(distanceKm * 100) / 100;
  return {
    distanceKm: roundedDistanceKm,
    fareAmount: Math.round(roundedDistanceKm * ratePerKm),
  };
}

export async function createFareQuote({
  userId,
  pickupLatitude,
  pickupLongitude,
  destination,
  ambulanceType,
}) {
  const rateColumn = ratesByType[ambulanceType];
  if (!rateColumn) {
    throw new FareQuoteError("Choose a valid ambulance type before calculating the fare.");
  }

  const destinationCoordinates = await geocodeAddress(destination);
  if (!destinationCoordinates) {
    throw new FareQuoteError("The destination could not be located in Bangladesh. Check the address and try again.");
  }

  const routeUrl = new URL(
    `https://router.project-osrm.org/route/v1/driving/${pickupLongitude},${pickupLatitude};${destinationCoordinates.longitude},${destinationCoordinates.latitude}`,
  );
  routeUrl.search = new URLSearchParams({
    overview: "false",
    steps: "false",
  }).toString();
  const response = await fetch(routeUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent": "EmergencyCare/1.0 (emergency response coordination application)",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new FareQuoteError("The road-routing service is unavailable right now.");
  }
  const routeResult = await response.json();
  const routeDistanceMeters = routeResult.routes?.[0]?.distance;
  if (routeResult.code !== "Ok" || !Number.isFinite(routeDistanceMeters) || routeDistanceMeters <= 0) {
    throw new FareQuoteError("A road route could not be found for this pickup and destination.");
  }

  const [rateRows] = await pool.execute(
    `SELECT ${rateColumn} AS ratePerKm FROM fare_settings WHERE id = 1 LIMIT 1`,
  );
  const ratePerKm = Number(rateRows[0]?.ratePerKm);
  if (!Number.isFinite(ratePerKm) || ratePerKm <= 0) {
    throw new FareQuoteError("The ambulance fare rate is not configured. Contact the administrator.");
  }
  const { distanceKm, fareAmount } = calculateFare(routeDistanceMeters / 1000, ratePerKm);
  const quote = {
    patientId: String(userId),
    pickupLatitude,
    pickupLongitude,
    destination: destination.trim(),
    destinationLatitude: destinationCoordinates.latitude,
    destinationLongitude: destinationCoordinates.longitude,
    ambulanceType,
    distanceKm,
    ratePerKm,
    fareAmount,
    paymentMethod: "cash",
  };
  const quoteToken = jwt.sign(quote, process.env.JWT_SECRET, { expiresIn: "15m" });
  return {
    quoteToken,
    distanceKm,
    ratePerKm,
    fareAmount,
    paymentMethod: "cash",
    destinationLatitude: destinationCoordinates.latitude,
    destinationLongitude: destinationCoordinates.longitude,
    destinationDisplayName: destinationCoordinates.displayName,
  };
}

export function verifyFareQuote(quoteToken, userId, requestData) {
  let quote;
  try {
    quote = jwt.verify(quoteToken, process.env.JWT_SECRET);
  } catch {
    return null;
  }

  if (
    typeof quote !== "object" ||
    quote.patientId !== String(userId) ||
    quote.pickupLatitude !== requestData.currentLatitude ||
    quote.pickupLongitude !== requestData.currentLongitude ||
    quote.destination !== requestData.destination.trim() ||
    quote.ambulanceType !== requestData.ambulanceType ||
    !Number.isFinite(quote.distanceKm) ||
    !Number.isFinite(quote.ratePerKm) ||
    !Number.isFinite(quote.fareAmount) ||
    !Number.isFinite(quote.destinationLatitude) ||
    !Number.isFinite(quote.destinationLongitude) ||
    quote.paymentMethod !== "cash"
  ) {
    return null;
  }
  return quote;
}
