"use strict";

// Turns one earnings press release into a verified Chinese Discord briefing.
// Headless Claude Code (signed in with CLAUDE_CODE_OAUTH_TOKEN) reads the
// release, looks up consensus and market reaction with WebSearch/WebFetch,
// and returns JSON matching REPORT_SCHEMA. checkReport() then rejects anything
// whose figures or sources cannot be traced.

const { spawn } = require("node:child_process");

const MODEL = process.env.MODEL || "opus";
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const MAX_TURNS = 40;
const TIMEOUT_MS = 20 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 1700;

const STYLE_EXAMPLE = `🟡 Broadcom（AVGO）Q3 FY26 财报速览｜2026-09-02

结论：本季双超预期，但新指引略低于市场目标，整体 Mixed。
• 营收 $29.59B vs 市场目标约 $29.3B：Beat 约 +1%
• 调整后 EPS $3.32 vs $3.22：Beat +3.1%
• GAAP / 调整后毛利率 69.1% / 75.0%；调整后营业利润率 67.9%
• 经营现金流 $14.20B，自由现金流 $13.67B（占营收 46%）
• 现金 $23.98B，总债务 $59.42B，净债务约 $35.44B

📌 指引：Q4 营收约 $34.8B vs 市场目标约 $35.05B：Miss 约 -0.7%；调整后营业利润率约 66%。
📉 市场反应：盘后早段一度下跌约 3%–5%，焦点落在略逊预期的营收指引。

重点：
1️⃣ AI 半导体营收 $16.7B，同比 +221%；Q4 预计升至 $21.7B。
2️⃣ 半导体业务营收 $20.84B，同比 +127%；基础设施软件 $8.75B，同比 +29%。
3️⃣ 盈利与现金流很强，但高预期环境下，后续股价更取决于 AI 增长兑现及指引上修空间。`;

const SYSTEM = `You write short Chinese earnings briefings for a Discord group of retail investors.

You receive one SEC filing that may contain a quarterly or annual earnings release. Work only from verifiable facts:
- Every reported figure (revenue, EPS, margins, cash flow, cash/debt, guidance) comes from the release text you are given. Never estimate or round in a way that changes meaning.
- Revenue and EPS targets: find the market consensus on the web, ideally confirmed by two current sources (news reports that state the analyst estimate, e.g. LSEG / FactSet / Zacks figures). If no consensus can be found but the company gave guidance last quarter, you may compare against that and must say "公司指引目标" in the message, never "市场预期". If neither exists, say so plainly.
- Market reaction: include it only if a source you found reports a real after-hours or next-session price move. Otherwise leave it out. Never speculate.
- Guidance: state the new outlook and compare it with consensus where a source gives one. Do not call it raised or lowered unless the release or a source supports that.
- Sources often differ slightly, e.g. revenue consensus $90.61B vs $90.69B, or a 2.5% vs 4% after-hours move measured at different times. When every source leads to the same verdict (beat, miss or in line), that is not a conflict: write the target or move as a range (市场目标约 $90.61–90.69B, 盘后上涨约 2.5%–4%) and note the difference in "minor_differences". Facts you left out because only one source reports them (e.g. guidance given only on the earnings call) also go in "minor_differences".
- List in "conflicts" only disagreements that change a verdict (the reported figure beats one source's target but misses another's) or a source figure that contradicts the release. A conflict blocks the post, so do not pick one source to avoid it.

The message must be at most ${MAX_MESSAGE_LENGTH} characters, in simplified Chinese, and follow this layout (emoji in moderation; 🟢 beat, 🟡 mixed, 🔴 miss):

${STYLE_EXAMPLE}

Return the result as JSON. Write actual, consensus and market_reaction exactly as they appear in the message. List in consensus_sources and market_reaction_source only URLs you actually opened or found in this session. If the filing is not a quarterly or annual earnings release (for example monthly sales, a shareholder meeting notice, or an acquisition), set is_earnings_release false with a short skip_reason and leave the other fields empty.`;

const metric = {
  type: "object",
  properties: {
    actual: { type: "string", description: "Reported figure as shown in the message, e.g. $29.59B or $3.32" },
    actual_quote: { type: "string", description: "Short verbatim snippet copied from the release text that contains this figure, at least as precise as the figure in the message" },
    consensus: { type: "string", description: "Target figure as shown in the message, e.g. $29.3B, or empty if none" },
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
    revenue: metric,
    eps: metric,
    market_reaction: { type: "string", description: "The reaction line as written in the message, or empty" },
    market_reaction_source: { type: "string", description: "URL that reports the price move, or empty" },
    conflicts: { type: "array", items: { type: "string" }, description: "Disagreements that change a verdict or contradict the release; these block the post" },
    minor_differences: { type: "array", items: { type: "string" }, description: "Source differences that do not change any verdict, and facts left out" },
    message: { type: "string" }
  },
  required: [
    "is_earnings_release", "skip_reason", "company_name", "ticker", "period", "report_date",
    "revenue", "eps", "market_reaction", "market_reaction_source", "conflicts", "minor_differences", "message"
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

const SCALE = { k: 1e3, thousand: 1e3, "万": 1e4, m: 1e6, mn: 1e6, million: 1e6, "亿": 1e8, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, tn: 1e12, trillion: 1e12 };
const AMOUNT = /(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|trillion|mn|bn|tn|[kmbt](?![a-z])|万|亿)?/gi;

// Every number in the text with its value and display precision. A number
// without a unit could be in thousands or millions (financial tables), so it
// is offered at each scale.
function amounts(text) {
  const found = [];
  for (const [, digits, unit] of text.matchAll(AMOUNT)) {
    const value = Number(digits.replace(/,/g, ""));
    const decimals = (digits.split(".")[1] ?? "").length;
    const scales = unit ? [SCALE[unit.toLowerCase()]] : [1, 1e3, 1e6, 1e9];
    for (const scale of scales) found.push({ value: value * scale, precision: 0.5 * 10 ** -decimals * scale });
  }
  return found;
}

// A target written as a range, e.g. "$90.61–90.69B" or "约 $4.72-$4.73", as
// [low, high]; a unit after the second number applies to both. Null otherwise.
function targetRange(text) {
  const match = text.match(/(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|trillion|mn|bn|tn|[kmbt](?![a-z])|万|亿)?\s*(?:–|—|-|~|～|至|to)\s*[^\d\s]*\s*(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|trillion|mn|bn|tn|[kmbt](?![a-z])|万|亿)?/i);
  if (!match) return null;
  const [, low, lowUnit, high, highUnit] = match;
  const scale = (unit) => (unit ? SCALE[unit.toLowerCase()] : 1);
  const values = [Number(low.replace(/,/g, "")) * scale(lowUnit || highUnit), Number(high.replace(/,/g, "")) * scale(highUnit || lowUnit)];
  return [Math.min(...values), Math.max(...values)];
}

// True when the figure in the message agrees with a number in the quote,
// allowing only for rounding to the coarser of the two precisions.
function figureMatchesQuote(actual, quote) {
  const [figure] = amounts(actual.replace(/^[^\d]*/, ""));
  if (!figure) return false;
  return amounts(quote).some((candidate) =>
    Math.abs(candidate.value - figure.value) <= Math.max(candidate.precision, figure.precision) * (1 + 1e-9)
  );
}

// Returns a list of problems; an empty list means the report may be published.
function checkReport(report, { ticker, releaseText, seenUrls }) {
  const problems = [];
  const source = squash(releaseText);
  const message = squash(report.message);
  const seen = new Set([...seenUrls].map(normalizeUrl));
  const isSeen = (url) => seen.has(normalizeUrl(url));

  if (report.ticker.toUpperCase() !== ticker.toUpperCase()) problems.push(`ticker ${report.ticker} does not match ${ticker}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(report.report_date)) problems.push(`report_date "${report.report_date}" is not YYYY-MM-DD`);
  if (!report.period.trim()) problems.push("period is empty");
  for (const conflict of report.conflicts) problems.push(`conflict: ${conflict}`);

  for (const name of ["revenue", "eps"]) {
    const item = report[name];
    if (!item.actual.trim()) problems.push(`${name}.actual is empty`);
    if (!/\d/.test(item.actual_quote) || !source.includes(squash(item.actual_quote))) {
      problems.push(`${name}.actual_quote is not in the release: "${item.actual_quote}"`);
    } else if (item.actual.trim() && !figureMatchesQuote(item.actual, item.actual_quote)) {
      problems.push(`${name}.actual ${item.actual} does not match the release quote "${item.actual_quote}"`);
    }
    if (item.actual.trim() && !message.includes(squash(item.actual))) problems.push(`${name} ${item.actual} is not the figure in the message`);
    if (item.consensus_basis !== "unavailable" && item.consensus.trim() && !message.includes(squash(item.consensus))) {
      problems.push(`${name} target ${item.consensus} is not the figure in the message`);
    }
    const range = item.consensus_basis !== "unavailable" && targetRange(item.consensus);
    const [figure] = amounts(item.actual.replace(/^[^\d]*/, ""));
    if (range && figure && figure.value >= range[0] && figure.value <= range[1]) {
      problems.push(`${name} ${item.actual} is inside the target range ${item.consensus}, so sources disagree on beat or miss`);
    }
    if (item.consensus_basis === "market_consensus") {
      const traced = item.consensus_sources.filter(isSeen);
      if (traced.length === 0) problems.push(`${name} consensus has no source from the search results`);
    }
    if (item.consensus_basis === "company_guidance" && !report.message.includes("公司指引目标")) {
      problems.push(`${name} target is company guidance but the message does not say 公司指引目标`);
    }
  }

  if (report.market_reaction.trim()) {
    if (!isSeen(report.market_reaction_source)) problems.push("market reaction has no source from the search results");
    if (!message.includes(squash(report.market_reaction))) problems.push("market_reaction is not the line in the message");
  } else if (report.message.includes("市场反应")) {
    problems.push("message mentions a market reaction but market_reaction is empty");
  }

  const length = [...report.message].length;
  if (length === 0) problems.push("message is empty");
  if (length > MAX_MESSAGE_LENGTH) problems.push(`message is ${length} characters (limit ${MAX_MESSAGE_LENGTH})`);
  if (!report.message.toUpperCase().includes(ticker.toUpperCase())) problems.push("message does not mention the ticker");

  return problems;
}

module.exports = { draftReport, checkReport, parseStream, normalizeUrl, figureMatchesQuote, targetRange, MODEL, MAX_MESSAGE_LENGTH };
