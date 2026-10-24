import jwt from "jsonwebtoken";
import pool from "../config/database.js";

const roles = ["patient", "dispatcher", "ambulance", "admin"];

export async function authenticate(request, response, next) {
  const authorization = request.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : null;

  if (!token) {
    return response.status(401).json({ message: "Please log in to continue." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (
      typeof payload !== "object" ||
      typeof payload.sub !== "string" ||
      !roles.includes(payload.role)
    ) {
      return response.status(401).json({ message: "Your session is invalid. Please log in again." });
    }

    const [users] = await pool.execute(
      `SELECT id, name, email, phone, role, account_status
       FROM users WHERE id = ? LIMIT 1`,
      [payload.sub],
    );
    const user = users[0];

    if (!user || user.account_status !== "active") {
      return response.status(401).json({ message: "Your account is unavailable. Please contact support." });
    }

    request.user = {
      id: String(user.id),
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
    };
    return next();
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return response.status(401).json({ message: "Your session has expired. Please log in again." });
    }
    return next(error);
  }
}

export function requireRole(...allowedRoles) {
  return (request, response, next) => {
    if (!request.user || !allowedRoles.includes(request.user.role)) {
      return response.status(403).json({ message: "You do not have permission to access this resource." });
    }
    return next();
  };
}
