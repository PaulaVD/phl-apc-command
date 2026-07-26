/**
 * Mock data + assertions for live-roster median APC1 classification
 * Run: node rallyRoles.test.js
 *
 * Rule: APC1 CP >= median → RL; below → RJ. Plaza is not part of the gate.
 */

"use strict";

const {
  classifyAllianceMembers,
  deriveThresholdsFromRoster,
  summarizeRallyRoles,
  meetsRallyLeaderThresholds
} = require("./rallyRoles");

const MOCK_MEMBERS = [
  { id: "1", name: "SnoopDawg", apc1_cp: 820_000_000, rally_capacity: 450_000, apc1_faction: "Shooter" },
  { id: "2", name: "Tea", apc1_cp: 605_000_000, rally_capacity: 320_000, apc1_faction: "Fighter" },
  { id: "3", name: "Fisherman", apc1_cp: 744_000_000, rally_capacity: 410_000, apc1_faction: "Rider" },
  { id: "4", name: "Tiger", apc1_cp: 578_000_000, rally_capacity: 280_000, apc1_faction: "Fighter" },
  { id: "5", name: "Bella", apc1_cp: 460_000_000, rally_capacity: 200_000, apc1_faction: "Rider" }
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run() {
  const empty = deriveThresholdsFromRoster([]);
  assert(empty.minApc1Cp === 0 && empty.sampleApc === 0, "Empty roster → no median");

  const thresholds = deriveThresholdsFromRoster(MOCK_MEMBERS);
  assert(thresholds.minApc1Cp === 605_000_000, `Expected median APC, got ${thresholds.minApc1Cp}`);
  assert(thresholds.sampleApc === 5, `Expected 5 APC samples, got ${thresholds.sampleApc}`);

  // High APC1 with low plaza still qualifies as RL (plaza not in gate)
  assert(
    meetsRallyLeaderThresholds({ apc1_cp: 700_000_000, rally_capacity: 0 }, thresholds),
    "High APC1 / zero plaza → RL"
  );
  assert(
    !meetsRallyLeaderThresholds({ apc1_cp: 500_000_000, rally_capacity: 999_999 }, thresholds),
    "Low APC1 / huge plaza → RJ"
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
  console.log("alliance median APC1 (from roster):", thresholds);
  console.table(result.map(m => ({
    name: m.name,
    apc1_cp: m.apc1_cp,
    plaza: m.rally_capacity,
    role: m.assigned_role
  })));
}

run();
