import { getStore } from "@netlify/blobs";
import {
  AUTH_CORS_HEADERS,
  normalizePersonalCode,
  resolveCallerAuth
} from "../lib/auth.mjs";

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

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const [y, mo, d] = raw.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return "";
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d
  ) {
    return "";
  }
  return raw;
}

function normalizeRsvpStatus(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "accepted" || raw === "accept" || raw === "yes") return "accepted";
  if (raw === "declined" || raw === "decline" || raw === "no") return "declined";
  return "";
}

function normalizeRsvps(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    const status = normalizeRsvpStatus(value.status);
    if (!status) continue;
    let actorKey = "";
    if (String(key).startsWith("admin:")) {
      actorKey = String(key).trim().slice(0, 48);
    } else {
      actorKey = normalizePersonalCode(key);
    }
    if (!actorKey) continue;
    out[actorKey] = {
      status,
      name: String(value.name || "").trim().slice(0, 40),
      updated: Number(value.updated) || Date.now()
    };
  }
  return out;
}

function normalizeEvent(item) {
  if (!item || typeof item !== "object") return null;
  const id = String(item.id || "").trim().slice(0, 64);
  const time = normalizeTime(item.time);
  const title = String(item.title || item.label || "").trim().slice(0, 80);
  const note = String(item.note || "").trim().slice(0, 120);
  const date = normalizeDate(item.date);
  if (!id || !time || !title) return null;
  return {
    id,
    date,
    time,
    title,
    note,
    rsvps: normalizeRsvps(item.rsvps),
    updated: Number(item.updated) || Date.now(),
    createdBy: String(item.createdBy || "").trim().slice(0, 40)
  };
}

function sortEvents(list) {
  return [...list].sort((a, b) => {
    const aDate = a.date || "9999-99-99";
    const bDate = b.date || "9999-99-99";
    const byDate = String(aDate).localeCompare(String(bDate));
    if (byDate) return byDate;
    const byTime = String(a.time).localeCompare(String(b.time));
    if (byTime) return byTime;
    return String(a.title).localeCompare(String(b.title));
  });
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
  return sortEvents([...map.values()]).slice(0, MAX_EVENTS);
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

function resolveRsvpActor(auth, body) {
  if (auth.personalCode) {
    return {
      key: auth.personalCode,
      name: String(body?.name || "").trim().slice(0, 40) || auth.personalCode
    };
  }
  if (auth.role === "leadership" && auth.adminId) {
    return {
      key: `admin:${auth.adminId}`,
      name: String(body?.name || auth.adminName || auth.adminId).trim().slice(0, 40)
    };
  }
  return null;
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
      const action = String(body.action || "upsert").toLowerCase();
      const existing = await readEvents(store);
      let next = [...existing.events];

      if (action === "rsvp") {
        if (auth.role === "public") {
          return json(401, { error: "Sign in required to accept or decline" });
        }
        const actor = resolveRsvpActor(auth, body);
        if (!actor) {
          return json(401, { error: "Sign in required to accept or decline" });
        }
        const id = String(body.id || body.event?.id || "").trim();
        const status = normalizeRsvpStatus(body.status || body.rsvp);
        if (!id) return json(400, { error: "Missing event id" });
        if (!status) return json(400, { error: "Status must be accepted or declined" });
        const prev = next.find(item => item.id === id);
        if (!prev) return json(404, { error: "Event not found" });
        const rsvps = { ...(prev.rsvps || {}) };
        rsvps[actor.key] = {
          status,
          name: actor.name,
          updated: Date.now()
        };
        const event = normalizeEvent({
          ...prev,
          rsvps,
          updated: Date.now()
        });
        if (!event) return json(400, { error: "Invalid event" });
        next = [...next.filter(item => item.id !== id), event];
      } else if (auth.role !== "leadership") {
        return json(401, { error: "Leadership credentials required" });
      } else if (action === "delete") {
        const id = String(body.id || body.event?.id || "").trim();
        if (!id) return json(400, { error: "Missing event id" });
        next = next.filter(item => item.id !== id);
      } else if (action === "upsert" || action === "create" || action === "update") {
        const incoming = body.event || body;
        const id = String(incoming.id || body.id || "").trim() || newId();
        const time = normalizeTime(incoming.time);
        const date = normalizeDate(incoming.date);
        const title = String(incoming.title || incoming.label || "").trim().slice(0, 80);
        const note = String(incoming.note || "").trim().slice(0, 120);
        if (!time) return json(400, { error: "Invalid time (use HH:MM server time)" });
        if (!date) return json(400, { error: "Invalid date (use YYYY-MM-DD)" });
        if (!title) return json(400, { error: "Title is required" });
        const prev = next.find(item => item.id === id);
        const event = normalizeEvent({
          id,
          date,
          time,
          title,
          note,
          rsvps: prev?.rsvps || {},
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
        scope: auth.role === "leadership" ? "leadership" : "member",
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
