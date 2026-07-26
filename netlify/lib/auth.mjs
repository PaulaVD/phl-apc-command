/**
 * Shared RBAC helpers for Netlify functions.
 * Admin proof = plaintext access code hashed and compared to known SHA-256 hashes
 * (same hashes as public config.js — security is preimage resistance, not hash secrecy).
 * Member proof = Personal Code matching a roster record.
 */

/** Mirrors window.PHL_CONFIG.admins — keep in sync when officers change. */
export const ADMIN_ACCOUNTS = [
  { id: "kittyklawzz", name: "KittyKlawzz", hash: "c366e897148bb26d4d5b0900f0c0e57adf9f32008e2aaf28a6e1a5b751785f6c" },
  { id: "fisherman5", name: "Fisherman5", hash: "3330b62996b5f3a8925f3c0af1a79752ab10fb94b45ab46d69b958a9a15268e2" },
  { id: "ash", name: "Ash Officer", hash: "5ab71acdc146f964f251843f02afe0cafff58ad1e2cd7f06c8b96f9c81be2d27" },
  { id: "rise", name: "Rise Officer", hash: "ed245a31ef1c209e3506b2ae9ab8f8fc525c9a6f6e9ceb7f5ce635dcbf3910e3" },
  { id: "legacy", name: "Legacy Officer", hash: "f8701f53584028fead16f9301265fcf832ebbee3be25d430521671963086799c" }
];

const enc = new TextEncoder();

export async function sha256Hex(value) {
  const data = enc.encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

export function normalizePersonalCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 16);
}

export function getAdminById(adminId) {
  const id = String(adminId || "").trim().toLowerCase();
  if (!id) return null;
  return ADMIN_ACCOUNTS.find(a => a.id === id) || null;
}

export async function verifyAdminCredentials(adminId, adminCode) {
  const account = getAdminById(adminId);
  const code = String(adminCode || "");
  if (!account || !code) return null;
  const hash = await sha256Hex(code);
  if (hash !== account.hash) return null;
  return { id: account.id, name: account.name };
}

export function readHeader(req, name) {
  try {
    return req.headers.get(name) || req.headers.get(name.toLowerCase()) || "";
  } catch {
    return "";
  }
}

/**
 * Resolve caller role from headers / query / JSON body fields.
 * Headers preferred: X-PHL-Admin-Id, X-PHL-Admin-Code, X-PHL-Personal-Code
 */
export async function resolveCallerAuth(req, body = null) {
  const url = new URL(req.url);
  const adminId =
    readHeader(req, "X-PHL-Admin-Id") ||
    url.searchParams.get("adminId") ||
    String(body?.adminId || body?.auth?.adminId || "");
  const adminCode =
    readHeader(req, "X-PHL-Admin-Code") ||
    url.searchParams.get("adminCode") ||
    String(body?.adminCode || body?.auth?.adminCode || "");
  const personalCode = normalizePersonalCode(
    readHeader(req, "X-PHL-Personal-Code") ||
    url.searchParams.get("personalCode") ||
    // Nested auth only — never treat payload.members[].personalCode / top-level
    // personalCode on create bodies as session proof (those are often brand-new codes).
    String(body?.auth?.personalCode || "")
  );

  const admin = await verifyAdminCredentials(adminId, adminCode);
  if (admin) {
    return {
      role: "leadership",
      tier: "R4-R5",
      adminId: admin.id,
      adminName: admin.name,
      personalCode: ""
    };
  }

  if (personalCode) {
    return {
      role: "member",
      tier: "R1-R3",
      adminId: "",
      adminName: "",
      personalCode
    };
  }

  return {
    role: "public",
    tier: "anonymous",
    adminId: "",
    adminName: "",
    personalCode: ""
  };
}

export const AUTH_CORS_HEADERS =
  "Content-Type, X-PHL-Admin-Id, X-PHL-Admin-Code, X-PHL-Personal-Code, X-PHL-Admin-Session";
