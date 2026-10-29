#!/usr/bin/env node
"use strict";

// Rebuilds config/watchlist.json from the most traded US stocks: the top
// names by trading value (last price × shares traded) in Nasdaq's free stock
// screener, which covers NYSE, Nasdaq and NYSE American. Pinned names are
// always kept. Runs inside the earnings workflow when the list is a week old.
//
//   node scripts/refresh-watchlist.js [--dry-run] [--if-older-than-days 7]

const fs = require("node:fs");
const path = require("node:path");

const WATCHLIST_PATH = path.join(__dirname, "..", "config", "watchlist.json");
const SCREENER_URL = "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true";
const LIST_SIZE = 60;
const KEEP_WITHIN = 90; // existing names stay while still this high, so the list does not churn
const NOT_A_COMPANY = /\b(ETF|ETN|fund|warrants?|rights?|units?|notes|preferred|debentures?)\b/i;

const number = (text) => Number(String(text ?? "").replace(/[$,%]/g, "")) || 0;

// Returns [{ symbol, value }] for operating companies, highest trading value first.
function rankByTradingValue(rows) {
  return rows
    .filter((row) => /^[A-Z]{1,5}$/.test(row.symbol) && !NOT_A_COMPANY.test(row.name) && number(row.marketCap) > 0)
    .map((row) => ({ symbol: row.symbol, value: number(row.lastsale) * number(row.volume) }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
}

function pickMostTraded(ranked, previous = [], size = LIST_SIZE, keepWithin = KEEP_WITHIN) {
  const position = new Map(ranked.map((row, index) => [row.symbol, index]));
  const kept = previous.filter((symbol) => position.has(symbol) && position.get(symbol) < keepWithin);
  const picked = new Set(kept);
  for (const row of ranked) {
    if (picked.size >= Math.max(size, kept.length)) break;
    picked.add(row.symbol);
  }
  return [...picked].sort((a, b) => position.get(a) - position.get(b));
}

async function fetchScreener() {
  const response = await fetch(SCREENER_URL, {
    headers: {
      // The screener rejects requests without a browser-like user agent.
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      accept: "application/json"
    },
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) throw new Error(`Nasdaq screener returned HTTP ${response.status}`);
  const rows = (await response.json())?.data?.rows;
  if (!Array.isArray(rows) || rows.length < 1000) throw new Error("Nasdaq screener returned an unexpected payload");
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const maxAgeIndex = args.indexOf("--if-older-than-days");
  const current = JSON.parse(fs.readFileSync(WATCHLIST_PATH, "utf8"));

  if (maxAgeIndex !== -1 && current.updatedAt) {
    const ageDays = (Date.now() - new Date(current.updatedAt).getTime()) / 86_400_000;
    if (ageDays < Number(args[maxAgeIndex + 1])) {
      console.log(`Watchlist is ${ageDays.toFixed(1)} days old; no refresh needed`);
      return;
    }
  }

  const ranked = rankByTradingValue(await fetchScreener());
  const mostTraded = pickMostTraded(ranked, current.mostTraded ?? []);
  const valueOf = new Map(ranked.map((row) => [row.symbol, row.value]));
  const added = mostTraded.filter((symbol) => !(current.mostTraded ?? []).includes(symbol));
  const removed = (current.mostTraded ?? []).filter((symbol) => !mostTraded.includes(symbol));

  const next = {
    ...current,
    updatedAt: new Date().toISOString(),
    mostTraded,
    tradingValueMillionsUsd: Object.fromEntries(mostTraded.map((symbol) => [symbol, Math.round(valueOf.get(symbol) / 1e6)]))
  };

  console.log(`Most traded (${mostTraded.length}): ${mostTraded.join(" ")}`);
  console.log(`Added: ${added.join(" ") || "none"}`);
  console.log(`Removed: ${removed.join(" ") || "none"}`);
  if (!dryRun) fs.writeFileSync(WATCHLIST_PATH, `${JSON.stringify(next, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    // On a real run keep the existing list rather than block the earnings check;
    // a dry run (pull request check) should fail loudly instead.
    console.log(`::warning::Watchlist refresh skipped: ${error.message}`);
    if (process.argv.includes("--dry-run")) process.exitCode = 1;
  });
}

module.exports = { rankByTradingValue, pickMostTraded };
