import { createHash } from "node:crypto";
import pool from "../config/database.js";

export async function authenticateHospital(request, response, next) {
  const apiKey = request.get("x-hospital-api-key");
  if (typeof apiKey !== "string" || !apiKey.startsWith("ech_live_")) {
    return response.status(401).json({ message: "A valid hospital API key is required." });
  }

  try {
    const keyHash = createHash("sha256").update(apiKey).digest("hex");
    const [hospitals] = await pool.execute(
      `SELECT id, name, address, latitude, longitude
       FROM hospital_partners
       WHERE api_key_hash = ? AND is_active = TRUE LIMIT 1`,
      [keyHash],
    );
    if (!hospitals[0]) {
      return response.status(401).json({ message: "The hospital API key is invalid or inactive." });
    }

    request.hospital = {
      id: String(hospitals[0].id),
      name: hospitals[0].name,
      address: hospitals[0].address,
      latitude: Number(hospitals[0].latitude),
      longitude: Number(hospitals[0].longitude),
    };
    return next();
  } catch (error) {
    return next(error);
  }
}
