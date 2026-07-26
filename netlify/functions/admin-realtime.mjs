import { getStore } from "@netlify/blobs";
import { AUTH_CORS_HEADERS, resolveCallerAuth, verifyAdminCredentials } from "../lib/auth.mjs";

const STORE = "phl-admin-realtime";
const PRESENCE_KEY = "presence";
const CHAT_KEY = "chat";
const ONLINE_MS = 45_000;
const MAX_CHAT = 200;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": AUTH_CORS_HEADERS,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors }
  });
}

function getBlobStore() {
  return getStore({ name: STORE, consistency: "strong" });
}

async function readJson(store, key, fallback) {
  const raw = await store.get(key, { type: "text" });
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function prunePresence(map, now = Date.now()) {
  const out = {};
  for (const [id, row] of Object.entries(map || {})) {
    if (!row || typeof row !== "object") continue;
    const lastSeen = Number(row.lastSeen || 0);
    if (now - lastSeen > ONLINE_MS * 3) continue;
    out[id] = {
      id: String(row.id || id),
      name: String(row.name || id),
      sessionId: String(row.sessionId || ""),
      lastSeen
    };
  }
  return out;
}

function onlineList(map, now = Date.now()) {
  return Object.values(prunePresence(map, now))
    .filter(row => now - row.lastSeen <= ONLINE_MS)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ id, name, lastSeen }) => ({ id, name, lastSeen }));
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("", { status: 204, headers: cors });
  }

  try {
    const store = getBlobStore();
    const url = new URL(req.url);
    const action = (url.searchParams.get("action") || "").toLowerCase();

    // Presence / chat reads require leadership credentials (no public officer list)
    if (req.method === "GET" && (action === "presence" || action === "state" || action === "chat" || !action)) {
      const auth = await resolveCallerAuth(req);
      if (auth.role !== "leadership") {
        return json(401, { error: "Leadership credentials required", online: [], messages: [] });
      }
      const presence = prunePresence(await readJson(store, PRESENCE_KEY, {}));
      const chat = await readJson(store, CHAT_KEY, { messages: [] });
      if (action === "chat") {
        return json(200, {
          messages: Array.isArray(chat.messages) ? chat.messages.slice(-MAX_CHAT) : []
        });
      }
      return json(200, {
        online: onlineList(presence),
        messages: Array.isArray(chat.messages) ? chat.messages.slice(-MAX_CHAT) : [],
        serverTime: Date.now()
      });
    }

    if (req.method !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "Invalid JSON" });
    }

    const adminId = String(body.adminId || "").trim().toLowerCase();
    const adminName = String(body.adminName || "").trim().slice(0, 40);
    const sessionId = String(body.sessionId || "").trim();
    const adminCode = String(body.adminCode || "");
    if (!adminId || !adminName || !sessionId) {
      return json(400, { error: "adminId, adminName and sessionId are required" });
    }

    const verified = await verifyAdminCredentials(adminId, adminCode);
    if (!verified || verified.id !== adminId) {
      return json(401, { error: "Invalid admin credentials" });
    }

    const now = Date.now();
    const presence = prunePresence(await readJson(store, PRESENCE_KEY, {}), now);
    const existing = presence[adminId];

    if (action === "claim") {
      presence[adminId] = {
        id: adminId,
        name: verified.name || adminName,
        sessionId,
        lastSeen: now
      };
      await store.set(PRESENCE_KEY, JSON.stringify(presence));
      return json(200, {
        ok: true,
        claimed: true,
        kickedPrevious: Boolean(existing && existing.sessionId && existing.sessionId !== sessionId),
        online: onlineList(presence, now)
      });
    }

    // heartbeat / chat require matching active session
    if (!existing || existing.sessionId !== sessionId) {
      return json(409, {
        ok: false,
        kicked: true,
        reason: existing ? "session_replaced" : "session_missing",
        online: onlineList(presence, now)
      });
    }

    if (action === "heartbeat" || action === "presence") {
      presence[adminId] = {
        id: adminId,
        name: verified.name || adminName,
        sessionId,
        lastSeen: now
      };
      await store.set(PRESENCE_KEY, JSON.stringify(presence));
      const chat = await readJson(store, CHAT_KEY, { messages: [] });
      return json(200, {
        ok: true,
        kicked: false,
        online: onlineList(presence, now),
        messages: Array.isArray(chat.messages) ? chat.messages.slice(-MAX_CHAT) : [],
        serverTime: now
      });
    }

    if (action === "chat") {
      const text = String(body.text || "").trim().slice(0, 500);
      if (!text) return json(400, { error: "Message text required" });

      presence[adminId] = {
        id: adminId,
        name: verified.name || adminName,
        sessionId,
        lastSeen: now
      };
      await store.set(PRESENCE_KEY, JSON.stringify(presence));

      const chat = await readJson(store, CHAT_KEY, { messages: [] });
      const messages = Array.isArray(chat.messages) ? chat.messages : [];
      messages.push({
        id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
        adminId,
        adminName: verified.name || adminName,
        text,
        at: now
      });
      const trimmed = messages.slice(-MAX_CHAT);
      await store.set(CHAT_KEY, JSON.stringify({ messages: trimmed }));
      return json(200, {
        ok: true,
        kicked: false,
        online: onlineList(presence, now),
        messages: trimmed
      });
    }

    if (action === "logout") {
      if (existing?.sessionId === sessionId) {
        delete presence[adminId];
        await store.set(PRESENCE_KEY, JSON.stringify(presence));
      }
      return json(200, { ok: true, online: onlineList(presence, now) });
    }

    return json(400, { error: "Unknown action" });
  } catch (error) {
    return json(500, { error: error?.message || "Admin realtime failed" });
  }
};

export const config = {
  path: "/api/admin-realtime"
};
