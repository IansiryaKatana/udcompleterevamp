#!/usr/bin/env node
/**
 * Scan JSONL for parse errors; optionally write a cleaned file.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { rename, stat } from "node:fs/promises";
import readline from "node:readline";
import path from "node:path";

const src = process.argv[2];
const writeClean = process.argv.includes("--fix");
if (!src) {
  console.error("Usage: node repair-jsonl.mjs <file> [--fix]");
  process.exit(1);
}

const st = await stat(src);
console.error(`file=${src} sizeMB=${(st.size / 1e6).toFixed(1)}`);

const rl = readline.createInterface({
  input: createReadStream(src, { encoding: "utf8" }),
  crlfDelay: Infinity,
});

let lineNo = 0;
let ok = 0;
let bad = 0;
let noId = 0;
const ids = new Set();
let dupes = 0;
const errors = [];
const dest = src.replace(/\.jsonl$/, ".clean.jsonl");
const out = writeClean ? createWriteStream(dest) : null;

for await (const line of rl) {
  lineNo += 1;
  if (!line.trim()) continue;
  try {
    const row = JSON.parse(line);
    const rec = row.record || row;
    const id = rec?.id;
    if (!id) noId += 1;
    else if (ids.has(id)) dupes += 1;
    else ids.add(id);
    ok += 1;
    if (out) out.write(line + "\n");
  } catch (err) {
    bad += 1;
    if (errors.length < 20) {
      errors.push({
        lineNo,
        length: line.length,
        message: err.message,
        preview: line.slice(0, 120),
        around: line.slice(Math.max(0, 50800), 51100),
      });
    }
  }
  if (lineNo % 2000 === 0) {
    console.error(`scanned ${lineNo} ok=${ok} bad=${bad} unique=${ids.size}`);
  }
}

if (out) {
  await new Promise((resolve, reject) => {
    out.end(() => resolve());
    out.on("error", reject);
  });
  await rename(src, src.replace(/\.jsonl$/, ".corrupt.jsonl"));
  await rename(dest, src);
}

console.log(
  JSON.stringify({ lines: lineNo, ok, bad, uniqueIds: ids.size, dupes, noId, errors }, null, 2),
);
