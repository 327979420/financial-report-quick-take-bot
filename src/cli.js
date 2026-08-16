#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { formatQuickTake } = require("./formatter");

const inputPath = process.argv[2];
if (!inputPath) {
  process.stderr.write("Usage: node src/cli.js <report.json>\n");
  process.exitCode = 1;
} else {
  try {
    const absolutePath = path.resolve(process.cwd(), inputPath);
    const report = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
    process.stdout.write(`${formatQuickTake(report)}\n`);
  } catch (error) {
    process.stderr.write(`Unable to format report: ${error.message}\n`);
    process.exitCode = 1;
  }
}

