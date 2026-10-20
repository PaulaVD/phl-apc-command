import { getStore } from "@netlify/blobs";
import {
  AUTH_CORS_HEADERS,
  resolveCallerAuth,
  verifyMigrationAccess
} from "../lib/auth.mjs";
import seed from "../lib/migration-seed.json" with { type: "json" };

const STORE_NAME = "phl-roster";
const KEY = "migration-workspace-phl";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": AUTH_CORS_HEADERS,
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS"
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...cors
    }
  });
}

function getStoreHandle() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

async function readWorkspace() {
  const store = getStoreHandle();
  const raw = await store.get(KEY, { type: "text" });
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function basicDataCheck(data) {
  if (!data || typeof data !== "object") return false;
  if (data.version !== 1) return false;
  if (!Array.isArray(data.players) || data.players.length > 1000) return false;
  if (!Array.isArray(data.states) || data.states.length > 100) return false;
  if (!Array.isArray(data.tasks) || data.tasks.length > 1000) return false;
  if (!data.settings || typeof data.settings !== "object") return false;
  return true;
}

export default async function handler(req, context) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  let body = null;
  if (req.method === "PUT") {
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "Invalid JSON body." });
    }
  }

  const auth = await resolveCallerAuth(req, body);
  if (!verifyMigrationAccess(auth)) {
    return json(403, {
      error: "R4 officer sign-in required. Use Leadership access from the APC console."
    });
  }

  if (req.method === "GET") {
    const row = await readWorkspace();
    if (!row) {
      return json(200, { data: seed, revision: 0, updatedAt: null });
    }
    return json(200, {
      data: row.payload,
      revision: row.revision,
      updatedAt: row.updatedAt
    });
  }

  if (req.method === "PUT") {
    const text = JSON.stringify(body?.data ?? {});
    if (text.length > 2_000_000) {
      return json(413, { error: "Backup is too large." });
    }
    if (!basicDataCheck(body?.data)) {
      return json(400, { error: "Invalid workspace data." });
    }
    if (!Number.isInteger(body?.revision) || body.revision < 0) {
      return json(400, { error: "Invalid revision." });
    }

    const store = getStoreHandle();
    const existing = await readWorkspace();
    const now = new Date().toISOString();

    if (body.revision === 0 && !existing) {
      await store.set(
        KEY,
        JSON.stringify({
          payload: body.data,
          revision: 1,
          updatedAt: now,
          updatedBy: auth.adminId
        })
      );
      return json(200, { revision: 1, updatedAt: now });
    }

    if (!existing || existing.revision !== body.revision) {
      return json(409, {
        error:
          "This workspace changed in another tab. Reload before saving, or export your edits first."
      });
    }

    const nextRevision = body.revision + 1;
    await store.set(
      KEY,
      JSON.stringify({
        payload: body.data,
        revision: nextRevision,
        updatedAt: now,
        updatedBy: auth.adminId
      })
    );
    return json(200, { revision: nextRevision, updatedAt: now });
  }

  return json(405, { error: "Method not allowed." });
}

export const config = {
  path: "/api/migration-workspace"
};
