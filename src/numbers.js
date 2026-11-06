"use strict";

// Parses money and share figures as written in releases and briefings
// ("$3.66B", "3,660 million", "$0.48", "$3.9–4.0B", "1.2亿").

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

module.exports = { amounts, targetRange, figureMatchesQuote };
