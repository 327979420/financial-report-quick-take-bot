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

## From report to quick take

**Report → supplied key metrics → beat/miss verdict → guidance → takeaways → Discord-ready briefing**

The current formatter validates structured JSON and presents the supplied figures, verdict, and takeaways. It does not independently extract metrics, calculate surprises, or decide whether a company beat expectations.

A separate [manual publishing workflow](.github/workflows/publish-report.yml) can send a prepared message through a Discord webhook. Live filing ingestion and automatic metric verification are not implemented. Those are the next steps, alongside an earnings calendar.

## Run locally

Requires Node.js 20+. No packages to install.

```bash
npm run demo
npm test
node src/cli.js path/to/report.json
```

Use the sample JSON as the input template. Financial values are display strings, avoiding extra rounding by the formatter. For manual delivery, configure the repository secret `DISCORD_WEBHOOK_URL`; the workflow takes a base64-encoded message prepared and verified by the operator.

For information and discussion, not investment advice.
