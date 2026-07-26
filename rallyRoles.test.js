/**
 * Mock data + assertions for alliance-threshold classification
 * Run: node rallyRoles.test.js
 */

"use strict";

const {
  classifyAllianceMembers,
  deriveThresholdsFromRoster,
  summarizeRallyRoles
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
  const thresholds = deriveThresholdsFromRoster(MOCK_MEMBERS);
  assert(thresholds.minApc1Cp === 605_000_000, `Expected median APC, got ${thresholds.minApc1Cp}`);
  assert(thresholds.minRallyCapacity === 320_000, `Expected median plaza, got ${thresholds.minRallyCapacity}`);

  const result = classifyAllianceMembers(MOCK_MEMBERS, thresholds);
  const byId = Object.fromEntries(result.map(m => [m.id, m]));

  // >= alliance median APC1 AND >= alliance median plaza
  assert(byId["1"].assigned_role === "RL", "SnoopDawg above both medians");
  assert(byId["2"].assigned_role === "RL", "Tea on both medians");
  assert(byId["3"].assigned_role === "RL", "Fisherman above both medians");
  assert(byId["4"].assigned_role === "RJ", "Tiger below both medians");
  assert(byId["5"].assigned_role === "RJ", "Bella below both medians");

  const summary = summarizeRallyRoles(result);
  assert(summary.rl === 3, `Expected 3 RL, got ${summary.rl}`);
  assert(summary.rj === 2, `Expected 2 RJ, got ${summary.rj}`);

  console.log("rallyRoles.test.js — all passed");
  console.log("alliance thresholds (from roster):", thresholds);
  console.table(result.map(m => ({
    name: m.name,
    apc1_cp: m.apc1_cp,
    plaza: m.rally_capacity,
    role: m.assigned_role
  })));
}

run();
