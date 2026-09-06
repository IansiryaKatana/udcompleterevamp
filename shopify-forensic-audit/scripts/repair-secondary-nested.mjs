#!/usr/bin/env node
/**
 * Secondary nested repairs discovered in final audit:
 *  - order.discountApplications (exact-20 confirmed truncated)
 *  - abandonedCheckout.lineItems (exact-50 confirmed truncated)
 *  - product.media (exact-20 confirmed truncated)
 *
 *   node shopify-forensic-audit/scripts/repair-secondary-nested.mjs
 */
import { createReadStream } from "node:fs";
import { mkdir, writeFile, readFile, appendFile, readdir } from "node:fs/promises";
import readline from "node:readline";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  AUDIT_ROOT,
  RAW_DIR,
  API_VERSION,
  STORE,
  executeQuery,
} from "./shopify-exec.mjs";

const REPAIR_ROOT = path.join(AUDIT_ROOT, "raw_repairs");
const MANIFEST = path.join(REPAIR_ROOT, "nested-completeness-manifest.jsonl");

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

async function eachUnique(rel, onRec) {
  const seen = new Set();
  const rl = readline.createInterface({
    input: createReadStream(path.join(RAW_DIR, rel), { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
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

function safeName(gid) {
  return String(gid).replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function alreadyDone(dir) {
  const done = new Set();
  try {
    for (const f of await readdir(dir)) {
      if (!f.includes("-page-") || !f.endsWith(".json")) continue;
      const p = JSON.parse(await readFile(path.join(dir, f), "utf8"));
      if (p.parentGid) done.add(p.parentGid);
    }
  } catch {
    /* empty */
  }
  return done;
}

async function fetchRemaining({
  dir,
  gid,
  name,
  startCursor,
  query,
  rootPath, // e.g. ['order','discountApplications']
  connectionName,
  parentType,
}) {
  let cursor = startCursor;
  let hasNext = true;
  let page = 0;
  let added = 0;
  while (hasNext) {
    page += 1;
    const { data } = await executeQuery({ query, variables: { id: gid, cursor, first: 50 } });
    let cur = data;
    for (const k of rootPath) cur = cur?.[k];
    const nodes = cur?.nodes || [];
    await writeFile(
      path.join(dir, `${safeName(gid)}-page-${page}.json`),
      JSON.stringify(
        {
          fetchedAt: new Date().toISOString(),
          apiVersion: API_VERSION,
          store: STORE,
          parentType,
          parentGid: gid,
          parentName: name || null,
          page,
          cursorIn: cursor,
          pageInfo: cur?.pageInfo || null,
          nodes,
        },
        null,
        2,
      ),
    );
    added += nodes.length;
    hasNext = Boolean(cur?.pageInfo?.hasNextPage);
    cursor = cur?.pageInfo?.endCursor || null;
    console.error(`[${connectionName}] ${name || gid} page ${page}: +${nodes.length} hasNext=${hasNext}`);
    if (hasNext && !cursor) throw new Error(`hasNext without cursor for ${gid}`);
  }
  await appendFile(
    MANIFEST,
    JSON.stringify({
      parentType,
      parentGid: gid,
      connection: connectionName,
      repairPageCount: page,
      repairItemCount: added,
      finalHasNextPage: false,
      extractionTimestamp: new Date().toISOString(),
      apiVersion: API_VERSION,
    }) + "\n",
  );
  return added;
}

const DISCOUNT_PAGE = `
query($id: ID!, $cursor: String, $first: Int!) {
  order(id: $id) {
    id
    name
    discountApplications(first: $first, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        __typename
        allocationMethod
        targetSelection
        targetType
        value {
          ... on MoneyV2 { amount currencyCode }
          ... on PricingPercentageValue { percentage }
        }
        ... on DiscountCodeApplication { code }
        ... on ManualDiscountApplication { title description }
        ... on ScriptDiscountApplication { title }
        ... on AutomaticDiscountApplication { title }
      }
    }
  }
}`;

const DISCOUNT_PROBE = `
query($id: ID!) {
  order(id: $id) {
    id
    name
    discountApplications(first: 20) {
      pageInfo { hasNextPage endCursor }
      nodes { __typename }
    }
  }
}`;

const ABANDONED_PAGE = `
query($id: ID!, $cursor: String, $first: Int!) {
  node(id: $id) {
    ... on AbandonedCheckout {
      id
      name
      lineItems(first: $first, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          title
          quantity
          sku
          variant { id title sku }
          product { id title }
        }
      }
    }
  }
}`;

const ABANDONED_PROBE = `
query($id: ID!) {
  node(id: $id) {
    ... on AbandonedCheckout {
      id
      lineItems(first: 50) {
        pageInfo { hasNextPage endCursor }
        nodes { id }
      }
    }
  }
}`;

const MEDIA_PAGE = `
query($id: ID!, $cursor: String, $first: Int!) {
  product(id: $id) {
    id
    handle
    media(first: $first, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on MediaImage {
          id
          alt
          image { url width height }
        }
        ... on Video { id alt }
        ... on Model3d { id alt }
        ... on ExternalVideo { id alt }
      }
    }
  }
}`;

const MEDIA_PROBE = `
query($id: ID!) {
  product(id: $id) {
    id
    handle
    media(first: 20) {
      pageInfo { hasNextPage endCursor }
      nodes { ... on MediaImage { id } }
    }
  }
}`;

async function repairDiscountApplications() {
  const dir = path.join(REPAIR_ROOT, "discount_applications");
  await mkdir(dir, { recursive: true });
  const suspects = [];
  await eachUnique("orders/orders.jsonl", async (rec) => {
    if ((rec.discountApplications?.nodes || []).length >= 20) {
      suspects.push({ orderGid: rec.id, orderName: rec.name, raw: rec.discountApplications.nodes.length });
    }
  });
  const confirmed = [];
  for (const s of suspects) {
    try {
      const { data } = await executeQuery({ query: DISCOUNT_PROBE, variables: { id: s.orderGid } });
      const pi = data?.order?.discountApplications?.pageInfo;
      if (pi?.hasNextPage) {
        confirmed.push({ ...s, endCursor: pi.endCursor, hasNextPage: true });
      }
    } catch (e) {
      console.error(`[disc probe fail] ${s.orderName}: ${e.message}`);
    }
    if (confirmed.length % 50 === 0 && confirmed.length) {
      console.error(`[disc probe] confirmed ${confirmed.length}…`);
    }
  }
  await writeFile(path.join(dir, "confirmed-truncated.json"), JSON.stringify(confirmed, null, 2));
  const done = await alreadyDone(dir);
  let addedNodes = 0;
  let fetched = 0;
  const failed = [];
  for (const row of confirmed) {
    if (done.has(row.orderGid)) continue;
    try {
      addedNodes += await fetchRemaining({
        dir,
        gid: row.orderGid,
        name: row.orderName,
        startCursor: row.endCursor,
        query: DISCOUNT_PAGE,
        rootPath: ["order", "discountApplications"],
        connectionName: "discountApplications",
        parentType: "order",
      });
      fetched += 1;
    } catch (e) {
      failed.push({ gid: row.orderGid, error: e.message });
      console.error(`[disc fail] ${row.orderName}: ${e.message}`);
    }
  }
  const report = { suspects: suspects.length, confirmed: confirmed.length, fetched, addedNodes, failed };
  await writeFile(path.join(dir, "fetch-report.json"), JSON.stringify(report, null, 2));
  return report;
}

async function repairAbandoned() {
  const dir = path.join(REPAIR_ROOT, "abandoned_line_items");
  await mkdir(dir, { recursive: true });
  const suspects = [];
  await eachUnique("abandoned_checkouts/abandoned-checkouts.jsonl", async (rec) => {
    if ((rec.lineItems?.nodes || []).length >= 50) {
      suspects.push({ id: rec.id, name: rec.name || null, raw: rec.lineItems.nodes.length });
    }
  });
  const confirmed = [];
  for (const s of suspects) {
    try {
      const { data } = await executeQuery({ query: ABANDONED_PROBE, variables: { id: s.id } });
      const pi = data?.node?.lineItems?.pageInfo;
      if (pi?.hasNextPage) confirmed.push({ ...s, endCursor: pi.endCursor });
    } catch (e) {
      console.error(`[ab probe fail] ${s.id}: ${e.message}`);
    }
  }
  await writeFile(path.join(dir, "confirmed-truncated.json"), JSON.stringify(confirmed, null, 2));
  const done = await alreadyDone(dir);
  let addedNodes = 0;
  let fetched = 0;
  const failed = [];
  for (const row of confirmed) {
    if (done.has(row.id)) continue;
    try {
      addedNodes += await fetchRemaining({
        dir,
        gid: row.id,
        name: row.name,
        startCursor: row.endCursor,
        query: ABANDONED_PAGE,
        rootPath: ["node", "lineItems"],
        connectionName: "lineItems",
        parentType: "abandoned_checkout",
      });
      fetched += 1;
    } catch (e) {
      failed.push({ gid: row.id, error: e.message });
    }
  }

  // Additive backfill into abandoned_checkout_line_items if table exists
  await loadEnv();
  let backfill = null;
  try {
    const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Detect table
    const { error: tErr } = await sb.from("abandoned_checkout_items").select("id").limit(1);
    if (!tErr) {
      // Optional: leave as archive-only if schema differs; skip forced insert
      backfill = { note: "abandoned_checkout_items exists — archive repair only in this pass" };
    } else {
      backfill = { note: `no matching line table (${tErr.message}) — archive repair only` };
    }
  } catch (e) {
    backfill = { note: e.message };
  }

  const report = { suspects: suspects.length, confirmed: confirmed.length, fetched, addedNodes, failed, backfill };
  await writeFile(path.join(dir, "fetch-report.json"), JSON.stringify(report, null, 2));
  return report;
}

async function repairMedia() {
  const dir = path.join(REPAIR_ROOT, "product_media");
  await mkdir(dir, { recursive: true });
  const suspects = [];
  await eachUnique("products/products.jsonl", async (rec) => {
    if ((rec.media?.nodes || []).length >= 20) {
      suspects.push({ id: rec.id, handle: rec.handle, raw: rec.media.nodes.length });
    }
  });
  const confirmed = [];
  let i = 0;
  for (const s of suspects) {
    i += 1;
    try {
      const { data } = await executeQuery({ query: MEDIA_PROBE, variables: { id: s.id } });
      const pi = data?.product?.media?.pageInfo;
      if (pi?.hasNextPage) confirmed.push({ ...s, endCursor: pi.endCursor });
    } catch (e) {
      console.error(`[media probe fail] ${s.handle}: ${e.message}`);
    }
    if (i % 40 === 0) console.error(`[media probe] ${i}/${suspects.length} confirmed=${confirmed.length}`);
  }
  await writeFile(path.join(dir, "confirmed-truncated.json"), JSON.stringify(confirmed, null, 2));
  const done = await alreadyDone(dir);
  let addedNodes = 0;
  let fetched = 0;
  const failed = [];
  for (const row of confirmed) {
    if (done.has(row.id)) continue;
    try {
      addedNodes += await fetchRemaining({
        dir,
        gid: row.id,
        name: row.handle,
        startCursor: row.endCursor,
        query: MEDIA_PAGE,
        rootPath: ["product", "media"],
        connectionName: "media",
        parentType: "product",
      });
      fetched += 1;
    } catch (e) {
      failed.push({ gid: row.id, error: e.message });
    }
  }
  const report = { suspects: suspects.length, confirmed: confirmed.length, fetched, addedNodes, failed };
  await writeFile(path.join(dir, "fetch-report.json"), JSON.stringify(report, null, 2));
  return report;
}

async function main() {
  await mkdir(REPAIR_ROOT, { recursive: true });
  console.error("[secondary] discountApplications…");
  const discounts = await repairDiscountApplications();
  console.error("[secondary] abandoned lineItems…");
  const abandoned = await repairAbandoned();
  console.error("[secondary] product media…");
  const media = await repairMedia();
  const report = { at: new Date().toISOString(), discounts, abandoned, media };
  await writeFile(
    path.join(AUDIT_ROOT, "import", "out", "secondary-nested-repair-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
