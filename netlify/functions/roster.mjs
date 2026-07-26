import { getStore } from "@netlify/blobs";

const STORE_NAME = "phl-roster";
const KEY = "alliance-phl";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
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

function normalizeMembers(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(item => item && typeof item === "object" && String(item.name || "").trim())
    .map(item => ({
      ...item,
      id: String(item.id || ""),
      name: String(item.name || "").trim().slice(0, 30),
      updated: Number(item.updated) || Date.now(),
      isDemo: Boolean(item.isDemo)
    }))
    .filter(item => item.id && !item.isDemo);
}

function normalizeTombstones(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const [id, ts] of Object.entries(input)) {
    const key = String(id || "").trim();
    const time = Number(ts);
    if (!key || !Number.isFinite(time)) continue;
    out[key] = Math.max(out[key] || 0, time);
  }
  return out;
}

function mergeTombstones(existing, incoming, deletedIds = []) {
  const out = { ...normalizeTombstones(existing), ...normalizeTombstones(incoming) };
  const now = Date.now();
  for (const id of deletedIds || []) {
    const key = String(id || "").trim();
    if (!key) continue;
    out[key] = Math.max(out[key] || 0, now);
  }
  return out;
}

function mergeMembers(existing, incoming) {
  const map = new Map();
  for (const member of normalizeMembers(existing)) map.set(member.id, member);
  for (const member of normalizeMembers(incoming)) {
    const prev = map.get(member.id);
    if (!prev || Number(member.updated || 0) >= Number(prev.updated || 0)) {
      map.set(member.id, member);
    }
  }
  const byName = new Map();
  for (const member of map.values()) {
    const key = member.name.toLowerCase();
    const prev = byName.get(key);
    if (!prev || Number(member.updated || 0) >= Number(prev.updated || 0)) {
      byName.set(key, member);
    }
  }
  return [...byName.values()].sort((a, b) => Number(b.updated || 0) - Number(a.updated || 0));
}

function applyTombstones(members, tombstones) {
  const stones = normalizeTombstones(tombstones);
  return normalizeMembers(members).filter(member => {
    const deletedAt = stones[member.id];
    if (!deletedAt) return true;
    // Resurrect only if member was updated after the delete
    return Number(member.updated || 0) > deletedAt;
  });
}

function getRosterStore() {
  return getStore({
    name: STORE_NAME,
    consistency: "strong"
  });
}

async function readRoster(store) {
  const raw = await store.get(KEY, { type: "text" });
  if (!raw) return { alliance_id: "phl", members: [], tombstones: {}, updated_at: null };
  try {
    const data = JSON.parse(raw);
    const tombstones = normalizeTombstones(data.tombstones);
    return {
      alliance_id: "phl",
      members: applyTombstones(data.members, tombstones),
      tombstones,
      updated_at: data.updated_at || null
    };
  } catch {
    return { alliance_id: "phl", members: [], tombstones: {}, updated_at: null };
  }
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("", { status: 204, headers: cors });
  }

  try {
    const store = getRosterStore();

    if (req.method === "GET") {
      const data = await readRoster(store);
      return json(200, data);
    }

    if (req.method === "POST") {
      let body;
      try {
        body = await req.json();
      } catch {
        return json(400, { error: "Invalid JSON body" });
      }

      const existingRaw = await store.get(KEY, { type: "text" });
      let existing = { members: [], tombstones: {} };
      if (existingRaw) {
        try { existing = JSON.parse(existingRaw); } catch { /* ignore */ }
      }

      const tombstones = mergeTombstones(existing.tombstones, body.tombstones, body.deleted_ids);
      const merged = mergeMembers(existing.members, body.members);
      const members = applyTombstones(merged, tombstones);
      const payload = {
        alliance_id: "phl",
        members,
        tombstones,
        updated_at: new Date().toISOString()
      };
      await store.set(KEY, JSON.stringify(payload), {
        metadata: { alliance: "phl" }
      });
      const saved = await readRoster(store);
      return json(200, saved);
    }

    return json(405, { error: "Method not allowed" });
  } catch (error) {
    return json(500, {
      error: error?.message || "Roster storage failed",
      hint: "Netlify Blobs unavailable"
    });
  }
};

export const config = {
  path: "/api/roster"
};
