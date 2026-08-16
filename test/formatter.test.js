"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { formatQuickTake, validateReport } = require("../src/formatter");

const report = {
  ticker: "MU",
  period: "Q4 FY26",
  verdict: "beat",
  guidance: "raised",
  revenue: { actual: "$11.32B", expected: "$10.95B", yoy: "+38%" },
  eps: { basis: "Adj.", actual: "$3.21", expected: "$2.95" },
  margins: { gross: "44.7%", operating: "36.2%" },
  freeCashFlow: "$2.84B",
  balanceSheet: { label: "Net cash", value: "$1.40B" },
  takeaways: ["HBM demand remained strong."]
};

test("formats a concise earnings summary", () => {
  const output = formatQuickTake(report);
  assert.match(output, /MU Q4 FY26 — BEAT \| Guidance raised/);
  assert.match(output, /Revenue: \$11\.32B vs \$10\.95B expected \(\+38% YoY\)/);
  assert.match(output, /Free cash flow: \$2\.84B \| Net cash: \$1\.40B/);
  assert.match(output, /• HBM demand remained strong\./);
});

test("rejects unsupported verdicts", () => {
  assert.throws(() => validateReport({ ...report, verdict: "great" }), /verdict must be/);
});

test("limits takeaways to three", () => {
  assert.throws(
    () => validateReport({ ...report, takeaways: ["One", "Two", "Three", "Four"] }),
    /more than three/
  );
});

test("enforces the configured Discord character limit", () => {
  assert.throws(() => formatQuickTake(report, { maxLength: 20 }), /exceeds 20 characters/);
});

