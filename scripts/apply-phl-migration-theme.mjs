import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sources = [
  path.join(root, "apps/migration-command/app/globals.css"),
  path.join(root, "legacy/apc-console/migration/migration.css")
];

const fontImport =
  "@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Teko:wght@500;600;700&display=swap');";

const rootBlock =
  ":root{--ink:#f7efe9;--muted:#cab4a7;--teal:#ff7a46;--line:rgba(255,128,69,.18);--bg:#090303;--nav:#120606;--soft:rgba(42,18,14,.78);--amber:#f0ba72;--panel:#160909ee;--panel-2:#1d0d0cf2;--gold:#f0ba72;--ember:#ff7a46}";

/** Order matters: longer / more specific hex first where needed. */
const replacements = [
  [/@import url\('https:\/\/fonts\.googleapis\.com[^)]+\);/, fontImport],
  [
    /:root\{--ink:[^}]+\}/,
    rootBlock
  ],
  ["'DM Sans',sans-serif", "var(--font, 'Rajdhani'),system-ui,sans-serif"],
  ["'Manrope',sans-serif", "var(--font-display, 'Teko'),Rajdhani,sans-serif"],
  ["#112f32", "#120606"],
  ["#173f3e", "#1a0d0c"],
  ["#173d36", "#2a1208"],
  ["#23423f", "#241412"],
  ["#34524f", "rgba(255,128,69,.22)"],
  ["#16766c", "#da4e28"],
  ["#105c54", "#b83a18"],
  ["#2e8973", "#ff7a46"],
  ["#64b8a3", "#ff9a57"],
  ["#60a18e", "#ff9a57"],
  ["#f4f7f5", "#090303"],
  ["#fcfdfb", "#120808"],
  ["#f0f6f3", "#1a0d0c"],
  ["#b4cec4", "rgba(255,196,128,.35)"],
  ["#eef2f0", "rgba(255,255,255,.04)"],
  ["#72857c", "#cab4a7"],
  ["#e3f1e9", "rgba(255,122,70,.12)"],
  ["#267660", "#ffd8aa"],
  ["#d8e8dc", "rgba(255,128,69,.22)"],
  ["#9fc3ad", "#f0ba72"],
  ["#c4e1b2", "#ffd8aa"],
  ["#b5ccc3", "#cab4a7"],
  ["#dfedcf", "linear-gradient(180deg,#f8d297,#ff9a57 65%,#da4e28)"],
  ["#234b3c", "#250e07"],
  ["#86b3a52c", "rgba(255,122,70,.18)"],
  ["#365e52", "#2a1411"],
  ["#74987c", "rgba(255,196,128,.35)"],
  ["#d1e8bd", "#ffe3a5"],
  ["#60877914", "rgba(255,122,70,.08)"],
  ["#284d46", "#241412"],
  ["#557a66", "rgba(255,128,69,.28)"],
  ["#c7dfc5", "#f7efe9"],
  ["#88ab9d", "#a89488"],
  ["#fff", "#1d0d0c"],
  ["background:#fff", "background:var(--panel-2)"],
  ["background:white", "background:var(--panel-2)"],
  ["#75897f", "#cab4a7"],
  ["#7ca78d", "#f0ba72"],
  ["#709d8a", "#ff9a57"],
  ["#f0f6ee", "rgba(255,122,70,.1)"],
  ["#edf1ed", "rgba(255,128,69,.12)"],
  ["#edf2ed", "rgba(255,255,255,.06)"],
  ["#76a68c", "#ff9a57"],
  ["#dfe8e0", "rgba(255,128,69,.15)"],
  ["#91a69a", "#a89488"],
  ["#eff5ed", "rgba(42,18,14,.65)"],
  ["#7b9c82", "#f0ba72"],
  ["#dce8d9", "rgba(255,128,69,.2)"],
  ["#93aa9b", "#cab4a7"],
  ["#f7f7ec", "rgba(42,18,14,.55)"],
  ["#7b805d", "#cab4a7"],
  ["#e4e6d5", "rgba(255,128,69,.18)"],
  ["#8b9e91", "#a89488"],
  ["#dbe5de", "rgba(255,128,69,.22)"],
  ["#e4f3ec", "rgba(255,122,70,.15)"],
  ["#9aa99f", "#8a7268"],
  ["#f9fbf8", "#140808"],
  ["#f8fbf5", "#1a0d0c"],
  ["#e6efe3", "rgba(255,122,70,.12)"],
  ["#6b8d6a", "#f0ba72"],
  ["#8e9c92", "#a89488"],
  ["#7d9f82", "#f0ba72"],
  ["#94a28f", "#cab4a7"],
  ["#8b9a8d", "#a89488"],
  ["#f6f8f3", "rgba(255,255,255,.04)"],
  ["#647a69", "#cab4a7"],
  ["#8d9b90", "#a89488"],
  ["#ebf0e8", "rgba(255,255,255,.06)"],
  ["#699b7e", "#ff9a57"],
  ["#93b097", "#f0ba72"],
  ["#869a89", "#a89488"],
  ["#94a090", "#a89488"],
  ["#9bad9d", "#cab4a7"],
  ["#edf2ec", "rgba(36,16,14,.85)"],
  ["#e0e8de", "rgba(255,128,69,.15)"],
  ["#dfe8dc", "rgba(255,128,69,.18)"],
  ["#183b3210", "rgba(0,0,0,.25)"],
  ["#8b9d8c", "#a89488"],
  ["#bfcebc", "rgba(255,196,128,.25)"],
  ["#99b290", "#ff9a57"],
  ["#92a28f", "#a89488"],
  ["#102c3980", "rgba(5,1,1,.78)"],
  ["#14332b20", "rgba(0,0,0,.45)"],
  ["#eef4eb", "rgba(42,18,14,.72)"],
  ["#7d9278", "#cab4a7"],
  ["#f0f5ec", "rgba(36,16,14,.65)"],
  ["#647d64", "#cab4a7"],
  ["#c4d7bb", "rgba(255,196,128,.35)"],
  ["#8b9e85", "#a89488"],
  ["#214d3e", "#2a1411"],
  ["#e5f3dc", "#f7efe9"],
  ["#0b35243d", "rgba(0,0,0,.5)"],
  ["#8e9e89", "#a89488"],
  ["#b7dfb3", "linear-gradient(180deg,#f8d297,#ff9a57)"],
  ["#1d4b40", "#250e07"],
  ["#91b0ac", "#cab4a7"],
  ["#87a9a5", "#a89488"],
  ["#a8c1bb", "#cab4a7"],
  ["#d6eadb", "rgba(240,186,114,.16)"],
  ["#bcd9c4", "rgba(255,196,128,.22)"],
  ["#8aac9e", "#a89488"],
  ["#e0e9e0", "#f7efe9"],
  ["#8faeab", "#a89488"],
  ["#b4d7a1", "#ff9a57"],
  ["#e9f2ee", "#f7efe9"],
  ["#e9efec", "rgba(255,122,70,.1)"],
  ["#57766a", "#f0ba72"],
  ["#32534d", "#2a1411"],
  ["#d5e7d8", "#ffe3a5"],
  ["#a1b3ae", "#a89488"],
  ["#82a99d", "#ff9a57"],
  ["#7a9288", "#f0ba72"],
  ["#93b097", "#f0ba72"]
];

const patchRules = `
body{background:var(--bg);color:var(--ink)}
.main{background:var(--bg)}
.topbar{background:rgba(18,8,8,.92);border-bottom-color:var(--line)}
.metric,.panel,.drawer,.modal,.drawer-footer{background:linear-gradient(180deg,var(--panel),var(--panel-2));color:var(--ink)}
.metric>strong,.panel-foot strong,.summary-strip strong{color:var(--ink)}
.hero{background:linear-gradient(135deg,#2a1411 0%,#120606 55%,#1a0d0c 100%);border:1px solid rgba(255,128,69,.22)}
.hero button{color:#250e07!important;background:linear-gradient(180deg,#f8d297,#ff9a57 58%,#da4e28)!important;font-weight:700}
.primary{background:linear-gradient(180deg,#f8d297 0%,#ff9a57 58%,#da4e28 100%)!important;border-color:rgba(255,189,126,.48)!important;color:#250e07!important}
.primary:hover{background:linear-gradient(180deg,#ffd8aa,#ff7a46 58%,#b83a18 100%)!important;color:#250e07!important}
.sidebar{background:linear-gradient(180deg,#160909,#0a0404);border-right:1px solid var(--line)}
.sidebar nav button.active{color:var(--gold)!important}
.brand-icon{background:linear-gradient(180deg,rgba(255,140,80,.35),rgba(120,40,20,.5))!important;color:var(--gold)!important;border:1px solid rgba(255,189,126,.35)}
.tag.teal{background:rgba(255,122,70,.14)!important;color:#ffd8aa!important}
.toast{background:linear-gradient(180deg,#2a1411,#160909)!important;border:1px solid rgba(255,196,128,.25)!important;color:var(--text,#f7efe9)!important}
input,select,textarea{background:#140808;border-color:rgba(255,128,69,.22);color:var(--ink)}
button{background:rgba(255,255,255,.04);border-color:rgba(255,128,69,.22);color:var(--ink)}
button:hover{background:rgba(255,122,70,.1);border-color:rgba(255,196,128,.35)}
th{background:#140808;color:#cab4a7}
`;

for (const file of sources) {
  let css = fs.readFileSync(file, "utf8");
  for (const [from, to] of replacements) {
    css = typeof from === "string" ? css.split(from).join(to) : css.replace(from, to);
  }
  if (!css.includes("/* PH-L console theme */")) {
    css += `\n/* PH-L console theme */\n${patchRules}\n`;
  }
  fs.writeFileSync(file, css);
  console.log("Patched", file);
}
