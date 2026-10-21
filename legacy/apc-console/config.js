/* Shared roster sync + per-admin access hashes.
   Passwords are not stored in plaintext — only SHA-256 hashes. */
window.PHL_CONFIG = {
  cloudApiUrl: "https://transcendent-kitsune-43421d.netlify.app/api/roster",
  adminRealtimeUrl: "https://transcendent-kitsune-43421d.netlify.app/api/admin-realtime",
  eventsApiUrl: "https://transcendent-kitsune-43421d.netlify.app/api/events",
  migrationApiUrl: "https://transcendent-kitsune-43421d.netlify.app/api/migration-workspace",
  supabaseUrl: "",
  supabaseAnonKey: "",
  allianceId: "phl",
  admins: [
    { id: "kittyklawzz", name: "KittyKlawzz", hash: "033f517b5f88a0e86063a99ca8e74b08aeda680825d936b67430b2b14950ecbd", officerRank: "R5" },
    { id: "fisherman5", name: "Fisherman5", hash: "670143be77813baeba0d430f98dbcd29c5adb699e5807f8f93f077080c993fc9", officerRank: "R4" },
    { id: "hellbel", name: "HellBel", hash: "ac2db96b45fb85c95b30f1b532f958e7d70b1919712334fb03488bbcb6984aa8", officerRank: "R4" },
    { id: "foxie", name: "Fôxie", hash: "4161421009e6cc7023295c26ba409ff5ca49f78a3f3d875d79357fbcd55fa7c8", officerRank: "R4" },
    { id: "sweetniha", name: "sweet niha", hash: "2e181a410a58043d2839e68dd0a8dfd19e6c6c85c5cdd0a280617125998ee9ff", officerRank: "R4" },
    { id: "hajjpodge", name: "Hajjpodge", hash: "6c16ef80ac0cdd08b74f1985eb385aa784a29382f566cb11ad9ab1b434a25a79", officerRank: "R4" },
    { id: "jplin", name: "JPLin", hash: "af2f56d47e05c82b04e633a138cbdaf80240be753da0d8e9f2fb3b894a48ae42", officerRank: "R4" },
    { id: "lost", name: "LOST", hash: "081ae418713277a23f7cd40b12e30f3f6d5c0eae0ec93cb633e34e7974d88954", officerRank: "R4" },
    { id: "hollya", name: "Hollya", hash: "658ec5a48e424acf37a7c212d9cbc3a27665df03bf38a5849dd4f323ebd61b17", officerRank: "R4" },
    { id: "xstructurexx", name: "xStructureXx", hash: "9dcbe44aa9bf6290d3bd745e3174f34ada22c9e2737cd172bf72f1f63111e398", officerRank: "R4" },
    { id: "battlebee", name: "BattleBëe", hash: "b00454c24c22b1bf4342b73cc961ffd1fab0f7efb312e8be97a631976420225c", officerRank: "R4" },
    { id: "senchatea", name: "Šęŋçħã Ţęã", hash: "c710c5f1778ef5f3ce7c443a1ffafc575c9d2019bae7db8ce4270378e96b9c16", officerRank: "R4" },
    { id: "chestickles", name: "Chestickles", hash: "c961892863fef1830a195147cd312cf1e233b88584bf93af3b11c93e27828024", officerRank: "R4" }
  ]
};
