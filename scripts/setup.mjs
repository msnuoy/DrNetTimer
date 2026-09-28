// One-command setup: deploy the Worker, store its secrets, register the webhook.
//   npm run setup
// Answers can also come from the environment: BOT_TOKEN=... ALLOWED_USERS=... npm run setup

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WRANGLER = process.env.WRANGLER_JS || join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

function wrangler(args, options = {}) {
  const r = spawnSync(process.execPath, [WRANGLER, ...args], { cwd: ROOT, stdio: "inherit", ...options });
  if (r.status !== 0) fail(`"wrangler ${args.join(" ")}" failed, see the output above.`);
}

// Hostname of the deployed Worker, from wrangler's machine-readable output.
function deployedUrl(outputFile) {
  if (!existsSync(outputFile)) return null;
  const entries = readFileSync(outputFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const targets = entries.filter((e) => e.type === "deploy").flatMap((e) => e.targets ?? []);
  const target = targets.find((t) => t.includes("workers.dev")) ?? targets.find((t) => /^(https?:\/\/)?[\w.-]+(:\d+)?$/.test(t));
  return target ? normalizeUrl(target) : null;
}

const normalizeUrl = (s) => (/^https?:\/\//.test(s) ? s : `https://${s}`).replace(/\/+$/, "");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Line prompts. The async iterator buffers input, so piped answers aren't lost.
let rl;
let lines;
async function ask(question) {
  rl ??= createInterface({ input: process.stdin, output: process.stdout });
  lines ??= rl[Symbol.asyncIterator]();
  rl.setPrompt(question);
  rl.prompt();
  const { value, done } = await lines.next();
  return done ? "" : value.trim();
}
function closePrompts() {
  rl?.close();
  rl = lines = undefined;
}

if (Number(process.versions.node.split(".")[0]) < 22) {
  fail(`Node.js 22 or newer is required (this is ${process.version}). Download it from https://nodejs.org`);
}
if (!existsSync(WRANGLER)) {
  console.log("Installing dependencies…");
  spawnSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: ROOT, stdio: "inherit", shell: true });
  if (!existsSync(WRANGLER)) fail("npm install failed.");
}

console.log(`
DrNetTimer setup
────────────────
First, in Telegram → @BotFather:
  1. /newbot             → copy the token (the username must end in "bot")
  2. /setinline          → choose the bot → placeholder, e.g.: 3d title
  3. /setinlinefeedback  → choose the bot → Enabled   (needed for live updates)
`);

const token = (process.env.BOT_TOKEN ?? (await ask("Bot token from @BotFather: "))).trim();
if (!/^\d{5,}:[\w-]{30,}$/.test(token)) fail("That doesn't look like a bot token (expected 123456789:AA…).");
const allowed = (
  process.env.ALLOWED_USERS ??
  (await ask("Telegram user IDs allowed to create countdowns (comma-separated, Enter = anyone): "))
)
  .split(/[\s,]+/)
  .filter(Boolean);
if (allowed.some((id) => !/^\d+$/.test(id))) fail("User IDs are numbers, e.g. 123456789,987654321");
closePrompts();

console.log("\n→ Deploying to Cloudflare (a browser window opens if you need to log in)…\n");
const outDir = mkdtempSync(join(tmpdir(), "drnettimer-"));
wrangler(["deploy"], { env: { ...process.env, WRANGLER_OUTPUT_FILE_PATH: join(outDir, "output.json") } });
let url = deployedUrl(join(outDir, "output.json"));
rmSync(outDir, { recursive: true, force: true });
if (!url) {
  url = normalizeUrl(await ask("Worker URL shown above (https://…): "));
  closePrompts();
}

console.log("\n→ Saving secrets…\n");
const webhookSecret = randomBytes(24).toString("hex");
const secrets = { BOT_TOKEN: token, WEBHOOK_SECRET: webhookSecret };
if (allowed.length) secrets.ALLOWED_USERS = allowed.join(",");
wrangler(["secret", "bulk"], { input: JSON.stringify(secrets), stdio: ["pipe", "inherit", "inherit"] });

// The new secrets (and, on a first deploy, the workers.dev DNS name) take a
// little while to go live; until then /setup answers 403 or doesn't resolve.
process.stdout.write("\n→ Registering the Telegram webhook");
const setupUrl = `${url}/setup?key=${webhookSecret}`;
let result;
for (let attempt = 0; attempt < 40 && !result; attempt++) {
  try {
    const res = await fetch(setupUrl, { signal: AbortSignal.timeout(15_000) });
    if (res.ok) result = await res.json();
  } catch {
    // not reachable yet
  }
  if (!result) {
    process.stdout.write(".");
    await sleep(3000);
  }
}
if (!result) fail(`Couldn't reach ${url}. Open this link in a browser (maybe with a VPN) to finish:\n  ${setupUrl}`);
if (!result.ok) fail(result.error ?? `setWebhook failed: ${result.webhook}`);

console.log(`\n\n✔ ${result.bot} is live at ${url}`);
if (!result.inline_mode) console.log("⚠ Inline mode is off: in @BotFather send /setinline and choose the bot.");
console.log(`
Next:
  • Make sure /setinlinefeedback is Enabled in @BotFather (Telegram doesn't let bots check it).
  • Send /start to ${result.bot}. It replies with help and your user ID.
  • Try it in any chat:  ${result.bot} 2m test`);
if (!allowed.length) {
  console.log("  • To make the bot private: npx wrangler secret put ALLOWED_USERS  (paste your user ID)");
}
