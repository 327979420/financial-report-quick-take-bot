"use strict";

// SEC EDGAR helpers: find new earnings releases (8-K item 2.02, or 6-K for
// foreign issuers) and read the press release exhibit as plain text.

// SEC requires "Name email" and rejects GitHub noreply addresses.
const USER_AGENT = process.env.SEC_USER_AGENT || "Freddy Liang liangfreddy164@gmail.com";
const REQUEST_GAP_MS = 150; // SEC allows 10 requests/second; stay well under it

let lastRequestAt = 0;

async function secFetch(url, as = "json") {
  const wait = lastRequestAt + REQUEST_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();

  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: as === "json" ? "application/json" : "text/html" }
  });
  if (!response.ok) throw new Error(`SEC returned HTTP ${response.status} for ${url}`);
  return as === "json" ? response.json() : response.text();
}

async function loadTickerMap() {
  const data = await secFetch("https://www.sec.gov/files/company_tickers.json");
  const map = new Map();
  for (const row of Object.values(data)) {
    map.set(row.ticker.toUpperCase(), { cik: row.cik_str, name: row.title });
  }
  return map;
}

function recentFilingsFrom(submissions) {
  const recent = submissions.filings.recent;
  return recent.accessionNumber.map((accession, index) => ({
    accession,
    form: recent.form[index],
    filingDate: recent.filingDate[index],
    acceptedAt: new Date(recent.acceptanceDateTime[index]).toISOString(),
    items: recent.items[index] || "",
    primaryDocument: recent.primaryDocument[index]
  }));
}

async function recentFilings(cik) {
  const padded = String(cik).padStart(10, "0");
  return recentFilingsFrom(await secFetch(`https://data.sec.gov/submissions/CIK${padded}.json`));
}

function isEarningsCandidate(filing) {
  if (filing.form === "8-K") return filing.items.split(",").map((item) => item.trim()).includes("2.02");
  return filing.form === "6-K";
}

function filingFolder(cik, accession) {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}`;
}

// Exhibit 99.x is the press release. Some 6-K filers (TSMC, ASML) name it
// freely, so without an ex99 file take every document, cover page last.
function pickReleaseDocuments(names, primaryDocument) {
  const html = names.filter((name) => /\.html?$/i.test(name) && !/-index(-headers)?\.html$/i.test(name));
  const exhibits = html.filter((name) => /ex-?99|exhibit-?99|ex_?99|dex99/i.test(name)).sort();
  if (exhibits.length > 0) return exhibits.slice(0, 2);
  const others = html.filter((name) => name !== primaryDocument).sort();
  return [...others.slice(0, 3), primaryDocument];
}

async function releaseText(cik, filing) {
  const folder = filingFolder(cik, filing.accession);
  const index = await secFetch(`${folder}/index.json`);
  const names = index.directory.item.map((item) => item.name);
  const documents = pickReleaseDocuments(names, filing.primaryDocument);
  const texts = [];
  for (const name of documents) texts.push(htmlToText(await secFetch(`${folder}/${name}`, "text")));
  return { text: texts.join("\n\n"), texts, urls: documents.map((name) => `${folder}/${name}`) };
}

const ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", middot: "·", bull: "•" };

function htmlToText(html) {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/[ \t ]+/g, " ")
    .replace(/ ?\| ?(\| ?)+/g, " | ")
    .replace(/ *\n */g, "\n")
    .replace(/\n+/g, "\n")
    .trim();
}

// 6-K filings include monthly sales, AGM notices and so on; keep only ones that read like results.
function looksLikeResults(text) {
  const head = text.slice(0, 6000);
  return /(first|second|third|fourth)[ -]quarter|\bQ[1-4]\b|full[ -]year|fiscal year/i.test(head) &&
    /results|earnings|financial (results|highlights)/i.test(head) &&
    /revenue|net sales|net income/i.test(head);
}

module.exports = {
  loadTickerMap,
  recentFilings,
  recentFilingsFrom,
  isEarningsCandidate,
  releaseText,
  pickReleaseDocuments,
  htmlToText,
  looksLikeResults
};
