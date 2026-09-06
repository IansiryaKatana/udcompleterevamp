#!/usr/bin/env node
/**
 * Dry-run planner: stream forensic JSONL → counts, staff discovery, samples, validation.
 * Never writes to Supabase. Safe to run anytime.
 *
 * Usage:
 *   node shopify-forensic-audit/import/plan.mjs
 *   node shopify-forensic-audit/import/plan.mjs --limit-orders 50
 */
import {
  eachJsonl,
  writeJson,
  parseArgs,
  mfValue,
  OUT,
} from "./lib/helpers.mjs";
import {
  collectStaffNamesFromCustomer,
  collectStaffNamesFromCompany,
  collectStaffNamesFromOrder,
  mapCustomer,
  mapCompany,
  mapOrder,
  mapDraft,
  mapAbandoned,
} from "./lib/mappers.mjs";

const { opts } = parseArgs();
const limitOrders = opts["limit-orders"] ? Number(opts["limit-orders"]) : Infinity;
const sampleN = opts.samples ? Number(opts.samples) : 3;

async function main() {
  const started = Date.now();
  const staffNames = new Set();
  const issues = [];
  const samples = { customers: [], companies: [], orders: [], drafts: [], abandoned: [] };

  console.log("Phase: discover staff names…");
  await eachJsonl("customers/customers.jsonl", (rec) => {
    collectStaffNamesFromCustomer(rec, staffNames);
  });
  await eachJsonl("customers/companies.jsonl", (rec) => {
    collectStaffNamesFromCompany(rec, staffNames);
  });
  await eachJsonl("orders/orders.jsonl", (rec) => {
    collectStaffNamesFromOrder(rec, staffNames);
  }, { limit: limitOrders });
  await eachJsonl("draft_orders/draft-orders.jsonl", (rec) => {
    collectStaffNamesFromOrder(rec, staffNames);
  });

  const staffByName = new Map();
  for (const name of [...staffNames].sort((a, b) => a.localeCompare(b))) {
    staffByName.set(name.toLowerCase(), { id: `dry-${name.toLowerCase().replace(/\s+/g, "-")}`, name });
  }

  const customerIdByGid = new Map();
  const companyIdByGid = new Map();
  const locationIdByGid = new Map();
  const orderIdByGid = new Map();

  const stats = {
    staff: staffByName.size,
    customers: 0,
    customerAddresses: 0,
    customerTags: 0,
    customerMetafields: 0,
    companies: 0,
    companyLocations: 0,
    companyContacts: 0,
    companyContactsSkippedMissingCustomer: 0,
    orders: 0,
    orderItems: 0,
    orderTransactions: 0,
    orderRefunds: 0,
    orderFulfillments: 0,
    orderShippingLines: 0,
    orderTaxLines: 0,
    orderEvents: 0,
    orderComments: 0,
    orderTags: 0,
    orderMetafields: 0,
    drafts: 0,
    draftLines: 0,
    abandoned: 0,
    orderTotalsGbp: 0,
    orderOutstandingGbp: 0,
    maxOrderTotal: 0,
    ordersMissingEmail: 0,
    parseErrors: {},
  };

  console.log("Phase: customers…");
  const custScan = await eachJsonl("customers/customers.jsonl", (rec) => {
    const mapped = mapCustomer(rec, staffByName);
    customerIdByGid.set(rec.id, mapped.customer.id);
    stats.customers += 1;
    stats.customerAddresses += mapped.addresses.length;
    stats.customerTags += mapped.tags.length;
    stats.customerMetafields += mapped.metafields.length;
    if (samples.customers.length < sampleN) {
      samples.customers.push({
        shopifyGid: rec.id,
        email: mapped.customer.email,
        trading_name: mapped.customer.trading_name,
        tagCount: mapped.tags.length,
        metafieldCount: mapped.metafields.length,
        addressCount: mapped.addresses.length,
      });
    }
  });
  stats.parseErrors.customers = custScan.parseErrors;

  console.log("Phase: companies…");
  const coScan = await eachJsonl("customers/companies.jsonl", (rec) => {
    const mapped = mapCompany(rec, staffByName, customerIdByGid);
    companyIdByGid.set(rec.id, mapped.company.id);
    stats.companies += 1;
    stats.companyLocations += mapped.locations.length;
    for (const loc of mapped.locations) {
      locationIdByGid.set(loc.shopifyGid, loc.location.id);
    }
    const contactNodes = rec.contacts?.nodes || [];
    stats.companyContacts += mapped.contacts.length;
    stats.companyContactsSkippedMissingCustomer += Math.max(0, contactNodes.length - mapped.contacts.length);
    if (samples.companies.length < sampleN) {
      samples.companies.push({
        shopifyGid: rec.id,
        name: mapped.company.name,
        locations: mapped.locations.length,
        contactsMapped: mapped.contacts.length,
        salesperson: mfValue(rec.metafields, "custom", "salesperson_assigned"),
      });
    }
  });
  stats.parseErrors.companies = coScan.parseErrors;

  console.log("Phase: orders…");
  const ctx = { staffByName, customerIdByGid, companyIdByGid, locationIdByGid };
  const ordScan = await eachJsonl(
    "orders/orders.jsonl",
    (rec) => {
      const mapped = mapOrder(rec, ctx);
      orderIdByGid.set(rec.id, mapped.order.id);
      stats.orders += 1;
      stats.orderItems += mapped.items.length;
      stats.orderTransactions += mapped.transactions.length;
      stats.orderRefunds += mapped.refunds.length;
      stats.orderFulfillments += mapped.fulfillments.length;
      stats.orderShippingLines += mapped.shippingLines.length;
      stats.orderTaxLines += mapped.taxLines.length;
      stats.orderEvents += mapped.events.length;
      stats.orderComments += mapped.comments.length;
      stats.orderTags += mapped.tags.length;
      stats.orderMetafields += mapped.metafields.length;
      stats.orderTotalsGbp += mapped.order.total || 0;
      stats.orderOutstandingGbp += mapped.order.total_outstanding || 0;
      if ((mapped.order.total || 0) > stats.maxOrderTotal) stats.maxOrderTotal = mapped.order.total;
      if (!rec.email && !rec.customer?.email) stats.ordersMissingEmail += 1;
      if (mapped.order.total >= 1e10) {
        issues.push({ type: "huge_total", order: rec.name, total: mapped.order.total });
      }
      if (samples.orders.length < sampleN) {
        samples.orders.push({
          shopifyGid: rec.id,
          name: rec.name,
          order_number: mapped.order.order_number,
          status: mapped.order.status,
          financial_status: mapped.order.financial_status,
          total: mapped.order.total,
          items: mapped.items.length,
          txs: mapped.transactions.length,
          fulfillments: mapped.fulfillments.length,
          customerLinked: Boolean(mapped.order.customer_id),
          companyLinked: Boolean(mapped.order.company_id),
        });
      }
    },
    { limit: limitOrders },
  );
  stats.parseErrors.orders = ordScan.parseErrors;

  console.log("Phase: drafts…");
  const draftCtx = { ...ctx, orderIdByGid };
  const draftScan = await eachJsonl("draft_orders/draft-orders.jsonl", (rec) => {
    const mapped = mapDraft(rec, draftCtx);
    stats.drafts += 1;
    stats.draftLines += mapped.lines.length;
    if (samples.drafts.length < sampleN) {
      samples.drafts.push({
        shopifyGid: rec.id,
        name: mapped.draft.name,
        status: mapped.draft.status,
        total: mapped.draft.total_price,
        lines: mapped.lines.length,
      });
    }
  });
  stats.parseErrors.drafts = draftScan.parseErrors;

  console.log("Phase: abandoned checkouts…");
  const abScan = await eachJsonl("abandoned_checkouts/abandoned-checkouts.jsonl", (rec) => {
    const mapped = mapAbandoned(rec, customerIdByGid);
    stats.abandoned += 1;
    if (samples.abandoned.length < sampleN) {
      samples.abandoned.push({
        shopifyGid: rec.id,
        email: mapped.email,
        total: mapped.total_price,
        lineItems: mapped.line_items.length,
      });
    }
  });
  stats.parseErrors.abandoned = abScan.parseErrors;

  // Products: intentionally not imported
  let productCount = 0;
  try {
    const p = await eachJsonl("products/products.jsonl", () => {
      productCount += 1;
    });
    void p;
  } catch {
    productCount = -1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: "dry-run",
    elapsedMs: Date.now() - started,
    limits: { orders: Number.isFinite(limitOrders) ? limitOrders : null },
    staffNames: [...staffNames].sort((a, b) => a.localeCompare(b)),
    stats: {
      ...stats,
      orderTotalsGbp: Number(stats.orderTotalsGbp.toFixed(2)),
      orderOutstandingGbp: Number(stats.orderOutstandingGbp.toFixed(2)),
      maxOrderTotal: Number(stats.maxOrderTotal.toFixed(2)),
      productsInCacheNotImported: productCount,
    },
    samples,
    issues,
    nextSteps: [
      "Apply migrations 036–048 to a staging Supabase (resolve remote history drift first).",
      "Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.",
      "Run: node shopify-forensic-audit/import/run.mjs --apply --phase staff",
      "Then customers → companies → orders → drafts → abandoned.",
      "Do NOT import products into live catalog (SKU matching is a separate linking pass).",
    ],
    safety: {
      productsImported: false,
      defaultMode: "dry-run",
      applyRequiresExplicitFlag: true,
      orderNumberPrefix: "SH-{legacyResourceId}",
      productIdOnLineItems: null,
    },
  };

  const outPath = await writeJson("dry-run-report.json", report);
  await writeJson("staff-names.json", report.staffNames);

  console.log("\n=== Dry-run complete ===");
  console.log(JSON.stringify(report.stats, null, 2));
  console.log(`Staff members discovered: ${report.staffNames.length}`);
  console.log(`Wrote ${outPath}`);
  console.log(`Also: ${OUT}/staff-names.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
