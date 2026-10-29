# Financial Report Quick Take Bot

**Turn an earnings report into the numbers worth reading first.**

A compact earnings briefing for me and my Discord group, so we can review the key figures before digging into a full release or filing.

## Example output

Excerpt generated from the included [MU sample input](examples/micron-q4-fy26.json). **These figures are illustrative, not verified earnings results.** The supplied verdict is BEAT and guidance is raised.

```text
Revenue: $11.32B vs $10.95B expected (+38% YoY)
Adj. EPS: $3.21 vs $2.95 expected
Gross margin: 44.7% | Operating margin: 36.2%
Free cash flow: $2.84B | Net cash: $1.40B

Quick takeaways
• HBM revenue more than doubled as AI demand remained strong.
• Gross margin expanded on improved pricing and product mix.
• Management raised next-quarter revenue guidance.
```

## What it captures

Revenue and EPS against expectations, margins, free cash flow, balance-sheet position, and guidance direction, followed by up to three takeaways. The output stays within a configurable character limit for easy sharing in Discord.

## How it runs

**New filing on SEC EDGAR → Claude reads the release and checks consensus → automatic checks → Discord**

A [scheduled GitHub Action](.github/workflows/earnings-check.yml) runs hourly on US trading days. It looks for new earnings releases (8-K item 2.02, or 6-K results for foreign issuers) from every company in the [watchlist](config/watchlist.json), then:

1. Reads the press release straight from the filing.
2. Asks Claude Code (headless, with web search) to write the Chinese briefing, looking up the analyst consensus and any real after-hours move on the web.
3. Blocks the post unless revenue and EPS can be quoted from the release and the message shows those same figures (allowing only for rounding), every target and price move in the message links to a source that was actually found, the message fits in 1,700 characters, and sources do not disagree on whether a figure beat or missed. Small differences that leave the verdict unchanged (e.g. $90.61B vs $90.69B consensus) are shown as a range instead. When only company guidance is available, the message must say so.
4. Posts to Discord and records the result in [state/published-reports.json](state/published-reports.json), so each report goes out once.

A blocked report fails the run (GitHub emails the owner) and is not retried; to publish it after checking, run the workflow by hand with its `accession` and dry run off. Other errors (SEC or Claude Code failing) are retried on the next runs, up to three attempts.

Each run starts new filings for 20 minutes at most; anything left over is handled by the next hourly run. The check looks back at least 48 hours, and further back to the last run that finished everything, so filings from late Friday are still found on Monday.

**Which companies.** The [watchlist](config/watchlist.json) follows where the money is: the 60 most traded US-listed stocks by trading value (last price × shares traded) from Nasdaq's free stock screener, refreshed weekly inside the same workflow, plus a few pinned names that are always covered. A name already on the list stays while it is still in the top 90, so the list does not churn on one quiet day. ETFs and funds are excluded because they do not report earnings.

To test, run **Check for new earnings** from the Actions tab. It defaults to a dry run that prints the draft without posting. `accession` processes one specific filing.

Needs two repository secrets: `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`, so it runs on a Claude subscription rather than API billing) and `DISCORD_WEBHOOK_URL`. The model defaults to Opus and can be changed with the `MODEL` environment variable.

## Run locally

Requires Node.js 22 and the Claude Code CLI.

```bash
npm ci
npm test
node scripts/check-earnings.js --detect-only --since 2026-10-20T00:00:00Z
node scripts/check-earnings.js --dry-run --accession <accession number>
```

The original JSON formatter still works for hand-made summaries (`npm run demo`), and the [manual publishing workflow](.github/workflows/publish-report.yml) can send a prepared message.

For information and discussion, not investment advice.
