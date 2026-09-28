// Pure countdown logic (no Workers APIs), unit-tested with `node --test`.

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const UNIT = { w: 7 * DAY, d: DAY, h: HOUR, m: MIN, s: SEC };
const MAX_AHEAD = 999 * DAY;

export const DONE_TEXT = "✅ زمان به پایان رسید!";

const pad = (n) => String(n).padStart(2, "0");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const UNITS = [["هفته", 604800], ["روز", 86400], ["ساعت", 3600], ["دقیقه", 60]];
const WITH_SECONDS = [...UNITS, ["ثانیه", 1]];

// "05 روز 03 ساعت 20 دقیقه": leading units that are zero are left out, the
// smallest unit always shows. `wrap` styles each number.
function units(seconds, list, wrap) {
  const parts = [];
  for (const [name, size] of list) {
    const n = Math.floor(seconds / size);
    seconds %= size;
    if (n || parts.length || size === list.at(-1)[1]) parts.push(`${wrap(pad(n))} ${name}`);
  }
  return parts.join(" ");
}

/**
 * Message countdown to the minute, e.g. "05 روز 03 ساعت 20 دقیقه". Minutes
 * round up, so it never reads "00 دقیقه" before the end.
 */
export function countdown(ms, wrap = (n) => n) {
  const minutes = ms <= 0 ? 0 : Math.max(1, Math.ceil((ms - SEC) / MIN));
  return units(minutes * 60, UNITS, wrap);
}

/** Exact remaining time for the button, e.g. "⏳ 05 روز 03 ساعت 20 دقیقه 08 ثانیه". */
export const formatLeft = (ms) => `⏳ ${units(Math.max(0, Math.round(ms / SEC)), WITH_SECONDS, String)}`;

/** True once the remaining time rounds down to zero seconds. */
export const isDone = (target, now) => target - now < SEC / 2;

const bold = (n) => `<b>${n}</b>`;

/**
 * Message body (parse_mode HTML): the custom text, then the countdown with
 * bold numbers. A "{}" in the text marks where the countdown goes instead.
 */
export function renderMessage(title, target, now) {
  const done = isDone(target, now);
  const left = countdown(done ? 0 : target - now, bold);
  const text = esc(title);
  if (text.includes("{}")) {
    const body = text.split("{}").join(left);
    return done ? `${body}\n\n${DONE_TEXT}` : body;
  }
  const line = done ? DONE_TEXT : `⏳ ${left}`;
  return text ? `${text}\n\n${line}` : line;
}

/**
 * Next edit time: aligned so the remaining time is a whole multiple of `step`
 * seconds (with step=60 each edit lands exactly as the minute changes), at least
 * min(1s, step/2) from now, and never later than the target itself (the final
 * "done" edit).
 */
export function nextTick(target, now, step) {
  const margin = Math.min(SEC, (step * SEC) / 2);
  const k = Math.floor((target - now - margin) / (step * SEC));
  return k > 0 ? target - k * step * SEC : target;
}

/** "+03:30" → 210 (minutes east of UTC). Defaults to Iran time. */
export function tzMinutes(s) {
  const m = /^([+-]?)(\d{1,2}):?(\d{2})?$/.exec(String(s ?? "").trim());
  if (!m) return 210;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

// Persian (U+06F0..) and Arabic-Indic (U+0660..) digits → ASCII. Both map one
// UTF-16 unit to one, so match indices stay valid on the original string.
const latinDigits = (s) => s.replace(/[۰-۹٠-٩]/g, (c) => String(c.charCodeAt(0) & 0xf));

/**
 * Whether a Telegram user may create countdowns. An empty ALLOWED_USERS lets
 * everyone in; otherwise only the IDs in it (runs of 5+ digits), so stray
 * spaces, commas, invisible direction marks or text pasted around an ID
 * don't matter. A value with no ID in it lets nobody in.
 */
export function isAllowed(allowedUsers, userId) {
  const raw = String(allowedUsers ?? "").trim();
  if (!raw) return true;
  return (latinDigits(raw).match(/\d{5,}/g) ?? []).includes(String(userId));
}

/** Jalali (Shamsi) date → Gregorian [y, m, d]; arithmetic 33-year cycle (jdf). */
export function jalaliToGregorian(jy, jm, jd) {
  jy += 1595;
  let days =
    -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const len = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  let gd = days + 1;
  while (gd > len[gm]) gd -= len[gm++];
  return [gy, gm + 1, gd];
}

// Local wall-clock date/time → epoch ms; NaN if the date doesn't exist.
function localToEpoch(y, mo, d, hh, mi, tz) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mi > 59) return NaN;
  if (y < 1700) {
    if (d > (mo <= 6 ? 31 : 30)) return NaN;
    [y, mo, d] = jalaliToGregorian(y, mo, d);
  }
  const t = Date.UTC(y, mo - 1, d, hh, mi);
  return new Date(t).getUTCDate() === d ? t - tz * MIN : NaN;
}

/**
 * Parses an inline query "<when> <title>". <when> is one of:
 *   3d · 2h30m · 1w2d · 90s          duration (w d h m s)
 *   18:30                             next occurrence of that local time
 *   2026-10-01 18:30 · 1405/07/09     Gregorian or Jalali date, time optional
 * Returns null if <when> isn't recognised, otherwise { target, title } where
 * target is epoch ms rounded to the second, or null if invalid / not ahead.
 */
export function parseQuery(query, now, tz) {
  const raw = String(query ?? "").trim();
  const q = latinDigits(raw);
  let m;
  let target;
  if ((m = /^(?:\d+[wdhms])+(?![a-z\d])/i.exec(q))) {
    target = now;
    for (const [, n, u] of m[0].matchAll(/(\d+)([wdhms])/gi)) target += Number(n) * UNIT[u.toLowerCase()];
  } else if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[\sT]+(\d{1,2}):(\d{2}))?(?![\d:])/.exec(q))) {
    const [y, mo, d, hh, mi] = m.slice(1).map((v) => Number(v ?? 0));
    target = localToEpoch(y, mo, d, hh, mi, tz);
  } else if ((m = /^(\d{1,2}):(\d{2})(?![\d:])/.exec(q))) {
    const [hh, mi] = [Number(m[1]), Number(m[2])];
    const midnight = Math.floor((now + tz * MIN) / DAY) * DAY - tz * MIN;
    target = hh > 23 || mi > 59 ? NaN : midnight + hh * HOUR + mi * MIN;
    if (target <= now) target += DAY;
  } else {
    return null;
  }
  target = Math.round(target / SEC) * SEC;
  const ahead = target - now;
  return { target: ahead >= SEC && ahead <= MAX_AHEAD ? target : null, title: raw.slice(m[0].length).trim() };
}
