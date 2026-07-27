/**
 * Mock data + assertions for live-roster median max-APC classification
 * Run: node rallyRoles.test.js
 *
 * Rule: max APC CP (highest of APC1–APC4) >= median → RL; below → RJ.
 * Plaza is not part of the gate.
 */

"use strict";

const {
  classifyAllianceMembers,
  deriveThresholdsFromRoster,
  summarizeRallyRoles,
  meetsRallyLeaderThresholds
} = require("./rallyRoles");

const MOCK_MEMBERS = [
  { id: "1", name: "SnoopDawg", max_apc_cp: 820_000_000, rally_capacity: 450_000, apc1_faction: "Shooter" },
  { id: "2", name: "Tea", max_apc_cp: 605_000_000, rally_capacity: 320_000, apc1_faction: "Fighter" },
  { id: "3", name: "Fisherman", max_apc_cp: 744_000_000, rally_capacity: 410_000, apc1_faction: "Rider" },
  { id: "4", name: "Tiger", max_apc_cp: 578_000_000, rally_capacity: 280_000, apc1_faction: "Fighter" },
  { id: "5", name: "Bella", max_apc_cp: 460_000_000, rally_capacity: 200_000, apc1_faction: "Rider" }
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run() {
  const empty = deriveThresholdsFromRoster([]);
  assert(empty.minApcCp === 0 && empty.sampleApc === 0, "Empty roster → no median");

  const thresholds = deriveThresholdsFromRoster(MOCK_MEMBERS);
  assert(thresholds.minApcCp === 605_000_000, `Expected median max APC, got ${thresholds.minApcCp}`);
  assert(thresholds.sampleApc === 5, `Expected 5 APC samples, got ${thresholds.sampleApc}`);

  // High max APC with low plaza still qualifies as RL (plaza not in gate)
  assert(
    meetsRallyLeaderThresholds({ max_apc_cp: 700_000_000, rally_capacity: 0 }, thresholds),
    "High max APC / zero plaza → RL"
  );
  assert(
    !meetsRallyLeaderThresholds({ max_apc_cp: 500_000_000, rally_capacity: 999_999 }, thresholds),
    "Low max APC / huge plaza → RJ"
  );

  // Member whose APC1 is weak but another slot is strong still uses the max
  const mixedSlots = deriveThresholdsFromRoster([
    { max_apc_cp: 400_000_000 },
    { max_apc_cp: 600_000_000 },
    { max_apc_cp: 800_000_000 }
  ]);
  assert(mixedSlots.minApcCp === 600_000_000, "Median of max marches");
  assert(
    meetsRallyLeaderThresholds({ max_apc_cp: 750_000_000, rally_capacity: 0 }, mixedSlots),
    "Max march above median → RL even if APC1 alone would be low"
  );

  const result = classifyAllianceMembers(MOCK_MEMBERS, thresholds);
  const byId = Object.fromEntries(result.map(m => [m.id, m]));

  assert(byId["1"].assigned_role === "RL", "SnoopDawg at/above median");
  assert(byId["2"].assigned_role === "RL", "Tea on median");
  assert(byId["3"].assigned_role === "RL", "Fisherman above median");
  assert(byId["4"].assigned_role === "RJ", "Tiger below median");
  assert(byId["5"].assigned_role === "RJ", "Bella below median");

  const summary = summarizeRallyRoles(result);
  assert(summary.rl === 3, `Expected 3 RL, got ${summary.rl}`);
  assert(summary.rj === 2, `Expected 2 RJ, got ${summary.rj}`);

  console.log("rallyRoles.test.js — all passed");
  console.log("alliance median highest APC (from roster):", thresholds);
  console.table(result.map(m => ({
    name: m.name,
    max_apc_cp: m.max_apc_cp,
    plaza: m.rally_capacity,
    role: m.assigned_role
  })));
}

run();
