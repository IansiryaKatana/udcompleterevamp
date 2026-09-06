#!/usr/bin/env node
/**
 * Post-repair migration integrity gate.
 *   node shopify-forensic-audit/import/integrity-gate.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  eachJsonl,
  loadEnvFile,
  supabaseCreds,
  firstMoney,
  money,
  mfNodes,
  mfValue,
  tagList,
  SYSTEM,
  nowIso,
  OUT,
  ROOT,
} from "./lib/helpers.mjs";

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function runSql(sql) {
  const tmp = path.join(os.tmpdir(), "ud-repair");
  await mkdir(tmp, { recursive: true });
  const file = path.join(tmp, `gate-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`);
  await writeFile(file, sql);
  const repoRoot = path.resolve(ROOT, "..");
  const cmd = `npx supabase db query --linked -f "${file}" -o json`;
  const r = spawnSync(cmd, { cwd: repoRoot, encoding: "utf8", maxBuffer: 20 * 1024 * 1024, shell: true });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || "sql failed");
  const text = (r.stdout || "").replace(/^Initialising login role\.\.\.\s*/i, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`SQL JSON parse failed: ${text.slice(0, 300)}`);
  }
  // CLI may wrap as { rows: [...] } or return a bare array
  if (Array.isArray(parsed)) return parsed[0] || {};
  if (parsed?.rows && Array.isArray(parsed.rows)) return parsed.rows[0] || {};
  if (parsed && typeof parsed === "object") return parsed;
  return {};
}

async function countExact(sb, table, filter) {
  let q = sb.from(table).select("*", { count: "exact", head: true });
  if (filter) q = filter(q);
  const { count, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function main() {
  await loadEnvFile();
  const { url, key } = supabaseCreds();
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  await mkdir(OUT, { recursive: true });

  const report = { at: nowIso(), entities: {}, financial: {}, repairs: {}, source: {}, gate: {} };

  // Entity counts
  const entityTables = {
    customers: "customers",
    companies: "companies",
    orders: "orders",
    order_items: "order_items",
    draft_orders: "draft_orders",
    abandoned_checkouts: "abandoned_checkouts",
    payment_transactions: "payment_transactions",
    refunds: "refunds",
    fulfillments: "fulfillments",
    order_events: "order_events",
    company_contacts: "company_contacts",
    customer_addresses: "customer_addresses",
    entity_assignments: "entity_assignments",
  };
  for (const [k, t] of Object.entries(entityTables)) {
    report.entities[k] = await countExact(sb, t);
  }
  report.entities.orders_with_draft_id = await countExact(sb, "orders", (q) =>
    q.not("draft_order_id", "is", null),
  );
  report.entities.drafts_with_converted_order = await countExact(sb, "draft_orders", (q) =>
    q.not("converted_order_id", "is", null),
  );
  report.entities.payment_due_on = await countExact(sb, "orders", (q) =>
    q.not("payment_due_on", "is", null),
  );
  report.entities.null_original_unit_price = await countExact(sb, "order_items", (q) =>
    q.is("original_unit_price", null),
  );
  report.entities.zero_original_unit_price = await countExact(sb, "order_items", (q) =>
    q.eq("original_unit_price", 0),
  );

  report.entities.customer_metafields = await countExact(sb, "metafields", (q) =>
    q.eq("source_system", SYSTEM).eq("owner_type", "customer"),
  );
  report.entities.order_metafields = await countExact(sb, "metafields", (q) =>
    q.eq("source_system", SYSTEM).eq("owner_type", "order"),
  );
  report.entities.customer_tags = await countExact(sb, "entity_tags", (q) =>
    q.eq("entity_type", "customer"),
  );
  report.entities.order_tags = await countExact(sb, "entity_tags", (q) => q.eq("entity_type", "order"));

  // Financial via SQL
  const fin = await runSql(`
select
  round(sum(subtotal)::numeric,2) as subtotal,
  round(sum(discount_total)::numeric,2) as discounts,
  round(sum(shipping_total)::numeric,2) as shipping,
  round(sum(tax_total)::numeric,2) as tax,
  round(sum(total)::numeric,2) as total,
  round(sum(total_received)::numeric,2) as paid,
  round(sum(total_outstanding)::numeric,2) as outstanding
from public.orders;
`);
  const refundFin = await runSql(`
select round(sum(total_refunded)::numeric,2) as refund_headers from public.refunds;
`);
  report.financial.db = {
    subtotal: Number(fin.subtotal),
    discounts: Number(fin.discounts),
    shipping: Number(fin.shipping),
    tax: Number(fin.tax),
    total: Number(fin.total),
    paid: Number(fin.paid),
    outstanding: Number(fin.outstanding),
    refund_headers: Number(refundFin.refund_headers),
  };

  // Source financials (deduped JSONL)
  let srcSub = 0,
    srcDisc = 0,
    srcShip = 0,
    srcTax = 0,
    srcTot = 0,
    srcPaid = 0,
    srcOut = 0,
    srcRef = 0;
  let srcOrders = 0,
    srcItems = 0,
    srcCustMf = 0,
    srcOrdMf = 0,
    srcCustTags = 0,
    srcOrdTags = 0,
    srcAddrs = 0,
    srcContacts = 0,
    srcOrigSet = 0,
    srcPaymentDue = 0,
    srcDraftConverted = 0;
  await eachJsonl("orders/orders.jsonl", (rec) => {
    srcOrders += 1;
    srcSub += money(rec.subtotalPriceSet);
    srcDisc += firstMoney(rec.currentTotalDiscountsSet, rec.totalDiscountsSet);
    srcShip += money(rec.totalShippingPriceSet);
    srcTax += money(rec.totalTaxSet);
    srcTot += money(rec.totalPriceSet);
    srcPaid += money(rec.totalReceivedSet);
    srcOut += money(rec.totalOutstandingSet);
    for (const rf of rec.refunds?.nodes || rec.refunds || []) {
      if (rf && typeof rf === "object") srcRef += money(rf.totalRefundedSet);
    }
    srcItems += (rec.lineItems?.nodes || []).length;
    srcOrdMf += mfNodes(rec.metafields).length;
    srcOrdTags += tagList(rec.tags).length;
    if (mfValue(rec.metafields, "order", "payment_due_date") || mfValue(rec.metafields, "custom", "payment_due")) {
      srcPaymentDue += 1;
    }
    for (const li of rec.lineItems?.nodes || []) {
      if (li?.originalUnitPriceSet != null) srcOrigSet += 1;
    }
  });
  await eachJsonl("customers/customers.jsonl", (rec) => {
    srcCustMf += mfNodes(rec.metafields).length;
    srcCustTags += tagList(rec.tags).length;
    srcAddrs += (rec.addresses || []).length;
  });
  await eachJsonl("customers/companies.jsonl", (rec) => {
    srcContacts += (rec.contacts?.nodes || []).length;
  });
  await eachJsonl("draft_orders/draft-orders.jsonl", (rec) => {
    if (rec.order?.id) srcDraftConverted += 1;
  });

  report.source = {
    orders: srcOrders,
    order_items: srcItems,
    discounts: round2(srcDisc),
    subtotal: round2(srcSub),
    shipping: round2(srcShip),
    tax: round2(srcTax),
    total: round2(srcTot),
    paid: round2(srcPaid),
    outstanding: round2(srcOut),
    refund_headers: round2(srcRef),
    customer_metafields: srcCustMf,
    order_metafields: srcOrdMf,
    customer_tags: srcCustTags,
    order_tags: srcOrdTags,
    addresses: srcAddrs,
    contacts: srcContacts,
    payment_due: srcPaymentDue,
    originalUnitPriceSet: srcOrigSet,
    draft_converted: srcDraftConverted,
  };

  report.financial.targets = {
    subtotal: 21913963.61,
    discounts: 519373.41,
    shipping: 36587.87,
    tax: 4382097.5,
    total: 26332392.98,
    paid: 23706207.7,
    outstanding: 1107159.59,
    refund_headers: 17134.63,
  };

  // Parent entity counts (order_events / child line counts are dynamic after nested repairs)
  const expectedEntities = {
    customers: 6219,
    companies: 3518,
    orders: 21767,
    draft_orders: 4093,
    abandoned_checkouts: 173,
    payment_transactions: 34430,
    refunds: 3774,
    fulfillments: 22917,
    company_contacts: 3518,
  };

  const blockers = [];
  for (const [k, exp] of Object.entries(expectedEntities)) {
    if (report.entities[k] !== exp) blockers.push(`${k}: got ${report.entities[k]} want ${exp}`);
  }
  if (Number(report.financial.db.discounts) !== 519373.41) {
    blockers.push(`discounts: got ${report.financial.db.discounts} want 519373.41`);
  }
  for (const [k, exp] of Object.entries(report.financial.targets)) {
    const got = report.financial.db[k];
    if (Number(got) !== Number(exp)) {
      const src = report.source[k === "refund_headers" ? "refund_headers" : k === "discounts" ? "discounts" : k];
      if (k === "discounts") continue;
      blockers.push(`financial.${k}: db=${got} target=${exp} source=${src ?? "n/a"}`);
    }
  }
  if (report.entities.payment_due_on !== report.source.payment_due) {
    blockers.push(`payment_due_on: got ${report.entities.payment_due_on} want ${report.source.payment_due}`);
  }
  if (report.entities.customer_metafields !== report.source.customer_metafields) {
    blockers.push(
      `customer_metafields: got ${report.entities.customer_metafields} want ${report.source.customer_metafields}`,
    );
  }
  if (report.entities.order_metafields !== report.source.order_metafields) {
    blockers.push(
      `order_metafields: got ${report.entities.order_metafields} want ${report.source.order_metafields}`,
    );
  }
  if (report.entities.customer_tags !== report.source.customer_tags) {
    blockers.push(`customer_tags: got ${report.entities.customer_tags} want ${report.source.customer_tags}`);
  }
  if (report.entities.order_tags !== report.source.order_tags) {
    blockers.push(`order_tags: got ${report.entities.order_tags} want ${report.source.order_tags}`);
  }
  if (report.entities.customer_addresses !== report.source.addresses) {
    blockers.push(
      `customer_addresses: got ${report.entities.customer_addresses} want ${report.source.addresses}`,
    );
  }
  if (report.entities.orders_with_draft_id !== report.entities.drafts_with_converted_order) {
    blockers.push(
      `draft↔order mismatch: orders.draft_order_id=${report.entities.orders_with_draft_id} drafts.converted=${report.entities.drafts_with_converted_order}`,
    );
  }

  // SOURCE → ARCHIVE completeness.
  // Primary JSONL may still mark hasNextPage=true; repair pages under raw_repairs must finish those.
  const { readdir } = await import("node:fs/promises");
  const REPAIR_ORDERS = path.join(ROOT, "raw_repairs", "order_line_items");
  const REPAIR_DRAFTS = path.join(ROOT, "raw_repairs", "draft_line_items");

  async function repairCoverage(dir) {
    const covered = new Map(); // parentGid -> { pages, lastHasNext, repairNodes }
    let files = [];
    try {
      files = (await readdir(dir)).filter((f) => f.includes("-page-") && f.endsWith(".json"));
    } catch {
      return covered;
    }
    for (const f of files) {
      try {
        const p = JSON.parse(await readFile(path.join(dir, f), "utf8"));
        if (!p.parentGid) continue;
        const cur = covered.get(p.parentGid) || { pages: 0, lastHasNext: true, repairNodes: 0, maxPage: 0 };
        cur.pages += 1;
        cur.repairNodes += (p.nodes || []).length;
        if ((p.page || 0) >= cur.maxPage) {
          cur.maxPage = p.page || 0;
          cur.lastHasNext = Boolean(p.pageInfo?.hasNextPage);
        }
        covered.set(p.parentGid, cur);
      } catch {
        /* ignore bad page */
      }
    }
    return covered;
  }

  const orderRepair = await repairCoverage(REPAIR_ORDERS);
  const draftRepair = await repairCoverage(REPAIR_DRAFTS);

  let orderPrimaryTruncated = 0;
  let draftPrimaryTruncated = 0;
  let orderLineCountArchive = 0;
  let draftLineCountArchive = 0;
  let orderUnrepaired = 0;
  let draftUnrepaired = 0;
  const unrepairedOrderSamples = [];
  const unrepairedDraftSamples = [];

  await eachJsonl("orders/orders.jsonl", (rec) => {
    orderLineCountArchive += (rec.lineItems?.nodes || []).length;
    if (!rec.lineItems?.pageInfo?.hasNextPage) return;
    orderPrimaryTruncated += 1;
    const cov = orderRepair.get(rec.id);
    if (!cov || cov.lastHasNext) {
      orderUnrepaired += 1;
      if (unrepairedOrderSamples.length < 5) unrepairedOrderSamples.push(rec.name || rec.id);
    }
  });
  await eachJsonl("draft_orders/draft-orders.jsonl", (rec) => {
    draftLineCountArchive += (rec.lineItems?.nodes || []).length;
    if (!rec.lineItems?.pageInfo?.hasNextPage) return;
    draftPrimaryTruncated += 1;
    const cov = draftRepair.get(rec.id);
    if (!cov || cov.lastHasNext) {
      draftUnrepaired += 1;
      if (unrepairedDraftSamples.length < 5) unrepairedDraftSamples.push(rec.name || rec.id);
    }
  });

  // Drafts historically lacked pageInfo — also require coverage for API-confirmed truncated drafts.
  let draftConfirmedTruncated = 0;
  try {
    const confirmed = JSON.parse(
      await readFile(path.join(REPAIR_DRAFTS, "confirmed-truncated.json"), "utf8"),
    );
    for (const row of confirmed) {
      draftConfirmedTruncated += 1;
      const cov = draftRepair.get(row.draftGid);
      if (!cov || cov.lastHasNext) {
        draftUnrepaired += 1;
        if (unrepairedDraftSamples.length < 5) {
          unrepairedDraftSamples.push(row.draftName || row.draftGid);
        }
      }
    }
  } catch {
    /* confirmed list optional until draft repair runs */
  }

  let repairOrderNodes = 0;
  for (const v of orderRepair.values()) repairOrderNodes += v.repairNodes;
  let repairDraftNodes = 0;
  for (const v of draftRepair.values()) repairDraftNodes += v.repairNodes;

  report.sourceCompleteness = {
    orderLineItemsPrimaryHasNextPage: orderPrimaryTruncated,
    draftLineItemsPrimaryHasNextPage: draftPrimaryTruncated,
    draftConfirmedTruncated,
    orderUnrepairedHasNextPage: orderUnrepaired,
    draftUnrepairedHasNextPage: draftUnrepaired,
    unrepairedOrderSamples,
    unrepairedDraftSamples,
    archiveOrderLineNodes: orderLineCountArchive,
    archiveDraftLineNodes: draftLineCountArchive,
    repairOrderLineNodes: repairOrderNodes,
    repairDraftLineNodes: repairDraftNodes,
    dbOrderItems: report.entities.order_items,
    note: "SOURCE→ARCHIVE completeness requires unrepaired hasNextPage=0 (primary may remain truncated; raw_repairs must finish).",
  };

  if (orderUnrepaired > 0) {
    blockers.push(
      `source_incomplete: ${orderUnrepaired}/${orderPrimaryTruncated} truncated orders lack complete repair pages`,
    );
  }
  if (draftUnrepaired > 0) {
    blockers.push(
      `source_incomplete: ${draftUnrepaired} truncated drafts lack complete repair pages (primary=${draftPrimaryTruncated}, confirmed=${draftConfirmedTruncated})`,
    );
  }

  // Nested operational repairs (fulfillment/refund/events + secondary)
  async function unrepairedConfirmed(dir, confirmedFile, gidFields) {
    let confirmed = [];
    try {
      confirmed = JSON.parse(await readFile(path.join(dir, confirmedFile), "utf8"));
    } catch {
      return { confirmed: 0, unrepaired: 0 };
    }
    if (!Array.isArray(confirmed)) confirmed = [];
    const cov = await repairCoverage(dir);
    let unrepaired = 0;
    for (const row of confirmed) {
      const gid = gidFields.map((k) => row[k]).find(Boolean);
      const c = gid ? cov.get(gid) : null;
      if (!c || c.lastHasNext) unrepaired += 1;
    }
    return { confirmed: confirmed.length, unrepaired };
  }

  const REPAIR_FF = path.join(ROOT, "raw_repairs", "fulfillment_line_items");
  const REPAIR_RF = path.join(ROOT, "raw_repairs", "refund_line_items");
  const REPAIR_EV = path.join(ROOT, "raw_repairs", "order_events");
  const REPAIR_DISC = path.join(ROOT, "raw_repairs", "discount_applications");
  const REPAIR_AB = path.join(ROOT, "raw_repairs", "abandoned_line_items");
  const REPAIR_MEDIA = path.join(ROOT, "raw_repairs", "product_media");
  const REPAIR_VAR = path.join(ROOT, "raw_repairs", "product_variants");

  const nestedRepairs = {
    fulfillmentLineItems: await unrepairedConfirmed(REPAIR_FF, "confirmed-truncated.json", [
      "fulfillmentGid",
    ]),
    refundLineItems: await unrepairedConfirmed(REPAIR_RF, "confirmed-truncated.json", ["refundGid"]),
    events: await unrepairedConfirmed(REPAIR_EV, "truncated-manifest.json", ["orderGid"]),
    discountApplications: await unrepairedConfirmed(REPAIR_DISC, "confirmed-truncated.json", [
      "orderGid",
    ]),
    abandonedLineItems: await unrepairedConfirmed(REPAIR_AB, "confirmed-truncated.json", ["id"]),
    productMedia: await unrepairedConfirmed(REPAIR_MEDIA, "confirmed-truncated.json", ["id"]),
    productVariants: await unrepairedConfirmed(REPAIR_VAR, "truncated-manifest.json", ["productGid"]),
  };
  report.sourceCompleteness.nestedRepairs = nestedRepairs;
  for (const [name, st] of Object.entries(nestedRepairs)) {
    if (st.confirmed > 0 && st.unrepaired > 0) {
      blockers.push(`source_incomplete: ${name} unrepaired=${st.unrepaired}/${st.confirmed}`);
    }
  }

  // Child table sanity (computed, not hardcoded historical constants)
  const childCounts = await runSql(`
select
  (select count(*)::int from public.fulfillment_line_items) as fulfillment_lines,
  (select count(*)::int from public.refund_line_items) as refund_lines,
  (select count(*)::int from public.order_events) as order_events;
`);
  report.entities.fulfillment_line_items = Number(childCounts.fulfillment_lines) || 0;
  report.entities.refund_line_items = Number(childCounts.refund_lines) || 0;
  // order_events already counted above in entityTables — refresh from SQL for consistency
  if (childCounts.order_events != null) {
    report.entities.order_events = Number(childCounts.order_events);
  }
  if (report.entities.refund_line_items <= 0) {
    blockers.push("refund_line_items: empty after nested repair");
  }
  if (report.entities.fulfillment_line_items <= 0) {
    blockers.push("fulfillment_line_items: empty");
  }

  const dupLines = await runSql(`
select count(*)::int as n from (
  select source_line_item_gid from public.order_items
  where source_line_item_gid is not null
  group by 1 having count(*) > 1
) d;
`);
  if (Number(dupLines.n) > 0) blockers.push(`duplicate_order_line_gids: ${dupLines.n}`);

  const dupFf = await runSql(`
select count(*)::int as n from (
  select external_gid from public.fulfillment_line_items
  where external_gid is not null group by 1 having count(*) > 1
) d;
`);
  if (Number(dupFf.n) > 0) blockers.push(`duplicate_fulfillment_line_gids: ${dupFf.n}`);

  const dupRf = await runSql(`
select count(*)::int as n from (
  select external_gid from public.refund_line_items
  where external_gid is not null group by 1 having count(*) > 1
) d;
`);
  if (Number(dupRf.n) > 0) blockers.push(`duplicate_refund_line_gids: ${dupRf.n}`);

  const orphanLines = await runSql(`
select count(*)::int as n from public.order_items oi
left join public.orders o on o.id = oi.order_id
where o.id is null;
`);
  if (Number(orphanLines.n) > 0) blockers.push(`orphan_order_items: ${orphanLines.n}`);

  const orphanFf = await runSql(`
select count(*)::int as n from public.fulfillment_line_items fli
left join public.fulfillments f on f.id = fli.fulfillment_id
where f.id is null;
`);
  if (Number(orphanFf.n) > 0) blockers.push(`orphan_fulfillment_line_items: ${orphanFf.n}`);

  const orphanRf = await runSql(`
select count(*)::int as n from public.refund_line_items rli
left join public.refunds r on r.id = rli.refund_id
where r.id is null;
`);
  if (Number(orphanRf.n) > 0) blockers.push(`orphan_refund_line_items: ${orphanRf.n}`);

  report.gate.blockers = blockers;
  report.gate.passed = blockers.length === 0;
  report.gate.verdict = blockers.length === 0 ? "MIGRATION INTEGRITY GATE PASSED" : "MIGRATION INTEGRITY GATE FAILED";

  await writeFile(path.join(OUT, "integrity-gate.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(report.gate.verdict);
  process.exit(blockers.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
