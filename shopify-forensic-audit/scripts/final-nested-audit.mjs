#!/usr/bin/env node
/**
 * Final nested-connection audit across all forensic GraphQL queries + raw data.
 *   node shopify-forensic-audit/scripts/final-nested-audit.mjs
 */
import { createReadStream } from "node:fs";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(ROOT, "raw");
const QUERY_DIR = path.join(ROOT, "queries");
const OUT = path.join(ROOT, "import", "out");

async function eachUnique(rel, onRec) {
  const seen = new Set();
  const rl = readline.createInterface({
    input: createReadStream(path.join(RAW, rel), { encoding: "utf8" }),
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
  return seen.size;
}

function repairComplete(dir, confirmedPath) {
  return (async () => {
    let confirmed = [];
    try {
      confirmed = JSON.parse(await readFile(confirmedPath, "utf8"));
    } catch {
      return { confirmed: 0, unrepaired: 0 };
    }
    const byParent = new Map();
    try {
      for (const f of await readdir(dir)) {
        if (!f.includes("-page-") || !f.endsWith(".json")) continue;
        const p = JSON.parse(await readFile(path.join(dir, f), "utf8"));
        if (!p.parentGid) continue;
        if (!byParent.has(p.parentGid)) byParent.set(p.parentGid, []);
        byParent.get(p.parentGid).push(p);
      }
    } catch {
      /* empty */
    }
    let unrepaired = 0;
    for (const row of confirmed) {
      const gid = row.fulfillmentGid || row.refundGid || row.orderGid || row.draftGid;
      const pages = (byParent.get(gid) || []).sort((a, b) => a.page - b.page);
      if (!pages.length || pages.at(-1)?.pageInfo?.hasNextPage) unrepaired += 1;
    }
    return { confirmed: confirmed.length, unrepaired };
  })();
}

async function main() {
  const rows = [];

  // Static inventory from known queries
  const staticRows = [
    { query: "04-orders", parent: "Order", connection: "lineItems", pageSize: 50, paginationImplemented: true, notes: "repaired" },
    { query: "04-orders", parent: "Order", connection: "events", pageSize: 50, paginationImplemented: true, notes: "repairing" },
    { query: "04-orders", parent: "Order", connection: "metafields", pageSize: 50, paginationImplemented: false, notes: "pageInfo present; expand not recursive in extractor" },
    { query: "04-orders", parent: "Order", connection: "fulfillments", pageSize: 20, paginationImplemented: false, notes: "array not connection pageInfo" },
    { query: "04-orders", parent: "Fulfillment", connection: "fulfillmentLineItems", pageSize: 50, paginationImplemented: true, notes: "repairing" },
    { query: "04-orders", parent: "Order", connection: "refunds", pageSize: 20, paginationImplemented: false, notes: "array not connection pageInfo" },
    { query: "04-orders", parent: "Refund", connection: "refundLineItems", pageSize: 50, paginationImplemented: true, notes: "repairing" },
    { query: "04-orders", parent: "Order", connection: "transactions", pageSize: 30, paginationImplemented: false, notes: "array" },
    { query: "04-orders", parent: "Order", connection: "returns", pageSize: 10, paginationImplemented: false, notes: "nodes only" },
    { query: "04-orders", parent: "Order", connection: "shippingLines", pageSize: 10, paginationImplemented: false, notes: "nodes only" },
    { query: "04-orders", parent: "Order", connection: "discountApplications", pageSize: 20, paginationImplemented: false, notes: "nodes only" },
    { query: "07-draft-orders", parent: "DraftOrder", connection: "lineItems", pageSize: 50, paginationImplemented: true, notes: "repaired" },
    { query: "07-draft-orders", parent: "DraftOrder", connection: "events", pageSize: 30, paginationImplemented: false, notes: "no pageInfo" },
    { query: "07-draft-orders", parent: "DraftOrder", connection: "metafields", pageSize: 50, paginationImplemented: false, notes: "pageInfo present" },
    { query: "05-customers", parent: "Customer", connection: "addresses", pageSize: 20, paginationImplemented: false, notes: "" },
    { query: "05-customers", parent: "Customer", connection: "metafields", pageSize: 50, paginationImplemented: false, notes: "pageInfo present" },
    { query: "10-companies", parent: "Company", connection: "contacts", pageSize: 20, paginationImplemented: false, notes: "" },
    { query: "10-companies", parent: "Company", connection: "locations", pageSize: 20, paginationImplemented: false, notes: "" },
    { query: "10-companies", parent: "Company", connection: "metafields", pageSize: 50, paginationImplemented: false, notes: "" },
    { query: "06-products", parent: "Product", connection: "variants", pageSize: 50, paginationImplemented: false, notes: "pageInfo present" },
    { query: "06-products", parent: "Product", connection: "metafields", pageSize: 50, paginationImplemented: false, notes: "" },
    { query: "06-products", parent: "ProductVariant", connection: "metafields", pageSize: 30, paginationImplemented: false, notes: "" },
    { query: "06-products", parent: "Product", connection: "media", pageSize: 20, paginationImplemented: false, notes: "" },
    { query: "06-products", parent: "Product", connection: "collections", pageSize: 20, paginationImplemented: false, notes: "" },
    { query: "14-inventory", parent: "InventoryItem", connection: "inventoryLevels", pageSize: 20, paginationImplemented: false, notes: "" },
    { query: "11-collections", parent: "Collection", connection: "metafields", pageSize: 30, paginationImplemented: false, notes: "" },
    { query: "09-discounts", parent: "DiscountCodeNode", connection: "codes", pageSize: 20, paginationImplemented: false, notes: "" },
    { query: "08-abandoned-checkouts", parent: "AbandonedCheckout", connection: "lineItems", pageSize: 50, paginationImplemented: false, notes: "" },
  ];

  // Raw observations
  let orderStats = {
    unique: 0,
    lineItemsHasNext: 0,
    eventsHasNext: 0,
    metafieldsHasNext: 0,
    fulfillmentsExact20: 0,
    fulfillmentLineExact50: 0,
    refundsExact20: 0,
    refundLineExact50: 0,
    transactionsExact30: 0,
    returnsExact10: 0,
    shippingExact10: 0,
    discountAppExact20: 0,
  };
  await eachUnique("orders/orders.jsonl", async (rec) => {
    orderStats.unique += 1;
    if (rec.lineItems?.pageInfo?.hasNextPage) orderStats.lineItemsHasNext += 1;
    if (rec.events?.pageInfo?.hasNextPage) orderStats.eventsHasNext += 1;
    if (rec.metafields?.pageInfo?.hasNextPage) orderStats.metafieldsHasNext += 1;
    const ffs = rec.fulfillments || [];
    if (ffs.length >= 20) orderStats.fulfillmentsExact20 += 1;
    for (const f of ffs) {
      if ((f.fulfillmentLineItems?.nodes || []).length >= 50) orderStats.fulfillmentLineExact50 += 1;
    }
    const rfs = rec.refunds || [];
    if (rfs.length >= 20) orderStats.refundsExact20 += 1;
    for (const r of rfs) {
      if ((r.refundLineItems?.nodes || []).length >= 50) orderStats.refundLineExact50 += 1;
    }
    if ((rec.transactions || []).length >= 30) orderStats.transactionsExact30 += 1;
    if ((rec.returns?.nodes || []).length >= 10) orderStats.returnsExact10 += 1;
    if ((rec.shippingLines?.nodes || []).length >= 10) orderStats.shippingExact10 += 1;
    if ((rec.discountApplications?.nodes || []).length >= 20) orderStats.discountAppExact20 += 1;
  });

  let draftStats = { unique: 0, lineItemsHasNext: 0, eventsExact30: 0, metafieldsHasNext: 0 };
  await eachUnique("draft_orders/draft-orders.jsonl", async (rec) => {
    draftStats.unique += 1;
    if (rec.lineItems?.pageInfo?.hasNextPage) draftStats.lineItemsHasNext += 1;
    if ((rec.events?.nodes || []).length >= 30) draftStats.eventsExact30 += 1;
    if (rec.metafields?.pageInfo?.hasNextPage) draftStats.metafieldsHasNext += 1;
  });

  let customerStats = { unique: 0, addressesExact20: 0, metafieldsHasNext: 0 };
  try {
    await eachUnique("customers/customers.jsonl", async (rec) => {
      customerStats.unique += 1;
      if ((rec.addresses || []).length >= 20) customerStats.addressesExact20 += 1;
      if (rec.metafields?.pageInfo?.hasNextPage) customerStats.metafieldsHasNext += 1;
    });
  } catch {
    customerStats.error = "missing";
  }

  let companyStats = { unique: 0, contactsExact20: 0, locationsExact20: 0 };
  try {
    await eachUnique("companies/companies.jsonl", async (rec) => {
      companyStats.unique += 1;
      if ((rec.contacts?.nodes || rec.contacts || []).length >= 20) companyStats.contactsExact20 += 1;
      if ((rec.locations?.nodes || rec.locations || []).length >= 20) companyStats.locationsExact20 += 1;
    });
  } catch {
    companyStats.error = "missing";
  }

  let productStats = { unique: 0, variantsHasNext: 0, variantsExact50: 0, mediaExact20: 0 };
  try {
    await eachUnique("products/products.jsonl", async (rec) => {
      productStats.unique += 1;
      if (rec.variants?.pageInfo?.hasNextPage) productStats.variantsHasNext += 1;
      if ((rec.variants?.nodes || []).length >= 50) productStats.variantsExact50 += 1;
      if ((rec.media?.nodes || []).length >= 20) productStats.mediaExact20 += 1;
    });
  } catch {
    productStats.error = "missing";
  }

  let abandonedStats = { unique: 0, lineExact50: 0 };
  try {
    await eachUnique("abandoned_checkouts/abandoned-checkouts.jsonl", async (rec) => {
      abandonedStats.unique += 1;
      if ((rec.lineItems?.nodes || []).length >= 50) abandonedStats.lineExact50 += 1;
    });
  } catch {
    abandonedStats.error = "missing";
  }

  const repairs = {
    orderLineItems: await repairComplete(
      path.join(ROOT, "raw_repairs", "order_line_items"),
      path.join(ROOT, "raw_repairs", "order_line_items", "truncated-manifest.json"),
    ),
    draftLineItems: await repairComplete(
      path.join(ROOT, "raw_repairs", "draft_line_items"),
      path.join(ROOT, "raw_repairs", "draft_line_items", "confirmed-truncated.json"),
    ),
    fulfillmentLineItems: await repairComplete(
      path.join(ROOT, "raw_repairs", "fulfillment_line_items"),
      path.join(ROOT, "raw_repairs", "fulfillment_line_items", "confirmed-truncated.json"),
    ),
    refundLineItems: await repairComplete(
      path.join(ROOT, "raw_repairs", "refund_line_items"),
      path.join(ROOT, "raw_repairs", "refund_line_items", "confirmed-truncated.json"),
    ),
    events: await repairComplete(
      path.join(ROOT, "raw_repairs", "order_events"),
      path.join(ROOT, "raw_repairs", "order_events", "truncated-manifest.json"),
    ),
  };

  const audit = {
    at: new Date().toISOString(),
    staticConnections: staticRows,
    rawObservations: {
      orders: orderStats,
      drafts: draftStats,
      customers: customerStats,
      companies: companyStats,
      products: productStats,
      abandoned: abandonedStats,
    },
    repairCoverage: repairs,
    actionRequired: [],
  };

  // Decide actions
  const add = (conn, action, detail) => audit.actionRequired.push({ connection: conn, action, detail });
  if (orderStats.lineItemsHasNext > 0 && repairs.orderLineItems.unrepaired === 0) {
    /* repaired via raw_repairs */
  } else if (repairs.orderLineItems.unrepaired > 0) {
    add("order.lineItems", "REPAIR_INCOMPLETE", `${repairs.orderLineItems.unrepaired} unrepaired`);
  }
  if (orderStats.eventsHasNext > 0 && repairs.events.unrepaired > 0) {
    add("order.events", "REPAIR_INCOMPLETE", `${repairs.events.unrepaired} unrepaired`);
  }
  if (orderStats.fulfillmentLineExact50 > 0 && repairs.fulfillmentLineItems.unrepaired > 0) {
    add("fulfillmentLineItems", "REPAIR_INCOMPLETE", `${repairs.fulfillmentLineItems.unrepaired} unrepaired`);
  }
  if (orderStats.refundLineExact50 > 0 && repairs.refundLineItems.unrepaired > 0) {
    add("refundLineItems", "REPAIR_INCOMPLETE", `${repairs.refundLineItems.unrepaired} unrepaired`);
  }
  if (orderStats.metafieldsHasNext > 0) add("order.metafields", "INVESTIGATE", `${orderStats.metafieldsHasNext} hasNext`);
  if (orderStats.fulfillmentsExact20 > 0) {
    add("order.fulfillments", "MONITOR", `${orderStats.fulfillmentsExact20} at exact 20 — no pageInfo; probe if needed`);
  }
  if (orderStats.refundsExact20 > 0) {
    add("order.refunds", "MONITOR", `${orderStats.refundsExact20} at exact 20`);
  }
  if (orderStats.transactionsExact30 > 0) add("transactions", "INVESTIGATE", `${orderStats.transactionsExact30} exact 30`);
  if (orderStats.returnsExact10 > 0) add("returns", "INVESTIGATE", `${orderStats.returnsExact10} exact 10`);
  if (draftStats.eventsExact30 > 0) add("draft.events", "INVESTIGATE", `${draftStats.eventsExact30} exact 30`);
  if (customerStats.addressesExact20 > 0) add("customer.addresses", "INVESTIGATE", `${customerStats.addressesExact20} exact 20`);
  if (companyStats.contactsExact20 > 0) add("company.contacts", "INVESTIGATE", `${companyStats.contactsExact20} exact 20`);
  if (companyStats.locationsExact20 > 0) add("company.locations", "INVESTIGATE", `${companyStats.locationsExact20} exact 20`);
  if (productStats.variantsHasNext > 0) add("product.variants", "REPAIR", `${productStats.variantsHasNext} hasNext`);
  if (productStats.variantsExact50 > 0 && productStats.variantsHasNext === 0) {
    add("product.variants", "MONITOR", `${productStats.variantsExact50} exact 50 without hasNext in extract`);
  }
  if (abandonedStats.lineExact50 > 0) add("abandoned.lineItems", "INVESTIGATE", `${abandonedStats.lineExact50} exact 50`);

  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, "final-nested-connection-audit.json"), JSON.stringify(audit, null, 2));
  console.log(JSON.stringify(audit, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
