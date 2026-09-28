import assert from "node:assert/strict";
import { test } from "node:test";
import { pageUrl, readPageUrl, renderPage } from "../src/page.js";

const ORIGIN = "https://drnettimer.example.workers.dev";
const TARGET = Date.UTC(2026, 9, 2, 15, 0);

test("page links round-trip and are signed", async () => {
  const link = await pageUrl(ORIGIN, "s3cret", TARGET, "🚀 نسخه جدید Dr.Net");
  assert.match(link, /^https:\/\/drnettimer\.example\.workers\.dev\/t\/[0-9a-z]+\/[\w-]{16}\?n=[\w-]+$/);
  assert.deepEqual(await readPageUrl(new URL(link), "s3cret"), { target: TARGET, title: "🚀 نسخه جدید Dr.Net" });

  const bare = await pageUrl(ORIGIN, "s3cret", TARGET, "");
  assert.doesNotMatch(bare, /\?/);
  assert.deepEqual(await readPageUrl(new URL(bare), "s3cret"), { target: TARGET, title: "" });
});

test("tampered or foreign links are rejected", async () => {
  const link = new URL(await pageUrl(ORIGIN, "s3cret", TARGET, "عنوان"));
  assert.equal(await readPageUrl(link, "other-secret"), null);
  assert.equal(await readPageUrl(link, undefined), null);

  const otherTitle = new URL(link);
  otherTitle.searchParams.set("n", "aGFja2Vk");
  assert.equal(await readPageUrl(otherTitle, "s3cret"), null);

  const otherTarget = new URL(link);
  otherTarget.pathname = otherTarget.pathname.replace(/\/t\/[0-9a-z]+\//, "/t/zzzzzz/");
  assert.equal(await readPageUrl(otherTarget, "s3cret"), null);

  assert.equal(await readPageUrl(new URL(`${ORIGIN}/t/abc`), "s3cret"), null);
});

test("long titles are cut to keep the link short", async () => {
  const page = await readPageUrl(new URL(await pageUrl(ORIGIN, "k", TARGET, "ت".repeat(300))), "k");
  assert.equal(page.title, "ت".repeat(120));
});

test("renderPage escapes the title and splits it around {}", () => {
  const html = renderPage({ title: 'تا <script>x</script> "{}" مانده {}', target: TARGET, now: TARGET - 5000 });
  assert.doesNotMatch(html, /<script>x/);
  assert.match(html, /<h1>تا &lt;script&gt;x&lt;\/script&gt; &quot;<\/h1>/);
  assert.match(html, /<p class="after">&quot; مانده<\/p>/);
  assert.match(html, new RegExp(`const T = ${TARGET}, skew = ${TARGET - 5000} - Date.now\\(\\)`));
  assert.match(renderPage({ title: "", target: TARGET, now: 0 }), /<title>⏳ شمارش معکوس<\/title>/);
});
