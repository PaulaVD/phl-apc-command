/**
 * Shared RBAC helpers for Netlify functions.
 * Admin proof = plaintext access code hashed and compared to known SHA-256 hashes
 * (same hashes as public config.js — security is preimage resistance, not hash secrecy).
 * Member proof = Personal Code matching a roster record.
 */

/** Mirrors window.PHL_CONFIG.admins — keep in sync when officers change. */
export const ADMIN_ACCOUNTS = [
  {
    id: "kittyklawzz",
    name: "KittyKlawzz",
    hash: "033f517b5f88a0e86063a99ca8e74b08aeda680825d936b67430b2b14950ecbd",
    officerRank: "R5"
  },
  {
    id: "fisherman5",
    name: "Fisherman5",
    hash: "670143be77813baeba0d430f98dbcd29c5adb699e5807f8f93f077080c993fc9",
    officerRank: "R4"
  },
  {
    id: "hellbel",
    name: "HellBel",
    hash: "ac2db96b45fb85c95b30f1b532f958e7d70b1919712334fb03488bbcb6984aa8",
    officerRank: "R4"
  },
  {
    id: "foxie",
    name: "Fôxie",
    hash: "4161421009e6cc7023295c26ba409ff5ca49f78a3f3d875d79357fbcd55fa7c8",
    officerRank: "R4"
  },
  {
    id: "sweetniha",
    name: "sweet niha",
    hash: "2e181a410a58043d2839e68dd0a8dfd19e6c6c85c5cdd0a280617125998ee9ff",
    officerRank: "R4"
  },
  {
    id: "hajjpodge",
    name: "Hajjpodge",
    hash: "6c16ef80ac0cdd08b74f1985eb385aa784a29382f566cb11ad9ab1b434a25a79",
    officerRank: "R4"
  },
  {
    id: "jplin",
    name: "JPLin",
    hash: "af2f56d47e05c82b04e633a138cbdaf80240be753da0d8e9f2fb3b894a48ae42",
    officerRank: "R4"
  },
  {
    id: "lost",
    name: "LOST",
    hash: "081ae418713277a23f7cd40b12e30f3f6c0eae0ec93cb633e34e7974d88954",
    officerRank: "R4"
  },
  {
    id: "hollya",
    name: "Hollya",
    hash: "658ec5a48e424acf37a7c212d9cbc3a27665df03bf38a5849dd4f323ebd61b17",
    officerRank: "R4"
  },
  {
    id: "xstructurexx",
    name: "xStructureXx",
    hash: "9dcbe44aa9bf6290d3bd745e3174f34ada22c9e2737cd172bf72f1f63111e398",
    officerRank: "R4"
  },
  {
    id: "battlebee",
    name: "BattleBëe",
    hash: "b00454c24c22b1bf4342b73cc961ffd1fab0f7efb312e8be97a631976420225c",
    officerRank: "R4"
  },
  {
    id: "senchatea",
    name: "Šęŋçħã Ţęã",
    hash: "c710c5f1778ef5f3ce7c443a1ffafc575c9d2019bae7db8ce4270378e96b9c16",
    officerRank: "R4"
  },
  {
    id: "chestickles",
    name: "Chestickles",
    hash: "c961892863fef1830a195147cd312cf1e233b88584bf93af3b11c93e27828024",
    officerRank: "R4"
  }
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
  return {
    id: account.id,
    name: account.name,
    officerRank: account.officerRank || "R4"
  };
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
    String(body?.auth?.personalCode || "")
  );

  const admin = await verifyAdminCredentials(adminId, adminCode);
  if (admin) {
    return {
      role: "leadership",
      tier: "R4-R5",
      officerRank: admin.officerRank || "R4",
      adminId: admin.id,
      adminName: admin.name,
      personalCode: ""
    };
  }

  if (personalCode) {
    return {
      role: "member",
      tier: "R1-R3",
      officerRank: "",
      adminId: "",
      adminName: "",
      personalCode
    };
  }

  return {
    role: "public",
    tier: "anonymous",
    officerRank: "",
    adminId: "",
    adminName: "",
    personalCode: ""
  };
}

/** Migration Command — R4/R5 leadership only (not members / public). */
export function verifyMigrationAccess(auth) {
  if (!auth || auth.role !== "leadership") return false;
  const rank = String(auth.officerRank || "R4").toUpperCase();
  return rank === "R4" || rank === "R5";
}

export const AUTH_CORS_HEADERS =
  "Content-Type, X-PHL-Admin-Id, X-PHL-Admin-Code, X-PHL-Personal-Code, X-PHL-Admin-Session";
