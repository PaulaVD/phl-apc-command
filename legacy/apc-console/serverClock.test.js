/**
 * Server time converter tests
 * Run: node serverClock.test.js
 */

"use strict";

const {
  SERVER_UTC_OFFSET,
  PARAGUAY_UTC_OFFSET,
  convertServerEvent,
  wallTimeToUtcMs,
  formatClockInOffset,
  formatAsuncionClock,
  formatServerClock,
  getAsuncionUtcOffsetHours,
  getServerUtcOffsetHours,
  partsInOffset,
  detectLocalTimezone,
  nearestPresetOffset
} = require("./serverClock");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function parseHm(hm) {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

function run() {
  assert(SERVER_UTC_OFFSET === -3, "Server must be UTC-3");
  assert(PARAGUAY_UTC_OFFSET === -4, "Paraguay must be UTC-4");
  assert(SERVER_UTC_OFFSET - PARAGUAY_UTC_OFFSET === 1, "Server is 1h ahead of Paraguay");

  const now = Date.UTC(2026, 6, 25, 18, 0, 0); // 2026-07-25 18:00 UTC
  assert(getServerUtcOffsetHours(now) === getAsuncionUtcOffsetHours(now) + 1, "server = asunción +1 offset");

  const asy = formatAsuncionClock(now, { withSeconds: false });
  const srv = formatServerClock(now, { withSeconds: false });
  assert((parseHm(srv) - parseHm(asy) + 24 * 60) % (24 * 60) === 60, `main clock must be Asunción+1h (${asy} → ${srv})`);

  const asyOffset = getAsuncionUtcOffsetHours(now);
  const py = convertServerEvent("15:00", asyOffset, now);
  assert(py.server === "15:00", `server wall ${py.server}`);
  assert(py.local === "14:00", `Asunción should see 14:00, got ${py.local}`);
  assert(py.paraguay === "14:00", "paraguay helper");

  const utc = convertServerEvent("15:00", 0, now);
  const expectedUtcHour = (15 - getServerUtcOffsetHours(now) + 24) % 24;
  assert(utc.local === `${String(expectedUtcHour).padStart(2, "0")}:00`, `UTC from server 15:00 → ${expectedUtcHour}:00, got ${utc.local}`);

  const known = Date.UTC(2026, 6, 25, 18, 0, 0);
  assert(formatClockInOffset(known, -3, { withSeconds: false }) === "15:00", "known→server fixed");
  assert(formatClockInOffset(known, -4, { withSeconds: false }) === "14:00", "known→PY fixed");

  const back = wallTimeToUtcMs({ year: 2026, month: 6, day: 25, hour: 15, minute: 0 }, -3);
  assert(back === known, "wallTimeToUtcMs round-trip");

  const half = convertServerEvent("12:00", 5.5, now);
  const serverOff = getServerUtcOffsetHours(now);
  const halfUtc = wallTimeToUtcMs(
    { year: 2026, month: 6, day: 25, hour: 12, minute: 0 },
    serverOff
  );
  assert(half.local === formatClockInOffset(halfUtc, 5.5, { withSeconds: false }), "India half-hour via live server offset");

  const p = partsInOffset(known, -3);
  assert(p.hour === 15 && p.minute === 0, "partsInOffset");

  const detected = detectLocalTimezone(new Date());
  assert(Number.isFinite(detected.offsetHours), "detect offset");
  assert(typeof detected.timeZone === "string" && detected.timeZone.length > 0, "detect IANA zone");
  assert(Number.isFinite(nearestPresetOffset(detected.offsetHours)), "nearest preset");
  assert(nearestPresetOffset(5.5) === 5.5, "preserve half-hour");
  assert(nearestPresetOffset(-3.01) === -3, "snap near server");

  console.log("serverClock.test.js — all passed");
  console.log(JSON.stringify({ asy, srv, py, utc, half, asyOffset, serverOff, detected }, null, 2));
}

run();
