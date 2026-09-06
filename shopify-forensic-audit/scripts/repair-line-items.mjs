#!/usr/bin/env node
/**
 * Targeted nested line-item repair (READ-ONLY Shopify).
 *
 *   node shopify-forensic-audit/scripts/repair-line-items.mjs --manifest
 *   node shopify-forensic-audit/scripts/repair-line-items.mjs --fetch
 *   node shopify-forensic-audit/scripts/repair-line-items.mjs --backfill
 *   node shopify-forensic-audit/scripts/repair-line-items.mjs --all
 */
import { createReadStream } from "node:fs";
import { mkdir, writeFile, readFile, appendFile } from "node:fs/promises";
import readline from "node:readline";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  AUDIT_ROOT,
  RAW_DIR,
  QUERY_DIR,
  API_VERSION,
  STORE,
  executeQuery,
  expandNestedLineItems,
} from "./shopify-exec.mjs";

const REPAIR_ROOT = path.join(AUDIT_ROOT, "raw_repairs");
const ORDER_REPAIR = path.join(REPAIR_ROOT, "order_line_items");
const DRAFT_REPAIR = path.join(REPAIR_ROOT, "draft_line_items");
const OUT = path.join(AUDIT_ROOT, "import", "out");

const args = new Set(process.argv.slice(2));
const doManifest = args.has("--manifest") || args.has("--all");
const doFetch = args.has("--fetch") || args.has("--all");
const doBackfill = args.has("--backfill") || args.has("--all");
const limitArg = process.argv.includes("--limit")
  ? Number(process.argv[process.argv.indexOf("--limit") + 1])
  : Infinity;

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

function money(set) {
  if (set == null) return 0;
  const n = Number(set?.shopMoney?.amount ?? set?.amount);
  return Number.isFinite(n) ? n : 0;
}
function moneyOrNull(set) {
  if (set == null) return null;
  if (set.amount != null || set?.shopMoney?.amount != null) return money(set);
  return null;
}
function newId() {
  return crypto.randomUUID();
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
    await onRec(rec, o);
  }
  return seen.size;
}

async function supabase() {
  await loadEnv();
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Need VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function loadDbLineCounts(sb, table, gidCol, parentGidCol, parentTable) {
  // Map parent shopify gid -> count of lines
  const parentMap = new Map(); // parent uuid -> shopify gid
  {
    let from = 0;
    for (;;) {
      const { data, error } = await sb
        .from(parentTable)
        .select(`id,${parentGidCol}`)
        .not(parentGidCol, "is", null)
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      if (!data?.length) break;
      for (const r of data) parentMap.set(r.id, r[parentGidCol]);
      if (data.length < 1000) break;
      from += 1000;
    }
  }
  const counts = new Map(); // shopify parent gid -> count
  {
    let from = 0;
    for (;;) {
      const { data, error } = await sb
        .from(table)
        .select(`id,${gidCol === "order" ? "order_id" : "draft_order_id"}`)
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      if (!data?.length) break;
      const fk = gidCol === "order" ? "order_id" : "draft_order_id";
      for (const r of data) {
        const parentUuid = r[fk];
        const shopifyGid = parentMap.get(parentUuid);
        if (!shopifyGid) continue;
        counts.set(shopifyGid, (counts.get(shopifyGid) || 0) + 1);
      }
      if (data.length < 1000) break;
      from += 1000;
    }
  }
  return counts;
}

async function loadExistingLineGids(sb, table) {
  const set = new Set();
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from(table)
      .select("source_line_item_gid")
      .not("source_line_item_gid", "is", null)
      .order("source_line_item_gid")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const r of data) set.add(r.source_line_item_gid);
    if (data.length < 1000) break;
    from += 1000;
  }
  return set;
}

async function loadParentIdByGid(sb, table, gidCol) {
  const map = new Map();
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from(table)
      .select(`id,${gidCol}`)
      .not(gidCol, "is", null)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const r of data) map.set(r[gidCol], r.id);
    if (data.length < 1000) break;
    from += 1000;
  }
  return map;
}

async function buildOrderManifest(sb) {
  console.error("[manifest] scanning orders.jsonl…");
  const dbCounts = await loadDbLineCounts(sb, "order_items", "order", "shopify_order_gid", "orders");
  const rows = [];
  await eachJsonl("orders/orders.jsonl", async (rec) => {
    const hasNext = Boolean(rec.lineItems?.pageInfo?.hasNextPage);
    if (!hasNext) return;
    const rawCount = (rec.lineItems?.nodes || []).length;
    rows.push({
      orderGid: rec.id,
      orderName: rec.name || null,
      rawLineCount: rawCount,
      dbLineCount: dbCounts.get(rec.id) || 0,
      endCursor: rec.lineItems?.pageInfo?.endCursor || null,
      hasNextPage: true,
    });
  });
  await mkdir(ORDER_REPAIR, { recursive: true });
  await writeFile(path.join(ORDER_REPAIR, "truncated-manifest.json"), JSON.stringify(rows, null, 2));
  console.error(`[manifest] truncated orders: ${rows.length}`);
  return rows;
}

async function buildDraftManifest(sb) {
  console.error("[manifest] scanning draft-orders.jsonl…");
  const dbCounts = await loadDbLineCounts(
    sb,
    "draft_order_line_items",
    "draft",
    "shopify_draft_gid",
    "draft_orders",
  );
  const rows = [];
  const suspects50 = [];
  await eachJsonl("draft_orders/draft-orders.jsonl", async (rec) => {
    const n = (rec.lineItems?.nodes || []).length;
    const hasNext = Boolean(rec.lineItems?.pageInfo?.hasNextPage);
    if (hasNext) {
      rows.push({
        draftGid: rec.id,
        draftName: rec.name || null,
        rawLineCount: n,
        dbLineCount: dbCounts.get(rec.id) || 0,
        endCursor: rec.lineItems?.pageInfo?.endCursor || null,
        hasNextPage: true,
        source: "pageInfo",
      });
      return;
    }
    // Historical draft extract lacked pageInfo — probe 50-line drafts via API later.
    if (n >= 50) {
      suspects50.push({
        draftGid: rec.id,
        draftName: rec.name || null,
        rawLineCount: n,
        dbLineCount: dbCounts.get(rec.id) || 0,
        endCursor: null,
        hasNextPage: null,
        source: "exact50_suspect",
      });
    }
  });
  await mkdir(DRAFT_REPAIR, { recursive: true });
  await writeFile(path.join(DRAFT_REPAIR, "truncated-manifest.json"), JSON.stringify(rows, null, 2));
  await writeFile(path.join(DRAFT_REPAIR, "suspect-50-manifest.json"), JSON.stringify(suspects50, null, 2));
  console.error(`[manifest] truncated drafts (pageInfo): ${rows.length}; exact-50 suspects: ${suspects50.length}`);
  return { truncated: rows, suspects: suspects50 };
}

async function fetchRemainingPages({ kind, gid, name, startCursor, outDir }) {
  const queryFile = path.join(
    QUERY_DIR,
    kind === "draft" ? "16-draft-line-items-page.graphql" : "15-order-line-items-page.graphql",
  );
  const rootKey = kind === "draft" ? "draftOrder" : "order";
  let cursor = startCursor;
  let hasNext = true;
  let page = 0;
  const allNew = [];
  // If no cursor (suspect), start from beginning and skip first page duplicates later.
  if (!cursor) {
    // Fetch page 1 to get endCursor then continue — or fetch all pages and dedupe by GID.
    cursor = null;
  }
  while (hasNext) {
    page += 1;
    const { data } = await executeQuery({
      queryFile,
      variables: { id: gid, cursor, first: 50 },
    });
    const root = data?.[rootKey];
    if (!root) throw new Error(`Missing ${rootKey} for ${gid}`);
    const conn = root.lineItems;
    const nodes = conn?.nodes || [];
    const payload = {
      fetchedAt: new Date().toISOString(),
      apiVersion: API_VERSION,
      store: STORE,
      parentGid: gid,
      parentName: name || root.name || null,
      page,
      cursorIn: cursor,
      pageInfo: conn?.pageInfo || null,
      nodes,
    };
    const file = path.join(outDir, `${gid.replace(/[^a-zA-Z0-9_-]/g, "_")}-page-${page}.json`);
    await writeFile(file, JSON.stringify(payload, null, 2));
    allNew.push(...nodes);
    hasNext = Boolean(conn?.pageInfo?.hasNextPage);
    cursor = conn?.pageInfo?.endCursor || null;
    console.error(
      `[fetch ${kind}] ${name || gid} page ${page}: +${nodes.length} (batch ${allNew.length}) hasNext=${hasNext}`,
    );
    if (hasNext && !cursor) throw new Error(`hasNext without cursor for ${gid}`);
    // When startCursor was set, first page is already the NEXT page — good.
    // When startCursor was null, we fetched from start — all pages collected.
  }
  return allNew;
}

async function fetchOrders(manifest) {
  await mkdir(ORDER_REPAIR, { recursive: true });
  const { readdir } = await import("node:fs/promises");
  const done = new Set();
  try {
    for (const f of await readdir(ORDER_REPAIR)) {
      const m = f.match(/^(gid_.*)-page-1\.json$/);
      if (m) {
        // recover gid from any page file via reading parentGid
      }
      if (f.includes("-page-") && f.endsWith(".json")) {
        try {
          const p = JSON.parse(await readFile(path.join(ORDER_REPAIR, f), "utf8"));
          if (p.parentGid) done.add(p.parentGid);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* empty */
  }
  console.error(`[fetch orders] already have pages for ${done.size} orders`);
  const summary = { fetched: 0, failed: [], addedNodes: 0, skippedDone: 0 };
  const slice = manifest.filter((r) => !done.has(r.orderGid)).slice(0, limitArg);
  summary.skippedDone = manifest.length - slice.length - (manifest.length > limitArg ? manifest.length - limitArg : 0);
  // recount skipped properly
  summary.skippedDone = manifest.filter((r) => done.has(r.orderGid)).length;
  for (const row of slice) {
    try {
      const nodes = await fetchRemainingPages({
        kind: "order",
        gid: row.orderGid,
        name: row.orderName,
        startCursor: row.endCursor,
        outDir: ORDER_REPAIR,
      });
      summary.fetched += 1;
      summary.addedNodes += nodes.length;
      await appendFile(
        path.join(ORDER_REPAIR, "fetched-summary.jsonl"),
        JSON.stringify({
          at: new Date().toISOString(),
          orderGid: row.orderGid,
          orderName: row.orderName,
          pagesFetched: true,
          newNodes: nodes.length,
          nodeIds: nodes.map((n) => n.id),
        }) + "\n",
      );
    } catch (e) {
      console.error(`[fail order] ${row.orderName}: ${e.message}`);
      summary.failed.push({ orderGid: row.orderGid, orderName: row.orderName, error: e.message });
    }
  }
  await writeFile(path.join(ORDER_REPAIR, "fetch-report.json"), JSON.stringify(summary, null, 2));
  return summary;
}

async function probeAndFetchDrafts(truncated, suspects) {
  await mkdir(DRAFT_REPAIR, { recursive: true });
  const toFetch = [...truncated];
  // Probe suspects via first page
  const sliceSuspects = suspects.slice(0, limitArg === Infinity ? suspects.length : Math.min(limitArg, suspects.length));
  for (const s of sliceSuspects) {
    try {
      const { data } = await executeQuery({
        queryFile: path.join(QUERY_DIR, "16-draft-line-items-page.graphql"),
        variables: { id: s.draftGid, cursor: null, first: 50 },
      });
      const conn = data?.draftOrder?.lineItems;
      if (conn?.pageInfo?.hasNextPage) {
        toFetch.push({
          ...s,
          endCursor: conn.pageInfo.endCursor,
          hasNextPage: true,
          source: "api_probe",
        });
      }
    } catch (e) {
      console.error(`[probe draft fail] ${s.draftName}: ${e.message}`);
    }
  }
  await writeFile(path.join(DRAFT_REPAIR, "confirmed-truncated.json"), JSON.stringify(toFetch, null, 2));
  console.error(`[drafts] confirmed truncated: ${toFetch.length}`);

  const summary = { fetched: 0, failed: [], addedNodes: 0, confirmed: toFetch.length };
  for (const row of toFetch.slice(0, limitArg)) {
    try {
      // For pageInfo-truncated with endCursor: fetch remaining only.
      // For api_probe: we already have page1 in probe — use endCursor to continue.
      // For safety: fetch ALL pages from null and dedupe on backfill.
      const nodes = await fetchRemainingPages({
        kind: "draft",
        gid: row.draftGid,
        name: row.draftName,
        startCursor: row.endCursor || null,
        outDir: DRAFT_REPAIR,
      });
      summary.fetched += 1;
      summary.addedNodes += nodes.length;
    } catch (e) {
      console.error(`[fail draft] ${row.draftName}: ${e.message}`);
      summary.failed.push({ draftGid: row.draftGid, draftName: row.draftName, error: e.message });
    }
  }
  await writeFile(path.join(DRAFT_REPAIR, "fetch-report.json"), JSON.stringify(summary, null, 2));
  return summary;
}

function mapOrderLine(li, orderId) {
  const originalUnit = moneyOrNull(li.originalUnitPriceSet);
  const discountedUnit = moneyOrNull(li.discountedUnitPriceSet);
  const unit = originalUnit != null ? originalUnit : discountedUnit != null ? discountedUnit : 0;
  const discountedTotal = moneyOrNull(li.discountedTotalSet);
  const originalTotal = moneyOrNull(li.originalTotalSet);
  const lineTotal =
    discountedTotal != null
      ? discountedTotal
      : originalTotal != null
        ? originalTotal
        : unit * (li.quantity || 0);
  return {
    id: newId(),
    order_id: orderId,
    product_id: null,
    product_name: li.name || li.title || "Line item",
    product_slug: null,
    image_url: li.image?.url || null,
    unit_price: unit,
    quantity: li.quantity || 0,
    line_total: lineTotal,
    sku_snapshot: li.sku || null,
    variant_title_snapshot: li.variantTitle || li.variant?.title || null,
    vendor_snapshot: li.vendor || li.product?.vendor || null,
    product_type_snapshot: li.product?.productType || null,
    barcode_snapshot: li.variant?.barcode || null,
    original_unit_price: originalUnit,
    discount_total: Math.max(0, (originalTotal ?? lineTotal) - (discountedTotal ?? lineTotal)),
    tax_total: money(li.totalTaxSet),
    taxable: li.taxable !== false,
    product_shopify_gid: li.product?.id || null,
    variant_shopify_gid: li.variant?.id || null,
    source_line_item_gid: li.id || null,
    deleted_product: !li.product || !li.variant,
    properties: li.customAttributes || [],
    metadata: { repair: "line_item_nested_pagination", source_system: "shopify" },
  };
}

function mapDraftLine(li, draftId, sortOrder) {
  const unit = moneyOrNull(li.originalUnitPriceSet) ?? 0;
  const qty = li.quantity || 0;
  const discountedTotal = moneyOrNull(li.discountedTotalSet);
  return {
    id: newId(),
    draft_order_id: draftId,
    title: li.title || li.name || "Line",
    variant_title: li.variant?.title || null,
    sku_snapshot: li.sku || null,
    vendor_snapshot: li.product?.vendor || null,
    quantity: qty,
    original_unit_price: unit,
    discounted_unit_price: qty > 0 && discountedTotal != null ? discountedTotal / qty : null,
    original_total: unit * qty,
    discounted_total: discountedTotal,
    taxable: true,
    requires_shipping: true,
    custom_attributes: li.customAttributes || [],
    tax_lines: [],
    product_shopify_gid: li.product?.id || null,
    variant_shopify_gid: li.variant?.id || null,
    source_line_item_gid: li.id || null,
    deleted_product: !li.product || !li.variant,
    sort_order: sortOrder,
  };
}

async function readRepairPages(dir) {
  const { readdir } = await import("node:fs/promises");
  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json") && f.includes("-page-"));
  } catch {
    return [];
  }
  const byParent = new Map();
  for (const f of files) {
    const payload = JSON.parse(await readFile(path.join(dir, f), "utf8"));
    if (!payload.parentGid) continue;
    if (!byParent.has(payload.parentGid)) byParent.set(payload.parentGid, []);
    byParent.get(payload.parentGid).push(payload);
  }
  return byParent;
}

async function backfillOrders(sb) {
  console.error("[backfill] orders…");
  const existing = await loadExistingLineGids(sb, "order_items");
  const orderIdByGid = await loadParentIdByGid(sb, "orders", "shopify_order_gid");
  const pages = await readRepairPages(ORDER_REPAIR);
  let added = 0;
  let skipped = 0;
  let failed = [];
  const rows = [];
  for (const [gid, pageList] of pages) {
    const orderId = orderIdByGid.get(gid);
    if (!orderId) {
      failed.push({ gid, error: "order not in DB" });
      continue;
    }
    // If we started from endCursor, all nodes are new. If from null, dedupe.
    const seenLocal = new Set();
    for (const page of pageList.sort((a, b) => a.page - b.page)) {
      for (const li of page.nodes || []) {
        if (!li?.id || seenLocal.has(li.id)) continue;
        seenLocal.add(li.id);
        if (existing.has(li.id)) {
          skipped += 1;
          continue;
        }
        existing.add(li.id);
        rows.push(mapOrderLine(li, orderId));
      }
    }
  }
  for (let i = 0; i < rows.length; i += 80) {
    const chunk = rows.slice(i, i + 80);
    const { error } = await sb.from("order_items").insert(chunk);
    if (error) {
      for (const row of chunk) {
        const { error: e2 } = await sb.from("order_items").insert(row);
        if (e2) {
          if (/duplicate|unique/i.test(e2.message)) skipped += 1;
          else failed.push({ gid: row.source_line_item_gid, error: e2.message });
        } else added += 1;
      }
    } else {
      added += chunk.length;
    }
    console.error(`[backfill orders] ${Math.min(i + chunk.length, rows.length)}/${rows.length}`);
  }
  const report = { added, skipped, failed, attempted: rows.length };
  await writeFile(path.join(ORDER_REPAIR, "backfill-report.json"), JSON.stringify(report, null, 2));
  return report;
}

async function backfillDrafts(sb) {
  console.error("[backfill] drafts…");
  const existing = await loadExistingLineGids(sb, "draft_order_line_items");
  const draftIdByGid = await loadParentIdByGid(sb, "draft_orders", "shopify_draft_gid");
  const pages = await readRepairPages(DRAFT_REPAIR);
  let added = 0;
  let skipped = 0;
  const failed = [];
  const rows = [];
  let sortBase = 1000;
  for (const [gid, pageList] of pages) {
    const draftId = draftIdByGid.get(gid);
    if (!draftId) {
      failed.push({ gid, error: "draft not in DB" });
      continue;
    }
    const seenLocal = new Set();
    let sort = sortBase;
    for (const page of pageList.sort((a, b) => a.page - b.page)) {
      for (const li of page.nodes || []) {
        if (!li?.id || seenLocal.has(li.id)) continue;
        seenLocal.add(li.id);
        if (existing.has(li.id)) {
          skipped += 1;
          continue;
        }
        existing.add(li.id);
        rows.push(mapDraftLine(li, draftId, sort++));
      }
    }
  }
  for (let i = 0; i < rows.length; i += 80) {
    const chunk = rows.slice(i, i + 80);
    const { error } = await sb.from("draft_order_line_items").insert(chunk);
    if (error) {
      for (const row of chunk) {
        const { error: e2 } = await sb.from("draft_order_line_items").insert(row);
        if (e2) {
          if (/duplicate|unique/i.test(e2.message)) skipped += 1;
          else failed.push({ gid: row.source_line_item_gid, error: e2.message });
        } else added += 1;
      }
    } else added += chunk.length;
    console.error(`[backfill drafts] ${Math.min(i + chunk.length, rows.length)}/${rows.length}`);
  }
  const report = { added, skipped, failed, attempted: rows.length };
  await writeFile(path.join(DRAFT_REPAIR, "backfill-report.json"), JSON.stringify(report, null, 2));
  return report;
}

async function main() {
  if (!doManifest && !doFetch && !doBackfill) {
    console.log(`Usage:
  node shopify-forensic-audit/scripts/repair-line-items.mjs --manifest
  node shopify-forensic-audit/scripts/repair-line-items.mjs --fetch
  node shopify-forensic-audit/scripts/repair-line-items.mjs --backfill
  node shopify-forensic-audit/scripts/repair-line-items.mjs --all
  optional: --limit N`);
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });
  const sb = await supabase();

  let orderManifest = [];
  let draftTruncated = [];
  let draftSuspects = [];

  if (doManifest) {
    orderManifest = await buildOrderManifest(sb);
    const d = await buildDraftManifest(sb);
    draftTruncated = d.truncated;
    draftSuspects = d.suspects;
  } else {
    try {
      orderManifest = JSON.parse(await readFile(path.join(ORDER_REPAIR, "truncated-manifest.json"), "utf8"));
    } catch {
      orderManifest = [];
    }
    try {
      draftTruncated = JSON.parse(await readFile(path.join(DRAFT_REPAIR, "truncated-manifest.json"), "utf8"));
    } catch {
      draftTruncated = [];
    }
    try {
      draftSuspects = JSON.parse(await readFile(path.join(DRAFT_REPAIR, "suspect-50-manifest.json"), "utf8"));
    } catch {
      draftSuspects = [];
    }
  }

  let orderFetch = null;
  let draftFetch = null;
  if (doFetch) {
    orderFetch = await fetchOrders(orderManifest);
    draftFetch = await probeAndFetchDrafts(draftTruncated, draftSuspects);
  }

  let orderBackfill = null;
  let draftBackfill = null;
  if (doBackfill) {
    orderBackfill = await backfillOrders(sb);
    draftBackfill = await backfillDrafts(sb);
  }

  const report = {
    at: new Date().toISOString(),
    orderManifestCount: orderManifest.length,
    draftTruncatedPageInfo: draftTruncated.length,
    draftSuspects50: draftSuspects.length,
    orderFetch,
    draftFetch,
    orderBackfill,
    draftBackfill,
  };
  await writeFile(path.join(OUT, "line-item-repair-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
