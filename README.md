# Financial Report Quick Take Bot

A portfolio-ready prototype that turns structured earnings data into compact Discord-ready summaries.

The bot is designed for people who want the important numbers at a glance—not a long research report. It focuses on popular technology, AI infrastructure, memory-semiconductor, and crypto-linked stocks.

## Example output

```text
📊 MU Q4 FY26 — BEAT | Guidance raised

Revenue: $11.32B vs $10.95B expected (+38% YoY)
Adj. EPS: $3.21 vs $2.95 expected
Gross margin: 44.7% | Operating margin: 36.2%
Free cash flow: $2.84B | Net cash: $1.40B

Quick takeaways
• HBM revenue more than doubled as AI demand remained strong.
• Gross margin expanded on improved pricing and product mix.
• Management raised next-quarter revenue guidance.
```

## What it includes

- A focused, tiered stock watchlist
- Beat, mixed, or miss classification
- Guidance direction
- Revenue and EPS versus expectations
- Margins, free cash flow, and balance-sheet position
- Up to three quick takeaways
- Discord-safe output kept below a configurable character limit
- Automated tests using Node's built-in test runner

## Run locally

Requires Node.js 20 or newer. No packages need to be installed.

```bash
npm run demo
npm test
```

To format another report:

```bash
node src/cli.js path/to/report.json
```

## Input format

See [`examples/micron-q4-fy26.json`](examples/micron-q4-fy26.json). Financial values are supplied as display strings so the formatter does not introduce rounding or currency errors.

## Project structure

```text
config/watchlist.json       Stocks and themes to monitor
examples/                   Sample structured earnings data
src/formatter.js            Summary validation and formatting
src/cli.js                  Command-line interface
test/formatter.test.js      Automated tests
outputs/                    Editorial and watchlist design notes
```

## Roadmap

- Ingest primary-source earnings releases and filings
- Extract and validate financial metrics
- Send summaries through a Discord webhook
- Add an earnings calendar and weekly radar
- Add presentation-quality Discord embeds

## Disclaimer

This project provides informational summaries only and is not financial advice. The included report is illustrative sample data, not a live investment report.

