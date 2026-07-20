import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("https://x424.org/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the x424 landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>x424 — Human Dependency Protocol<\/title>/i);
  assert.match(html, /Make an HTTP action depend on one human\./);
  assert.match(html, /github\.com\/x424protocol\/x424/);
  assert.match(html, /424 Failed Dependency/);
  assert.match(html, /HUMAN-REQUIRED/);
  assert.match(html, /HUMAN-PROOF/);
  assert.match(html, /HTTP-native unique-human dependencies\./);
  assert.match(html, /x424 → x402 → authorization → execution/);
  assert.match(
    html,
    /<script[^>]+src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-EZVEJ0RCVT"/,
  );
  assert.match(html, /<script id="google-analytics">/);
  assert.match(html, /gtag\('config', 'G-EZVEJ0RCVT'\)/);
  assert.match(html, /https:\/\/x424\.org\/og\.png/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});
