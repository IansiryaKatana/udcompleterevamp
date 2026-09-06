#!/usr/bin/env node
/**
 * Final nested pagination repair: fulfillmentLineItems, refundLineItems, events.
 *
 *   node shopify-forensic-audit/scripts/repair-nested-connections.mjs --manifest
 *   node shopify-forensic-audit/scripts/repair-nested-connections.mjs --probe
 *   node shopify-forensic-audit/scripts/repair-nested-connections.mjs --fetch
 *   node shopify-forensic-audit/scripts/repair-nested-connections.mjs --backfill
 *   node shopify-forensic-audit/scripts/repair-nested-connections.mjs --all
 *   optional: --limit N
 */
import { createReadStream } from "node:fs";
import { mkdir, writeFile, readFile, readdir, appendFile } from "node:fs/promises";
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
} from "./shopify-exec.mjs";

const REPAIR_ROOT = path.join(AUDIT_ROOT, "raw_repairs");
const FF_DIR = path.join(REPAIR_ROOT, "fulfillment_line_items");
const RF_DIR = path.join(REPAIR_ROOT, "refund_line_items");
const EV_DIR = path.join(REPAIR_ROOT, "order_events");
const OUT = path.join(AUDIT_ROOT, "import", "out");
const MANIFEST = path.join(REPAIR_ROOT, "nested-completeness-manifest.jsonl");

const args = new Set(process.argv.slice(2));
const doManifest = args.has("--manifest") || args.has("--all");
const doProbe = args.has("--probe") || args.has("--all");
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
  const n = Number(set?.shopMoney?.amount ?? set?.amount);
  return Number.isFinite(n) ? n : 0;
}
function newId() {
  return crypto.randomUUID();
}
function safeName(gid) {
  return String(gid).replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function eachUniqueOrder(onRec) {
  const full = path.join(RAW_DIR, "orders/orders.jsonl");
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
  return seen.size;
}

async function supabase() {
  await loadEnv();
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Need VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function loadGidSet(sb, table, col) {
  const set = new Set();
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from(table)
      .select(col)
      .not(col, "is", null)
      .range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    for (const r of data) set.add(r[col]);
    if (data.length < 1000) break;
    from += 1000;
  }
  return set;
}

async function loadIdByGid(sb, table, gidCol) {
  const map = new Map();
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from(table)
      .select(`id,${gidCol}`)
      .not(gidCol, "is", null)
      .range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    for (const r of data) map.set(r[gidCol], r.id);
    if (data.length < 1000) break;
    from += 1000;
  }
  return map;
}

async function buildManifest() {
  console.error("[manifest] scanning unique orders…");
  const ffSuspects = [];
  const rfSuspects = [];
  const evTruncated = [];
  let fulfillments = 0;
  let refunds = 0;
  let ffLines = 0;
  let rfLines = 0;

  await eachUniqueOrder(async (rec) => {
    if (rec.events?.pageInfo?.hasNextPage) {
      evTruncated.push({
        orderGid: rec.id,
        orderName: rec.name || null,
        rawEventCount: (rec.events.nodes || []).length,
        endCursor: rec.events.pageInfo.endCursor || null,
        hasNextPage: true,
      });
    }
    for (const f of rec.fulfillments || []) {
      fulfillments += 1;
      const nodes = f.fulfillmentLineItems?.nodes || [];
      ffLines += nodes.length;
      const hasNext = Boolean(f.fulfillmentLineItems?.pageInfo?.hasNextPage);
      if (hasNext || nodes.length >= 50) {
        ffSuspects.push({
          fulfillmentGid: f.id,
          fulfillmentName: f.name || null,
          orderGid: rec.id,
          orderName: rec.name || null,
          rawLineCount: nodes.length,
          endCursor: f.fulfillmentLineItems?.pageInfo?.endCursor || null,
          hasNextPage: hasNext || null,
          source: hasNext ? "pageInfo" : "exact50_suspect",
        });
      }
    }
    for (const r of rec.refunds || []) {
      refunds += 1;
      const nodes = r.refundLineItems?.nodes || [];
      rfLines += nodes.length;
      const hasNext = Boolean(r.refundLineItems?.pageInfo?.hasNextPage);
      if (hasNext || nodes.length >= 50) {
        rfSuspects.push({
          refundGid: r.id,
          orderGid: rec.id,
          orderName: rec.name || null,
          rawLineCount: nodes.length,
          endCursor: r.refundLineItems?.pageInfo?.endCursor || null,
          hasNextPage: hasNext || null,
          source: hasNext ? "pageInfo" : "exact50_suspect",
        });
      }
    }
  });

  await mkdir(FF_DIR, { recursive: true });
  await mkdir(RF_DIR, { recursive: true });
  await mkdir(EV_DIR, { recursive: true });
  await writeFile(path.join(FF_DIR, "suspect-manifest.json"), JSON.stringify(ffSuspects, null, 2));
  await writeFile(path.join(RF_DIR, "suspect-manifest.json"), JSON.stringify(rfSuspects, null, 2));
  await writeFile(path.join(EV_DIR, "truncated-manifest.json"), JSON.stringify(evTruncated, null, 2));
  const summary = {
    fulfillments,
    fulfillmentLineNodesArchive: ffLines,
    fulfillmentSuspects: ffSuspects.length,
    refunds,
    refundLineNodesArchive: rfLines,
    refundSuspects: rfSuspects.length,
    eventTruncatedOrders: evTruncated.length,
  };
  await writeFile(path.join(REPAIR_ROOT, "nested-suspect-summary.json"), JSON.stringify(summary, null, 2));
  console.error("[manifest]", JSON.stringify(summary));
  return { ffSuspects, rfSuspects, evTruncated, summary };
}

async function probeList(kind, suspects, probeFile, rootKey, connKey, outConfirmedPath) {
  const confirmed = [];
  const notTruncated = [];
  const failed = [];
  const slice = suspects.slice(0, limitArg);
  let i = 0;
  for (const row of slice) {
    i += 1;
    const gid = kind === "fulfillment" ? row.fulfillmentGid : row.refundGid;
    try {
      if (row.hasNextPage === true && row.endCursor) {
        confirmed.push({ ...row, source: row.source || "pageInfo" });
        continue;
      }
      const { data } = await executeQuery({
        queryFile: path.join(QUERY_DIR, probeFile),
        variables: { id: gid },
      });
      const conn = data?.[rootKey]?.[connKey];
      if (conn?.pageInfo?.hasNextPage) {
        confirmed.push({
          ...row,
          endCursor: conn.pageInfo.endCursor,
          hasNextPage: true,
          source: "api_probe",
          probeNodeCount: (conn.nodes || []).length,
        });
      } else {
        notTruncated.push({
          ...row,
          hasNextPage: false,
          probeNodeCount: (conn?.nodes || []).length,
        });
      }
    } catch (e) {
      failed.push({ ...row, error: e.message });
      console.error(`[probe ${kind} fail] ${gid}: ${e.message}`);
    }
    if (i % 50 === 0) console.error(`[probe ${kind}] ${i}/${slice.length} confirmed=${confirmed.length}`);
  }
  await writeFile(outConfirmedPath, JSON.stringify(confirmed, null, 2));
  await writeFile(
    outConfirmedPath.replace("confirmed-truncated.json", "probe-not-truncated.json"),
    JSON.stringify(notTruncated, null, 2),
  );
  await writeFile(
    outConfirmedPath.replace("confirmed-truncated.json", "probe-failed.json"),
    JSON.stringify(failed, null, 2),
  );
  console.error(
    `[probe ${kind}] confirmed=${confirmed.length} notTruncated=${notTruncated.length} failed=${failed.length}`,
  );
  return { confirmed, notTruncated, failed };
}

async function fetchPages({ kind, gid, name, startCursor, outDir, queryFile, rootKey, connKey }) {
  let cursor = startCursor;
  let hasNext = true;
  let page = 0;
  const allNew = [];
  while (hasNext) {
    page += 1;
    const { data } = await executeQuery({
      queryFile: path.join(QUERY_DIR, queryFile),
      variables: { id: gid, cursor, first: 50 },
    });
    const root = data?.[rootKey];
    if (!root) throw new Error(`Missing ${rootKey} for ${gid}`);
    const conn = root[connKey];
    const nodes = conn?.nodes || [];
    const payload = {
      fetchedAt: new Date().toISOString(),
      apiVersion: API_VERSION,
      store: STORE,
      parentType: kind,
      parentGid: gid,
      parentName: name || root.name || null,
      page,
      cursorIn: cursor,
      pageInfo: conn?.pageInfo || null,
      nodes,
    };
    await writeFile(path.join(outDir, `${safeName(gid)}-page-${page}.json`), JSON.stringify(payload, null, 2));
    allNew.push(...nodes);
    hasNext = Boolean(conn?.pageInfo?.hasNextPage);
    cursor = conn?.pageInfo?.endCursor || null;
    console.error(
      `[fetch ${kind}] ${name || gid} page ${page}: +${nodes.length} (batch ${allNew.length}) hasNext=${hasNext}`,
    );
    if (hasNext && !cursor) throw new Error(`hasNext without cursor for ${gid}`);
  }
  await appendFile(
    MANIFEST,
    JSON.stringify({
      parentType: kind,
      parentGid: gid,
      connection:
        kind === "fulfillment"
          ? "fulfillmentLineItems"
          : kind === "refund"
            ? "refundLineItems"
            : "events",
      repairPageCount: page,
      repairItemCount: allNew.length,
      finalHasNextPage: false,
      extractionTimestamp: new Date().toISOString(),
      apiVersion: API_VERSION,
    }) + "\n",
  );
  return allNew;
}

async function alreadyFetched(dir) {
  const done = new Set();
  try {
    for (const f of await readdir(dir)) {
      if (!f.includes("-page-") || !f.endsWith(".json")) continue;
      try {
        const p = JSON.parse(await readFile(path.join(dir, f), "utf8"));
        if (p.parentGid) done.add(p.parentGid);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* empty */
  }
  return done;
}

async function fetchConfirmed(kind, confirmed, outDir, queryFile, rootKey, connKey, gidField, nameField) {
  await mkdir(outDir, { recursive: true });
  const done = await alreadyFetched(outDir);
  const summary = { fetched: 0, failed: [], addedNodes: 0, skippedDone: 0 };
  const slice = confirmed.filter((r) => !done.has(r[gidField])).slice(0, limitArg);
  summary.skippedDone = confirmed.filter((r) => done.has(r[gidField])).length;
  console.error(`[fetch ${kind}] already done ${summary.skippedDone}; remaining ${slice.length}`);
  for (const row of slice) {
    try {
      const nodes = await fetchPages({
        kind,
        gid: row[gidField],
        name: row[nameField] || row.orderName || null,
        startCursor: row.endCursor,
        outDir,
        queryFile,
        rootKey,
        connKey,
      });
      summary.fetched += 1;
      summary.addedNodes += nodes.length;
    } catch (e) {
      console.error(`[fail ${kind}] ${row[gidField]}: ${e.message}`);
      summary.failed.push({ gid: row[gidField], error: e.message });
    }
  }
  await writeFile(path.join(outDir, "fetch-report.json"), JSON.stringify(summary, null, 2));
  return summary;
}

async function readRepairPages(dir) {
  const byParent = new Map();
  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => f.includes("-page-") && f.endsWith(".json"));
  } catch {
    return byParent;
  }
  for (const f of files) {
    const payload = JSON.parse(await readFile(path.join(dir, f), "utf8"));
    if (!payload.parentGid) continue;
    if (!byParent.has(payload.parentGid)) byParent.set(payload.parentGid, []);
    byParent.get(payload.parentGid).push(payload);
  }
  for (const pages of byParent.values()) pages.sort((a, b) => a.page - b.page);
  return byParent;
}

async function backfillFulfillmentLines(sb) {
  console.error("[backfill] fulfillment lines from repair pages…");
  const existing = await loadGidSet(sb, "fulfillment_line_items", "external_gid");
  const ffByGid = await loadIdByGid(sb, "fulfillments", "external_gid");
  const itemByLineGid = await loadIdByGid(sb, "order_items", "source_line_item_gid");
  const pages = await readRepairPages(FF_DIR);
  let added = 0;
  let skipped = 0;
  const failed = [];
  const rows = [];
  for (const [gid, pageList] of pages) {
    const fulfillmentId = ffByGid.get(gid);
    if (!fulfillmentId) {
      failed.push({ gid, error: "fulfillment not in DB" });
      continue;
    }
    const seen = new Set();
    for (const page of pageList) {
      for (const fl of page.nodes || []) {
        if (!fl?.id || seen.has(fl.id)) continue;
        seen.add(fl.id);
        if (existing.has(fl.id)) {
          skipped += 1;
          continue;
        }
        existing.add(fl.id);
        rows.push({
          id: newId(),
          fulfillment_id: fulfillmentId,
          order_item_id: fl.lineItem?.id ? itemByLineGid.get(fl.lineItem.id) ?? null : null,
          quantity: fl.quantity || 0,
          sku_snapshot: fl.lineItem?.sku || null,
          name_snapshot: fl.lineItem?.name || null,
          source_system: "shopify",
          external_gid: fl.id,
        });
      }
    }
  }
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error } = await sb.from("fulfillment_line_items").insert(chunk);
    if (error) {
      for (const row of chunk) {
        const { error: e2 } = await sb.from("fulfillment_line_items").insert(row);
        if (e2) {
          if (/duplicate|unique/i.test(e2.message)) skipped += 1;
          else failed.push({ gid: row.external_gid, error: e2.message });
        } else added += 1;
      }
    } else added += chunk.length;
    console.error(`[backfill ff] ${Math.min(i + chunk.length, rows.length)}/${rows.length}`);
  }
  const report = { added, skipped, failed, attempted: rows.length };
  await writeFile(path.join(FF_DIR, "backfill-report.json"), JSON.stringify(report, null, 2));
  return report;
}

async function backfillAllRefundLines(sb) {
  console.error("[backfill] refund lines from primary archive + repair pages…");
  // refund_line_items was never imported — load ALL from archive, then repair extras.
  const existing = await loadGidSet(sb, "refund_line_items", "external_gid");
  const refundByGid = await loadIdByGid(sb, "refunds", "external_gid");
  const itemByLineGid = await loadIdByGid(sb, "order_items", "source_line_item_gid");
  let added = 0;
  let skipped = 0;
  const failed = [];
  const rows = [];

  function pushNode(refundId, rl) {
    if (!rl?.id) return;
    if (existing.has(rl.id)) {
      skipped += 1;
      return;
    }
    existing.add(rl.id);
    rows.push({
      id: newId(),
      refund_id: refundId,
      order_item_id: rl.lineItem?.id ? itemByLineGid.get(rl.lineItem.id) ?? null : null,
      quantity: rl.quantity || 0,
      restock_type: rl.restockType || null,
      subtotal: money(rl.subtotalSet) || money(rl.priceSet),
      total_tax: money(rl.totalTaxSet),
      sku_snapshot: rl.lineItem?.sku || null,
      name_snapshot: rl.lineItem?.name || null,
      source_system: "shopify",
      external_gid: rl.id,
    });
  }

  await eachUniqueOrder(async (rec) => {
    for (const r of rec.refunds || []) {
      if (!r?.id) continue;
      const refundId = refundByGid.get(r.id);
      if (!refundId) {
        failed.push({ gid: r.id, error: "refund not in DB" });
        continue;
      }
      for (const rl of r.refundLineItems?.nodes || []) pushNode(refundId, rl);
    }
  });

  const pages = await readRepairPages(RF_DIR);
  for (const [gid, pageList] of pages) {
    const refundId = refundByGid.get(gid);
    if (!refundId) {
      failed.push({ gid, error: "refund not in DB (repair)" });
      continue;
    }
    for (const page of pageList) {
      for (const rl of page.nodes || []) pushNode(refundId, rl);
    }
  }

  console.error(`[backfill rf] preparing ${rows.length} rows (skipped so far ${skipped})`);
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error } = await sb.from("refund_line_items").insert(chunk);
    if (error) {
      for (const row of chunk) {
        const { error: e2 } = await sb.from("refund_line_items").insert(row);
        if (e2) {
          if (/duplicate|unique/i.test(e2.message)) skipped += 1;
          else failed.push({ gid: row.external_gid, error: e2.message });
        } else added += 1;
      }
    } else added += chunk.length;
    if ((i / 100) % 20 === 0) console.error(`[backfill rf] ${Math.min(i + chunk.length, rows.length)}/${rows.length}`);
  }
  const report = { added, skipped, failed: failed.slice(0, 50), failedCount: failed.length, attempted: rows.length };
  await writeFile(path.join(RF_DIR, "backfill-report.json"), JSON.stringify(report, null, 2));
  return report;
}

async function backfillEvents(sb) {
  console.error("[backfill] order events from repair pages…");
  const existing = await loadGidSet(sb, "order_events", "external_event_id");
  const orderByGid = await loadIdByGid(sb, "orders", "shopify_order_gid");
  const pages = await readRepairPages(EV_DIR);
  let added = 0;
  let skipped = 0;
  const failed = [];
  const rows = [];
  const comments = [];
  for (const [gid, pageList] of pages) {
    const orderId = orderByGid.get(gid);
    if (!orderId) {
      failed.push({ gid, error: "order not in DB" });
      continue;
    }
    for (const page of pageList) {
      for (const ev of page.nodes || []) {
        if (!ev?.id) continue;
        if (existing.has(ev.id)) {
          skipped += 1;
          continue;
        }
        existing.add(ev.id);
        const isComment =
          ev.__typename === "CommentEvent" ||
          (ev.message && String(ev.message).startsWith("Comment:"));
        if (isComment) {
          comments.push({
            id: newId(),
            order_id: orderId,
            body: ev.rawMessage || ev.message || "",
            author_name_snapshot: null,
            source_system: "shopify",
            external_event_id: ev.id,
            occurred_at: ev.createdAt || new Date().toISOString(),
          });
        } else {
          rows.push({
            id: newId(),
            order_id: orderId,
            event_type: ev.__typename || "Event",
            category: "system",
            source_system: "shopify",
            source_app: ev.appTitle || null,
            actor_type: null,
            actor_id: null,
            actor_name_snapshot: null,
            message: ev.message || null,
            metadata: {
              attributeToApp: ev.attributeToApp ?? null,
              attributeToUser: ev.attributeToUser ?? null,
              criticalAlert: ev.criticalAlert ?? null,
              repair: "events_nested_pagination",
            },
            external_event_id: ev.id,
            occurred_at: ev.createdAt || new Date().toISOString(),
            imported_at: new Date().toISOString(),
          });
        }
      }
    }
  }
  for (let i = 0; i < rows.length; i += 80) {
    const chunk = rows.slice(i, i + 80);
    const { error } = await sb.from("order_events").insert(chunk);
    if (error) {
      for (const row of chunk) {
        const { error: e2 } = await sb.from("order_events").insert(row);
        if (e2) {
          if (/duplicate|unique/i.test(e2.message)) skipped += 1;
          else failed.push({ gid: row.external_event_id, error: e2.message });
        } else added += 1;
      }
    } else added += chunk.length;
  }
  if (comments.length) {
    const { error } = await sb.from("order_comments").insert(comments);
    if (error) console.error("[backfill comments]", error.message);
  }
  const report = { added, skipped, failed, attempted: rows.length, comments: comments.length };
  await writeFile(path.join(EV_DIR, "backfill-report.json"), JSON.stringify(report, null, 2));
  return report;
}

async function main() {
  if (!doManifest && !doProbe && !doFetch && !doBackfill) {
    console.log(`Usage: node shopify-forensic-audit/scripts/repair-nested-connections.mjs --manifest|--probe|--fetch|--backfill|--all [--limit N]`);
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });
  await mkdir(REPAIR_ROOT, { recursive: true });
  const sb = await supabase();

  let ffSuspects = [];
  let rfSuspects = [];
  let evTruncated = [];

  if (doManifest) {
    const m = await buildManifest();
    ffSuspects = m.ffSuspects;
    rfSuspects = m.rfSuspects;
    evTruncated = m.evTruncated;
  } else {
    try {
      ffSuspects = JSON.parse(await readFile(path.join(FF_DIR, "suspect-manifest.json"), "utf8"));
    } catch {
      ffSuspects = [];
    }
    try {
      rfSuspects = JSON.parse(await readFile(path.join(RF_DIR, "suspect-manifest.json"), "utf8"));
    } catch {
      rfSuspects = [];
    }
    try {
      evTruncated = JSON.parse(await readFile(path.join(EV_DIR, "truncated-manifest.json"), "utf8"));
    } catch {
      evTruncated = [];
    }
  }

  let ffProbe = null;
  let rfProbe = null;
  if (doProbe) {
    ffProbe = await probeList(
      "fulfillment",
      ffSuspects,
      "17b-fulfillment-line-items-probe.graphql",
      "fulfillment",
      "lineItems",
      path.join(FF_DIR, "confirmed-truncated.json"),
    );
    rfProbe = await probeList(
      "refund",
      rfSuspects,
      "18b-refund-line-items-probe.graphql",
      "refund",
      "lineItems",
      path.join(RF_DIR, "confirmed-truncated.json"),
    );
  }

  let ffFetch = null;
  let rfFetch = null;
  let evFetch = null;
  if (doFetch) {
    let ffConfirmed = [];
    let rfConfirmed = [];
    try {
      ffConfirmed = JSON.parse(await readFile(path.join(FF_DIR, "confirmed-truncated.json"), "utf8"));
    } catch {
      ffConfirmed = ffProbe?.confirmed || [];
    }
    try {
      rfConfirmed = JSON.parse(await readFile(path.join(RF_DIR, "confirmed-truncated.json"), "utf8"));
    } catch {
      rfConfirmed = rfProbe?.confirmed || [];
    }
    ffFetch = await fetchConfirmed(
      "fulfillment",
      ffConfirmed,
      FF_DIR,
      "17-fulfillment-line-items-page.graphql",
      "fulfillment",
      "lineItems",
      "fulfillmentGid",
      "fulfillmentName",
    );
    rfFetch = await fetchConfirmed(
      "refund",
      rfConfirmed,
      RF_DIR,
      "18-refund-line-items-page.graphql",
      "refund",
      "lineItems",
      "refundGid",
      "orderName",
    );
    // events: use truncated manifest directly
    evFetch = await fetchConfirmed(
      "event",
      evTruncated.map((r) => ({
        ...r,
        eventOrderGid: r.orderGid,
      })),
      EV_DIR,
      "19-order-events-page.graphql",
      "order",
      "events",
      "orderGid",
      "orderName",
    );
  }

  let ffBackfill = null;
  let rfBackfill = null;
  let evBackfill = null;
  if (doBackfill) {
    ffBackfill = await backfillFulfillmentLines(sb);
    rfBackfill = await backfillAllRefundLines(sb);
    evBackfill = await backfillEvents(sb);
  }

  const report = {
    at: new Date().toISOString(),
    ffSuspects: ffSuspects.length,
    rfSuspects: rfSuspects.length,
    evTruncated: evTruncated.length,
    ffProbe: ffProbe
      ? { confirmed: ffProbe.confirmed.length, notTruncated: ffProbe.notTruncated.length, failed: ffProbe.failed.length }
      : null,
    rfProbe: rfProbe
      ? { confirmed: rfProbe.confirmed.length, notTruncated: rfProbe.notTruncated.length, failed: rfProbe.failed.length }
      : null,
    ffFetch,
    rfFetch,
    evFetch,
    ffBackfill,
    rfBackfill,
    evBackfill,
  };
  await writeFile(path.join(OUT, "nested-connection-repair-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
