"use strict";

const VALID_VERDICTS = new Set(["beat", "mixed", "miss"]);
const VALID_GUIDANCE = new Set(["raised", "maintained", "lowered", "not provided"]);

function requireText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function validateReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new TypeError("report must be an object");
  }

  for (const field of ["ticker", "period", "verdict", "guidance"]) {
    requireText(report[field], field);
  }

  if (!VALID_VERDICTS.has(report.verdict.toLowerCase())) {
    throw new RangeError("verdict must be beat, mixed, or miss");
  }
  if (!VALID_GUIDANCE.has(report.guidance.toLowerCase())) {
    throw new RangeError("guidance must be raised, maintained, lowered, or not provided");
  }

  for (const section of ["revenue", "eps"]) {
    if (!report[section] || typeof report[section] !== "object") {
      throw new TypeError(`${section} must be an object`);
    }
    requireText(report[section].actual, `${section}.actual`);
  }

  if (!Array.isArray(report.takeaways) || report.takeaways.length === 0) {
    throw new TypeError("takeaways must contain at least one item");
  }
  if (report.takeaways.length > 3) {
    throw new RangeError("takeaways cannot contain more than three items");
  }
  report.takeaways.forEach((item, index) => requireText(item, `takeaways[${index}]`));

  return report;
}

function comparison(metric) {
  const expected = metric.expected ? ` vs ${metric.expected} expected` : "";
  const growth = metric.yoy ? ` (${metric.yoy} YoY)` : "";
  return `${metric.actual}${expected}${growth}`;
}

function formatQuickTake(input, options = {}) {
  const report = validateReport(input);
  const maxLength = options.maxLength ?? 1800;
  const epsLabel = report.eps.basis ? `${report.eps.basis} EPS` : "EPS";
  const margins = [
    report.margins?.gross ? `Gross margin: ${report.margins.gross}` : null,
    report.margins?.operating ? `Operating margin: ${report.margins.operating}` : null
  ].filter(Boolean).join(" | ");
  const balanceSheet = [
    report.freeCashFlow ? `Free cash flow: ${report.freeCashFlow}` : null,
    report.balanceSheet ? `${report.balanceSheet.label}: ${report.balanceSheet.value}` : null
  ].filter(Boolean).join(" | ");

  const lines = [
    `📊 ${report.ticker.toUpperCase()} ${report.period} — ${report.verdict.toUpperCase()} | Guidance ${report.guidance.toLowerCase()}`,
    "",
    `Revenue: ${comparison(report.revenue)}`,
    `${epsLabel}: ${comparison(report.eps)}`,
    margins || null,
    balanceSheet || null,
    "",
    "Quick takeaways",
    ...report.takeaways.map((item) => `• ${item}`)
  ].filter((line) => line !== null);

  const output = lines.join("\n");
  if (output.length > maxLength) {
    throw new RangeError(`formatted summary exceeds ${maxLength} characters`);
  }
  return output;
}

module.exports = { formatQuickTake, validateReport };

