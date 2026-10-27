import { createHash } from "node:crypto";
import webPush from "web-push";
import pool from "../config/database.js";
import { emitUserNotification } from "./realtime.js";

let pushConfigured = false;

export function configurePushNotifications() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  const configuredValues = [publicKey, privateKey, subject].filter(Boolean);

  if (configuredValues.length === 0) return;
  if (configuredValues.length !== 3) {
    throw new Error("Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT together.");
  }
  if (!subject.startsWith("mailto:") && !subject.startsWith("https://")) {
    throw new Error("VAPID_SUBJECT must be a mailto: address or an HTTPS URL.");
  }

  webPush.setVapidDetails(subject, publicKey, privateKey);
  pushConfigured = true;
}

export function isPushConfigured() {
  return pushConfigured;
}

export function hashPushEndpoint(endpoint) {
  return createHash("sha256").update(endpoint).digest();
}

export async function notifyTripAssigned({ requestId, patientId, dispatcherId, ambulanceId }) {
  const [admins] = await pool.execute(
    `SELECT id FROM users
     WHERE role = 'admin' AND account_status = 'active'`,
  );
  const targets = [
    patientId && {
      userId: patientId,
      title: "Ambulance assigned to your request",
      message: `A dispatcher assigned an ambulance to request #${requestId}.`,
      href: "/patient",
    },
    dispatcherId && {
      userId: dispatcherId,
      title: "Ambulance assigned",
      message: `You assigned an ambulance to request #${requestId}.`,
      href: "/dispatcher",
    },
    {
      userId: ambulanceId,
      title: "New trip assigned",
      message: `You are assigned to request #${requestId}. Patient details are available in your workspace.`,
      href: "/ambulance",
    },
    ...admins.map((admin) => ({
      userId: String(admin.id),
      title: "Ambulance assigned",
      message: `A dispatcher assigned an ambulance to request #${requestId}.`,
      href: "/admin",
    })),
  ].filter(Boolean);
  const uniqueTargets = [...new Map(targets.map((target) => [target.userId, target])).values()];
  const values = uniqueTargets.flatMap((target) => [
    target.userId,
    "trip_assigned",
    target.title,
    target.message,
    target.href,
  ]);
  const connection = await pool.getConnection();
  const notificationIds = [];
  try {
    await connection.beginTransaction();
    for (let index = 0; index < values.length; index += 5) {
      const [result] = await connection.execute(
        `INSERT INTO user_notifications
           (user_id, notification_type, title, message, href)
         VALUES (?, ?, ?, ?, ?)`,
        values.slice(index, index + 5),
      );
      notificationIds.push(String(result.insertId));
    }
    await connection.commit();
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error("Could not roll back trip notification inserts:", rollbackError.message);
    }
    throw error;
  } finally {
    connection.release();
  }

  const [subscriptions] = pushConfigured
    ? await pool.execute(
      `SELECT ps.user_id AS userId, ps.endpoint, ps.p256dh_key AS p256dh,
        ps.auth_key AS auth
       FROM push_subscriptions ps
       INNER JOIN users u ON u.id = ps.user_id AND u.account_status = 'active'
       WHERE ps.user_id IN (${uniqueTargets.map(() => "?").join(", ")})`,
      uniqueTargets.map((target) => target.userId),
    )
    : [[]];

  uniqueTargets.forEach((target, index) => {
    const notification = {
      id: notificationIds[index],
      type: "trip_assigned",
      title: target.title,
      message: target.message,
      href: target.href,
      readAt: null,
      createdAt: new Date().toISOString(),
    };
    emitUserNotification(target.userId, notification);
  });

  const targetById = new Map(uniqueTargets.map((target) => [target.userId, target]));
  const deliveries = subscriptions.map(async (subscription) => {
    const target = targetById.get(String(subscription.userId));
    try {
      await webPush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify({
          title: target.title,
          body: target.message,
          url: target.href,
        }),
      );
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await pool.execute(
          "DELETE FROM push_subscriptions WHERE endpoint = ?",
          [subscription.endpoint],
        );
        return;
      }
      console.error(
        `Web Push delivery failed for user ${subscription.userId}:`,
        error.message,
      );
    }
  });
  const deliveryResults = await Promise.allSettled(deliveries);
  deliveryResults.forEach((result) => {
    if (result.status === "rejected") {
      console.error("Could not complete a Web Push delivery:", result.reason.message);
    }
  });
}
