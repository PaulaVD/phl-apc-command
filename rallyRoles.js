/**
 * Dark War Survival — Alliance Rally Role Classifier
 * Pure module: thresholds are injected by the alliance layer (live roster median APC1).
 * Rule: APC1 CP >= median → Rally Leader (RL); below → Rally Joiner (RJ).
 */

"use strict";

/** @typedef {"Fighter" | "Shooter" | "Rider"} DominantFaction */
/** @typedef {"RL" | "RJ"} RallyRole */

/**
 * @typedef {Object} RallyThresholds
 * @property {number} minApc1Cp  Absolute APC1 CP gate (live uploaded median)
 */

/**
 * @typedef {Object} MemberInput
 * @property {string} id
 * @property {string} name
 * @property {number} apc1_cp
 * @property {number} rally_capacity
 * @property {DominantFaction} apc1_faction
 */

/**
 * @typedef {MemberInput & {
 *   assigned_role: RallyRole,
 *   specialty_faction: DominantFaction
 * }} CategorizedMember
 */

/** @type {ReadonlySet<DominantFaction>} */
const VALID_FACTIONS = Object.freeze(new Set(["Fighter", "Shooter", "Rider"]));

/** Test-only fallback — production UI must pass live roster median. */
const DEFAULT_THRESHOLDS = Object.freeze({
  minApc1Cp: 1_200_000
});

/**
 * @param {Partial<RallyThresholds> | null | undefined} thresholds
 * @returns {RallyThresholds}
 */
function normalizeThresholds(thresholds) {
  const minApc1Cp = Number(thresholds?.minApc1Cp);
  return {
    minApc1Cp: Number.isFinite(minApc1Cp) && minApc1Cp >= 0 ? minApc1Cp : DEFAULT_THRESHOLDS.minApc1Cp
  };
}

/**
 * RL if APC1 CP is at or above the alliance median gate.
 * @param {Pick<MemberInput, "apc1_cp" | "rally_capacity">} member
 * @param {Partial<RallyThresholds>} [thresholds]
 * @returns {boolean}
 */
function meetsRallyLeaderThresholds(member, thresholds) {
  const gate = normalizeThresholds(thresholds);
  return Number(member.apc1_cp) >= gate.minApc1Cp;
}

/**
 * @param {unknown} faction
 * @returns {DominantFaction}
 */
function normalizeFaction(faction) {
  const value = String(faction || "").trim();
  if (VALID_FACTIONS.has(/** @type {DominantFaction} */ (value))) {
    return /** @type {DominantFaction} */ (value);
  }
  return "Fighter";
}

/**
 * @param {MemberInput} member
 * @param {Partial<RallyThresholds>} [thresholds]
 * @returns {CategorizedMember}
 */
function classifyMember(member, thresholds) {
  if (!member || typeof member !== "object") {
    throw new TypeError("MemberInput must be an object.");
  }
  if (!member.id || !member.name) {
    throw new TypeError("MemberInput requires non-empty id and name.");
  }

  const apc1_cp = Number(member.apc1_cp);
  const rally_capacity = Number(member.rally_capacity);
  if (!Number.isFinite(apc1_cp) || apc1_cp < 0) {
    throw new TypeError(`Invalid apc1_cp for ${member.name}.`);
  }
  if (!Number.isFinite(rally_capacity) || rally_capacity < 0) {
    throw new TypeError(`Invalid rally_capacity for ${member.name}.`);
  }

  const apc1_faction = normalizeFaction(member.apc1_faction);
  const assigned_role = meetsRallyLeaderThresholds({ apc1_cp, rally_capacity }, thresholds) ? "RL" : "RJ";

  return {
    id: String(member.id),
    name: String(member.name),
    apc1_cp,
    rally_capacity,
    apc1_faction,
    assigned_role,
    specialty_faction: apc1_faction
  };
}

/**
 * @param {MemberInput[]} members
 * @param {Partial<RallyThresholds>} [thresholds]
 * @returns {CategorizedMember[]}
 */
function classifyAllianceMembers(members, thresholds) {
  if (!Array.isArray(members)) {
    throw new TypeError("classifyAllianceMembers expects an array of MemberInput.");
  }
  const gate = normalizeThresholds(thresholds);
  return members.map(member => classifyMember(member, gate));
}

/**
 * @param {CategorizedMember[]} categorized
 */
function summarizeRallyRoles(categorized) {
  /** @type {Record<DominantFaction, number>} */
  const byFaction = { Fighter: 0, Shooter: 0, Rider: 0 };
  let rl = 0;
  let rj = 0;

  for (const member of categorized) {
    if (member.assigned_role === "RL") rl += 1;
    else rj += 1;
    byFaction[member.specialty_faction] += 1;
  }

  return { total: categorized.length, rl, rj, byFaction };
}

/**
 * Build roster-derived APC1 median gate from live uploaded samples.
 * @param {{ apc1_cp: number, rally_capacity?: number }[]} samples
 * @returns {RallyThresholds & { sampleApc: number }}
 */
function deriveThresholdsFromRoster(samples) {
  const apcs = (samples || []).map(s => Number(s.apc1_cp)).filter(n => Number.isFinite(n) && n > 0);
  return {
    minApc1Cp: median(apcs),
    sampleApc: apcs.length
  };
}

/**
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Default march contribution used for capacity packing. */
const DEFAULT_JOINER_MARCH_TROOPS = 100_000;

/**
 * How many full joiner marches fit inside a plaza without exceeding capacity.
 * @param {number} capacity
 * @param {number} marchTroops
 * @returns {number}
 */
function slotsForCapacity(capacity, marchTroops) {
  const cap = Number(capacity);
  const march = Number(marchTroops);
  if (!Number.isFinite(cap) || cap <= 0 || !Number.isFinite(march) || march <= 0) return 0;
  return Math.floor(cap / march);
}

/**
 * @param {CategorizedMember} a
 * @param {CategorizedMember} b
 * @returns {number}
 */
function byApcDesc(a, b) {
  return Number(b.apc1_cp) - Number(a.apc1_cp);
}

/**
 * @param {CategorizedMember} a
 * @param {CategorizedMember} b
 * @returns {number}
 */
function byLeaderPriority(a, b) {
  const capDiff = Number(b.rally_capacity) - Number(a.rally_capacity);
  if (capDiff !== 0) return capDiff;
  return byApcDesc(a, b);
}

/**
 * @param {CategorizedMember[]} pool
 * @param {number} count
 * @param {(m: CategorizedMember) => boolean} [predicate]
 * @returns {CategorizedMember[]}
 */
function takeFromPool(pool, count, predicate) {
  if (count <= 0 || !pool.length) return [];
  /** @type {CategorizedMember[]} */
  const picked = [];
  for (let i = 0; i < pool.length && picked.length < count; i += 1) {
    const candidate = pool[i];
    if (predicate && !predicate(candidate)) continue;
    picked.push(candidate);
    pool.splice(i, 1);
    i -= 1;
  }
  return picked;
}

/**
 * Build optimal suggested strike teams: one group per Rally Leader.
 * Priority: same faction → pack floor(capacity / 100k) → off-faction fillers.
 *
 * @param {CategorizedMember[]} categorized
 * @param {{ joinerMarchTroops?: number, exclusiveJoiners?: boolean }} [options]
 * @returns {Array<{
 *   leader_name: string,
 *   leader_faction: DominantFaction,
 *   max_capacity: number,
 *   recommended_joiners: string[],
 *   off_faction_fillers: string[],
 *   expected_total_troops: number,
 *   is_faction_pure: boolean,
 *   open_slots: number
 * }>}
 */
function suggestRallyFormations(categorized, options = {}) {
  if (!Array.isArray(categorized)) {
    throw new TypeError("suggestRallyFormations expects an array of CategorizedMember.");
  }

  const marchTroops = Number(options.joinerMarchTroops) > 0
    ? Number(options.joinerMarchTroops)
    : DEFAULT_JOINER_MARCH_TROOPS;
  const exclusive = options.exclusiveJoiners !== false;

  const leaders = categorized
    .filter(m => m && m.assigned_role === "RL")
    .slice()
    .sort(byLeaderPriority);

  /** @type {CategorizedMember[]} */
  const joinerPool = categorized
    .filter(m => m && m.assigned_role === "RJ")
    .slice()
    .sort(byApcDesc);

  const groups = [];

  for (const leader of leaders) {
    const faction = leader.specialty_faction || leader.apc1_faction;
    const maxCapacity = Math.max(0, Math.floor(Number(leader.rally_capacity) || 0));
    const slots = slotsForCapacity(maxCapacity, marchTroops);
    const pool = exclusive ? joinerPool : joinerPool.slice().sort(byApcDesc);

    const aligned = takeFromPool(pool, slots, m => m.specialty_faction === faction || m.apc1_faction === faction);
    const fillers = takeFromPool(pool, slots - aligned.length);
    const recommended = [...aligned, ...fillers];

    groups.push({
      leader_name: leader.name,
      leader_faction: faction,
      max_capacity: maxCapacity,
      recommended_joiners: recommended.map(m => m.name),
      off_faction_fillers: fillers.map(m => m.name),
      expected_total_troops: recommended.length * marchTroops,
      is_faction_pure: fillers.length === 0,
      open_slots: Math.max(0, slots - recommended.length)
    });
  }

  return groups;
}

const api = {
  DEFAULT_THRESHOLDS,
  DEFAULT_JOINER_MARCH_TROOPS,
  normalizeThresholds,
  meetsRallyLeaderThresholds,
  classifyMember,
  classifyAllianceMembers,
  summarizeRallyRoles,
  deriveThresholdsFromRoster,
  median,
  slotsForCapacity,
  suggestRallyFormations
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}
if (typeof window !== "undefined") {
  window.PHL_RALLY_ROLES = api;
  window.PHL_RALLY_MATCHMAKING = {
    DEFAULT_JOINER_MARCH_TROOPS,
    slotsForCapacity,
    suggestRallyFormations
  };
}
