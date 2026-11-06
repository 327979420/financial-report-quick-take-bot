"use strict";

// Lays out a checked report as one Discord embed: a coloured bar for the
// verdict, a one-line headline, a three-column scoreboard (revenue, EPS,
// guidance), the market reaction and up to three highlights. The layout lives
// here rather than in the prompt so every company's post looks the same.

const { amounts, targetRange } = require("./numbers");

const COLOR = { beat: 0x2ecc71, mixed: 0xf1c40f, miss: 0xe74c3c };
const IN_LINE_PCT = 0.5; // within ±0.5% of the target counts as in line
const TARGET_LABEL = { market_consensus: "预期", company_guidance: "公司指引" };

// The value a figure stands for: the midpoint of a range, otherwise the number.
function valueOf(text) {
  const range = targetRange(text);
  if (range) return (range[0] + range[1]) / 2;
  const [first] = amounts(text.replace(/^[^\d]*/, ""));
  return first ? first.value : null;
}

function surprisePct(actual, target) {
  const a = valueOf(actual);
  const t = valueOf(target);
  if (a === null || t === null || t === 0) return null;
  return ((a - t) / Math.abs(t)) * 100;
}

function surpriseLine(pct) {
  if (pct === null) return "";
  const text = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  if (pct >= IN_LINE_PCT) return `✅ ${text}`;
  if (pct <= -IN_LINE_PCT) return `❌ ${text}`;
  return `➖ 持平 ${text}`;
}

function scoreField(name, actual, target, basis) {
  const label = TARGET_LABEL[basis];
  const lines = [`**${actual}**`];
  if (label && target.trim()) lines.push(`${label} ${target}`, surpriseLine(surprisePct(actual, target)));
  else lines.push("无可比预期");
  return { name, value: lines.filter(Boolean).join("\n"), inline: true };
}

// "盘前" / "盘中" / "盘后" from the filing's acceptance time in New York.
function sessionLabel(acceptedAt) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(acceptedAt));
  const minutes = Number(parts.find((p) => p.type === "hour").value) * 60 + Number(parts.find((p) => p.type === "minute").value);
  if (minutes < 9 * 60 + 30) return "盘前";
  if (minutes >= 16 * 60) return "盘后";
  return "盘中";
}

function sourceHosts(report) {
  const urls = [...report.revenue.consensus_sources, ...report.eps.consensus_sources, ...report.guidance.consensus_sources];
  const hosts = [];
  for (const url of urls) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      if (!hosts.includes(host)) hosts.push(host);
    } catch {
      // ignore malformed URLs; checkReport already traced the ones that matter
    }
  }
  return hosts.slice(0, 3);
}

function renderCard(report, { filing, releaseUrls }) {
  const guidance = report.guidance;
  const fields = [
    scoreField("营收", report.revenue.actual, report.revenue.consensus, report.revenue.consensus_basis),
    scoreField(report.eps_label || "EPS", report.eps.actual, report.eps.consensus, report.eps.consensus_basis),
    guidance.label.trim()
      ? scoreField(guidance.label, guidance.value, guidance.consensus, guidance.consensus.trim() ? "market_consensus" : "unavailable")
      : { name: "指引", value: "未给出数字指引", inline: true }
  ];
  if (report.market_reaction.trim()) {
    const icon = /^[^\d]*-|跌/.test(report.market_reaction) ? "📉" : "📈";
    fields.push({ name: "市场反应", value: `${icon} ${report.market_reaction}`, inline: false });
  }
  fields.push({ name: "看点", value: report.highlights.map((item) => `· ${item}`).join("\n"), inline: false });

  const hosts = sourceHosts(report);
  return {
    color: COLOR[report.verdict] ?? COLOR.mixed,
    author: { name: `${report.ticker} · ${report.period} · ${report.report_date} ${sessionLabel(filing.acceptedAt)}` },
    title: `${report.company_name}：${report.headline}`,
    url: releaseUrls[0],
    description: report.summary,
    fields,
    footer: { text: `来源：SEC ${filing.form}${hosts.length ? ` · 预期 ${hosts.join(" / ")}` : ""}` }
  };
}

// Plain-text view of a card for logs and dry runs.
function cardToText(card) {
  return [
    card.author.name,
    card.title,
    card.description,
    "",
    ...card.fields.map((field) => `[${field.name}] ${field.value.replace(/\*\*/g, "").replace(/\n/g, " | ")}`),
    "",
    card.footer.text
  ].join("\n");
}

function cardLength(card) {
  return [card.author.name, card.title, card.description, card.footer.text, ...card.fields.flatMap((f) => [f.name, f.value])]
    .join("").length;
}

module.exports = { renderCard, cardToText, cardLength, surprisePct, surpriseLine, sessionLabel };
