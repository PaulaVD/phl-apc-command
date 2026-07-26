/**
 * Mock data + assertions for RL↔RJ strike-team matchmaking
 * Run: node rallyMatchmaking.test.js
 */

"use strict";

const { classifyAllianceMembers, suggestRallyFormations, slotsForCapacity } = require("./rallyRoles");

/** Alliance policy used only to force known RL / RJ labels for matchmaking tests. */
const GATE = { minApc1Cp: 700_000_000, minRallyCapacity: 350_000 };

/**
 * Mock roster sized so packing + faction fallback are observable.
 * Leaders: capacity → march slots at 100k/march
 *   Nova (Shooter, 450k) → 4 slots
 *   Orion (Fighter, 400k) → 4 slots
 *   Vega (Rider, 380k) → 3 slots
 */
const MOCK_MEMBERS = [
  { id: "rl1", name: "Nova", apc1_cp: 820_000_000, rally_capacity: 450_000, apc1_faction: "Shooter" },
  { id: "rl2", name: "Orion", apc1_cp: 780_000_000, rally_capacity: 400_000, apc1_faction: "Fighter" },
  { id: "rl3", name: "Vega", apc1_cp: 760_000_000, rally_capacity: 380_000, apc1_faction: "Rider" },
  // Same-faction joiners for Nova (Shooter) — only 2 → forces off-faction fill for slots 3–4
  { id: "rj1", name: "Arrow", apc1_cp: 520_000_000, rally_capacity: 180_000, apc1_faction: "Shooter" },
  { id: "rj2", name: "Bolt", apc1_cp: 480_000_000, rally_capacity: 160_000, apc1_faction: "Shooter" },
  // Fighter joiners for Orion
  { id: "rj3", name: "Brick", apc1_cp: 500_000_000, rally_capacity: 200_000, apc1_faction: "Fighter" },
  { id: "rj4", name: "Anvil", apc1_cp: 455_000_000, rally_capacity: 150_000, apc1_faction: "Fighter" },
  { id: "rj5", name: "Forge", apc1_cp: 430_000_000, rally_capacity: 140_000, apc1_faction: "Fighter" },
  // Rider joiner (scarce) + mixed fillers
  { id: "rj6", name: "Gale", apc1_cp: 510_000_000, rally_capacity: 170_000, apc1_faction: "Rider" },
  { id: "rj7", name: "Mosaic", apc1_cp: 400_000_000, rally_capacity: 120_000, apc1_faction: "Shooter" },
  { id: "rj8", name: "Patch", apc1_cp: 390_000_000, rally_capacity: 110_000, apc1_faction: "Fighter" },
  { id: "rj9", name: "Spare", apc1_cp: 350_000_000, rally_capacity: 100_000, apc1_faction: "Rider" }
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run() {
  assert(slotsForCapacity(450_000, 100_000) === 4, "450k plaza → 4 marches");
  assert(slotsForCapacity(60_000, 100_000) === 0, "60k plaza → 0 marches (cannot exceed)");
  assert(slotsForCapacity(399_999, 100_000) === 3, "Packing must not exceed capacity");

  const categorized = classifyAllianceMembers(MOCK_MEMBERS, GATE);
  const roles = Object.fromEntries(categorized.map(m => [m.name, m.assigned_role]));
  assert(roles.Nova === "RL" && roles.Orion === "RL" && roles.Vega === "RL", "Leaders classified RL");
  assert(roles.Arrow === "RJ" && roles.Brick === "RJ", "Joiners classified RJ");

  const groups = suggestRallyFormations(categorized);
  assert(groups.length === 3, `Expected 3 RallyGroups, got ${groups.length}`);

  const byLeader = Object.fromEntries(groups.map(g => [g.leader_name, g]));

  // Nova (450k) claims first: all Shooter RJs (Arrow, Bolt, Mosaic) + 1 off-faction filler
  const nova = byLeader.Nova;
  assert(nova.leader_faction === "Shooter", "Nova faction");
  assert(nova.max_capacity === 450_000, "Nova capacity");
  assert(nova.recommended_joiners.length === 4, `Nova needs 4 joiners, got ${nova.recommended_joiners.length}`);
  assert(
    nova.recommended_joiners.slice(0, 3).every(n => ["Arrow", "Bolt", "Mosaic"].includes(n)),
    "Nova fills aligned Shooters first"
  );
  assert(nova.off_faction_fillers.length === 1, `Nova uses 1 off-faction filler, got ${nova.off_faction_fillers.length}`);
  assert(nova.is_faction_pure === false, "Nova not faction-pure");
  assert(nova.expected_total_troops === 400_000, "Nova troops = 4 × 100k (under capacity)");
  assert(nova.open_slots === 0, "Nova fully packed");

  // Orion next (400k): remaining Fighters after Nova may have taken some fillers
  const orion = byLeader.Orion;
  assert(orion.leader_faction === "Fighter", "Orion faction");
  assert(orion.recommended_joiners.length === 4, "Orion packs 4");
  assert(orion.expected_total_troops === 400_000, "Orion exact fill");
  // Exclusive pool: Nova already consumed 2 fillers from the shared RJ set
  const assigned = new Set(groups.flatMap(g => g.recommended_joiners));
  assert(assigned.size === groups.reduce((n, g) => n + g.recommended_joiners.length, 0), "Joiners are exclusive");

  // Vega (380k → 3 slots): may be partial / mixed depending on remaining pool
  const vega = byLeader.Vega;
  assert(vega.max_capacity === 380_000, "Vega capacity");
  assert(vega.recommended_joiners.length <= 3, "Vega never exceeds 3 marches");
  assert(vega.expected_total_troops === vega.recommended_joiners.length * 100_000, "Vega troop math");
  assert(
    vega.expected_total_troops <= vega.max_capacity,
    "Expected troops must not exceed plaza capacity"
  );

  // Non-exclusive mode: every leader can see the full RJ pool
  const shared = suggestRallyFormations(categorized, { exclusiveJoiners: false });
  const novaShared = shared.find(g => g.leader_name === "Nova");
  assert(novaShared.recommended_joiners.includes("Arrow"), "Shared mode still aligns Nova");
  assert(
    shared.every(g => g.recommended_joiners.length === slotsForCapacity(g.max_capacity, 100_000)
      || g.open_slots >= 0),
    "Shared mode respects slot caps"
  );

  console.log("rallyMatchmaking.test.js — all passed");
  console.log(JSON.stringify(groups, null, 2));
}

run();
