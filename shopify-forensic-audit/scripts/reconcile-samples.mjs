#!/usr/bin/env node
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { executeQuery, QUERY_DIR, AUDIT_ROOT } from "./shopify-exec.mjs";

async function loadEnv() {
  const text = await readFile(path.resolve(AUDIT_ROOT, "../.env"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

async function shopifyCount(gid) {
  let cursor = null;
  let hasNext = true;
  let total = 0;
  let pages = 0;
  while (hasNext) {
    pages += 1;
    const { data } = await executeQuery({
      queryFile: path.join(QUERY_DIR, "15-order-line-items-page.graphql"),
      variables: { id: gid, cursor, first: 250 },
    });
    const conn = data?.order?.lineItems;
    total += (conn?.nodes || []).length;
    hasNext = Boolean(conn?.pageInfo?.hasNextPage);
    cursor = conn?.pageInfo?.endCursor || null;
    if (pages > 40) throw new Error("too many pages");
  }
  return total;
}

async function loadRepairMap(dir) {
  const map = new Map();
  for (const f of await readdir(dir)) {
    if (!f.includes("-page-") || !f.endsWith(".json")) continue;
    const p = JSON.parse(await readFile(path.join(dir, f), "utf8"));
    if (!p.parentGid) continue;
    if (!map.has(p.parentGid)) map.set(p.parentGid, []);
    map.get(p.parentGid).push(p);
  }
  for (const pages of map.values()) pages.sort((a, b) => a.page - b.page);
  return map;
}

async function main() {
  await loadEnv();
  const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const orderDir = path.join(AUDIT_ROOT, "raw_repairs", "order_line_items");
  const draftDir = path.join(AUDIT_ROOT, "raw_repairs", "draft_line_items");
  const manifest = JSON.parse(await readFile(path.join(orderDir, "truncated-manifest.json"), "utf8"));
  const byName = Object.fromEntries(manifest.map((r) => [r.orderName, r]));
  const repairByGid = await loadRepairMap(orderDir);
  const draftRepair = await loadRepairMap(draftDir);
  const draftConf = JSON.parse(await readFile(path.join(draftDir, "confirmed-truncated.json"), "utf8"));

  const largest = [...repairByGid.entries()]
    .map(([gid, pages]) => ({
      gid,
      name: pages[0]?.parentName,
      n: pages.reduce((s, p) => s + (p.nodes || []).length, 0),
      lastHasNext: Boolean(pages.at(-1)?.pageInfo?.hasNextPage),
    }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);

  const samples = ["#UD7070", "#UD7074", "#UD12925", "#UD1761", "#UD22797", "#UD1054"];
  for (const x of largest) if (x.name && !samples.includes(x.name)) samples.push(x.name);

  const results = [];
  for (const name of samples) {
    const row = byName[name] || largest.find((x) => x.name === name);
    const gid = row?.orderGid || row?.gid;
    if (!gid) {
      results.push({ name, error: "missing" });
      continue;
    }
    const primary = row.rawLineCount ?? 50;
    const pages = repairByGid.get(gid) || [];
    const repairIds = new Set();
    for (const p of pages) for (const n of p.nodes || []) if (n.id) repairIds.add(n.id);
    const archiveFinal = primary + repairIds.size;
    const lastHasNext = pages.length ? Boolean(pages.at(-1).pageInfo?.hasNextPage) : true;
    let shopifyFinal;
    try {
      shopifyFinal = await shopifyCount(gid);
    } catch (e) {
      shopifyFinal = `ERR:${e.message}`;
    }
    const { data: ord } = await sb
      .from("orders")
      .select("id, source_order_number, subtotal, discount_total, tax_total, total, shipping_total")
      .eq("shopify_order_gid", gid)
      .maybeSingle();
    let dbCount = 0;
    const sums = { qty: 0, line_total: 0, discount_total: 0, tax_total: 0 };
    if (ord?.id) {
      let from = 0;
      for (;;) {
        const { data } = await sb
          .from("order_items")
          .select("quantity,line_total,discount_total,tax_total")
          .eq("order_id", ord.id)
          .range(from, from + 999);
        if (!data?.length) break;
        dbCount += data.length;
        for (const li of data) {
          sums.qty += Number(li.quantity) || 0;
          sums.line_total += Number(li.line_total) || 0;
          sums.discount_total += Number(li.discount_total) || 0;
          sums.tax_total += Number(li.tax_total) || 0;
        }
        if (data.length < 1000) break;
        from += 1000;
      }
    }
    const round = (n) => Math.round(n * 100) / 100;
    const rec = {
      name,
      gid,
      shopifyFinalLineCount: shopifyFinal,
      archiveFinalLineCount: archiveFinal,
      dbLineCount: dbCount,
      match: shopifyFinal === archiveFinal && archiveFinal === dbCount ? "MATCH" : "MISMATCH",
      primary,
      repairAdded: repairIds.size,
      repairPages: pages.length,
      lastHasNext,
      header: ord
        ? {
            subtotal: ord.subtotal,
            discount: ord.discount_total,
            tax: ord.tax_total,
            shipping: ord.shipping_total,
            total: ord.total,
          }
        : null,
      lineSums: {
        qty: sums.qty,
        line_total: round(sums.line_total),
        discount_total: round(sums.discount_total),
        tax_total: round(sums.tax_total),
      },
    };
    results.push(rec);
    console.error(`done ${name} ${rec.match} shopify=${shopifyFinal} archive=${archiveFinal} db=${dbCount}`);
  }

  let unrepaired = 0;
  for (const r of manifest) {
    const pages = repairByGid.get(r.orderGid) || [];
    if (!pages.length || pages.at(-1)?.pageInfo?.hasNextPage) unrepaired += 1;
  }
  let draftUnrepaired = 0;
  for (const r of draftConf) {
    const pages = draftRepair.get(r.draftGid) || [];
    if (!pages.length || pages.at(-1)?.pageInfo?.hasNextPage) draftUnrepaired += 1;
  }

  const out = {
    at: new Date().toISOString(),
    unrepairedOrders: unrepaired,
    unrepairedDrafts: draftUnrepaired,
    truncatedOrders: manifest.length,
    confirmedDrafts: draftConf.length,
    samples: results,
    largestRepairs: largest,
  };
  const outDir = path.join(AUDIT_ROOT, "import", "out");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "line-item-reconcile.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
