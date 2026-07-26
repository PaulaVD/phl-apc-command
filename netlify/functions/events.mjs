import { getStore } from "@netlify/blobs";
import { AUTH_CORS_HEADERS, resolveCallerAuth } from "../lib/auth.mjs";

const STORE_NAME = "phl-events";
const KEY = "scheduled";
const MAX_EVENTS = 40;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": AUTH_CORS_HEADERS,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...cors
    }
  });
}

function getEventsStore() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

function normalizeTime(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "";
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return "";
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function normalizeEvent(item) {
  if (!item || typeof item !== "object") return null;
  const id = String(item.id || "").trim().slice(0, 64);
  const time = normalizeTime(item.time);
  const title = String(item.title || item.label || "").trim().slice(0, 80);
  const note = String(item.note || "").trim().slice(0, 120);
  if (!id || !time || !title) return null;
  return {
    id,
    time,
    title,
    note,
    updated: Number(item.updated) || Date.now(),
    createdBy: String(item.createdBy || "").trim().slice(0, 40)
  };
}

function normalizeEvents(list) {
  if (!Array.isArray(list)) return [];
  const map = new Map();
  for (const item of list) {
    const event = normalizeEvent(item);
    if (!event) continue;
    const prev = map.get(event.id);
    if (!prev || Number(event.updated || 0) >= Number(prev.updated || 0)) {
      map.set(event.id, event);
    }
  }
  return [...map.values()]
    .sort((a, b) => {
      const byTime = String(a.time).localeCompare(String(b.time));
      if (byTime) return byTime;
      return String(a.title).localeCompare(String(b.title));
    })
    .slice(0, MAX_EVENTS);
}

async function readEvents(store) {
  const raw = await store.get(KEY, { type: "text" });
  if (!raw) return { events: [], updated_at: null };
  try {
    const parsed = JSON.parse(raw);
    return {
      events: normalizeEvents(parsed?.events),
      updated_at: parsed?.updated_at || null
    };
  } catch {
    return { events: [], updated_at: null };
  }
}

async function writeEvents(store, events) {
  const payload = {
    alliance_id: "phl",
    events: normalizeEvents(events),
    updated_at: new Date().toISOString()
  };
  await store.set(KEY, JSON.stringify(payload), {
    metadata: { alliance: "phl" }
  });
  return payload;
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("", { status: 204, headers: cors });
  }

  try {
    const store = getEventsStore();

    if (req.method === "GET") {
      const data = await readEvents(store);
      return json(200, {
        alliance_id: "phl",
        scope: "public",
        events: data.events,
        updated_at: data.updated_at
      });
    }

    if (req.method === "POST") {
      let body;
      try {
        body = await req.json();
      } catch {
        return json(400, { error: "Invalid JSON body" });
      }

      const auth = await resolveCallerAuth(req, body);
      if (auth.role !== "leadership") {
        return json(401, { error: "Leadership credentials required" });
      }

      const action = String(body.action || "upsert").toLowerCase();
      const existing = await readEvents(store);
      let next = [...existing.events];

      if (action === "delete") {
        const id = String(body.id || body.event?.id || "").trim();
        if (!id) return json(400, { error: "Missing event id" });
        next = next.filter(item => item.id !== id);
      } else if (action === "upsert" || action === "create" || action === "update") {
        const incoming = body.event || body;
        const id = String(incoming.id || body.id || "").trim() || newId();
        const time = normalizeTime(incoming.time);
        const title = String(incoming.title || incoming.label || "").trim().slice(0, 80);
        const note = String(incoming.note || "").trim().slice(0, 120);
        if (!time) return json(400, { error: "Invalid time (use HH:MM server time)" });
        if (!title) return json(400, { error: "Title is required" });
        const prev = next.find(item => item.id === id);
        const event = normalizeEvent({
          id,
          time,
          title,
          note,
          updated: Date.now(),
          createdBy: prev?.createdBy || auth.adminName || auth.adminId || "admin"
        });
        if (!event) return json(400, { error: "Invalid event" });
        next = [...next.filter(item => item.id !== id), event];
      } else {
        return json(400, { error: "Unknown action" });
      }

      const saved = await writeEvents(store, next);
      return json(200, {
        alliance_id: "phl",
        scope: "leadership",
        role: auth.role,
        tier: auth.tier,
        events: saved.events,
        updated_at: saved.updated_at
      });
    }

    return json(405, { error: "Method not allowed" });
  } catch (error) {
    return json(500, {
      error: error?.message || "Events storage failed",
      hint: "Netlify Blobs unavailable"
    });
  }
};

export const config = {
  path: "/api/events"
};
