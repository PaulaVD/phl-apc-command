/**
 * Thin re-export — matchmaking lives in rallyRoles.js (browser-safe single module).
 * Keep this file for Node tests / imports that still point here.
 */

"use strict";

(function bindRallyMatchmaking(root) {
  function safeRequire(path) {
    try {
      if (typeof require === "function") return require(path);
    } catch {
      /* browser / missing module */
    }
    return null;
  }

  const roles = safeRequire("./rallyRoles") || (root && root.PHL_RALLY_ROLES) || null;
  if (!roles) return;

  const rallyMatchmakingApi = {
    DEFAULT_JOINER_MARCH_TROOPS: roles.DEFAULT_JOINER_MARCH_TROOPS,
    slotsForCapacity: roles.slotsForCapacity,
    suggestRallyFormations: roles.suggestRallyFormations
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = rallyMatchmakingApi;
  }
  if (root) {
    root.PHL_RALLY_MATCHMAKING = rallyMatchmakingApi;
  }
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : null);
