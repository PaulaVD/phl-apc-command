/* Shared roster sync + per-admin access hashes.
   Passwords are not stored in plaintext — only SHA-256 hashes. */
window.PHL_CONFIG = {
  cloudApiUrl: "https://transcendent-kitsune-43421d.netlify.app/api/roster",
  adminRealtimeUrl: "https://transcendent-kitsune-43421d.netlify.app/api/admin-realtime",
  supabaseUrl: "",
  supabaseAnonKey: "",
  allianceId: "phl",
  admins: [
    { id: "kittyklawzz", name: "KittyKlawzz", hash: "c366e897148bb26d4d5b0900f0c0e57adf9f32008e2aaf28a6e1a5b751785f6c" },
    { id: "fisherman5", name: "Fisherman5", hash: "3330b62996b5f3a8925f3c0af1a79752ab10fb94b45ab46d69b958a9a15268e2" },
    { id: "ash", name: "Ash Officer", hash: "5ab71acdc146f964f251843f02afe0cafff58ad1e2cd7f06c8b96f9c81be2d27" },
    { id: "rise", name: "Rise Officer", hash: "ed245a31ef1c209e3506b2ae9ab8f8fc525c9a6f6e9ceb7f5ce635dcbf3910e3" },
    { id: "legacy", name: "Legacy Officer", hash: "f8701f53584028fead16f9301265fcf832ebbee3be25d430521671963086799c" }
  ]
};
