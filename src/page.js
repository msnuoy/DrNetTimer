// Live countdown page behind the "⏱ زمان دقیق" button. Telegram can't edit a
// message every second, but a browser can tick.

import { DONE_TEXT } from "./core.js";

const utf8 = new TextEncoder();
const MAX_TITLE = 120; // characters carried in the link

const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function sign(secret, data) {
  const key = await crypto.subtle.importKey("raw", utf8.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8.encode(data))).slice(0, 12));
}

/** Link to the live page. Signed, so the page only shows texts the bot issued. */
export async function pageUrl(origin, secret, target, title) {
  const id = (target / 1000).toString(36);
  const n = b64url(utf8.encode(Array.from(title).slice(0, MAX_TITLE).join("")));
  return `${origin}/t/${id}/${await sign(secret, `${id}.${n}`)}${n ? `?n=${n}` : ""}`;
}

/** { target, title } for a valid page link, otherwise null. */
export async function readPageUrl(url, secret) {
  const m = /^\/t\/([0-9a-z]+)\/([\w-]+)$/.exec(url.pathname);
  const n = url.searchParams.get("n") ?? "";
  if (!m || !secret || m[2] !== (await sign(secret, `${m[1]}.${n}`))) return null;
  return { target: parseInt(m[1], 36) * 1000, title: new TextDecoder().decode(unb64url(n)) };
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The page: title (split around "{}" if present) and a ticking countdown. */
export function renderPage({ title, target, now }) {
  const i = title.indexOf("{}");
  const before = (i < 0 ? title : title.slice(0, i)).trim();
  const after = i < 0 ? "" : title.slice(i + 2).replaceAll("{}", "").trim();
  const cell = (id, label) => `<div class="cell"><b id="${id}">00</b><span>${label}</span></div>`;
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>⏳ ${esc(before || "شمارش معکوس")}</title>
<style>
:root { color-scheme: light dark; --bg: #f4f6f9; --card: #fff; --fg: #10151b; --muted: #6b7682; --accent: #2a8bd6; }
@media (prefers-color-scheme: dark) { :root { --bg: #0e1319; --card: #19212a; --fg: #eef2f6; --muted: #8e99a5; --accent: #5ab3f5; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--fg); font-family: system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif; }
main { width: 100%; max-width: 520px; text-align: center; }
h1 { margin: 0 0 20px; font-size: 1.3rem; font-weight: 600; line-height: 1.7; overflow-wrap: anywhere; }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.cell { background: var(--card); border-radius: 14px; padding: 14px 4px 10px; box-shadow: 0 1px 3px rgb(0 0 0 / 8%); }
.cell b { display: block; font-size: clamp(1.8rem, 10vw, 3rem); font-weight: 800; font-variant-numeric: tabular-nums; color: var(--accent); }
.cell span { color: var(--muted); font-size: .85rem; }
.after { margin: 20px 0 0; font-size: 1.1rem; overflow-wrap: anywhere; }
.when { margin: 24px 0 0; color: var(--muted); font-size: .9rem; }
.done { margin: 20px 0 0; font-size: 1.4rem; font-weight: 700; }
</style>
</head>
<body>
<main>
${before ? `<h1>${esc(before)}</h1>` : ""}
<div class="grid" id="grid">${cell("d", "روز")}${cell("h", "ساعت")}${cell("m", "دقیقه")}${cell("s", "ثانیه")}</div>
${after ? `<p class="after">${esc(after)}</p>` : ""}
<p class="done" id="done" hidden>${DONE_TEXT}</p>
<p class="when" id="when"></p>
</main>
<script>
const T = ${Number(target)}, skew = ${Number(now)} - Date.now(); // server clock, not the device's
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const fa = (o) => new Intl.DateTimeFormat("fa-IR", o).format(T);
$("when").textContent = \`🗓 \${fa({ weekday: "long" })} \${fa({ day: "numeric", month: "long", year: "numeric" })} · ساعت \${fa({ hour: "2-digit", minute: "2-digit" })}\`;
function tick() {
  const t = Math.max(0, Math.round((T - Date.now() - skew) / 1000));
  $("d").textContent = pad(Math.floor(t / 86400));
  $("h").textContent = pad(Math.floor((t % 86400) / 3600));
  $("m").textContent = pad(Math.floor((t % 3600) / 60));
  $("s").textContent = pad(t % 60);
  if (t === 0) {
    clearInterval(timer);
    $("done").hidden = false;
  }
}
const timer = setInterval(tick, 200);
tick();
</script>
</body>
</html>`;
}
