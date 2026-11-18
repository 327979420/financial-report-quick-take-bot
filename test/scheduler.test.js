const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const env = {
  GITHUB_OWNER: "327979420",
  GITHUB_REPO: "financial-report-quick-take-bot",
  GITHUB_REF: "main",
  WORKFLOW: "earnings-check.yml",
  GITHUB_ACTIONS_TOKEN: "test-token",
};

test("scheduler dispatches a live (non-dry) earnings check", async () => {
  const { dispatchCheck } = await import("../scheduler/worker.mjs");
  const calls = [];
  const result = await dispatchCheck(env, async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status: 204 });
  });
  assert.equal(result.dispatched, true);
  assert.equal(calls[0].url, "https://api.github.com/repos/327979420/financial-report-quick-take-bot/actions/workflows/earnings-check.yml/dispatches");
  assert.deepEqual(JSON.parse(calls[0].init.body), { ref: "main", inputs: { dry_run: "false" } });
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
});

test("scheduler reports a failed dispatch", async () => {
  const { dispatchCheck } = await import("../scheduler/worker.mjs");
  await assert.rejects(dispatchCheck(env, async () => new Response("no", { status: 403 })), /HTTP 403/);
  await assert.rejects(dispatchCheck({ ...env, GITHUB_ACTIONS_TOKEN: "" }, async () => new Response(null, { status: 204 })), /GITHUB_ACTIONS_TOKEN/);
});

test("worker cron matches wrangler config", async () => {
  const { CRON } = await import("../scheduler/worker.mjs");
  const config = fs.readFileSync(path.join(__dirname, "../scheduler/wrangler.jsonc"), "utf8");
  assert.ok(config.includes(`"crons": ["${CRON}"]`));
});
