#!/usr/bin/env node
/** Investigate corrupt JSONL, draft→order links, credit_note values. Read-only. */
import { createReadStream } from "node:fs";
import readline from "node:readline";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(ROOT, "raw");
const OUT = path.join(ROOT, "import", "out");

async function eachLine(rel, onLine) {
  const rl = readline.createInterface({
    input: createReadStream(path.join(RAW, rel), { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let i = 0;
  for await (const line of rl) {
    i += 1;
    await onLine(line, i);
  }
  return i;
}

async function scanCorrupt() {
  const bad = [];
  const idCounts = new Map();
  let total = 0;
  await eachLine("orders/orders.jsonl", (line, i) => {
    total = i;
    if (!line.trim()) return;
    try {
      const o = JSON.parse(line);
      const r = o.record ?? o;
      if (r?.id) idCounts.set(r.id, (idCounts.get(r.id) || 0) + 1);
    } catch (e) {
      // try to salvage id from raw text
      const m = line.match(/gid:\/\/shopify\/Order\/\d+/);
      bad.push({
        lineNo: i,
        len: line.length,
        salvagedOrderGid: m?.[0] || null,
        err: String(e.message).slice(0, 120),
        head: line.slice(0, 160),
        tail: line.slice(-120),
      });
    }
  });
  const dups = [...idCounts.entries()].filter(([, c]) => c > 1);
  return {
    totalLines: total,
    uniqueIds: idCounts.size,
    parseErrors: bad.length,
    bad,
    duplicateIdCount: dups.length,
    duplicateExtraRows: dups.reduce((s, [, c]) => s + (c - 1), 0),
  };
}

async function draftOrderLinks() {
  let total = 0;
  let withOrder = 0;
  const samples = [];
  await eachLine("draft_orders/draft-orders.jsonl", (line) => {
    if (!line.trim()) return;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      return;
    }
    const r = o.record ?? o;
    if (!r?.id) return;
    total += 1;
    const orderGid = r.order?.id || null;
    if (orderGid) {
      withOrder += 1;
      if (samples.length < 5) samples.push({ draft: r.id, order: orderGid, status: r.status });
    }
  });
  return { total, withOrder, samples };
}

async function creditNotes() {
  const samples = [];
  const typeCounts = {};
  await eachLine("orders/orders.jsonl", (line) => {
    if (!line.trim() || samples.length >= 40) return;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      return;
    }
    const r = o.record ?? o;
    for (const mf of r.metafields?.nodes || []) {
      if (mf.namespace === "custom" && mf.key === "credit_note") {
        const v = String(mf.value ?? "");
        typeCounts[mf.type || "unknown"] = (typeCounts[mf.type || "unknown"] || 0) + 1;
        if (samples.length < 25) {
          samples.push({
            order: r.name,
            type: mf.type,
            value: v.slice(0, 300),
            looksLikeUrl: /^https?:\/\//i.test(v),
            looksLikeNumber: /^\d[\d\-_/]*$/.test(v.trim()),
            looksLikeJson: v.trim().startsWith("{") || v.trim().startsWith("["),
          });
        }
      }
    }
  });
  // recount all credit notes
  let total = 0;
  await eachLine("orders/orders.jsonl", (line) => {
    if (!line.trim()) return;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      return;
    }
    const r = o.record ?? o;
    for (const mf of r.metafields?.nodes || []) {
      if (mf.namespace === "custom" && mf.key === "credit_note" && mf.value) total += 1;
    }
  });
  return { total, typeCounts, samples };
}

const report = {
  corrupt: await scanCorrupt(),
  drafts: await draftOrderLinks(),
  creditNotes: await creditNotes(),
};
await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, "repair-investigation.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
