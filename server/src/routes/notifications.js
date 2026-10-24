import { Router } from "express";
import pool from "../config/database.js";
import { authenticate, requireRole } from "../middleware/authenticate.js";
import { hashPushEndpoint, isPushConfigured } from "../services/pushNotifications.js";

const router = Router();

router.get("/public-key", (_request, response) => {
  if (!isPushConfigured()) {
    return response.status(503).json({
      message: "Browser notifications are not configured on the server yet.",
    });
  }
  return response.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

router.use(
  authenticate,
  requireRole("patient", "dispatcher", "ambulance", "admin"),
);

router.get("/", async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, notification_type AS type, title, message, href,
        read_at AS readAt, created_at AS createdAt
       FROM user_notifications
       WHERE user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 50`,
      [request.user.id],
    );
    return response.json({
      notifications: rows.map((row) => ({ ...row, id: String(row.id) })),
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/subscriptions", async (request, response, next) => {
  const { endpoint, expirationTime, keys } = request.body ?? {};
  let parsedEndpoint;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    return response.status(400).json({ message: "A valid browser push subscription is required." });
  }
  if (
    typeof endpoint !== "string" ||
    endpoint.length > 2048 ||
    parsedEndpoint.protocol !== "https:" ||
    parsedEndpoint.username ||
    parsedEndpoint.password ||
    typeof keys?.p256dh !== "string" ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(keys.p256dh) ||
    typeof keys?.auth !== "string" ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(keys.auth) ||
    (expirationTime !== null &&
      expirationTime !== undefined &&
      (!Number.isSafeInteger(expirationTime) || expirationTime < 0))
  ) {
    return response.status(400).json({ message: "The browser push subscription is invalid." });
  }
  if (!isPushConfigured()) {
    return response.status(503).json({ message: "Browser notifications are not configured on the server yet." });
  }

  try {
    await pool.execute(
      `INSERT INTO push_subscriptions
        (user_id, endpoint, endpoint_hash, p256dh_key, auth_key, expiration_time)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         user_id = VALUES(user_id),
         endpoint = VALUES(endpoint),
         p256dh_key = VALUES(p256dh_key),
         auth_key = VALUES(auth_key),
         expiration_time = VALUES(expiration_time)`,
      [
        request.user.id,
        endpoint,
        hashPushEndpoint(endpoint),
        keys.p256dh,
        keys.auth,
        expirationTime ?? null,
      ],
    );
    return response.status(201).json({ message: "Browser notifications are enabled on this device." });
  } catch (error) {
    return next(error);
  }
});

router.delete("/subscriptions", async (request, response, next) => {
  const { endpoint } = request.body ?? {};
  if (typeof endpoint !== "string" || endpoint.length > 2048) {
    return response.status(400).json({ message: "A valid browser push endpoint is required." });
  }
  try {
    await pool.execute(
      "DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint_hash = ?",
      [request.user.id, hashPushEndpoint(endpoint)],
    );
    return response.json({ message: "Browser notifications are disabled on this device." });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:notificationId/read", async (request, response, next) => {
  const { notificationId } = request.params;
  if (!/^\d+$/.test(notificationId)) {
    return response.status(400).json({ message: "The notification ID is invalid." });
  }
  try {
    const [result] = await pool.execute(
      `UPDATE user_notifications SET read_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ? AND read_at IS NULL`,
      [notificationId, request.user.id],
    );
    if (result.affectedRows === 0) {
      const [rows] = await pool.execute(
        "SELECT id FROM user_notifications WHERE id = ? AND user_id = ? LIMIT 1",
        [notificationId, request.user.id],
      );
      if (rows.length === 0) {
        return response.status(404).json({ message: "Notification not found." });
      }
    }
    return response.json({ message: "Notification marked as read." });
  } catch (error) {
    return next(error);
  }
});

export default router;
