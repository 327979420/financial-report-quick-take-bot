"use strict";

// Turns one earnings press release into the fields of a Chinese Discord card.
// Headless Claude Code (signed in with CLAUDE_CODE_OAUTH_TOKEN) reads the
// release, looks up consensus and market reaction with WebSearch/WebFetch,
// and returns JSON matching REPORT_SCHEMA. checkReport() then rejects anything
// whose figures or sources cannot be traced; src/card.js lays out the post.

const { spawn } = require("node:child_process");
const { amounts, targetRange, figureMatchesQuote } = require("./numbers");

const MODEL = process.env.MODEL || "opus";
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const MAX_TURNS = 40;
const TIMEOUT_MS = 20 * 60 * 1000;
const MAX_HEADLINE = 20;
const MAX_SUMMARY = 50;
const MAX_HIGHLIGHT = 40;

const SYSTEM = `You prepare short Chinese earnings cards for a Discord group of retail traders. The card shows a scoreboard (revenue, EPS, next-quarter guidance, each against expectations), the market reaction and up to three highlights. You supply the fields; code lays them out and computes the beat/miss percentages, so do not write percentages versus expectations yourself.

You receive one SEC filing that may contain a quarterly or annual earnings release. Work only from verifiable facts:
- Every reported figure comes from the release text you are given. Write it compactly as traders read it ($3.66B, $1.20, $3.9–4.0B, 64.0%). Never estimate or round in a way that changes meaning.
- Revenue and EPS targets: find the market consensus on the web, ideally confirmed by two current sources (news reports that state the analyst estimate, e.g. LSEG / FactSet / Zacks). If no consensus exists but the company guided last quarter, use that with consensus_basis "company_guidance". If neither exists, use "unavailable" and leave consensus empty.
- EPS: prefer the adjusted (non-GAAP) figure when consensus is quoted on that basis, and say which in eps_label ("调整后 EPS" or "GAAP EPS").
- Guidance: the company's main numeric outlook for next quarter or year, usually revenue (label like "Q4 营收指引"). Give consensus for that figure when a source states it. Leave label empty if the release gives no numeric outlook.
- Market reaction: only a real after-hours or next-session move that a source you found reports, written short, e.g. "盘后 +6%" or "盘后 -1%~-4%". Otherwise leave it empty. Never speculate.
- Sources often differ slightly (consensus $90.61B vs $90.69B, a 2.5% vs 4% move measured at different times). When every source leads to the same verdict, that is not a conflict: write the target as a range ($90.61–90.69B) and note it in "minor_differences". Facts you left out because only one source reports them also go there.
- List in "conflicts" only disagreements that change a verdict (the figure beats one source's target but misses another's) or a source figure that contradicts the release. A conflict blocks the post, so do not pick one source to avoid it.

Writing, in simplified Chinese, short and plain:
- verdict: beat (revenue and EPS beat and guidance is not weak), miss (both miss or guidance clearly weak), otherwise mixed.
- headline: at most ${MAX_HEADLINE} characters, the verdict in words, e.g. "全面超预期，指引更强", "营收超预期，但指引偏弱", "双双不及预期".
- summary: one sentence of at most ${MAX_SUMMARY} characters saying why, without repeating scoreboard numbers.
- highlights: one to three items, each at most ${MAX_HIGHLIGHT} characters with at most one or two numbers: the facts a trader would act on (segment growth, backlog, margins, buybacks). Do not repeat scoreboard figures. The last one may start with "留意：" for a risk.

List in consensus_sources and market_reaction_source only URLs you actually opened or found in this session. If the filing is not a quarterly or annual earnings release (for example monthly sales, a shareholder meeting notice, or an acquisition), set is_earnings_release false with a short skip_reason and leave the other fields empty.`;

const metric = {
  type: "object",
  properties: {
    actual: { type: "string", description: "Reported figure as shown on the card, e.g. $29.59B or $3.32" },
    actual_quote: { type: "string", description: "Short verbatim snippet copied from the release text that contains this figure, at least as precise as the figure on the card" },
    consensus: { type: "string", description: "Target figure as shown on the card, e.g. $29.3B or $90.61–90.69B, or empty if none" },
    consensus_basis: { type: "string", enum: ["market_consensus", "company_guidance", "unavailable"] },
    consensus_sources: { type: "array", items: { type: "string" }, description: "URLs from your web search results that state the target" }
  },
  required: ["actual", "actual_quote", "consensus", "consensus_basis", "consensus_sources"],
  additionalProperties: false
};

const REPORT_SCHEMA = {
  type: "object",
  properties: {
    is_earnings_release: { type: "boolean" },
    skip_reason: { type: "string" },
    company_name: { type: "string" },
    ticker: { type: "string" },
    period: { type: "string", description: "Fiscal period, e.g. Q3 FY26" },
    report_date: { type: "string", description: "Release date, YYYY-MM-DD" },
    verdict: { type: "string", enum: ["beat", "mixed", "miss"] },
    headline: { type: "string" },
    summary: { type: "string" },
    revenue: metric,
    eps_label: { type: "string", description: "调整后 EPS or GAAP EPS" },
    eps: metric,
    guidance: {
      type: "object",
      properties: {
        label: { type: "string", description: "e.g. Q4 营收指引, or empty if no numeric outlook" },
        value: { type: "string", description: "e.g. $3.9–4.0B" },
        value_quote: { type: "string", description: "Verbatim snippet from the release containing the outlook" },
        consensus: { type: "string", description: "Market expectation for the same figure, or empty" },
        consensus_sources: { type: "array", items: { type: "string" } }
      },
      required: ["label", "value", "value_quote", "consensus", "consensus_sources"],
      additionalProperties: false
    },
    market_reaction: { type: "string", description: "e.g. 盘后 +6%, or empty" },
    market_reaction_source: { type: "string", description: "URL that reports the price move, or empty" },
    highlights: { type: "array", items: { type: "string" } },
    conflicts: { type: "array", items: { type: "string" }, description: "Disagreements that change a verdict or contradict the release; these block the post" },
    minor_differences: { type: "array", items: { type: "string" }, description: "Source differences that do not change any verdict, and facts left out" }
  },
  required: [
    "is_earnings_release", "skip_reason", "company_name", "ticker", "period", "report_date",
    "verdict", "headline", "summary", "revenue", "eps_label", "eps", "guidance",
    "market_reaction", "market_reaction_source", "highlights", "conflicts", "minor_differences"
  ],
  additionalProperties: false
};

const URL_PATTERN = /https?:\/\/[^\s"'<>()\[\]{}\\]+/g;

// Reads Claude Code's stream-json output: every URL that appeared in a
// WebSearch/WebFetch result or WebFetch request, the final JSON, and usage.
function parseStream(stdout) {
  const seenUrls = new Set();
  const usage = { costUsd: 0, turns: 0, searches: 0 };
  let result = null;

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const content = Array.isArray(event.message?.content) ? event.message.content : [];
    if (event.type === "assistant") {
      for (const block of content) {
        if (block.type !== "tool_use") continue;
        if (block.name === "WebSearch") usage.searches++;
        if (block.name === "WebFetch" && block.input?.url) seenUrls.add(block.input.url);
      }
    }
    if (event.type === "user") {
      for (const block of content) {
        if (block.type !== "tool_result") continue;
        for (const url of JSON.stringify(block.content ?? "").match(URL_PATTERN) ?? []) seenUrls.add(url.replace(/[.,;]+$/, ""));
      }
    }
    if (event.type === "result") result = event;
  }

  if (!result) throw new Error("Claude Code produced no result");
  if (result.is_error) throw new Error(`Claude Code failed: ${result.result || result.subtype}`);
  usage.costUsd = result.total_cost_usd ?? 0;
  usage.turns = result.num_turns ?? 0;
  const report = result.structured_output ?? JSON.parse(result.result);
  return { report, seenUrls, usage };
}

function runClaude(prompt) {
  const args = [
    "-p",
    "--model", MODEL,
    "--output-format", "stream-json",
    "--verbose",
    "--max-turns", String(MAX_TURNS),
    "--system-prompt", SYSTEM,
    "--tools", "WebSearch,WebFetch",
    "--allowedTools", "WebSearch,WebFetch",
    "--json-schema", JSON.stringify(REPORT_SCHEMA)
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), TIMEOUT_MS);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      // A failed run still writes a result event; let parseStream report it.
      if (!stdout.trim()) reject(new Error(`claude exited ${code}: ${stderr.trim().slice(0, 500)}`));
      else resolve(stdout);
    });
    child.stdin.end(prompt);
  });
}

async function draftReport({ ticker, companyName, filing, release }) {
  const prompt = [
    `Ticker: ${ticker}`,
    `Company: ${companyName}`,
    `SEC form ${filing.form}, accepted ${filing.acceptedAt}`,
    `Filing documents: ${release.urls.join(" ")}`,
    "",
    "<release>",
    release.text,
    "</release>"
  ].join("\n");

  const parsed = parseStream(await runClaude(prompt));
  for (const url of release.urls) parsed.seenUrls.add(url);
  return parsed;
}

const squash = (text) => text.replace(/\s+/g, " ").trim().toLowerCase();

// Compares URLs the way a reader would: ignores the scheme, "www.", a
// trailing slash, the fragment, HTML-escaped ampersands and tracking parameters.
function normalizeUrl(raw) {
  try {
    const url = new URL(raw.trim().replace(/&amp;/g, "&"));
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_\w+|guccounter|guce_\w+|ref|refsrc|cmpid|mod|taid|ncid|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return `${host}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  } catch {
    return raw.trim();
  }
}

// Returns a list of problems; an empty list means the report may be published.
function checkReport(report, { ticker, releaseText, seenUrls }) {
  const problems = [];
  const source = squash(releaseText);
  const seen = new Set([...seenUrls].map(normalizeUrl));
  const isSeen = (url) => seen.has(normalizeUrl(url));
  const quoted = (name, figure, quote) => {
    if (!/\d/.test(quote) || !source.includes(squash(quote))) problems.push(`${name} quote is not in the release: "${quote}"`);
    else if (figure.trim() && !figureMatchesQuote(figure, quote)) problems.push(`${name} ${figure} does not match the release quote "${quote}"`);
  };

  if (report.ticker.toUpperCase() !== ticker.toUpperCase()) problems.push(`ticker ${report.ticker} does not match ${ticker}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(report.report_date)) problems.push(`report_date "${report.report_date}" is not YYYY-MM-DD`);
  if (!report.period.trim()) problems.push("period is empty");
  for (const conflict of report.conflicts) problems.push(`conflict: ${conflict}`);

  for (const name of ["revenue", "eps"]) {
    const item = report[name];
    if (!item.actual.trim()) problems.push(`${name}.actual is empty`);
    quoted(name, item.actual, item.actual_quote);
    if (item.consensus_basis !== "unavailable" && !item.consensus.trim()) problems.push(`${name} has a ${item.consensus_basis} basis but no target`);
    const range = item.consensus_basis !== "unavailable" && targetRange(item.consensus);
    const [figure] = amounts(item.actual.replace(/^[^\d]*/, ""));
    if (range && figure && figure.value >= range[0] && figure.value <= range[1]) {
      problems.push(`${name} ${item.actual} is inside the target range ${item.consensus}, so sources disagree on beat or miss`);
    }
    if (item.consensus_basis === "market_consensus" && !item.consensus_sources.some(isSeen)) {
      problems.push(`${name} consensus has no source from the search results`);
    }
  }

  const guidance = report.guidance;
  if (guidance.label.trim()) {
    if (!guidance.value.trim()) problems.push("guidance has a label but no value");
    quoted("guidance", guidance.value, guidance.value_quote);
    if (guidance.consensus.trim() && !guidance.consensus_sources.some(isSeen)) problems.push("guidance consensus has no source from the search results");
  }

  if (report.market_reaction.trim() && !isSeen(report.market_reaction_source)) problems.push("market reaction has no source from the search results");

  const length = (text) => [...text.trim()].length;
  if (!length(report.headline) || length(report.headline) > MAX_HEADLINE) problems.push(`headline must be 1–${MAX_HEADLINE} characters: "${report.headline}"`);
  if (!length(report.summary) || length(report.summary) > MAX_SUMMARY) problems.push(`summary must be 1–${MAX_SUMMARY} characters`);
  if (report.highlights.length < 1 || report.highlights.length > 3) problems.push(`needs one to three highlights, got ${report.highlights.length}`);
  for (const item of report.highlights) {
    if (!length(item) || length(item) > MAX_HIGHLIGHT) problems.push(`highlight must be 1–${MAX_HIGHLIGHT} characters: "${item}"`);
  }

  return problems;
}

module.exports = { draftReport, checkReport, parseStream, normalizeUrl, figureMatchesQuote, targetRange, MODEL };
