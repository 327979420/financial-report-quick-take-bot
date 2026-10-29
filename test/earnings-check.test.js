"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const sec = require("../src/sec");
const { checkReport, parseStream, normalizeUrl, figureMatchesQuote } = require("../src/writer");
const { parseArgs } = require("../scripts/check-earnings");

test("keeps 8-K item 2.02 and 6-K filings only", () => {
  assert.equal(sec.isEarningsCandidate({ form: "8-K", items: "2.02,9.01" }), true);
  assert.equal(sec.isEarningsCandidate({ form: "8-K", items: "5.02,9.01" }), false);
  assert.equal(sec.isEarningsCandidate({ form: "6-K", items: "" }), true);
  assert.equal(sec.isEarningsCandidate({ form: "10-Q", items: "" }), false);
});

test("reads recent filings from the submissions feed", () => {
  const filings = sec.recentFilingsFrom({
    filings: {
      recent: {
        accessionNumber: ["0000001-26-000001"],
        form: ["8-K"],
        filingDate: ["2026-10-22"],
        acceptanceDateTime: ["2026-10-22T16:05:12.000Z"],
        items: ["2.02,9.01"],
        primaryDocument: ["tsla-20261022.htm"]
      }
    }
  });
  assert.deepEqual(filings[0], {
    accession: "0000001-26-000001",
    form: "8-K",
    filingDate: "2026-10-22",
    acceptedAt: "2026-10-22T16:05:12.000Z",
    items: "2.02,9.01",
    primaryDocument: "tsla-20261022.htm"
  });
});

test("prefers exhibit 99 documents for the press release", () => {
  assert.deepEqual(
    sec.pickReleaseDocuments(["tsla-8k.htm", "tsla-ex991.htm", "logo.jpg", "tsla-ex992.htm", "tsla-ex993.htm"], "tsla-8k.htm"),
    ["tsla-ex991.htm", "tsla-ex992.htm"]
  );
  assert.deepEqual(
    sec.pickReleaseDocuments(["x-index.html", "tsm-6k.htm", "a3q26release.htm", "a3q26slides.htm", "chart.jpg"], "tsm-6k.htm"),
    ["a3q26release.htm", "a3q26slides.htm", "tsm-6k.htm"]
  );
});

test("turns release HTML into readable text with table cells", () => {
  const text = sec.htmlToText("<p>Revenue&nbsp;rose</p><table><tr><td>Revenue</td><td>$29,594</td></tr></table><script>x()</script>");
  assert.equal(text, "Revenue rose\nRevenue | $29,594 |");
});

test("recognises a 6-K results release but not monthly sales", () => {
  assert.equal(sec.looksLikeResults("ASML reports third-quarter 2026 financial results. Net sales of €9.1 billion"), true);
  assert.equal(sec.looksLikeResults("TSMC September 2026 Revenue Report. Net revenue for September"), false);
});

const release = "Total revenue was $29,594 million, up 22% year over year. GAAP diluted EPS was $2.01; non-GAAP diluted EPS was $3.32.";
const seenUrls = new Set(["https://www.reuters.com/a", "https://www.cnbc.com/b"]);
const metric = (actual, quote, consensus) => ({
  actual,
  actual_quote: quote,
  consensus,
  consensus_basis: "market_consensus",
  consensus_sources: ["https://www.reuters.com/a"]
});
const good = {
  is_earnings_release: true,
  skip_reason: "",
  company_name: "Broadcom",
  ticker: "AVGO",
  period: "Q3 FY26",
  report_date: "2026-09-02",
  revenue: metric("$29.59B", "Total revenue was $29,594 million", "$29.3B"),
  eps: metric("$3.32", "non-GAAP diluted EPS was $3.32", "$3.22"),
  market_reaction: "盘后下跌约 4%",
  market_reaction_source: "https://www.cnbc.com/b",
  conflicts: [],
  message: [
    "🟡 Broadcom（AVGO）Q3 FY26 财报速览｜2026-09-02",
    "• 营收 $29.59B vs 市场目标约 $29.3B：Beat 约 +1%",
    "• 调整后 EPS $3.32 vs $3.22：Beat +3.1%",
    "📉 市场反应：盘后下跌约 4%"
  ].join("\n")
};

test("accepts a report whose figures and sources trace back", () => {
  assert.deepEqual(checkReport(good, { ticker: "AVGO", releaseText: release, seenUrls }), []);
});

test("blocks figures, targets and reactions that cannot be traced", () => {
  const bad = {
    ...good,
    revenue: { ...good.revenue, actual_quote: "Total revenue was $30,000 million" },
    eps: { ...good.eps, consensus_sources: ["https://example.com/made-up"] },
    market_reaction_source: "https://example.com/rumour",
    conflicts: ["Reuters and CNBC disagree on EPS consensus"]
  };
  const problems = checkReport(bad, { ticker: "AVGO", releaseText: release, seenUrls });
  assert.equal(problems.length, 4);
  assert.match(problems.join("\n"), /revenue\.actual_quote is not in the release/);
  assert.match(problems.join("\n"), /eps consensus has no source/);
  assert.match(problems.join("\n"), /market reaction has no source/);
  assert.match(problems.join("\n"), /conflict: Reuters and CNBC/);
});

test("requires 公司指引目标 when the target is company guidance", () => {
  const report = { ...good, revenue: { ...good.revenue, consensus_basis: "company_guidance", consensus_sources: [] } };
  assert.match(checkReport(report, { ticker: "AVGO", releaseText: release, seenUrls }).join(), /公司指引目标/);
  report.message = report.message.replace("市场目标", "公司指引目标");
  assert.deepEqual(checkReport(report, { ticker: "AVGO", releaseText: release, seenUrls }), []);
});

test("rejects messages over the Discord budget", () => {
  const report = { ...good, message: `AVGO ${"字".repeat(1700)}` };
  assert.match(checkReport(report, { ticker: "AVGO", releaseText: release, seenUrls }).join(), /limit 1700/);
});

test("treats empty workflow inputs as unset", () => {
  assert.deepEqual(parseArgs(["--dry-run", "--since", "", "--ticker", "tsla", "--accession", ""]), {
    dryRun: true, detectOnly: false, since: null, ticker: "TSLA", accession: null
  });
});

test("reads the report, sources and cost from Claude Code stream-json", () => {
  const lines = [
    { type: "assistant", message: { content: [{ type: "tool_use", name: "WebSearch", input: { query: "TSLA Q3 estimate" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", content: 'Links: [{"title":"Tesla Q3","url":"https://www.reuters.com/tesla-q3"}]' }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "WebFetch", input: { url: "https://www.cnbc.com/tesla" } }] } },
    { type: "result", is_error: false, num_turns: 4, total_cost_usd: 0.42, structured_output: { ticker: "TSLA" }, result: "" }
  ];
  const { report, seenUrls, usage } = parseStream(lines.map((line) => JSON.stringify(line)).join("\n"));
  assert.deepEqual(report, { ticker: "TSLA" });
  assert.deepEqual([...seenUrls].sort(), ["https://www.cnbc.com/tesla", "https://www.reuters.com/tesla-q3"]);
  assert.deepEqual(usage, { costUsd: 0.42, turns: 4, searches: 1 });
});

test("surfaces a failed Claude Code run", () => {
  const line = JSON.stringify({ type: "result", is_error: true, subtype: "success", result: "Not logged in" });
  assert.throws(() => parseStream(line), /Claude Code failed: Not logged in/);
});

const { rankByTradingValue, pickMostTraded } = require("../scripts/refresh-watchlist");

test("ranks operating companies by trading value", () => {
  const rows = [
    { symbol: "NVDA", name: "NVIDIA Corporation Common Stock", lastsale: "$200.00", volume: "100", marketCap: "5000" },
    { symbol: "META", name: "Meta Platforms Inc. Class A Common Stock", lastsale: "$700.00", volume: "50", marketCap: "1800" },
    { symbol: "BRK/B", name: "Berkshire Hathaway Inc.", lastsale: "$500.00", volume: "100", marketCap: "1000" },
    { symbol: "XYZW", name: "Example Corp Warrants", lastsale: "$1.00", volume: "1000000", marketCap: "10" },
    { symbol: "PFD", name: "Example Fund", lastsale: "$10.00", volume: "100000", marketCap: "10" },
    { symbol: "NONE", name: "Quiet Inc. Common Stock", lastsale: "$5.00", volume: "0", marketCap: "10" }
  ];
  assert.deepEqual(rankByTradingValue(rows), [{ symbol: "META", value: 35000 }, { symbol: "NVDA", value: 20000 }]);
});

test("keeps existing names while they stay near the top", () => {
  const ranked = ["A", "B", "C", "D", "E", "F"].map((symbol) => ({ symbol, value: 1 }));
  assert.deepEqual(pickMostTraded(ranked, [], 3, 5), ["A", "B", "C"]);
  // E is still inside the top 5, so it stays; F has fallen out of it.
  assert.deepEqual(pickMostTraded(ranked, ["E", "F"], 3, 5), ["A", "B", "E"]);
});

test("accepts the same source URL written slightly differently", () => {
  const report = {
    ...good,
    revenue: { ...good.revenue, consensus_sources: ["https://reuters.com/a/?utm_source=x#top"] },
    market_reaction_source: "http://www.cnbc.com/b/"
  };
  assert.deepEqual(checkReport(report, { ticker: "AVGO", releaseText: release, seenUrls }), []);
  assert.equal(normalizeUrl("https://www.x.com/p?b=2&amp;a=1&utm_medium=y"), normalizeUrl("https://x.com/p/?a=1&b=2"));
});

test("matches a figure to its quote only up to rounding", () => {
  assert.equal(figureMatchesQuote("$29.59B", "Total revenue was $29,594 million"), true);
  assert.equal(figureMatchesQuote("$29.6B", "Total revenue was $29,594 million"), true);
  assert.equal(figureMatchesQuote("$29.59B", "revenue of $29.6 billion"), true);
  assert.equal(figureMatchesQuote("$29.59B", "Net revenue | 29,594 |"), true);
  assert.equal(figureMatchesQuote("NT$989.92B", "net revenue of NT$989.92 billion"), true);
  assert.equal(figureMatchesQuote("$29.95B", "Total revenue was $29,594 million"), false);
  assert.equal(figureMatchesQuote("$3.23", "non-GAAP diluted EPS was $3.32"), false);
});

test("blocks a message whose figures differ from the checked fields", () => {
  const problems = checkReport(
    { ...good, message: good.message.replace("$29.59B", "$29.95B").replace("$3.22", "$3.12") },
    { ticker: "AVGO", releaseText: release, seenUrls }
  );
  assert.match(problems.join("\n"), /revenue \$29\.59B is not the figure in the message/);
  assert.match(problems.join("\n"), /eps target \$3\.22 is not the figure in the message/);

  const mismatch = { ...good, revenue: { ...good.revenue, actual: "$29.95B" } };
  mismatch.message = good.message.replace("$29.59B", "$29.95B");
  assert.match(checkReport(mismatch, { ticker: "AVGO", releaseText: release, seenUrls }).join(), /does not match the release quote/);
});

test("blocks a market reaction line that has no recorded source", () => {
  const report = { ...good, market_reaction: "", market_reaction_source: "" };
  assert.match(checkReport(report, { ticker: "AVGO", releaseText: release, seenUrls }).join(), /mentions a market reaction/);
  report.message = good.message.split("\n").slice(0, 3).join("\n");
  assert.deepEqual(checkReport(report, { ticker: "AVGO", releaseText: release, seenUrls }), []);
});

const { windowStart, isSettled, recordError } = require("../scripts/check-earnings");

test("looks back past the weekend to the last clean run", () => {
  const hour = 3600 * 1000;
  const monday = new Date("2026-11-02T11:20:00Z").getTime();
  const state = { notBefore: "2026-10-01T00:00:00Z", checkedThrough: "2026-10-30T23:20:00Z" };
  assert.equal(new Date(windowStart(state, monday)).toISOString(), "2026-10-30T22:20:00.000Z");
  // A recent clean run still leaves the normal 48-hour window.
  assert.equal(windowStart({ ...state, checkedThrough: "2026-11-02T10:20:00Z" }, monday), monday - 48 * hour);
  // Never earlier than notBefore or seven days.
  assert.equal(windowStart({ notBefore: "2026-11-01T00:00:00Z", checkedThrough: "2026-10-30T23:20:00Z" }, monday), new Date("2026-11-01T00:00:00Z").getTime());
  assert.equal(windowStart({ ...state, checkedThrough: "2026-10-01T00:00:00Z" }, monday), monday - 7 * 24 * hour);
});

test("retries an erroring filing three times, then gives up", () => {
  const state = { reports: [] };
  const candidate = { ticker: "MSFT", filing: { accession: "0001193125-26-436122", form: "8-K" } };
  assert.equal(recordError(state, candidate, new Error("SEC returned HTTP 503")), 1);
  assert.equal(recordError(state, candidate, new Error("Claude Code produced no result")), 2);
  assert.equal(state.reports.length, 1);
  assert.equal(isSettled(state.reports[0]), false);
  assert.equal(recordError(state, candidate, new Error("again")), 3);
  assert.equal(isSettled(state.reports[0]), true);
  assert.equal(isSettled({ status: "blocked" }), true);
});
