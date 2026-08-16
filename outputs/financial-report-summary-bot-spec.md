# Financial Report Summary Bot — Editorial Spec v0.1

Date: 17 August 2026 (Australia/Melbourne)

## Purpose

Publish quick-glance Discord summaries of company financial reports for stocks that attract sustained investor attention, with extra focus on AI infrastructure, memory semiconductors, and crypto-linked equities.

This is an information product, not investment advice. Separate reported facts from management claims and interpretation.

## Recommended launch watchlist

### Tier 1 — always cover

These companies drive the main narratives and tend to move related stocks.

| Ticker | Company | Why it belongs |
|---|---|---|
| NVDA | Nvidia | AI accelerator demand, data-center spending, HBM consumption |
| MSFT | Microsoft | Azure growth, AI monetisation, hyperscaler capex |
| AMZN | Amazon | AWS growth and AI infrastructure investment |
| GOOGL | Alphabet | Cloud/AI growth, advertising, capex |
| META | Meta Platforms | Advertising, AI capex, model/product monetisation |
| TSLA | Tesla | Large retail following; EV, autonomy, robotics and energy narratives |
| PLTR | Palantir | Highly followed AI software name; commercial and government growth |
| AMD | Advanced Micro Devices | AI accelerator and server-CPU competition |
| AVGO | Broadcom | AI networking/custom silicon plus infrastructure software |
| TSM | TSMC | Foundry demand and an early read on the whole advanced-chip cycle |
| MU | Micron Technology | Best direct, liquid US-listed read on DRAM, NAND and HBM |
| COIN | Coinbase | Crypto trading activity, custody, stablecoins and regulation sensitivity |
| MSTR | Strategy | Leveraged public-equity proxy for Bitcoin exposure |
| HOOD | Robinhood | Retail trading, crypto activity and prediction-market/product expansion |

### Tier 2 — specialist coverage

Always cover earnings, major guidance changes and genuinely material filings; omit routine minor news.

| Ticker / listing | Company | Coverage angle |
|---|---|---|
| 000660.KS / US ADS if available | SK hynix | HBM leadership, DRAM pricing, capacity allocation |
| 005930.KS | Samsung Electronics | DRAM/NAND/HBM execution and foundry performance |
| SNDK | Sandisk | NAND pricing and flash-cycle exposure |
| STX | Seagate | Nearline storage demand and data-centre buildout |
| WDC | Western Digital | HDD/storage cycle and cloud demand |
| MRVL | Marvell Technology | AI networking and custom silicon |
| ASML | ASML | Lithography orders and semiconductor capex cycle |
| ARM | Arm Holdings | Data-centre/edge royalties and AI compute architecture |
| MARA | MARA Holdings | Bitcoin mining economics, treasury and power strategy |
| RIOT | Riot Platforms | Bitcoin mining economics and power assets |
| IREN | IREN | Bitcoin mining plus AI/HPC data-centre transition |
| GLXY | Galaxy Digital | Institutional crypto infrastructure and market activity |

### Context instruments — never write full earnings summaries

Track these to explain reactions: BTC, ETH, SOL, QQQ, SMH, IBIT, the US 10-year Treasury yield, DXY, and the Fed policy rate. Use them as context rather than headline subjects.

## Dynamic popularity rules

Review the list weekly. A non-watchlist stock becomes a seven-day **candidate** when at least two signals are present:

1. It is among the most-discussed relevant tickers across monitored investor communities.
2. Trading volume is at least 2× its 20-day average or the one-day move is at least 8%.
3. It has a material catalyst: earnings, guidance, major filing, product launch, acquisition, regulatory decision or capital raise.
4. Its event materially changes the thesis for a tracked theme.

Promote a candidate to Tier 2 after two qualifying weeks in a rolling six-week window. Promote to Tier 1 only after sustained attention and clear read-through to the wider market. Demote after eight quiet weeks. Never promote from mention count alone; ticker ambiguity and coordinated promotion are common.

## What every financial-report post should contain

### 1. Header

- Company, ticker and reporting period
- One-sentence verdict: **beat / mixed / miss**, including whether guidance strengthened or weakened

### 2. Scorecard

- Revenue: actual, expected figure if available, and year-over-year change
- EPS: actual and expected figure if available, clearly labelled GAAP or adjusted
- Gross margin and/or operating margin
- Free cash flow
- Cash and debt, preferably expressed as net cash or net debt
- Guidance: raised, maintained, lowered or not provided

If consensus data is unavailable, say so. Never invent a “beat” from year-over-year growth alone.

### 3. Quick takeaways

Give no more than three short bullets covering the most important changes. Examples: demand, pricing, product mix, capacity, capex or margins.

### 4. One optional sector KPI

Include only when it materially explains the quarter:

- **Hyperscalers:** cloud growth or AI capex
- **Semiconductors:** data-centre growth or inventory
- **Memory:** HBM progress, DRAM/NAND pricing or capacity
- **Crypto platforms:** trading volume or crypto revenue
- **Crypto miners/treasury companies:** BTC held/produced or production cost

Source links and market-price reactions are not included in the audience-facing post. The bot should still retain its source records internally for verification and corrections.

## Discord formats

### Standard quick take

Aim for 500–750 characters and one compact Discord message:

> **MU Q4 FY26 — BEAT | Guidance raised**  
> Revenue: `$X` vs `$Y` expected (`+X% YoY`)  
> EPS: `$X` vs `$Y` expected · Gross margin: `X%`  
> FCF: `$X` · Net cash/debt: `$X`  
> **Quick takeaways**  
> • `[Most important development]`  
> • `[Second important development]`  
> • `[Optional risk or memory/HBM KPI]`

### Weekly radar

- Upcoming reports in the next seven days, in Melbourne time and US market time
- Three highest-priority names with the KPI that matters most
- Newly promoted/demoted candidates and the signals responsible
- One sentence each for AI compute, memory, and crypto-equity conditions

## Editorial safeguards

- Label GAAP, adjusted and management-defined metrics.
- Mark preliminary figures and later corrections.
- Attribute forward-looking statements to management.
- Do not convert rumours or social posts into facts.
- Do not give buy/sell instructions or personalised portfolio advice.
- When data conflicts, show the conflict and prefer the filed document.
- Retain the source URL and captured publication time for every numeric claim.

## Initial implementation order

1. Earnings calendar and primary-source ingestion for Tier 1.
2. Structured extraction into a stable report schema.
3. Quick-take generator with validation and Discord preview.
4. Scheduled weekly radar.
5. Popularity scoring and automated Tier 2 candidate rotation.
6. Visual polish only after factual accuracy and delivery reliability are measured.

## Launch success criteria

- At least 99% of published numbers trace to a linked primary source.
- Zero unlabeled mixing of GAAP and adjusted metrics.
- Quick take published within 15 minutes of a report for Tier 1 names.
- Corrections are visibly posted and linked to the original summary.
- No more than five routine posts per day outside peak earnings periods.
