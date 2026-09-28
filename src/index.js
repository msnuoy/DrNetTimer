// DrNetTimer — live countdowns in Telegram inline messages.
//
// Worker: Telegram webhook. Inline queries, button taps and /start are answered
//   straight in the webhook response (no extra round trip). When a result is
//   sent, `chosen_inline_result` hands us its inline_message_id and we start
//   a Countdown for it.
// Countdown (Durable Object, one per sent message): keeps {id, target, title}
//   and edits the message on an alarm once a minute until the target.
// The target time travels inside result_id / callback_data, so nothing else
// needs storage.

import { DurableObject } from "cloudflare:workers";
import { DONE_TEXT, countdown, formatLeft, isDone, nextTick, parseQuery, renderMessage, tzMinutes } from "./core.js";

const ALLOWED_UPDATES = ["message", "inline_query", "chosen_inline_result", "callback_query"];
const STEP = 60; // the message shows minutes, so it's edited once a minute, as the minute changes

const enc = (target) => (target / 1000).toString(36);
const dec = (s) => parseInt(s, 36) * 1000;
const keyboard = (target) => ({ inline_keyboard: [[{ text: "⏱ زمان دقیق", callback_data: "t" + enc(target) }]] });

async function tg(env, method, body) {
  try {
    const res = await fetch(`${env.TG_API || "https://api.telegram.org"}/bot${env.BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error_code: 0, description: String(e) };
  }
}

function allowed(env, userId) {
  const ids = String(env.ALLOWED_USERS ?? "").split(/[\s,]+/).filter(Boolean);
  return ids.length === 0 || ids.includes(String(userId));
}

// Bot username for help texts, from getMe (cached per isolate).
let botUsername;
async function username(env) {
  botUsername ??= (await tg(env, "getMe", {})).result?.username;
  return botUsername ?? "DrNetTimerBot";
}

function helpText(env, bot, userId) {
  return [
    `⏳ <b>${bot}</b> — شمارش معکوس زنده`,
    "",
    "در هر چت، گروه یا کانالی بنویسید:",
    `<code>@${bot} 3d 🚀 نسخه جدید Dr.Net</code>`,
    "",
    "<b>فرمت زمان</b>",
    "• مدت: <code>3d</code> · <code>2h30m</code> · <code>1w2d</code> · <code>90s</code>",
    "• ساعت (امروز یا فردا): <code>18:30</code>",
    "• تاریخ: <code>1405/07/10 18:30</code> یا <code>2026-10-02 18:30</code>",
    `ساعت‌ها به وقت UTC${env.TZ_OFFSET || "+03:30"} هستند.`,
    "",
    "• با <code>{}</code> جای شمارش را وسط متن خودتان بگذارید:",
    `<code>@${bot} 3d تا انتشار {} مانده</code>`,
    "",
    "پیام هر دقیقه به‌روز می‌شود؛ دکمهٔ «⏱ زمان دقیق» زمان باقی‌مانده را تا ثانیه نشان می‌دهد.",
    "",
    `🆔 شناسهٔ شما: <code>${userId}</code>`,
  ].join("\n");
}

// Checks the token, points the webhook here and fills in the bot profile
// (command list; descriptions only if still empty, so BotFather edits stay).
async function setup(env, origin) {
  const me = await tg(env, "getMe", {});
  if (!me.ok) return { ok: false, error: `Telegram rejected BOT_TOKEN: ${me.description}` };
  const bot = (botUsername = me.result.username);
  const [hook, , desc, short] = await Promise.all([
    tg(env, "setWebhook", { url: `${origin}/`, secret_token: env.WEBHOOK_SECRET, allowed_updates: ALLOWED_UPDATES }),
    tg(env, "setMyCommands", { commands: [{ command: "start", description: "راهنما" }] }),
    tg(env, "getMyDescription", {}),
    tg(env, "getMyShortDescription", {}),
  ]);
  if (desc.ok && !desc.result.description) {
    const description = `⏳ شمارش معکوس زنده داخل خود پیام.\n\nدر هر چت، گروه یا کانالی بنویسید:\n@${bot} 3d 🚀 عنوان\n\nزمان: مدت (3d، 2h30m)، ساعت (18:30) یا تاریخ (1405/07/10 18:30).`;
    await tg(env, "setMyDescription", { description });
  }
  if (short.ok && !short.result.short_description) {
    await tg(env, "setMyShortDescription", { short_description: `⏳ شمارش معکوس زنده داخل پیام. بنویسید: @${bot} 3d عنوان` });
  }
  return {
    ok: hook.ok,
    bot: `@${bot}`,
    inline_mode: Boolean(me.result.supports_inline_queries),
    webhook: hook.description,
  };
}

// Returns a Bot API call to send back as the webhook response, or null.
async function handle(update, env) {
  const now = Date.now();
  const tz = tzMinutes(env.TZ_OFFSET);

  if (update.inline_query) {
    const q = update.inline_query;
    const answer = { method: "answerInlineQuery", inline_query_id: q.id, cache_time: 0, is_personal: true, results: [] };
    if (!allowed(env, q.from.id)) {
      return { ...answer, cache_time: 300, button: { text: "⛔️ این ربات خصوصی است", start_parameter: "private" } };
    }
    const p = parseQuery(q.query, now, tz);
    if (!p?.target) {
      const hint = p ? "⚠️ زمان نامعتبر یا گذشته است" : "⏳ مثال: 3d عنوان · 2h30m · 18:30";
      return { ...answer, button: { text: hint, start_parameter: "help" } };
    }
    answer.results.push({
      type: "article",
      id: "c" + enc(p.target),
      title: p.title.replaceAll("{}", "⏳") || "شمارش معکوس",
      description: `⏳ ${countdown(p.target - now)}`,
      input_message_content: { message_text: renderMessage(p.title, p.target, now), parse_mode: "HTML" },
      reply_markup: keyboard(p.target),
    });
    return answer;
  }

  if (update.chosen_inline_result) {
    const r = update.chosen_inline_result;
    const [, id36] = /^c([0-9a-z]+)(?:_\d+)?$/.exec(r.result_id) ?? []; // "_<tick>": results from older versions
    const target = id36 ? dec(id36) : NaN;
    if (r.inline_message_id && Number.isFinite(target) && allowed(env, r.from.id)) {
      const title = parseQuery(r.query, now, tz)?.title ?? "";
      const stub = env.COUNTDOWN.get(env.COUNTDOWN.idFromName(r.inline_message_id));
      await stub.start({ id: r.inline_message_id, target, title });
    }
    return null;
  }

  if (update.callback_query) {
    const c = update.callback_query;
    const target = c.data?.startsWith("t") ? dec(c.data.slice(1)) : NaN;
    const text = !Number.isFinite(target) ? "" : isDone(target, now) ? DONE_TEXT : formatLeft(target - now);
    return { method: "answerCallbackQuery", callback_query_id: c.id, text };
  }

  const msg = update.message;
  if (msg?.chat.type === "private" && msg.text?.startsWith("/start")) {
    const text = helpText(env, await username(env), msg.from?.id);
    return { method: "sendMessage", chat_id: msg.chat.id, text, parse_mode: "HTML" };
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const secret = env.WEBHOOK_SECRET;

    // Called by `npm run setup` (or open https://<worker>/setup?key=<WEBHOOK_SECRET>).
    if (url.pathname === "/setup") {
      if (!secret || url.searchParams.get("key") !== secret) return new Response("forbidden", { status: 403 });
      return Response.json(await setup(env, url.origin));
    }

    if (request.method !== "POST") return new Response("DrNetTimer is running.");
    if (!secret || request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
      return new Response("unauthorized", { status: 401 });
    }
    const reply = await handle(await request.json(), env);
    return reply ? Response.json(reply) : new Response(null);
  },
};

export class Countdown extends DurableObject {
  async start(job) {
    const storage = this.ctx.storage;
    if (await storage.get("job")) return; // duplicate delivery
    await storage.put("job", job);
    await storage.setAlarm(nextTick(job.target, Date.now(), STEP));
  }

  async alarm() {
    const storage = this.ctx.storage;
    const job = await storage.get("job");
    if (!job) return;

    const now = Date.now();
    const done = isDone(job.target, now);
    const res = await tg(this.env, "editMessageText", {
      inline_message_id: job.id,
      text: renderMessage(job.title, job.target, now),
      parse_mode: "HTML",
      reply_markup: done ? undefined : keyboard(job.target), // drop the button once finished
    });

    if (res.ok || /not modified/i.test(res.description ?? "")) {
      if (done) return this.stop();
      return storage.setAlarm(nextTick(job.target, now, STEP));
    }
    if (res.error_code === 429) {
      // Flood control: wait as told, then carry on.
      return storage.setAlarm(now + (res.parameters?.retry_after ?? 5) * 1000);
    }
    if (res.error_code >= 400 && res.error_code < 500) {
      // Message deleted or no longer editable.
      console.log("countdown stopped:", res.description);
      return this.stop();
    }
    // Network / Telegram 5xx: keep going, but give up an hour past the target.
    if (now - job.target > 3600_000) return this.stop();
    return storage.setAlarm(done ? now + 5000 : nextTick(job.target, now, STEP));
  }

  async stop() {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
}
