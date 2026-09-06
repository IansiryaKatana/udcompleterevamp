#!/usr/bin/env node
/** Scan raw orders/drafts for nested hasNextPage truncation risks. */
import { createReadStream } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(ROOT, "raw");

async function scan(rel, kind) {
  const full = path.join(RAW, rel);
  const rl = readline.createInterface({
    input: createReadStream(full, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  const seen = new Set();
  const stats = {
    lineItems: 0,
    events: 0,
    metafields: 0,
    fulfillmentsExact20: 0,
    fulfillmentLineItemsExact50: 0,
    refundsExact20: 0,
    refundLineItemsExact50: 0,
    transactionsExact30: 0,
    returnsExact10: 0,
  };
  for await (const line of rl) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const rec = o.record ?? o;
    if (!rec?.id || seen.has(rec.id)) continue;
    seen.add(rec.id);
    if (rec.lineItems?.pageInfo?.hasNextPage) stats.lineItems += 1;
    if (rec.events?.pageInfo?.hasNextPage) stats.events += 1;
    if (rec.metafields?.pageInfo?.hasNextPage) stats.metafields += 1;
    const ffs = rec.fulfillments || [];
    if (Array.isArray(ffs) && ffs.length >= 20) stats.fulfillmentsExact20 += 1;
    for (const f of ffs) {
      const n = f.fulfillmentLineItems?.nodes?.length || 0;
      if (n >= 50) stats.fulfillmentLineItemsExact50 += 1;
    }
    const refs = rec.refunds || [];
    if (Array.isArray(refs) && refs.length >= 20) stats.refundsExact20 += 1;
    for (const r of refs) {
      const n = r.refundLineItems?.nodes?.length || 0;
      if (n >= 50) stats.refundLineItemsExact50 += 1;
    }
    if ((rec.transactions || []).length >= 30) stats.transactionsExact30 += 1;
    if ((rec.returns?.nodes || []).length >= 10) stats.returnsExact10 += 1;
  }
  return { kind, unique: seen.size, ...stats };
}

const out = {
  orders: await scan("orders/orders.jsonl", "orders"),
  drafts: await scan("draft_orders/draft-orders.jsonl", "drafts"),
};
await mkdir(path.join(ROOT, "import", "out"), { recursive: true });
await writeFile(path.join(ROOT, "import", "out", "nested-pagination-audit.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
