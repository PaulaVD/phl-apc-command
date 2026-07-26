import { getStore } from "@netlify/blobs";

const STORE_NAME = "phl-roster";
const KEY = "alliance-phl";
const HISTORY_CAP = 300;

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
    .map(item => {
      const personalCode = String(item.personalCode || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9-]/g, "")
        .slice(0, 16);
      const needsReview = Boolean(item.needsReview) || /\]-updt$/i.test(String(item.name || "")) || /-updt$/i.test(String(item.name || ""));
      return {
        ...item,
        id: String(item.id || ""),
        name: String(item.name || "").trim().slice(0, 30),
        updated: Number(item.updated) || Date.now(),
        isDemo: Boolean(item.isDemo),
        personalCode: personalCode || undefined,
        needsReview
      };
    })
    .filter(item => item.id && !item.isDemo);
}

function normalizeHistory(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(item => item && typeof item === "object")
    .map(item => ({
      id: String(item.id || ""),
      at: Number(item.at) || Date.now(),
      action: String(item.action || "update").slice(0, 40),
      memberId: String(item.memberId || "").slice(0, 64),
      memberName: String(item.memberName || "").trim().slice(0, 40),
      actor: String(item.actor || "member").trim().slice(0, 40),
      fields: Array.isArray(item.fields)
        ? item.fields.slice(0, 24).map(f => ({
            field: String(f?.field || "").slice(0, 40),
            from: String(f?.from ?? "").slice(0, 80),
            to: String(f?.to ?? "").slice(0, 80)
          }))
        : [],
      note: String(item.note || "").slice(0, 160)
    }))
    .filter(item => item.id)
    .sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
    .slice(0, HISTORY_CAP);
}

function mergeHistory(existing, incoming) {
  const map = new Map();
  for (const event of [...normalizeHistory(existing), ...normalizeHistory(incoming)]) {
    map.set(event.id, event);
  }
  return [...map.values()]
    .sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
    .slice(0, HISTORY_CAP);
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
      // Preserve personalCode if incoming omits it but previous had one
      const merged = { ...member };
      if (!merged.personalCode && prev?.personalCode) merged.personalCode = prev.personalCode;
      map.set(member.id, merged);
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
  // Keep personalCode uniqueness — newer wins
  const byCode = new Map();
  const withoutCode = [];
  for (const member of byName.values()) {
    const code = String(member.personalCode || "").toUpperCase();
    if (!code) {
      withoutCode.push(member);
      continue;
    }
    const prev = byCode.get(code);
    if (!prev || Number(member.updated || 0) >= Number(prev.updated || 0)) {
      byCode.set(code, member);
    }
  }
  return [...byCode.values(), ...withoutCode].sort((a, b) => Number(b.updated || 0) - Number(a.updated || 0));
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
  if (!raw) return { alliance_id: "phl", members: [], history: [], tombstones: {}, updated_at: null };
  try {
    const data = JSON.parse(raw);
    const tombstones = normalizeTombstones(data.tombstones);
    return {
      alliance_id: "phl",
      members: applyTombstones(data.members, tombstones),
      history: normalizeHistory(data.history),
      tombstones,
      updated_at: data.updated_at || null
    };
  } catch {
    return { alliance_id: "phl", members: [], history: [], tombstones: {}, updated_at: null };
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
      let existing = { members: [], history: [], tombstones: {} };
      if (existingRaw) {
        try { existing = JSON.parse(existingRaw); } catch { /* ignore */ }
      }

      const tombstones = mergeTombstones(existing.tombstones, body.tombstones, body.deleted_ids);
      const merged = mergeMembers(existing.members, body.members);
      const members = applyTombstones(merged, tombstones);
      const history = mergeHistory(existing.history, body.history);
      const payload = {
        alliance_id: "phl",
        members,
        history,
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
