import { useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import readApiResponse from "./readApiResponse.js";

async function notificationRequest(path, options = {}) {
  const response = await fetch(`/api/notifications${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${localStorage.getItem("emergencycare-token")}`,
      ...options.headers,
    },
  });
  return readApiResponse(response, "Could not load notifications.");
}

function decodeApplicationServerKey(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function dateLabel(value) {
  return value ? new Date(value).toLocaleString() : "";
}

export default function NotificationCenter({ user }) {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pushEnabled, setPushEnabled] = useState(false);

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const result = await notificationRequest("/");
      setNotifications(result.notifications);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      return undefined;
    }

    let mounted = true;
    navigator.serviceWorker.getRegistration().then(async (registration) => {
      const subscription = await registration?.pushManager.getSubscription();
      if (mounted) setPushEnabled(Boolean(subscription));
    }).catch((registrationError) => {
      console.error("Could not check browser notification status:", registrationError.message);
    });
    return () => {
      mounted = false;
    };
  }, [loadNotifications]);

  useEffect(() => {
    const socket = io({
      auth: { token: localStorage.getItem("emergencycare-token") },
      reconnection: true,
    });
    socket.on("notification:new", (notification) => {
      setNotifications((current) => [
        notification,
        ...current.filter((item) => item.id !== notification.id),
      ].slice(0, 50));
    });
    socket.on("connect_error", (socketError) => {
      console.error("Could not connect to EmergencyCare notifications:", socketError.message);
    });
    return () => socket.disconnect();
  }, [user.id]);

  async function enablePush() {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error("This browser does not support browser push notifications.");
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("Allow notifications in your browser settings to enable trip alerts.");
      }
      const { publicKey } = await notificationRequest("/public-key");
      const registration = await navigator.serviceWorker.register("/service-worker.js");
      const existingSubscription = await registration.pushManager.getSubscription();
      if (existingSubscription) await existingSubscription.unsubscribe();
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeApplicationServerKey(publicKey),
      });
      const result = await notificationRequest("/subscriptions", {
        method: "POST",
        body: JSON.stringify(subscription.toJSON()),
      });
      setPushEnabled(true);
      setNotice(result.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function disablePush() {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await notificationRequest("/subscriptions", {
          method: "DELETE",
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setPushEnabled(false);
      setNotice("Browser notifications are disabled on this device.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function openNotification(notification) {
    if (!notification.readAt) {
      try {
        await notificationRequest(`/${notification.id}/read`, { method: "PATCH" });
        setNotifications((current) => current.map((item) =>
          item.id === notification.id
            ? { ...item, readAt: new Date().toISOString() }
            : item,
        ));
      } catch (requestError) {
        setError(requestError.message);
      }
    }
    window.location.assign(notification.href);
  }

  const unreadCount = notifications.filter((item) => !item.readAt).length;

  return (
    <div className="notification-center">
      <button
        className="notification-trigger"
        aria-expanded={open}
        aria-controls="notification-panel"
        onClick={() => {
          setOpen((current) => !current);
          setError("");
        }}
      >
        Notifications
        {unreadCount > 0 && <span className="notification-count">{unreadCount}</span>}
      </button>
      {open && (
        <section className="notification-popover" id="notification-panel" aria-label="Notifications">
          <div className="notification-popover-heading">
            <strong>Trip notifications</strong>
            <button className="text-button" onClick={loadNotifications} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
          <div className="notification-push-controls">
            <button
              className="secondary-button compact-button"
              disabled={busy}
              onClick={pushEnabled ? disablePush : enablePush}
            >
              {busy
                ? "Please wait…"
                : pushEnabled ? "Disable browser alerts" : "Enable browser alerts"}
            </button>
            <small>SMS alerts can be added later with an SMS provider.</small>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          {notice && <p className="notice" role="status">{notice}</p>}
          {notifications.length === 0 ? (
            <p className="empty-state">
              {loading ? "Loading notifications…" : "No trip notifications yet."}
            </p>
          ) : (
            <div className="notification-list">
              {notifications.map((notification) => (
                <button
                  className={`notification-item ${notification.readAt ? "" : "unread"}`}
                  key={notification.id}
                  onClick={() => openNotification(notification)}
                >
                  <span className="notification-item-title">{notification.title}</span>
                  <span>{notification.message}</span>
                  <time>{dateLabel(notification.createdAt)}</time>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
