"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const sec = require("../src/sec");
const { checkReport, parseStream, normalizeUrl, figureMatchesQuote, targetRange } = require("../src/writer");
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

const release = "Total revenue was $29,594 million, up 22% year over year. GAAP diluted EPS was $2.01; non-GAAP diluted EPS was $3.32. We expect fourth quarter revenue of approximately $34.8 billion.";
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
  verdict: "mixed",
  headline: "双超预期，但指引略弱",
  summary: "AI 业务继续高增长，但下季营收指引略低于预期",
  eps_label: "调整后 EPS",
  guidance: {
    label: "Q4 营收指引",
    value: "$34.8B",
    value_quote: "fourth quarter revenue of approximately $34.8 billion",
    consensus: "$35.05B",
    consensus_sources: ["https://www.cnbc.com/b"]
  },
  market_reaction: "盘后 -4%",
  market_reaction_source: "https://www.cnbc.com/b",
  highlights: ["AI 半导体营收 $16.7B，同比 +221%", "留意：高预期下指引略弱"],
  conflicts: [],
  minor_differences: []
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
  assert.match(problems.join("\n"), /revenue quote is not in the release/);
  assert.match(problems.join("\n"), /eps consensus has no source/);
  assert.match(problems.join("\n"), /market reaction has no source/);
  assert.match(problems.join("\n"), /conflict: Reuters and CNBC/);
});

test("keeps the card text short", () => {
  const problems = checkReport(
    { ...good, headline: "这是一条远远超过二十个字的标题，读者根本看不完它", highlights: ["a", "b", "c", "d"] },
    { ticker: "AVGO", releaseText: release, seenUrls }
  );
  assert.match(problems.join("\n"), /headline must be/);
  assert.match(problems.join("\n"), /one to three highlights/);
});

test("checks guidance against the release and its sources", () => {
  const report = { ...good, guidance: { ...good.guidance, value: "$38.4B", consensus_sources: ["https://example.com/x"] } };
  const problems = checkReport(report, { ticker: "AVGO", releaseText: release, seenUrls }).join("\n");
  assert.match(problems, /guidance \$38\.4B does not match the release quote/);
  assert.match(problems, /guidance consensus has no source/);
  const none = { ...good, guidance: { label: "", value: "", value_quote: "", consensus: "", consensus_sources: [] } };
  assert.deepEqual(checkReport(none, { ticker: "AVGO", releaseText: release, seenUrls }), []);
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

test("blocks a figure that differs from its release quote", () => {
  const mismatch = { ...good, revenue: { ...good.revenue, actual: "$29.95B" } };
  assert.match(checkReport(mismatch, { ticker: "AVGO", releaseText: release, seenUrls }).join(), /does not match the release quote/);
});

const { renderCard, cardToText, surprisePct, surpriseLine, sessionLabel } = require("../src/card");

test("lays out the card with computed surprises", () => {
  const card = renderCard(good, {
    filing: { form: "8-K", acceptedAt: "2026-09-02T20:10:00Z" },
    releaseUrls: ["https://www.sec.gov/Archives/edgar/data/1/2/ex99.htm"]
  });
  assert.equal(card.color, 0xf1c40f);
  assert.equal(card.author.name, "AVGO · Q3 FY26 · 2026-09-02 盘后");
  assert.equal(card.title, "Broadcom：双超预期，但指引略弱");
  assert.deepEqual(card.fields.slice(0, 3).map((field) => field.value), [
    "**$29.59B**\n预期 $29.3B\n✅ +1.0%",
    "**$3.32**\n预期 $3.22\n✅ +3.1%",
    "**$34.8B**\n预期 $35.05B\n❌ -0.7%"
  ]);
  assert.equal(card.fields[3].value, "📉 盘后 -4%");
  assert.match(card.fields[4].value, /^· AI 半导体营收/);
  assert.equal(card.footer.text, "来源：SEC 8-K · 预期 reuters.com / cnbc.com");
  const ranged = renderCard({ ...good, revenue: { ...good.revenue, consensus: "$29.0–29.3B" } }, { filing: { form: "8-K", acceptedAt: "2026-09-02T20:10:00Z" }, releaseUrls: [] });
  assert.equal(ranged.fields[0].value, "**$29.59B**\n预期 $29.0–29.3B\n✅ +1.0%~+2.0%");
  assert.match(cardToText(card), /\[营收\] \$29\.59B \| 预期 \$29\.3B \| ✅ \+1\.0%/);
});

test("labels targets that are not market consensus", () => {
  const report = {
    ...good,
    revenue: { ...good.revenue, consensus_basis: "company_guidance" },
    eps: { ...good.eps, consensus: "", consensus_basis: "unavailable", consensus_sources: [] },
    guidance: { label: "", value: "", value_quote: "", consensus: "", consensus_sources: [] },
    market_reaction: ""
  };
  const card = renderCard(report, { filing: { form: "8-K", acceptedAt: "2026-09-02T11:00:00Z" }, releaseUrls: [] });
  assert.equal(card.fields[0].value, "**$29.59B**\n公司指引 $29.3B\n✅ +1.0%");
  assert.equal(card.fields[1].value, "**$3.32**\n无可比预期");
  assert.deepEqual(card.fields[2], { name: "指引", value: "未给出数字指引", inline: true });
  assert.equal(card.fields[3].name, "看点");
  assert.match(card.author.name, /盘前$/);
});

test("computes surprises against ranges and calls small ones in line", () => {
  assert.equal(surprisePct("$3.9–4.0B", "$3.6B").toFixed(1), "9.7");
  assert.equal(surprisePct("$90.70B", "$90.61–90.69B").toFixed(2), "0.06");
  assert.equal(surpriseLine(0.3), "➖ 持平 +0.3%");
  assert.equal(surpriseLine(-2), "❌ -2.0%");
  assert.equal(surpriseLine(9.9, 1.7), "✅ +1.7%~+9.9%");
  assert.equal(sessionLabel("2026-11-03T15:00:00Z"), "盘中");
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

test("reads a target written as a range", () => {
  assert.deepEqual(targetRange("$90.61–90.69B"), [90.61e9, 90.69e9]);
  assert.deepEqual(targetRange("约 $4.72-$4.73"), [4.72, 4.73]);
  assert.deepEqual(targetRange("$29,300 to $29,400 million"), [29.3e9, 29.4e9]);
  assert.equal(targetRange("$29.3B"), null);
  assert.equal(targetRange("-$0.12"), null);
});

test("allows a target range unless the figure falls inside it", () => {
  const ranged = (consensus) => checkReport({ ...good, revenue: { ...good.revenue, consensus } }, { ticker: "AVGO", releaseText: release, seenUrls });
  assert.deepEqual(ranged("$29.25–29.35B"), []);
  assert.match(ranged("$29.5–29.7B").join(), /inside the target range/);
});
