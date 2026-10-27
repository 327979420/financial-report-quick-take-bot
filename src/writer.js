"use strict";

// Turns one earnings press release into a verified Chinese Discord briefing.
// The model reads the release, looks up consensus and market reaction with
// OpenAI web search, and returns structured JSON. checkReport() then rejects
// anything whose figures or sources cannot be traced.

const OpenAI = require("openai");

const MODEL = process.env.MODEL || "gpt-6-astra";
const EFFORT = process.env.EFFORT || "high";
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
- If sources disagree with each other or with the release in a way that changes the conclusion, list the conflict in "conflicts" instead of picking one.

The message must be at most ${MAX_MESSAGE_LENGTH} characters, in simplified Chinese, and follow this layout (emoji in moderation; 🟢 beat, 🟡 mixed, 🔴 miss):

${STYLE_EXAMPLE}

Return the result as JSON. List in consensus_sources and market_reaction_source only URLs you actually opened or found in this session. If the filing is not a quarterly or annual earnings release (for example monthly sales, a shareholder meeting notice, or an acquisition), set is_earnings_release false with a short skip_reason and leave the other fields empty.`;

const metric = {
  type: "object",
  properties: {
    actual: { type: "string", description: "Reported figure as shown in the message, e.g. $29.59B or $3.32" },
    actual_quote: { type: "string", description: "Short verbatim snippet copied from the release text that contains this figure" },
    consensus: { type: "string", description: "Target figure, or empty if none" },
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
    conflicts: { type: "array", items: { type: "string" } },
    message: { type: "string" }
  },
  required: [
    "is_earnings_release", "skip_reason", "company_name", "ticker", "period", "report_date",
    "revenue", "eps", "market_reaction", "market_reaction_source", "conflicts", "message"
  ],
  additionalProperties: false
};

// Every URL the model searched, opened or cited, so sources can be checked.
function collectUrls(output, seen) {
  for (const item of output) {
    if (item.type === "web_search_call") {
      for (const source of item.action?.sources ?? []) seen.add(source.url);
      if (item.action?.url) seen.add(item.action.url);
    }
    if (item.type === "message") {
      for (const part of item.content ?? []) {
        for (const note of part.annotations ?? []) if (note.type === "url_citation") seen.add(note.url);
      }
    }
  }
}

async function draftReport({ ticker, companyName, filing, release }, client = new OpenAI({ timeout: 15 * 60 * 1000 })) {
  const input = [
    `Ticker: ${ticker}`,
    `Company: ${companyName}`,
    `SEC form ${filing.form}, accepted ${filing.acceptedAt}`,
    `Filing documents: ${release.urls.join(" ")}`,
    "",
    "<release>",
    release.text,
    "</release>"
  ].join("\n");

  const response = await client.responses.create({
    model: MODEL,
    instructions: SYSTEM,
    input,
    tools: [{ type: "web_search" }],
    include: ["web_search_call.action.sources"],
    reasoning: { effort: EFFORT },
    text: { format: { type: "json_schema", name: "earnings_report", strict: true, schema: REPORT_SCHEMA } },
    max_output_tokens: 32000,
    store: false
  });

  if (response.status !== "completed") {
    throw new Error(`OpenAI response ${response.status}: ${response.incomplete_details?.reason ?? response.error?.message ?? "unknown"}`);
  }
  const refusal = response.output.flatMap((item) => item.content ?? []).find((part) => part.type === "refusal");
  if (refusal) throw new Error(`Model refused: ${refusal.refusal}`);

  const seenUrls = new Set(release.urls);
  collectUrls(response.output, seenUrls);
  const usage = {
    input: response.usage?.input_tokens ?? 0,
    output: response.usage?.output_tokens ?? 0,
    searches: response.output.filter((item) => item.type === "web_search_call").length
  };
  return { report: JSON.parse(response.output_text), seenUrls, usage };
}

const squash = (text) => text.replace(/\s+/g, " ").trim().toLowerCase();

// Returns a list of problems; an empty list means the report may be published.
function checkReport(report, { ticker, releaseText, seenUrls }) {
  const problems = [];
  const source = squash(releaseText);

  if (report.ticker.toUpperCase() !== ticker.toUpperCase()) problems.push(`ticker ${report.ticker} does not match ${ticker}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(report.report_date)) problems.push(`report_date "${report.report_date}" is not YYYY-MM-DD`);
  if (!report.period.trim()) problems.push("period is empty");
  for (const conflict of report.conflicts) problems.push(`conflict: ${conflict}`);

  for (const name of ["revenue", "eps"]) {
    const item = report[name];
    if (!item.actual.trim()) problems.push(`${name}.actual is empty`);
    if (!/\d/.test(item.actual_quote) || !source.includes(squash(item.actual_quote))) {
      problems.push(`${name}.actual_quote is not in the release: "${item.actual_quote}"`);
    }
    if (item.consensus_basis === "market_consensus") {
      const traced = item.consensus_sources.filter((url) => seenUrls.has(url));
      if (traced.length === 0) problems.push(`${name} consensus has no source from the search results`);
    }
    if (item.consensus_basis === "company_guidance" && !report.message.includes("公司指引目标")) {
      problems.push(`${name} target is company guidance but the message does not say 公司指引目标`);
    }
  }

  if (report.market_reaction.trim() && !seenUrls.has(report.market_reaction_source)) {
    problems.push("market reaction has no source from the search results");
  }

  const length = [...report.message].length;
  if (length === 0) problems.push("message is empty");
  if (length > MAX_MESSAGE_LENGTH) problems.push(`message is ${length} characters (limit ${MAX_MESSAGE_LENGTH})`);
  if (!report.message.toUpperCase().includes(ticker.toUpperCase())) problems.push("message does not mention the ticker");

  return problems;
}

module.exports = { draftReport, checkReport, MODEL, MAX_MESSAGE_LENGTH };
