import { Router } from "express";
import { authenticate, requireRole } from "../middleware/authenticate.js";
import { reverseGeocode } from "../services/reverseGeocoding.js";

const router = Router();

router.use(authenticate, requireRole("patient", "dispatcher", "ambulance"));

router.get("/reverse", async (request, response) => {
  const { latitude: latitudeValue, longitude: longitudeValue } = request.query;
  if (
    typeof latitudeValue !== "string" || !latitudeValue.trim() ||
    typeof longitudeValue !== "string" || !longitudeValue.trim()
  ) {
    return response.status(400).json({ message: "Enter valid latitude and longitude coordinates." });
  }
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return response.status(400).json({ message: "Enter valid latitude and longitude coordinates." });
  }

  try {
    const placeName = await reverseGeocode(latitude, longitude);
    return response.json({ placeName });
  } catch (error) {
    console.error("OpenStreetMap reverse geocoding failed:", error.message);
    return response.status(502).json({
      message: "Place-name lookup is unavailable right now. Your coordinates are still available.",
    });
  }
});

export default router;
