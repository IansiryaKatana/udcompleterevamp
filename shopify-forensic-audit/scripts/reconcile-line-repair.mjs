#!/usr/bin/env node
/**
 * Post-repair reconciliation for targeted line-item repair.
 *   node shopify-forensic-audit/scripts/reconcile-line-repair.mjs
 */
import { createReadStream } from "node:fs";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import readline from "node:readline";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { AUDIT_ROOT, RAW_DIR, executeQuery, QUERY_DIR } from "./shopify-exec.mjs";

const REPAIR_ROOT = path.join(AUDIT_ROOT, "raw_repairs");
const ORDER_REPAIR = path.join(REPAIR_ROOT, "order_line_items");
const DRAFT_REPAIR = path.join(REPAIR_ROOT, "draft_line_items");
const OUT = path.join(AUDIT_ROOT, "import", "out");

async function loadEnv() {
  try {
    const text = await readFile(path.resolve(AUDIT_ROOT, "../.env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* optional */
  }
}

async function eachJsonl(rel, onRec) {
  const full = path.join(RAW_DIR, rel);
  const rl = readline.createInterface({
    input: createReadStream(full, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  const seen = new Set();
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
    await onRec(rec);
  }
}

async function repairPages(dir) {
  const byParent = new Map();
  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => f.includes("-page-") && f.endsWith(".json"));
  } catch {
    return byParent;
  }
  for (const f of files) {
    const p = JSON.parse(await readFile(path.join(dir, f), "utf8"));
    if (!p.parentGid) continue;
    if (!byParent.has(p.parentGid)) byParent.set(p.parentGid, []);
    byParent.get(p.parentGid).push(p);
  }
  for (const [, pages] of byParent) pages.sort((a, b) => (a.page || 0) - (b.page || 0));
  return byParent;
}

function money(set) {
  const n = Number(set?.shopMoney?.amount ?? set?.amount);
  return Number.isFinite(n) ? n : 0;
}

async function shopifyLineCount(kind, gid) {
  const queryFile = path.join(
    QUERY_DIR,
    kind === "draft" ? "16-draft-line-items-page.graphql" : "15-order-line-items-page.graphql",
  );
  const rootKey = kind === "draft" ? "draftOrder" : "order";
  let cursor = null;
  let hasNext = true;
  let total = 0;
  let pages = 0;
  while (hasNext) {
    pages += 1;
    const { data } = await executeQuery({
      queryFile,
      variables: { id: gid, cursor, first: 250 },
    });
    const conn = data?.[rootKey]?.lineItems;
    total += (conn?.nodes || []).length;
    hasNext = Boolean(conn?.pageInfo?.hasNextPage);
    cursor = conn?.pageInfo?.endCursor || null;
    if (pages > 40) throw new Error(`too many pages for ${gid}`);
  }
  return total;
}

async function main() {
  await loadEnv();
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const orderRepair = await repairPages(ORDER_REPAIR);
  const draftRepair = await repairPages(DRAFT_REPAIR);

  let ordersTotal = 0;
  let ordersTruncated = 0;
  let ordersRepaired = 0;
  let ordersStillTruncated = 0;
  let archiveOrderLines = 0;
  let repairOrderLines = 0;

  const truncatedGids = [];
  await eachJsonl("orders/orders.jsonl", async (rec) => {
    ordersTotal += 1;
    const rawN = (rec.lineItems?.nodes || []).length;
    archiveOrderLines += rawN;
    if (!rec.lineItems?.pageInfo?.hasNextPage) return;
    ordersTruncated += 1;
    truncatedGids.push({ gid: rec.id, name: rec.name, rawN, endCursor: rec.lineItems.pageInfo.endCursor });
    const pages = orderRepair.get(rec.id) || [];
    for (const p of pages) repairOrderLines += (p.nodes || []).length;
    const last = pages[pages.length - 1];
    if (pages.length && last && !last.pageInfo?.hasNextPage) ordersRepaired += 1;
    else ordersStillTruncated += 1;
  });

  let draftsTotal = 0;
  let draftsTruncatedPrimary = 0;
  let draftsSuspect50 = 0;
  let draftsRepaired = 0;
  let draftsStill = 0;
  let archiveDraftLines = 0;
  let repairDraftLines = 0;
  await eachJsonl("draft_orders/draft-orders.jsonl", async (rec) => {
    draftsTotal += 1;
    const rawN = (rec.lineItems?.nodes || []).length;
    archiveDraftLines += rawN;
    if (rec.lineItems?.pageInfo?.hasNextPage) draftsTruncatedPrimary += 1;
    if (rawN >= 50) draftsSuspect50 += 1;
  });
  for (const [gid, pages] of draftRepair) {
    for (const p of pages) repairDraftLines += (p.nodes || []).length;
    const last = pages[pages.length - 1];
    if (pages.length && last && !last.pageInfo?.hasNextPage) draftsRepaired += 1;
    else draftsStill += 1;
  }

  const { count: dbOrderItems } = await sb
    .from("order_items")
    .select("*", { count: "exact", head: true });
  const { count: dbDraftLines } = await sb
    .from("draft_order_line_items")
    .select("*", { count: "exact", head: true });

  // Regression entity counts
  const entityTables = {
    orders: "orders",
    customers: "customers",
    companies: "companies",
    company_contacts: "company_contacts",
    payment_transactions: "payment_transactions",
    refunds: "refunds",
    fulfillments: "fulfillments",
    order_events: "order_events",
    draft_orders: "draft_orders",
  };
  const regression = {};
  for (const [k, table] of Object.entries(entityTables)) {
    const { count } = await sb.from(table).select("*", { count: "exact", head: true });
    regression[k] = count;
  }

  // Samples: Shopify live count vs archive+repair vs DB
  const sampleNames = ["#UD7070", "#UD7074", "#UD12925"];
  // also pick a few largest by repair node count
  const byRepairSize = [...orderRepair.entries()]
    .map(([gid, pages]) => ({
      gid,
      name: pages[0]?.parentName,
      repairN: pages.reduce((s, p) => s + (p.nodes || []).length, 0),
    }))
    .sort((a, b) => b.repairN - a.repairN)
    .slice(0, 5);
  for (const x of byRepairSize) {
    if (x.name && !sampleNames.includes(x.name)) sampleNames.push(x.name);
  }

  const samples = [];
  for (const name of sampleNames) {
    let rec = null;
    await eachJsonl("orders/orders.jsonl", async (r) => {
      if (r.name === name) rec = r;
    });
    if (!rec) {
      samples.push({ name, error: "not in archive" });
      continue;
    }
    const pages = orderRepair.get(rec.id) || [];
    const primaryIds = new Set((rec.lineItems?.nodes || []).map((n) => n.id).filter(Boolean));
    const repairIds = new Set();
    for (const p of pages) for (const n of p.nodes || []) if (n.id) repairIds.add(n.id);
    const archiveFinal = new Set([...primaryIds, ...repairIds]).size;
    let shopifyFinal = null;
    try {
      shopifyFinal = await shopifyLineCount("order", rec.id);
    } catch (e) {
      shopifyFinal = `error: ${e.message}`;
    }
    const { data: orderRow } = await sb
      .from("orders")
      .select("id, shopify_order_gid, subtotal, total_discounts, tax_total, total, name")
      .eq("shopify_order_gid", rec.id)
      .maybeSingle();
    let dbCount = 0;
    let lineSum = { qty: 0, line_total: 0, discount_total: 0, tax_total: 0 };
    if (orderRow?.id) {
      let from = 0;
      for (;;) {
        const { data } = await sb
          .from("order_items")
          .select("quantity, line_total, discount_total, tax_total, source_line_item_gid")
          .eq("order_id", orderRow.id)
          .range(from, from + 999);
        if (!data?.length) break;
        dbCount += data.length;
        for (const li of data) {
          lineSum.qty += Number(li.quantity) || 0;
          lineSum.line_total += Number(li.line_total) || 0;
          lineSum.discount_total += Number(li.discount_total) || 0;
          lineSum.tax_total += Number(li.tax_total) || 0;
        }
        if (data.length < 1000) break;
        from += 1000;
      }
    }
    samples.push({
      name,
      gid: rec.id,
      shopifyFinalLineCount: shopifyFinal,
      archiveFinalLineCount: archiveFinal,
      dbLineCount: dbCount,
      match:
        shopifyFinal === archiveFinal && archiveFinal === dbCount
          ? "MATCH"
          : "MISMATCH",
      orderHeader: orderRow
        ? {
            subtotal: orderRow.subtotal,
            discounts: orderRow.total_discounts,
            tax: orderRow.tax_total,
            total: orderRow.total,
          }
        : null,
      lineSums: {
        qty: lineSum.qty,
        line_total: Math.round(lineSum.line_total * 100) / 100,
        discount_total: Math.round(lineSum.discount_total * 100) / 100,
        tax_total: Math.round(lineSum.tax_total * 100) / 100,
      },
      primaryHasNext: Boolean(rec.lineItems?.pageInfo?.hasNextPage),
      repairPages: pages.length,
      repairLastHasNext: pages.length ? Boolean(pages[pages.length - 1].pageInfo?.hasNextPage) : null,
    });
  }

  const report = {
    at: new Date().toISOString(),
    orders: {
      total: ordersTotal,
      previouslyTruncated: ordersTruncated,
      repaired: ordersRepaired,
      stillHasNextPage: ordersStillTruncated,
      archivePrimaryLineNodes: archiveOrderLines,
      repairLineNodes: repairOrderLines,
      dbOrderItems,
    },
    drafts: {
      total: draftsTotal,
      truncatedPrimaryPageInfo: draftsTruncatedPrimary,
      suspectExact50: draftsSuspect50,
      repairedWithPages: draftsRepaired,
      stillIncompleteRepairPages: draftsStill,
      archivePrimaryLineNodes: archiveDraftLines,
      repairLineNodes: repairDraftLines,
      dbDraftLines,
    },
    regression,
    samples,
  };

  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, "line-item-reconcile.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
