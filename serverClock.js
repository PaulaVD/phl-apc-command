/**
 * Dark War Survival — Server Time clock & converter
 * Rule: Server Time is always exactly 1 hour ahead of Asunción (America/Asuncion).
 * No external deps — Intl + Date only.
 */

"use strict";

const ASUNCION_TZ = "America/Asuncion";
/** Nominal offsets when Asunción is on standard PYT (no DST). */
const SERVER_UTC_OFFSET = -3;
const PARAGUAY_UTC_OFFSET = -4;

/** Common labels for the offset picker (UTC-12 … UTC+14). */
const OFFSET_PRESETS = [
  { offset: -12, label: "UTC-12 · Baker Island" },
  { offset: -11, label: "UTC-11 · Samoa / Midway" },
  { offset: -10, label: "UTC-10 · Hawaii" },
  { offset: -9, label: "UTC-9 · Alaska" },
  { offset: -8, label: "UTC-8 · Pacific (US)" },
  { offset: -7, label: "UTC-7 · Mountain (US)" },
  { offset: -6, label: "UTC-6 · Central (US) / Mexico" },
  { offset: -5, label: "UTC-5 · Eastern (US) / Colombia" },
  { offset: -4, label: "UTC-4 · Paraguay / Asunción ★" },
  { offset: -3, label: "UTC-3 · Server Time / Argentina / Brazil" },
  { offset: -2, label: "UTC-2 · South Georgia" },
  { offset: -1, label: "UTC-1 · Azores" },
  { offset: 0, label: "UTC±0 · London (GMT/UTC)" },
  { offset: 1, label: "UTC+1 · Central Europe (CET)" },
  { offset: 2, label: "UTC+2 · Eastern Europe / South Africa" },
  { offset: 3, label: "UTC+3 · Moscow / East Africa" },
  { offset: 4, label: "UTC+4 · Dubai / Mauritius" },
  { offset: 5, label: "UTC+5 · Pakistan" },
  { offset: 5.5, label: "UTC+5:30 · India" },
  { offset: 6, label: "UTC+6 · Bangladesh" },
  { offset: 7, label: "UTC+7 · Thailand / Vietnam" },
  { offset: 8, label: "UTC+8 · China / Singapore / Perth" },
  { offset: 9, label: "UTC+9 · Japan / Korea" },
  { offset: 10, label: "UTC+10 · Sydney (AEST)" },
  { offset: 11, label: "UTC+11 · Solomon Islands" },
  { offset: 12, label: "UTC+12 · New Zealand / Fiji" },
  { offset: 13, label: "UTC+13 · Tonga" },
  { offset: 14, label: "UTC+14 · Line Islands" }
];

/** @param {number} n @param {number} [width=2] */
function pad2(n, width = 2) {
  return String(Math.floor(Math.abs(n))).padStart(width, "0");
}

/**
 * Wall-clock parts for an IANA timezone.
 * @param {Date|number} date
 * @param {string} timeZone
 */
function getZoneParts(date, timeZone) {
  const d = new Date(date);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).formatToParts(d);

    const map = {};
    for (const part of parts) {
      if (part.type !== "literal") map[part.type] = part.value;
    }

    let hour = Number(map.hour);
    if (hour === 24) hour = 0;

    return {
      year: Number(map.year),
      month: Number(map.month) - 1,
      day: Number(map.day),
      hour,
      minute: Number(map.minute),
      second: Number(map.second)
    };
  } catch {
    // Fallback: treat as fixed Paraguay UTC-4
    return partsInOffset(d, PARAGUAY_UTC_OFFSET);
  }
}

/**
 * Instant → wall-clock parts in a fixed UTC offset (hours, may be .5).
 * @param {Date|number} date
 * @param {number} utcOffsetHours
 */
function partsInOffset(date, utcOffsetHours) {
  const ms = typeof date === "number" ? date : date.getTime();
  const shifted = new Date(ms + Number(utcOffsetHours) * 3_600_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds()
  };
}

/**
 * Current UTC offset (hours) for an IANA zone at `date`.
 * @param {Date|number} date
 * @param {string} timeZone
 */
function getZoneUtcOffsetHours(date, timeZone) {
  const d = new Date(date);
  const p = getZoneParts(d, timeZone);
  const asUtc = Date.UTC(p.year, p.month, p.day, p.hour, p.minute, p.second);
  const raw = (asUtc - d.getTime()) / 3_600_000;
  // Snap to the nearest minute so DST/IANA quirks don't leave fractional noise.
  return Math.round(raw * 60) / 60;
}

/** Asunción offset right now (usually -4). */
function getAsuncionUtcOffsetHours(date = Date.now()) {
  return getZoneUtcOffsetHours(date, ASUNCION_TZ);
}

/** Server offset = Asunción + 1 hour (always). */
function getServerUtcOffsetHours(date = Date.now()) {
  return getAsuncionUtcOffsetHours(date) + 1;
}

/**
 * @param {Date|number} date
 * @param {number} utcOffsetHours
 * @param {{ withSeconds?: boolean }} [opts]
 */
function formatClockInOffset(date, utcOffsetHours, opts = {}) {
  const p = partsInOffset(date, utcOffsetHours);
  const base = `${pad2(p.hour)}:${pad2(p.minute)}`;
  return opts.withSeconds === false ? base : `${base}:${pad2(p.second)}`;
}

/** Live Asunción wall clock. */
function formatAsuncionClock(date = Date.now(), opts = {}) {
  const p = getZoneParts(date, ASUNCION_TZ);
  const base = `${pad2(p.hour)}:${pad2(p.minute)}`;
  return opts.withSeconds === false ? base : `${base}:${pad2(p.second)}`;
}

/**
 * Main server clock: always Asunción + 1 hour.
 * @param {Date|number} [date]
 * @param {{ withSeconds?: boolean }} [opts]
 */
function formatServerClock(date = Date.now(), opts = {}) {
  const p = getZoneParts(date, ASUNCION_TZ);
  const hour = (p.hour + 1) % 24;
  const base = `${pad2(hour)}:${pad2(p.minute)}`;
  return opts.withSeconds === false ? base : `${base}:${pad2(p.second)}`;
}

/**
 * Wall time in `fromOffset` → UTC epoch ms.
 * @param {{ hour: number, minute?: number, second?: number, year?: number, month?: number, day?: number }} wall
 * @param {number} fromOffsetHours
 */
function wallTimeToUtcMs(wall, fromOffsetHours) {
  const nowParts = partsInOffset(Date.now(), fromOffsetHours);
  const year = wall.year ?? nowParts.year;
  const month = wall.month ?? nowParts.month;
  const day = wall.day ?? nowParts.day;
  const hour = Number(wall.hour) || 0;
  const minute = Number(wall.minute) || 0;
  const second = Number(wall.second) || 0;
  return Date.UTC(year, month, day, hour, minute, second) - Number(fromOffsetHours) * 3_600_000;
}

/**
 * Convert a Server Time HH:MM event (Asunción+1) into another offset's wall clock.
 * @param {string} serverHm
 * @param {number} targetOffsetHours
 * @param {Date|number} [now]
 */
function convertServerEvent(serverHm, targetOffsetHours, now = Date.now()) {
  const match = String(serverHm || "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    throw new TypeError("Event time must be HH:MM or HH:MM:SS.");
  }
  const hour = clampInt(match[1], 0, 23);
  const minute = clampInt(match[2], 0, 59);
  const second = clampInt(match[3] || 0, 0, 59);
  const serverOffset = getServerUtcOffsetHours(now);
  const asuncionOffset = getAsuncionUtcOffsetHours(now);
  const utcMs = wallTimeToUtcMs({ hour, minute, second }, serverOffset);
  return {
    server: formatClockInOffset(utcMs, serverOffset, { withSeconds: false }),
    local: formatClockInOffset(utcMs, targetOffsetHours, { withSeconds: false }),
    paraguay: formatClockInOffset(utcMs, asuncionOffset, { withSeconds: false }),
    targetOffset: Number(targetOffsetHours),
    serverOffset,
    asuncionOffset
  };
}

function clampInt(value, min, max) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function formatOffsetLabel(offsetHours) {
  const n = Number(offsetHours);
  if (!Number.isFinite(n)) return "UTC";
  if (n === 0) return "UTC±0";
  const sign = n > 0 ? "+" : "-";
  const abs = Math.abs(n);
  const whole = Math.floor(abs);
  const mins = Math.round((abs - whole) * 60);
  return mins ? `UTC${sign}${whole}:${pad2(mins)}` : `UTC${sign}${whole}`;
}

/**
 * Detect device timezone via Intl + getTimezoneOffset (handles DST).
 * @param {Date} [now]
 */
function detectLocalTimezone(now = new Date()) {
  let timeZone = "local";
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  } catch {
    timeZone = "local";
  }

  const rawMinutes = -now.getTimezoneOffset();
  const offsetHours = Math.round(rawMinutes / 15) / 4;

  const city = timeZone.includes("/")
    ? timeZone.split("/").pop().replace(/_/g, " ")
    : timeZone;

  return {
    offsetHours,
    timeZone,
    city,
    label: `${formatOffsetLabel(offsetHours)} · ${city} (detected)`
  };
}

/** @param {number} offsetHours */
function nearestPresetOffset(offsetHours) {
  let best = OFFSET_PRESETS[0].offset;
  let bestDist = Math.abs(best - offsetHours);
  for (const preset of OFFSET_PRESETS) {
    const dist = Math.abs(preset.offset - offsetHours);
    if (dist < bestDist) {
      best = preset.offset;
      bestDist = dist;
    }
  }
  return bestDist <= 0.01 ? best : offsetHours;
}

/** Device-local HH:MM:SS via Intl. */
function formatDeviceLocalClock(date = Date.now()) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      hourCycle: "h23"
    }).format(new Date(date));
  } catch {
    return formatClockInOffset(date, detectLocalTimezone(new Date(date)).offsetHours);
  }
}

/**
 * @param {Object} nodes
 */
function mountServerClock(nodes) {
  if (!nodes?.clockEl || !nodes?.offsetSelect || !nodes?.eventInput || !nodes?.resultEl) {
    throw new TypeError("mountServerClock requires clock, offset select, event input, and result nodes.");
  }

  const detected = detectLocalTimezone();
  const selectedOffset = nearestPresetOffset(detected.offsetHours);
  const select = nodes.offsetSelect;

  const hasExactPreset = OFFSET_PRESETS.some(p => Math.abs(p.offset - selectedOffset) < 0.001);
  const options = [{ offset: selectedOffset, label: detected.label }];
  for (const preset of OFFSET_PRESETS) {
    if (Math.abs(preset.offset - selectedOffset) < 0.001 && hasExactPreset) continue;
    options.push(preset);
  }

  select.innerHTML = options.map((p, index) =>
    `<option value="${p.offset}"${index === 0 ? " selected" : ""}>${p.label}</option>`
  ).join("");
  select.value = String(selectedOffset);

  if (nodes.localZoneLabelEl) nodes.localZoneLabelEl.textContent = detected.timeZone;
  if (nodes.localOffsetBadgeEl) nodes.localOffsetBadgeEl.textContent = formatOffsetLabel(detected.offsetHours);
  if (nodes.serverBadgeEl) nodes.serverBadgeEl.textContent = formatOffsetLabel(getServerUtcOffsetHours());

  if (!nodes.eventInput.value) nodes.eventInput.value = "15:00";

  let timer = 0;

  function tick() {
    const now = Date.now();
    nodes.clockEl.textContent = formatServerClock(now);
    if (nodes.localClockEl) nodes.localClockEl.textContent = formatDeviceLocalClock(now);
    if (nodes.serverBadgeEl) {
      nodes.serverBadgeEl.textContent = formatOffsetLabel(getServerUtcOffsetHours(now));
    }
    refreshConversion();
  }

  function refreshConversion() {
    const activeOffset = Number(select.value);
    try {
      const result = convertServerEvent(nodes.eventInput.value || "15:00", activeOffset);
      nodes.resultEl.textContent = result.local;
      if (nodes.resultMetaEl) {
        const zoneNote = Math.abs(activeOffset - detected.offsetHours) < 0.01
          ? detected.timeZone
          : formatOffsetLabel(activeOffset);
        nodes.resultMetaEl.textContent =
          `${result.server} → ${result.local} · ${zoneNote}`;
      }
    } catch {
      nodes.resultEl.textContent = "--:--";
      if (nodes.resultMetaEl) nodes.resultMetaEl.textContent = "Enter event time as HH:MM (server).";
    }
  }

  select.addEventListener("change", refreshConversion);
  nodes.eventInput.addEventListener("input", refreshConversion);

  tick();
  timer = window.setInterval(tick, 1000);

  return {
    stop() { window.clearInterval(timer); },
    refresh: refreshConversion,
    tick,
    detected
  };
}

const api = {
  ASUNCION_TZ,
  SERVER_UTC_OFFSET,
  PARAGUAY_UTC_OFFSET,
  OFFSET_PRESETS,
  getZoneParts,
  partsInOffset,
  getZoneUtcOffsetHours,
  getAsuncionUtcOffsetHours,
  getServerUtcOffsetHours,
  formatClockInOffset,
  formatAsuncionClock,
  formatServerClock,
  formatDeviceLocalClock,
  wallTimeToUtcMs,
  convertServerEvent,
  formatOffsetLabel,
  detectLocalTimezone,
  nearestPresetOffset,
  mountServerClock
};

(function exportServerClock(root) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) root.PHL_SERVER_CLOCK = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : undefined);
