import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../config/database.js";
import { authenticate, requireRole } from "../middleware/authenticate.js";

const router = Router();
const signupRoles = ["patient", "dispatcher", "ambulance"];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+?[0-9\s().-]{7,32}$/;

function createToken(user) {
  return jwt.sign(
    { role: user.role },
    process.env.JWT_SECRET,
    { subject: String(user.id), expiresIn: "12h" },
  );
}

function publicUser(user) {
  return {
    id: String(user.id),
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
  };
}

router.post("/signup", async (request, response, next) => {
  const { name, email, phone, password, role } = request.body ?? {};

  if (
    typeof name !== "string" ||
    name.trim().length < 2 ||
    name.trim().length > 120
  ) {
    return response.status(400).json({ message: "Name must be between 2 and 120 characters." });
  }
  if (typeof email !== "string" || email.length > 254 || !emailPattern.test(email.trim())) {
    return response.status(400).json({ message: "Enter a valid email address." });
  }
  if (typeof phone !== "string" || !phonePattern.test(phone.trim())) {
    return response.status(400).json({ message: "Enter a valid phone number." });
  }
  const phoneDigits = phone.trim().replace(/\D/g, "");
  if (phoneDigits.length < 7 || phoneDigits.length > 15) {
    return response.status(400).json({ message: "Phone number must contain 7 to 15 digits." });
  }
  if (
    typeof password !== "string" ||
    password.length < 8 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    return response.status(400).json({ message: "Password must be at least 8 characters and no more than 72 bytes." });
  }
  if (!signupRoles.includes(role)) {
    return response.status(400).json({ message: "Choose a valid account type. Admin accounts are created by the system administrator." });
  }

  const normalizedEmail = email.trim().toLowerCase();
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await pool.execute(
      `INSERT INTO users (name, email, phone, password_hash, role)
       VALUES (?, ?, ?, ?, ?)`,
      [name.trim(), normalizedEmail, phone.trim(), passwordHash, role],
    );

    return response.status(201).json({
      message: "Account created. Please log in with your email and password.",
      userId: String(result.insertId),
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return response.status(409).json({ message: "An account with that email already exists." });
    }
    return next(error);
  }
});

router.post("/login", async (request, response, next) => {
  const { email, password } = request.body ?? {};

  if (
    typeof email !== "string" ||
    email.trim().length > 254 ||
    !emailPattern.test(email.trim())
  ) {
    return response.status(400).json({ message: "Enter a valid email address." });
  }
  if (typeof password !== "string" || password.length === 0 || Buffer.byteLength(password, "utf8") > 72) {
    return response.status(400).json({ message: "Enter your password." });
  }

  try {
    const [users] = await pool.execute(
      `SELECT id, name, email, phone, password_hash, role, account_status
       FROM users WHERE email = ? LIMIT 1`,
      [email.trim().toLowerCase()],
    );
    const user = users[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return response.status(401).json({ message: "Email or password is incorrect." });
    }
    if (user.account_status !== "active") {
      return response.status(403).json({ message: "This account is suspended. Please contact support." });
    }

    return response.json({
      token: createToken(user),
      user: publicUser(user),
    });
  } catch (error) {
    return next(error);
  }
});

router.put("/profile", authenticate, requireRole("patient", "dispatcher", "ambulance", "admin"), async (request, response, next) => {
  const { email, phone, currentPassword, newPassword } = request.body ?? {};

  if (typeof email !== "string" || email.trim().length > 254 || !emailPattern.test(email.trim())) {
    return response.status(400).json({ message: "Enter a valid email address." });
  }
  if (typeof phone !== "string" || !phonePattern.test(phone.trim())) {
    return response.status(400).json({ message: "Enter a valid phone number." });
  }
  const phoneDigits = phone.trim().replace(/\D/g, "");
  if (phoneDigits.length < 7 || phoneDigits.length > 15) {
    return response.status(400).json({ message: "Phone number must contain 7 to 15 digits." });
  }
  if (typeof currentPassword !== "string" || currentPassword.length === 0 || Buffer.byteLength(currentPassword, "utf8") > 72) {
    return response.status(400).json({ message: "Enter your current password to save account changes." });
  }
  if (newPassword !== undefined && (typeof newPassword !== "string" || (newPassword.length > 0 && (newPassword.length < 8 || Buffer.byteLength(newPassword, "utf8") > 72)))) {
    return response.status(400).json({ message: "The new password must be at least 8 characters and no more than 72 bytes." });
  }

  const normalizedEmail = email.trim().toLowerCase();
  try {
    const [users] = await pool.execute(
      "SELECT id, name, email, phone, password_hash, role FROM users WHERE id = ? LIMIT 1",
      [request.user.id],
    );
    const user = users[0];
    if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
      return response.status(401).json({ message: "Your current password is incorrect." });
    }

    const passwordHash = newPassword ? await bcrypt.hash(newPassword, 12) : user.password_hash;
    await pool.execute(
      "UPDATE users SET email = ?, phone = ?, password_hash = ? WHERE id = ?",
      [normalizedEmail, phone.trim(), passwordHash, request.user.id],
    );
    return response.json({
      message: "Your account details were updated.",
      user: publicUser({ ...user, email: normalizedEmail, phone: phone.trim() }),
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return response.status(409).json({ message: "An account with that email already exists." });
    }
    return next(error);
  }
});

router.get(
  "/me",
  authenticate,
  requireRole("patient", "dispatcher", "ambulance", "admin"),
  (request, response) => response.json({ user: request.user }),
);

export default router;
