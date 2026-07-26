import { getStore } from "@netlify/blobs";
import {
  AUTH_CORS_HEADERS,
  normalizePersonalCode,
  resolveCallerAuth
} from "../lib/auth.mjs";

const STORE_NAME = "phl-roster";
const KEY = "alliance-phl";
const HISTORY_CAP = 300;
const PERSONAL_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

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

function normalizeMembers(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(item => item && typeof item === "object" && String(item.name || "").trim())
    .map(item => {
      const personalCode = normalizePersonalCode(item.personalCode);
      const needsReview =
        Boolean(item.needsReview) ||
        /\]-updt$/i.test(String(item.name || "")) ||
        /-updt$/i.test(String(item.name || ""));
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
  return [...byCode.values(), ...withoutCode].sort(
    (a, b) => Number(b.updated || 0) - Number(a.updated || 0)
  );
}

function applyTombstones(members, tombstones) {
  const stones = normalizeTombstones(tombstones);
  return normalizeMembers(members).filter(member => {
    const deletedAt = stones[member.id];
    if (!deletedAt) return true;
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

function findByPersonalCode(members, code) {
  const normalized = normalizePersonalCode(code);
  if (!normalized) return null;
  return (
    normalizeMembers(members).find(
      m => normalizePersonalCode(m.personalCode) === normalized
    ) || null
  );
}

function findByName(members, name, excludeId = null) {
  const key = String(name || "").trim().toLowerCase();
  if (!key) return null;
  return (
    normalizeMembers(members).find(
      m => m.name.toLowerCase() === key && m.id !== excludeId
    ) || null
  );
}

function generatePersonalCode(existingMembers) {
  const used = new Set(
    normalizeMembers(existingMembers).map(m => normalizePersonalCode(m.personalCode)).filter(Boolean)
  );
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let code = "PHL-";
    for (let i = 0; i < 6; i += 1) {
      code += PERSONAL_CODE_CHARS[Math.floor(Math.random() * PERSONAL_CODE_CHARS.length)];
    }
    if (!used.has(code)) return code;
  }
  return `PHL-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

function makeUpdateReviewName(baseName) {
  const clean = String(baseName || "member")
    .trim()
    .replace(/\[|\]/g, "")
    .replace(/-updt\d*$/i, "")
    .replace(/\s+/g, "")
    .slice(0, 24);
  return `${clean || "member"}-updt`.slice(0, 30);
}

function cryptoId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function selfPayload(data, member) {
  return {
    alliance_id: "phl",
    scope: "self",
    role: "member",
    tier: "R1-R3",
    members: member ? [member] : [],
    history: [],
    tombstones: {},
    updated_at: data.updated_at || null
  };
}

function publicPayload(data) {
  return {
    alliance_id: "phl",
    scope: "public",
    role: "public",
    tier: "anonymous",
    members: [],
    history: [],
    tombstones: {},
    updated_at: data.updated_at || null
  };
}

function leadershipPayload(data) {
  return {
    alliance_id: "phl",
    scope: "leadership",
    role: "leadership",
    tier: "R4-R5",
    members: data.members,
    history: data.history,
    tombstones: data.tombstones,
    updated_at: data.updated_at || null
  };
}

/**
 * Apply a single non-admin submit against the existing roster.
 * Returns { member, historyEvent } or { error, status }.
 *
 * forcedCode = authenticated member session code (must already exist).
 * incoming.personalCode without forcedCode may be:
 *   - an existing code → overwrite
 *   - a brand-new client-generated code → first registration (create)
 *   - blank → server generates a code
 */
function applyMemberSubmit(existingMembers, incomingRaw, forcedCode = "") {
  const incomingList = normalizeMembers([incomingRaw]);
  if (!incomingList.length) return { error: "Invalid member payload", status: 400 };
  const incoming = incomingList[0];
  const authCode = normalizePersonalCode(forcedCode);
  const proposedCode = normalizePersonalCode(incoming.personalCode);

  // Session-bound Personal Code must already exist on the roster
  if (authCode) {
    const owned = findByPersonalCode(existingMembers, authCode);
    if (!owned) return { error: "Personal Code not found", status: 404 };
    const target = {
      ...incoming,
      id: owned.id,
      personalCode: owned.personalCode,
      needsReview: false,
      name: String(incoming.name || owned.name).trim().slice(0, 30),
      updated: Number(incoming.updated) || Date.now()
    };
    return {
      member: target,
      historyEvent: {
        id: cryptoId(),
        at: Date.now(),
        action: "code-overwrite",
        memberId: target.id,
        memberName: target.name,
        actor: "member",
        fields: [],
        note: "Overwrite with Personal Code"
      }
    };
  }

  // Public / form code: existing code overwrites; unknown code is a first-time registration
  const byCode = proposedCode ? findByPersonalCode(existingMembers, proposedCode) : null;

  let target;
  let action = "create";
  let note = "";

  if (byCode) {
    target = {
      ...incoming,
      id: byCode.id,
      personalCode: byCode.personalCode,
      needsReview: false,
      name: String(incoming.name || byCode.name).trim().slice(0, 30),
      updated: Number(incoming.updated) || Date.now()
    };
    action = "code-overwrite";
    note = "Overwrite with Personal Code";
  } else {
    const existingSameName = findByName(existingMembers, incoming.name);
    if (existingSameName?.personalCode) {
      const code = proposedCode && !findByPersonalCode(existingMembers, proposedCode)
        ? proposedCode
        : generatePersonalCode(existingMembers);
      target = {
        ...incoming,
        id: cryptoId(),
        name: makeUpdateReviewName(incoming.name),
        personalCode: code,
        needsReview: true,
        updated: Number(incoming.updated) || Date.now()
      };
      action = "needs-review";
      note = "Submitted without matching Personal Code";
    } else if (existingSameName && !existingSameName.personalCode) {
      const code = proposedCode || generatePersonalCode(existingMembers);
      if (proposedCode && findByPersonalCode(existingMembers, proposedCode)) {
        return { error: "Personal Code already in use", status: 409 };
      }
      target = {
        ...incoming,
        id: existingSameName.id,
        personalCode: code,
        needsReview: false,
        name: String(incoming.name || existingSameName.name).trim().slice(0, 30),
        updated: Number(incoming.updated) || Date.now()
      };
      action = "claim-legacy";
      note = "Personal Code assigned";
    } else {
      const byId = existingMembers.find(m => m.id === incoming.id);
      if (byId?.personalCode) {
        return { error: "Cannot overwrite protected member without Personal Code", status: 403 };
      }
      if (proposedCode && findByPersonalCode(existingMembers, proposedCode)) {
        return { error: "Personal Code already in use", status: 409 };
      }
      const code = proposedCode || generatePersonalCode(existingMembers);
      target = {
        ...incoming,
        id: byId?.id || incoming.id || cryptoId(),
        personalCode: code,
        needsReview: Boolean(incoming.needsReview),
        updated: Number(incoming.updated) || Date.now()
      };
      action = byId ? "update" : "create";
      note = byId ? "Updated without Personal Code auth" : "Personal Code assigned";
    }
  }

  const historyEvent = {
    id: cryptoId(),
    at: Date.now(),
    action,
    memberId: target.id,
    memberName: target.name,
    actor: "member",
    fields: action === "create" || action === "claim-legacy"
      ? [{ field: "personalCode", from: "", to: String(target.personalCode || "") }]
      : [],
    note
  };

  return { member: target, historyEvent };
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("", { status: 204, headers: cors });
  }

  try {
    const store = getRosterStore();

    if (req.method === "GET") {
      const auth = await resolveCallerAuth(req);
      const data = await readRoster(store);

      if (auth.role === "leadership") {
        return json(200, leadershipPayload(data));
      }

      if (auth.role === "member") {
        const member = findByPersonalCode(data.members, auth.personalCode);
        if (!member) return json(404, { error: "Personal Code not found", scope: "self" });
        return json(200, selfPayload(data, member));
      }

      // Anonymous: no roster, no history, no aggregates
      return json(200, publicPayload(data));
    }

    if (req.method === "POST") {
      let body;
      try {
        body = await req.json();
      } catch {
        return json(400, { error: "Invalid JSON body" });
      }

      const auth = await resolveCallerAuth(req, body);
      const existingRaw = await store.get(KEY, { type: "text" });
      let existing = { members: [], history: [], tombstones: {} };
      if (existingRaw) {
        try {
          existing = JSON.parse(existingRaw);
        } catch {
          /* ignore */
        }
      }

      const existingLive = applyTombstones(existing.members, existing.tombstones);

      // —— Leadership: full merge ——
      if (auth.role === "leadership") {
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
        return json(200, leadershipPayload(saved));
      }

      // —— Member / public: scoped submit only (never full roster merge) ——
      const incoming = normalizeMembers(body.members);
      if (!incoming.length) {
        return json(400, { error: "No member payload to submit" });
      }

      // Cap abuse: non-admin may only submit a few records per request
      const batch = incoming.slice(0, 5);
      let working = [...existingLive];
      const accepted = [];
      const newHistory = [];

      for (const item of batch) {
        // Member session: overwrite own record. If the code is brand-new (first submit
        // raced ahead of unlock), fall through to public create with that proposed code.
        if (auth.role === "member") {
          const owned = findByPersonalCode(working, auth.personalCode);
          if (owned) {
            const result = applyMemberSubmit(working, { ...item, personalCode: auth.personalCode }, auth.personalCode);
            if (result.error) return json(result.status || 400, { error: result.error });
            working = mergeMembers(working, [result.member]);
            accepted.push(result.member);
            if (result.historyEvent) newHistory.push(result.historyEvent);
            continue;
          }
          // Unknown session code → first registration using that code (not a hard 404)
          const result = applyMemberSubmit(
            working,
            { ...item, personalCode: auth.personalCode || item.personalCode },
            ""
          );
          if (result.error) return json(result.status || 400, { error: result.error });
          working = mergeMembers(working, [result.member]);
          accepted.push(result.member);
          if (result.historyEvent) newHistory.push(result.historyEvent);
          continue;
        }

        const result = applyMemberSubmit(working, item, "");
        if (result.error) {
          // Skip invalid rows in multi-submit rather than failing the whole public push of mixed local state
          if (batch.length === 1) return json(result.status || 400, { error: result.error });
          continue;
        }
        working = mergeMembers(working, [result.member]);
        accepted.push(result.member);
        if (result.historyEvent) newHistory.push(result.historyEvent);
      }

      if (!accepted.length) {
        return json(400, { error: "No members accepted" });
      }

      // Preserve tombstones; non-admin cannot delete
      const tombstones = normalizeTombstones(existing.tombstones);
      const members = applyTombstones(working, tombstones);
      // Non-admin: only append server-authored history (ignore client spoofed events)
      const history = mergeHistory(existing.history, newHistory);
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

      return json(200, {
        alliance_id: "phl",
        scope: auth.role === "member" ? "self" : "submit",
        role: auth.role,
        tier: auth.tier,
        members: accepted,
        history: [],
        tombstones: {},
        updated_at: payload.updated_at
      });
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
