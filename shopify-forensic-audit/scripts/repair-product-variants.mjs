#!/usr/bin/env node
/**
 * Repair product.variants nested pagination (hasNextPage confirmed in raw).
 * Persist repair pages only (catalogue DB may not consume forensic products yet).
 *
 *   node shopify-forensic-audit/scripts/repair-product-variants.mjs
 */
import { createReadStream } from "node:fs";
import { mkdir, writeFile, readFile, appendFile, readdir } from "node:fs/promises";
import readline from "node:readline";
import path from "node:path";
import {
  AUDIT_ROOT,
  RAW_DIR,
  QUERY_DIR,
  API_VERSION,
  STORE,
  executeQuery,
} from "./shopify-exec.mjs";

const OUT_DIR = path.join(AUDIT_ROOT, "raw_repairs", "product_variants");
const MANIFEST = path.join(AUDIT_ROOT, "raw_repairs", "nested-completeness-manifest.jsonl");

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

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const truncated = [];
  await eachUnique("products/products.jsonl", async (rec) => {
    if (rec.variants?.pageInfo?.hasNextPage) {
      truncated.push({
        productGid: rec.id,
        handle: rec.handle || null,
        title: rec.title || null,
        rawVariantCount: (rec.variants.nodes || []).length,
        endCursor: rec.variants.pageInfo.endCursor || null,
      });
    }
  });
  await writeFile(path.join(OUT_DIR, "truncated-manifest.json"), JSON.stringify(truncated, null, 2));
  console.error(`[variants] truncated products: ${truncated.length}`);

  const done = new Set();
  try {
    for (const f of await readdir(OUT_DIR)) {
      if (!f.includes("-page-")) continue;
      const p = JSON.parse(await readFile(path.join(OUT_DIR, f), "utf8"));
      if (p.parentGid) done.add(p.parentGid);
    }
  } catch {
    /* empty */
  }

  const summary = { fetched: 0, failed: [], addedNodes: 0 };
  for (const row of truncated) {
    if (done.has(row.productGid)) continue;
    try {
      let cursor = row.endCursor;
      let hasNext = true;
      let page = 0;
      let added = 0;
      while (hasNext) {
        page += 1;
        const { data } = await executeQuery({
          queryFile: path.join(QUERY_DIR, "20-product-variants-page.graphql"),
          variables: { id: row.productGid, cursor, first: 50 },
        });
        const conn = data?.product?.variants;
        const nodes = conn?.nodes || [];
        await writeFile(
          path.join(OUT_DIR, `${safeName(row.productGid)}-page-${page}.json`),
          JSON.stringify(
            {
              fetchedAt: new Date().toISOString(),
              apiVersion: API_VERSION,
              store: STORE,
              parentType: "product",
              parentGid: row.productGid,
              parentName: row.handle || row.title,
              page,
              cursorIn: cursor,
              pageInfo: conn?.pageInfo || null,
              nodes,
            },
            null,
            2,
          ),
        );
        added += nodes.length;
        hasNext = Boolean(conn?.pageInfo?.hasNextPage);
        cursor = conn?.pageInfo?.endCursor || null;
        console.error(`[variants] ${row.handle || row.productGid} page ${page}: +${nodes.length} hasNext=${hasNext}`);
      }
      summary.fetched += 1;
      summary.addedNodes += added;
      await appendFile(
        MANIFEST,
        JSON.stringify({
          parentType: "product",
          parentGid: row.productGid,
          connection: "variants",
          repairPageCount: page,
          repairItemCount: added,
          finalHasNextPage: false,
          extractionTimestamp: new Date().toISOString(),
          apiVersion: API_VERSION,
        }) + "\n",
      );
    } catch (e) {
      summary.failed.push({ productGid: row.productGid, error: e.message });
      console.error(`[fail variants] ${row.handle}: ${e.message}`);
    }
  }
  await writeFile(path.join(OUT_DIR, "fetch-report.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ truncated: truncated.length, ...summary }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
