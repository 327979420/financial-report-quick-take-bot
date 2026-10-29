"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const sec = require("../src/sec");
const { checkReport, parseStream } = require("../src/writer");
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
const metric = (actual, quote) => ({
  actual,
  actual_quote: quote,
  consensus: "x",
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
  revenue: metric("$29.59B", "Total revenue was $29,594 million"),
  eps: metric("$3.32", "non-GAAP diluted EPS was $3.32"),
  market_reaction: "盘后下跌约 4%",
  market_reaction_source: "https://www.cnbc.com/b",
  conflicts: [],
  message: "🟡 Broadcom（AVGO）Q3 FY26 财报速览｜2026-09-02"
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
  report.message += "\n营收 vs 公司指引目标";
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
