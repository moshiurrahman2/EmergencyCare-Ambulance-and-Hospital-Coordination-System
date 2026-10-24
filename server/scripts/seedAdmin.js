import "dotenv/config";
import bcrypt from "bcryptjs";
import pool from "../src/config/database.js";

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Set a valid ADMIN_EMAIL in server/.env.");
  }
  if (!password || password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
    throw new Error("Set an ADMIN_PASSWORD of 8 to 72 bytes in server/.env.");
  }

  const [existing] = await pool.execute(
    "SELECT id, role FROM users WHERE email = ? LIMIT 1",
    [email],
  );
  if (existing.length > 0) {
    if (existing[0].role !== "admin") {
      throw new Error("ADMIN_EMAIL already belongs to a non-admin account. Choose a different email.");
    }
    console.log("Admin account already exists. No account was changed.");
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  await pool.execute(
    `INSERT INTO users (name, email, phone, password_hash, role)
     VALUES (?, ?, ?, ?, 'admin')`,
    ["EmergencyCare Admin", email, "", hash],
  );
  console.log("Admin account created. Sign in with ADMIN_EMAIL and ADMIN_PASSWORD.");
}

try {
  await seedAdmin();
} catch (error) {
  console.error("Admin seed failed:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
