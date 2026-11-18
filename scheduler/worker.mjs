// Cloudflare Worker that starts the earnings check on time.
//
// GitHub's own `schedule` trigger is best effort: in November 2026 it fired only
// one or two of the thirteen hourly runs a day, so NVDA's results (filed 21:20 UTC
// on 17 Nov) waited hours. Cloudflare Cron Triggers fire reliably; this worker only
// asks GitHub to run .github/workflows/earnings-check.yml. It reads no market data
// and posts nothing itself. GitHub's schedule stays in the workflow as a backup.
//
// Repeated runs are safe: the workflow's concurrency group queues them and
// state/published-reports.json makes every report go out once.

export const CRON = "5,25,45 11-23 * * 1-5";

function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`Missing required scheduler binding: ${name}`);
  return value;
}

export async function dispatchCheck(env, fetchImpl = fetch) {
  const owner = required(env, "GITHUB_OWNER");
  const repo = required(env, "GITHUB_REPO");
  const ref = required(env, "GITHUB_REF");
  const workflow = encodeURIComponent(required(env, "WORKFLOW"));
  const token = required(env, "GITHUB_ACTIONS_TOKEN");
  const response = await fetchImpl(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "EarningsCheckScheduler/1.0",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      // Inputs must be strings; "false" turns dry run off so the run posts like a scheduled one.
      body: JSON.stringify({ ref, inputs: { dry_run: "false" } }),
    },
  );
  if (!response.ok) {
    const requestId = response.headers.get("x-github-request-id");
    throw new Error(`GitHub workflow dispatch failed with HTTP ${response.status}${requestId ? ` (request ${requestId})` : ""}`);
  }
  return { dispatched: true, status: response.status };
}

export default {
  async scheduled(controller, env, ctx) {
    if (controller.cron !== CRON) throw new Error(`Unregistered scheduler cron: ${controller.cron}`);
    ctx.waitUntil(
      dispatchCheck(env).then((result) => {
        console.log(JSON.stringify({ event: "earnings_check_dispatch", scheduledTime: controller.scheduledTime, ...result }));
      }),
    );
  },
};
