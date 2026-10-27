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

**New filing on SEC EDGAR → OpenAI reads the release and checks consensus → automatic checks → Discord**

A [scheduled GitHub Action](.github/workflows/earnings-check.yml) runs hourly on US trading days. It looks for new earnings releases (8-K item 2.02, or 6-K results for foreign issuers) from every company in the [watchlist](config/watchlist.json), then:

1. Reads the press release straight from the filing.
2. Asks OpenAI (gpt-6-astra with web search) to write the Chinese briefing, looking up the analyst consensus and any real after-hours move on the web.
3. Blocks the post unless revenue and EPS can be quoted from the release, every target and price move links to a source that was actually found, and the message fits in 1,700 characters. When only company guidance is available, the message must say so.
4. Posts to Discord and records the result in [state/published-reports.json](state/published-reports.json), so each report goes out once.

A blocked report fails the run (GitHub emails the owner) and is not retried. Korean listings (SK hynix, Samsung) are not on EDGAR and are skipped for now.

To test, run **Check for new earnings** from the Actions tab. It defaults to a dry run that prints the draft without posting. `accession` processes one specific filing.

Needs two repository secrets: `OPENAI_API_KEY` and `DISCORD_WEBHOOK_URL`. The model defaults to `gpt-6-astra` and can be changed with the `MODEL` environment variable.

## Run locally

Requires Node.js 22.

```bash
npm ci
npm test
node scripts/check-earnings.js --detect-only --since 2026-10-20T00:00:00Z
OPENAI_API_KEY=... node scripts/check-earnings.js --dry-run --accession <accession number>
```

The original JSON formatter still works for hand-made summaries (`npm run demo`), and the [manual publishing workflow](.github/workflows/publish-report.yml) can send a prepared message.

For information and discussion, not investment advice.
