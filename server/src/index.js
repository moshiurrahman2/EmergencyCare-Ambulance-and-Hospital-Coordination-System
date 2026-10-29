import "dotenv/config";
import { createServer } from "node:http";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import dispatcherRoutes from "./routes/dispatcher.js";
import express from "express";
import adminRoutes from "./routes/admin.js";
import ambulanceRoutes from "./routes/ambulance.js";
import authRoutes from "./routes/auth.js";
import hospitalRoutes from "./routes/hospital.js";
import locationRoutes from "./routes/location.js";
import patientRoutes from "./routes/patient.js";
import notificationRoutes from "./routes/notifications.js";
import { errorHandler } from "./middleware/errorHandler.js";
import pool from "./config/database.js";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { setSocketServer } from "./services/realtime.js";
import { configurePushNotifications } from "./services/pushNotifications.js";

const app = express();
const httpServer = createServer(app);
const port = Number(process.env.PORT || 5000);
const clientOrigins = [
  process.env.CLIENT_ORIGIN || "http://localhost:5173",
  "http://localhost",
  "https://localhost",
  "capacitor://localhost",
];
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "You can make up to 30 login or signup requests every 15 minutes. Wait for the limit to reset and try again." },
});
const locationLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many location lookups. Wait a little and try again." },
});
const fareEstimateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many fare estimates. Wait for the limit to reset and try again." },
});
const hospitalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many hospital API requests. Wait a little and try again." },
});

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be set to a secret of at least 32 characters.");
}
configurePushNotifications();

app.use(
  cors({
    origin: clientOrigins,
  }),
);
app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "10kb" }));

app.use("/api/auth/login", authLimiter);
app.use("/api/auth/signup", authLimiter);
app.use("/api/auth", authRoutes);
app.use("/api/location", locationLookupLimiter, locationRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/ambulance", ambulanceRoutes);
app.use("/api/dispatcher", dispatcherRoutes);
app.use("/api/patient/fare-estimate", fareEstimateLimiter);
app.use("/api/patient", patientRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/hospital", hospitalApiLimiter, hospitalRoutes);

app.get("/api/health", async (_request, response) => {
  try {
    await pool.query("SELECT 1");
    response.json({ status: "ok", database: "connected" });
  } catch (error) {
    console.error("Database health check failed:", error.message);
    response.status(503).json({
      status: "error",
      message: "Database connection unavailable. Check the server configuration.",
    });
  }
});

app.use((_request, response) => {
  response.status(404).json({ message: "The requested API route was not found." });
});
app.use(errorHandler);

const io = new Server(httpServer, {
  cors: {
    origin: clientOrigins,
  },
});
setSocketServer(io);

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (typeof token !== "string" || !token) {
      return next(new Error("Please log in to receive trip updates."));
    }
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (
      typeof payload !== "object" ||
      typeof payload.sub !== "string" ||
      !["patient", "dispatcher", "ambulance", "admin"].includes(payload.role)
    ) {
      return next(new Error("Your session is invalid."));
    }
    const [users] = await pool.execute(
      `SELECT id, role, account_status FROM users WHERE id = ? LIMIT 1`,
      [payload.sub],
    );
    const user = users[0];
    if (!user || user.account_status !== "active" || user.role !== payload.role) {
      return next(new Error("Your account is unavailable."));
    }
    socket.data.user = { id: String(user.id), role: user.role };
    if (typeof payload.exp === "number") {
      const expiresIn = payload.exp * 1000 - Date.now();
      if (expiresIn <= 0) return next(new Error("Your session has expired."));
      const expiryTimer = setTimeout(() => socket.disconnect(true), expiresIn);
      expiryTimer.unref();
      socket.once("disconnect", () => clearTimeout(expiryTimer));
    }
    return next();
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return next(new Error("Your session has expired."));
    }
    return next(error);
  }
});

io.on("connection", (socket) => {
  socket.join(`user:${socket.data.user.id}`);
  socket.on("trip:join", async (payload, acknowledge = () => {}) => {
    const reply = typeof acknowledge === "function" ? acknowledge : () => {};
    const requestId = payload?.requestId;
    if (typeof requestId !== "string" || !/^\d+$/.test(requestId)) {
      reply({ ok: false, message: "The request ID is invalid." });
      return;
    }

    const user = socket.data.user;
    if (user.role === "admin") {
      reply({ ok: false, message: "Admins receive dashboard notifications, not trip-room updates." });
      return;
    }
    const ownerColumn = {
      patient: "patient_id",
      dispatcher: "dispatcher_id",
      ambulance: "ambulance_id",
    }[user.role];
    const assignmentRequirement = user.role === "ambulance"
      ? " AND dispatcher_id IS NOT NULL"
      : "";
    const profileTable = {
      dispatcher: "dispatcher_profiles",
      ambulance: "ambulance_profiles",
    }[user.role];
    try {
      if (profileTable) {
        const [profiles] = await pool.execute(
          `SELECT user_id FROM ${profileTable}
           WHERE user_id = ? AND approval_status = 'approved' LIMIT 1`,
          [user.id],
        );
        if (profiles.length === 0) {
          reply({ ok: false, message: "An approved profile is required for trip updates." });
          return;
        }
      }
      const [requests] = await pool.execute(
        `SELECT id FROM ambulance_requests
         WHERE id = ? AND ${ownerColumn} = ?${assignmentRequirement}
         LIMIT 1`,
        [requestId, user.id],
      );
      if (requests.length === 0) {
        reply({ ok: false, message: "You are not assigned to this request." });
        return;
      }
      await socket.join(`trip:${requestId}`);
      reply({ ok: true });
    } catch (error) {
      console.error("Socket trip subscription failed:", error.message);
      reply({ ok: false, message: "Could not subscribe to trip updates." });
    }
  });
});

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`EmergencyCare API listening on http://localhost:${port}`);
});
