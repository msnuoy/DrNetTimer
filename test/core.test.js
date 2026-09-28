import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DONE_TEXT,
  formatLeft,
  isDone,
  jalaliToGregorian,
  nextTick,
  parseQuery,
  renderMessage,
  tzMinutes,
} from "../src/core.js";

const S = 1000;
const H = 3600 * S;
const D = 24 * H;
const TEHRAN = 210;
// 2026-09-28 10:00:00.250 in Tehran (06:30 UTC)
const NOW = Date.UTC(2026, 8, 28, 6, 30, 0, 250);

test("formatLeft uses the requested layout", () => {
  assert.equal(formatLeft(2 * D + 14 * H + 32 * 60 * S + 8 * S), "⏳ 02 روز 14 ساعت 32 دقیقه 08 ثانیه");
  assert.equal(formatLeft(0), "⏳ 00 روز 00 ساعت 00 دقیقه 00 ثانیه");
  assert.equal(formatLeft(-5 * S), "⏳ 00 روز 00 ساعت 00 دقیقه 00 ثانیه");
  assert.equal(formatLeft(120 * D), "⏳ 120 روز 00 ساعت 00 دقیقه 00 ثانیه");
  assert.equal(formatLeft(19.7 * S), "⏳ 00 روز 00 ساعت 00 دقیقه 20 ثانیه"); // slightly late tick
});

const BOLD_90S = "<b>00</b> روز <b>00</b> ساعت <b>01</b> دقیقه <b>30</b> ثانیه";
const BOLD_ZERO = "<b>00</b> روز <b>00</b> ساعت <b>00</b> دقیقه <b>00</b> ثانیه";

test("renderMessage: custom text, then the countdown with bold numbers", () => {
  assert.equal(renderMessage("a <b> & c", NOW + 90 * S, NOW), `a &lt;b&gt; &amp; c\n\n⏳ ${BOLD_90S}`);
  assert.equal(renderMessage("", NOW + 5 * S, NOW), "⏳ <b>00</b> روز <b>00</b> ساعت <b>00</b> دقیقه <b>05</b> ثانیه");
  assert.equal(renderMessage("x", NOW + 400, NOW), `x\n\n${DONE_TEXT}`);
  assert.equal(isDone(NOW + 600, NOW), false);
  assert.equal(isDone(NOW + 400, NOW), true);
});

test("renderMessage: {} places the countdown inside the text", () => {
  assert.equal(renderMessage("تا انتشار {} مانده", NOW + 90 * S, NOW), `تا انتشار ${BOLD_90S} مانده`);
  assert.equal(renderMessage("<i>{}</i>", NOW + 90 * S, NOW), `&lt;i&gt;${BOLD_90S}&lt;/i&gt;`);
  assert.equal(renderMessage("تا انتشار {} مانده", NOW + 400, NOW), `تا انتشار ${BOLD_ZERO} مانده\n\n${DONE_TEXT}`);
});

test("parseQuery: durations", () => {
  assert.deepEqual(parseQuery("3d 🚀 نسخه جدید Dr.Net", NOW, TEHRAN), {
    target: Date.UTC(2026, 9, 1, 6, 30, 0),
    title: "🚀 نسخه جدید Dr.Net",
  });
  assert.equal(parseQuery("2h30m جلسه", NOW, TEHRAN).target, Date.UTC(2026, 8, 28, 9, 0, 0));
  assert.deepEqual(parseQuery("  1w2d  ", NOW, TEHRAN), { target: Date.UTC(2026, 9, 7, 6, 30, 0), title: "" });
  assert.equal(parseQuery("90S", NOW, TEHRAN).target, Date.UTC(2026, 8, 28, 6, 31, 30));
  assert.deepEqual(parseQuery("۳d تست ۱۲", NOW, TEHRAN), { target: Date.UTC(2026, 9, 1, 6, 30, 0), title: "تست ۱۲" });
  assert.equal(parseQuery("3d🚀", NOW, TEHRAN).title, "🚀");
  assert.equal(parseQuery("0s", NOW, TEHRAN).target, null);
  assert.equal(parseQuery("1000d", NOW, TEHRAN).target, null);
});

test("parseQuery: clock time is the next occurrence in the configured zone", () => {
  assert.deepEqual(parseQuery("18:30 وبینار", NOW, TEHRAN), { target: Date.UTC(2026, 8, 28, 15, 0), title: "وبینار" });
  assert.equal(parseQuery("08:00", NOW, TEHRAN).target, Date.UTC(2026, 8, 29, 4, 30)); // already passed → tomorrow
  assert.equal(parseQuery("۱۸:۳۰", NOW, TEHRAN).target, Date.UTC(2026, 8, 28, 15, 0));
  assert.equal(parseQuery("18:30", NOW, 0).target, Date.UTC(2026, 8, 28, 18, 30));
  assert.equal(parseQuery("25:00", NOW, TEHRAN).target, null);
  assert.equal(parseQuery("18:30:15", NOW, TEHRAN), null);
});

test("parseQuery: Gregorian and Jalali dates", () => {
  const launch = Date.UTC(2026, 9, 2, 15, 0); // 2026-10-02 18:30 Tehran
  assert.deepEqual(parseQuery("2026-10-02 18:30 🚀 لانچ", NOW, TEHRAN), { target: launch, title: "🚀 لانچ" });
  assert.equal(parseQuery("2026-10-02T18:30", NOW, TEHRAN).target, launch);
  assert.equal(parseQuery("1405/07/10 18:30", NOW, TEHRAN).target, launch);
  assert.equal(parseQuery("۱۴۰۵/۰۷/۱۰ ۱۸:۳۰ عنوان", NOW, TEHRAN).target, launch);
  assert.equal(parseQuery("1405/7/10", NOW, TEHRAN).target, Date.UTC(2026, 9, 1, 20, 30)); // midnight Tehran
  assert.equal(parseQuery("2026-02-30", NOW, TEHRAN).target, null);
  assert.equal(parseQuery("1405/07/31", NOW, TEHRAN).target, null); // Mehr has 30 days
  assert.equal(parseQuery("2020-01-01", NOW, TEHRAN).target, null); // past
});

test("parseQuery: unrecognised input", () => {
  for (const q of ["", "   ", "hello", "3days", "3 d", "2h30"]) assert.equal(parseQuery(q, NOW, TEHRAN), null, q);
});

test("jalaliToGregorian matches known Nowruz dates", () => {
  assert.deepEqual(jalaliToGregorian(1403, 1, 1), [2024, 3, 20]);
  assert.deepEqual(jalaliToGregorian(1403, 12, 30), [2025, 3, 20]);
  assert.deepEqual(jalaliToGregorian(1404, 1, 1), [2025, 3, 21]);
  assert.deepEqual(jalaliToGregorian(1405, 1, 1), [2026, 3, 21]);
  assert.deepEqual(jalaliToGregorian(1405, 7, 6), [2026, 9, 28]);
  assert.deepEqual(jalaliToGregorian(1399, 12, 30), [2021, 3, 20]);
});

test("nextTick aligns edits to whole steps before the target", () => {
  const T = NOW + 3 * D;
  assert.equal(nextTick(T, T - 25 * S, 10), T - 20 * S);
  assert.equal(nextTick(T, T - 20 * S, 10), T - 10 * S); // just rendered "20"
  assert.equal(nextTick(T, T - 20.3 * S, 10), T - 10 * S); // fired a bit early
  assert.equal(nextTick(T, T - 19.7 * S, 10), T - 10 * S); // fired a bit late
  assert.equal(nextTick(T, T - 10.5 * S, 10), T); // last one is the target itself
  assert.equal(nextTick(T, T + 2 * S, 10), T); // overdue → fire now
  assert.equal(nextTick(T, T - 7 * S + 50, 1), T - 6 * S); // 1s ticks don't skip when slightly late
  assert.equal(nextTick(T, T - 7.3 * S, 1), T - 6 * S); // …or fire twice when slightly early
  assert.equal(nextTick(T, T - 8 * S + 50, 2), T - 6 * S);
  assert.equal(nextTick(T, T - 9 * S + 50, 3), T - 6 * S);
  const first = nextTick(T, NOW + 7 * S, 10); // started 7s after the query
  assert.equal((T - first) % (10 * S), 0);
  assert.ok(first - (NOW + 7 * S) >= S && first - (NOW + 7 * S) <= 11 * S);
});

test("tzMinutes", () => {
  assert.equal(tzMinutes("+03:30"), 210);
  assert.equal(tzMinutes("-05:00"), -300);
  assert.equal(tzMinutes("0330"), 210);
  assert.equal(tzMinutes("0"), 0);
  assert.equal(tzMinutes(undefined), 210);
  assert.equal(tzMinutes("Asia/Tehran"), 210);
});
