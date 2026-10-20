#!/usr/bin/env node
/**
 * Regenerate PHL leadership access codes for R4 officers (local ops only).
 * Prints plaintext codes — never commit that output.
 */
import crypto from "node:crypto";

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function genCode() {
  let code = "PHL-";
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i += 1) code += CHARS[bytes[i] % CHARS.length];
  return code;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

const R4_OFFICERS = [
  ["hellbel", "HellBel"],
  ["foxie", "Fôxie"],
  ["sweetniha", "sweet niha"],
  ["hajjpodge", "Hajjpodge"],
  ["jplin", "JPLin"],
  ["lost", "LOST"],
  ["hollya", "Hollya"],
  ["xstructurexx", "xStructureXx"],
  ["battlebee", "BattleBëe"],
  ["senchatea", "Šęŋçħã Ţęã"],
  ["chestickles", "Chestickles"]
];

for (const [id, name] of R4_OFFICERS) {
  const code = genCode();
  console.log(`${name}\t${id}\t${code}\t${sha256(code)}`);
}
