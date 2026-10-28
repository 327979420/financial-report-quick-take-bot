#!/usr/bin/env node
"use strict";

// Scheduled earnings check. Finds new earnings filings for the watchlist on
// SEC EDGAR, has Claude Code draft and source a Chinese briefing, verifies it, and
// posts it to Discord. State lives in state/published-reports.json.
//
//   node scripts/check-earnings.js [--dry-run] [--detect-only]
//     [--since ISO] [--ticker TSLA] [--accession 0001628280-26-012345]
//
// --dry-run      draft and print, but do not post or write state
// --detect-only  list candidate filings only (no Claude call)
// --since        look back to this time instead of the normal window
// --accession    process exactly this filing, even if already handled

const fs = require("node:fs");
const path = require("node:path");
const sec = require("../src/sec");
const { draftReport, checkReport, MODEL } = require("../src/writer");

const ROOT = path.join(__dirname, "..");
const STATE_PATH = path.join(ROOT, "state", "published-reports.json");
const WATCHLIST_PATH = path.join(ROOT, "config", "watchlist.json");
const LOOKBACK_HOURS = Number(process.env.LOOKBACK_HOURS || 48);

function parseArgs(argv) {
  const args = { dryRun: false, detectOnly: false, since: null, ticker: null, accession: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--detect-only") args.detectOnly = true;
    else if (flag === "--since") args.since = argv[++i];
    else if (flag === "--ticker") args.ticker = argv[++i].toUpperCase();
    else if (flag === "--accession") args.accession = argv[++i];
    else throw new Error(`Unknown argument ${flag}`);
  }
  // Empty strings come through from optional workflow inputs.
  for (const key of ["since", "ticker", "accession"]) if (!args[key]) args[key] = null;
  return args;
}

function watchlistTickers() {
  const watchlist = JSON.parse(fs.readFileSync(WATCHLIST_PATH, "utf8"));
  const names = [...Object.values(watchlist.core).flat(), ...(watchlist.activeRedditRadar ?? [])];
  return [...new Set(names.map((name) => name.toUpperCase()))].sort();
}

const reportKey = (ticker, period, reportDate) => `${ticker}|${period}|${reportDate}`.toUpperCase();

async function postToDiscord(content) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) throw new Error("DISCORD_WEBHOOK_URL is not configured");
  const response = await fetch(`${url}?wait=true`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } })
  });
  if (!response.ok) throw new Error(`Discord returned HTTP ${response.status}`);
}

async function findCandidates(args, state, tickerMap) {
  const now = Date.now();
  const windowStart = args.since
    ? new Date(args.since).getTime()
    : Math.max(new Date(state.notBefore).getTime(), now - LOOKBACK_HOURS * 3600 * 1000);
  const handled = new Set(state.reports.map((report) => report.accession).filter(Boolean));
  const tickers = args.ticker ? [args.ticker] : watchlistTickers();
  const candidates = [];
  const unsupported = [];

  console.log(`Checking ${tickers.length} tickers for filings since ${new Date(windowStart).toISOString()}`);
  for (const ticker of tickers) {
    const company = tickerMap.get(ticker);
    if (!company) {
      unsupported.push(ticker);
      continue;
    }
    for (const filing of await sec.recentFilings(company.cik)) {
      const match = args.accession
        ? filing.accession === args.accession
        : new Date(filing.acceptedAt).getTime() >= windowStart &&
          sec.isEarningsCandidate(filing) &&
          !handled.has(filing.accession);
      if (match) candidates.push({ ticker, companyName: company.name, cik: company.cik, filing });
    }
  }
  if (unsupported.length) console.log(`Not on EDGAR, skipped: ${unsupported.join(", ")}`);
  return candidates;
}

async function processCandidate(candidate, args, state) {
  const { ticker, filing } = candidate;
  const label = `${ticker} ${filing.form} ${filing.accession}`;
  const record = (fields) => state.reports.push({ ticker, accession: filing.accession, form: filing.form, recordedAt: new Date().toISOString(), ...fields });

  const release = await sec.releaseText(candidate.cik, filing);
  if (filing.form === "6-K" && !release.texts.some(sec.looksLikeResults)) {
    console.log(`${label}: not an earnings release, skipped`);
    record({ status: "skipped", reason: "6-K without quarterly results" });
    return "skipped";
  }

  const { report, seenUrls, usage } = await draftReport({ ...candidate, release });
  console.log(`${label}: ${MODEL} took ${usage.turns} turns, ${usage.searches} searches, $${usage.costUsd.toFixed(2)} equivalent`);

  if (!report.is_earnings_release) {
    console.log(`${label}: not an earnings release (${report.skip_reason})`);
    record({ status: "skipped", reason: report.skip_reason });
    return "skipped";
  }

  const key = reportKey(ticker, report.period, report.report_date);
  if (!args.accession && state.reports.some((item) => item.status === "published" && reportKey(item.ticker, item.period, item.reportDate) === key)) {
    console.log(`${label}: ${report.period} already published, skipped`);
    record({ status: "skipped", period: report.period, reportDate: report.report_date, reason: "duplicate of a published report" });
    return "skipped";
  }

  const problems = checkReport(report, { ticker, releaseText: release.text, seenUrls });
  console.log(`\n----- ${label} -----\n${report.message}\n`);
  if (problems.length) {
    console.log(`${label}: BLOCKED\n- ${problems.join("\n- ")}`);
    record({ status: "blocked", period: report.period, reportDate: report.report_date, reason: problems.join("; ") });
    return "blocked";
  }

  if (args.dryRun) {
    console.log(`${label}: passed checks (dry run, not posted)`);
    return "drafted";
  }
  await postToDiscord(report.message);
  record({ status: "published", period: report.period, reportDate: report.report_date, publishedAt: new Date().toISOString() });
  console.log(`${label}: published ${report.period}`);
  return "published";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  const before = JSON.stringify(state);

  const tickerMap = await sec.loadTickerMap();
  const candidates = await findCandidates(args, state, tickerMap);
  console.log(`Found ${candidates.length} candidate filing(s)`);
  for (const { ticker, filing } of candidates) {
    console.log(`- ${ticker} ${filing.form} ${filing.accession} accepted ${filing.acceptedAt} items ${filing.items || "-"}`);
  }
  if (args.detectOnly || candidates.length === 0) return;

  let failures = 0;
  let saved = before;
  for (const candidate of candidates) {
    try {
      const outcome = await processCandidate(candidate, args, state);
      if (outcome === "blocked") failures++;
    } catch (error) {
      // Left unrecorded so the next run tries again.
      failures++;
      console.error(`${candidate.ticker} ${candidate.filing.accession}: ${error.message}`);
    }
    // Save after every filing so a later crash cannot cause a repeat post.
    const current = JSON.stringify(state);
    if (!args.dryRun && current !== saved) {
      fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
      saved = current;
    }
  }
  if (failures) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, reportKey };
