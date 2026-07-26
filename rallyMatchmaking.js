/**
 * Thin re-export — matchmaking lives in rallyRoles.js (browser-safe single module).
 * Keep this file for Node tests / imports that still point here.
 */

"use strict";

const roles = require("./rallyRoles");

const api = {
  DEFAULT_JOINER_MARCH_TROOPS: roles.DEFAULT_JOINER_MARCH_TROOPS,
  slotsForCapacity: roles.slotsForCapacity,
  suggestRallyFormations: roles.suggestRallyFormations
};

module.exports = api;
