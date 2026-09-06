#!/usr/bin/env node
/**
 * Stream JSONL caches into analysis/*.json summaries. Read-only; no Shopify writes.
 */
import { createReadStream } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(ROOT, "raw");
const OUT = path.join(ROOT, "analysis");

function money(set) {
  if (set == null) return 0;
  if (typeof set === "number") return set;
  if (set.amount != null) {
    const n = Number(set.amount);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(set?.shopMoney?.amount);
  return Number.isFinite(n) ? n : 0;
}

function bump(map, key, n = 1) {
  if (!key && key !== 0) return;
  const k = String(key);
  map[k] = (map[k] || 0) + n;
}

function bumpMoney(map, key, amount) {
  if (!key) return;
  const k = String(key);
  if (!map[k]) map[k] = { count: 0, amount: 0 };
  map[k].count += 1;
  map[k].amount += amount || 0;
}

function metafieldKey(mf) {
  return `${mf.namespace}.${mf.key}`;
}

function collectMetafields(ownerType, metafields, catalogue, values) {
  const nodes = metafields?.nodes || metafields || [];
  for (const mf of nodes) {
    if (!mf?.key) continue;
    const id = metafieldKey(mf);
    if (!catalogue[id]) {
      catalogue[id] = {
        ownerTypes: {},
        namespace: mf.namespace,
        key: mf.key,
        type: mf.type,
        populatedCount: 0,
        sampleValues: [],
      };
    }
    const entry = catalogue[id];
    entry.ownerTypes[ownerType] = (entry.ownerTypes[ownerType] || 0) + 1;
    entry.populatedCount += 1;
    if (entry.type == null && mf.type) entry.type = mf.type;
    if (entry.sampleValues.length < 8) {
      const sample = String(mf.value ?? "").slice(0, 180);
      if (sample && !entry.sampleValues.includes(sample)) entry.sampleValues.push(sample);
    }
    if (!values[id]) values[id] = {};
    const v = String(mf.value ?? "").slice(0, 200);
    if (v) bump(values[id], v);
  }
}

function collectTags(tags, map) {
  const list = Array.isArray(tags) ? tags : String(tags || "").split(",").map((t) => t.trim()).filter(Boolean);
  for (const tag of list) bump(map, tag);
}

async function eachJsonl(rel, onRecord) {
  const full = path.join(RAW, rel);
  const rl = readline.createInterface({ input: createReadStream(full), crlfDelay: Infinity });
  const seen = new Set();
  let n = 0;
  let skipped = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }
    const rec = row.record || row;
    const id = rec?.id || rec?.legacyResourceId;
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    await onRecord(rec, n);
    n += 1;
  }
  if (skipped) console.error(`[analyze] ${rel} skipped ${skipped} corrupt lines`);
  return n;
}

function topEntries(map, limit = 40) {
  return Object.entries(map)
    .sort((a, b) => (typeof b[1] === "number" ? b[1] - a[1] : (b[1].count || 0) - (a[1].count || 0)))
    .slice(0, limit)
    .map(([key, value]) => ({ key, value }));
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const metafieldCatalogue = {};
  const metafieldValues = {};
  const result = {
    generatedAt: new Date().toISOString(),
    store: "c906ff-0a.myshopify.com",
    apiVersion: "2026-07",
  };

  const products = {
    count: 0,
    status: {},
    vendor: {},
    productType: {},
    tags: {},
    options: {},
    tracked: { yes: 0, no: 0 },
    giftCard: 0,
    withCompareAt: 0,
    withBarcode: 0,
    withSku: 0,
    variantCount: 0,
  };
  try {
    products.count = await eachJsonl("products/products.jsonl", (p) => {
      bump(products.status, p.status);
      bump(products.vendor, p.vendor || "(blank)");
      bump(products.productType, p.productType || "(blank)");
      collectTags(p.tags, products.tags);
      collectMetafields("PRODUCT", p.metafields, metafieldCatalogue, metafieldValues);
      for (const opt of p.options || []) bump(products.options, opt.name);
      if (p.isGiftCard) products.giftCard += 1;
      for (const v of p.variants?.nodes || []) {
        products.variantCount += 1;
        if (v.sku) products.withSku += 1;
        if (v.barcode) products.withBarcode += 1;
        if (v.compareAtPrice) products.withCompareAt += 1;
        if (v.inventoryItem?.tracked) products.tracked.yes += 1;
        else products.tracked.no += 1;
        collectMetafields("PRODUCTVARIANT", v.metafields, metafieldCatalogue, metafieldValues);
      }
    });
  } catch (err) {
    products.error = err.message;
  }
  result.products = {
    ...products,
    status: topEntries(products.status),
    vendor: topEntries(products.vendor, 30),
    productType: topEntries(products.productType, 40),
    tags: topEntries(products.tags, 80),
    options: topEntries(products.options),
  };

  const collections = { count: 0, tags: {}, ruleTypes: {}, published: 0 };
  try {
    collections.count = await eachJsonl("products/collections.jsonl", (c) => {
      collectTags(c.tags, collections.tags);
      collectMetafields("COLLECTION", c.metafields, metafieldCatalogue, metafieldValues);
      if (c.ruleSet) bump(collections.ruleTypes, c.ruleSet.appliedDisjunctively ? "disjunctive" : "conjunctive");
      if (c.publishedOnCurrentPublication || c.handle) collections.published += 1;
    });
  } catch (err) {
    collections.error = err.message;
  }
  result.collections = { ...collections, tags: topEntries(collections.tags, 40) };

  const customers = {
    count: 0,
    state: {},
    tags: {},
    taxExempt: 0,
    withPhone: 0,
    withEmail: 0,
    withCompany: 0,
    notePresent: 0,
    numberOfOrders: { zero: 0, one: 0, twoToTen: 0, overTen: 0 },
    amountSpent: 0,
  };
  try {
    customers.count = await eachJsonl("customers/customers.jsonl", (c) => {
      bump(customers.state, c.state || c.defaultAddress?.countryCodeV2 || "unknown");
      collectTags(c.tags, customers.tags);
      collectMetafields("CUSTOMER", c.metafields, metafieldCatalogue, metafieldValues);
      if (c.taxExempt) customers.taxExempt += 1;
      if (c.phone) customers.withPhone += 1;
      if (c.email) customers.withEmail += 1;
      if (c.companyContactProfiles?.length || c.company) customers.withCompany += 1;
      if (c.note) customers.notePresent += 1;
      const orders = Number(c.numberOfOrders) || 0;
      if (orders === 0) customers.numberOfOrders.zero += 1;
      else if (orders === 1) customers.numberOfOrders.one += 1;
      else if (orders <= 10) customers.numberOfOrders.twoToTen += 1;
      else customers.numberOfOrders.overTen += 1;
      customers.amountSpent += money(c.amountSpent);
    });
  } catch (err) {
    customers.error = err.message;
  }
  result.customers = { ...customers, state: topEntries(customers.state, 20), tags: topEntries(customers.tags, 80) };

  const companies = { count: 0, withContacts: 0, withLocations: 0, paymentTerms: {} };
  try {
    companies.count = await eachJsonl("customers/companies.jsonl", (co) => {
      collectMetafields("COMPANY", co.metafields, metafieldCatalogue, metafieldValues);
      if ((co.contactCount || 0) > 0) companies.withContacts += 1;
      if ((co.locationsCount?.count || co.locations?.nodes?.length || 0) > 0) companies.withLocations += 1;
      for (const loc of co.locations?.nodes || []) {
        collectMetafields("COMPANY_LOCATION", loc.metafields, metafieldCatalogue, metafieldValues);
        const pt = loc.buyerExperienceConfiguration?.paymentTermsTemplate;
        if (pt?.name) bump(companies.paymentTerms, `${pt.name}|${pt.paymentTermsType}|${pt.dueInDays ?? ""}`);
      }
    });
  } catch (err) {
    companies.error = err.message;
  }
  result.companies = { ...companies, paymentTerms: topEntries(companies.paymentTerms, 30) };

  const orders = {
    count: 0,
    financial: {},
    fulfillment: {},
    sourceName: {},
    app: {},
    channel: {},
    tags: {},
    gateways: {},
    gatewayMoney: {},
    txKind: {},
    txStatus: {},
    txGateway: {},
    taxTitles: {},
    taxRates: {},
    taxesIncluded: 0,
    taxExempt: 0,
    unpaid: 0,
    test: 0,
    cancelled: 0,
    withPo: 0,
    withNote: 0,
    withCompany: 0,
    withRefund: 0,
    withReturn: 0,
    withFulfillment: 0,
    trackingCompanies: {},
    fulfillmentServices: {},
    shippingTitles: {},
    customAttributes: {},
    eventApps: {},
    commentEvents: 0,
    totalValue: 0,
    totalTax: 0,
    totalRefunded: 0,
    totalOutstanding: 0,
    firstCreated: null,
    lastCreated: null,
    monthly: {},
    missingProduct: 0,
    lineItemCount: 0,
  };
  try {
    orders.count = await eachJsonl("orders/orders.jsonl", (o) => {
      bump(orders.financial, o.displayFinancialStatus);
      bump(orders.fulfillment, o.displayFulfillmentStatus);
      bump(orders.sourceName, o.sourceName || "(blank)");
      bump(orders.app, o.app?.name || o.channelInformation?.app?.title || "(none)");
      bump(orders.channel, o.channelInformation?.displayName || "(none)");
      collectTags(o.tags, orders.tags);
      collectMetafields("ORDER", o.metafields, metafieldCatalogue, metafieldValues);
      const value = money(o.currentTotalPriceSet || o.totalPriceSet);
      orders.totalValue += value;
      orders.totalTax += money(o.currentTotalTaxSet || o.totalTaxSet);
      orders.totalRefunded += money(o.totalRefundedSet);
      orders.totalOutstanding += money(o.totalOutstandingSet);
      if (!orders.firstCreated || o.createdAt < orders.firstCreated) orders.firstCreated = o.createdAt;
      if (!orders.lastCreated || o.createdAt > orders.lastCreated) orders.lastCreated = o.createdAt;
      bump(orders.monthly, String(o.createdAt || "").slice(0, 7));
      if (o.taxesIncluded) orders.taxesIncluded += 1;
      if (o.taxExempt) orders.taxExempt += 1;
      if (o.unpaid) orders.unpaid += 1;
      if (o.test) orders.test += 1;
      if (o.cancelledAt) orders.cancelled += 1;
      if (o.poNumber) orders.withPo += 1;
      if (o.note) orders.withNote += 1;
      if (o.purchasingEntity?.company || o.billingAddress?.company) orders.withCompany += 1;
      for (const g of o.paymentGatewayNames || []) {
        bump(orders.gateways, g);
        bumpMoney(orders.gatewayMoney, g, value);
      }
      for (const tx of o.transactions || []) {
        bump(orders.txKind, tx.kind);
        bump(orders.txStatus, `${tx.kind}|${tx.status}`);
        bump(orders.txGateway, tx.gateway || tx.formattedGateway || "(blank)");
      }
      for (const tax of o.taxLines || []) {
        bump(orders.taxTitles, tax.title);
        bump(orders.taxRates, `${tax.title}|${tax.ratePercentage ?? tax.rate}`);
      }
      for (const ship of o.shippingLines?.nodes || []) bump(orders.shippingTitles, ship.title || ship.code || "(blank)");
      for (const attr of o.customAttributes || []) bump(orders.customAttributes, attr.key);
      if ((o.refunds || []).length) orders.withRefund += 1;
      if ((o.returns?.nodes || []).length) orders.withReturn += 1;
      if ((o.fulfillments || []).length) {
        orders.withFulfillment += 1;
        for (const f of o.fulfillments) {
          for (const t of f.trackingInfo || []) bump(orders.trackingCompanies, t.company || "(blank)");
          bump(orders.fulfillmentServices, f.service?.serviceName || f.service?.handle || "(none)");
        }
      }
      for (const ev of o.events?.nodes || []) {
        if (ev.appTitle) bump(orders.eventApps, ev.appTitle);
        if (ev.rawMessage) orders.commentEvents += 1;
      }
      for (const li of o.lineItems?.nodes || []) {
        orders.lineItemCount += 1;
        if (!li.product) orders.missingProduct += 1;
      }
    });
  } catch (err) {
    orders.error = err.message;
  }
  result.orders = {
    ...orders,
    financial: topEntries(orders.financial),
    fulfillment: topEntries(orders.fulfillment),
    sourceName: topEntries(orders.sourceName, 30),
    app: topEntries(orders.app, 30),
    channel: topEntries(orders.channel, 20),
    tags: topEntries(orders.tags, 80),
    gateways: topEntries(orders.gateways),
    gatewayMoney: topEntries(orders.gatewayMoney, 20),
    txKind: topEntries(orders.txKind),
    txStatus: topEntries(orders.txStatus, 30),
    txGateway: topEntries(orders.txGateway, 30),
    taxTitles: topEntries(orders.taxTitles),
    taxRates: topEntries(orders.taxRates, 30),
    trackingCompanies: topEntries(orders.trackingCompanies),
    fulfillmentServices: topEntries(orders.fulfillmentServices),
    shippingTitles: topEntries(orders.shippingTitles, 20),
    customAttributes: topEntries(orders.customAttributes, 40),
    eventApps: topEntries(orders.eventApps, 40),
    monthly: topEntries(orders.monthly, 40),
  };

  const drafts = {
    count: 0,
    status: {},
    tags: {},
    source: {},
    withPo: 0,
    withNote: 0,
    completed: 0,
    invoiceSent: 0,
    totalValue: 0,
    firstCreated: null,
    lastCreated: null,
  };
  try {
    drafts.count = await eachJsonl("draft_orders/draft-orders.jsonl", (d) => {
      bump(drafts.status, d.status);
      collectTags(d.tags, drafts.tags);
      collectMetafields("DRAFTORDER", d.metafields, metafieldCatalogue, metafieldValues);
      bump(drafts.source, d.purchasingEntity?.__typename || d.sourceName || "(none)");
      if (d.poNumber) drafts.withPo += 1;
      if (d.note) drafts.withNote += 1;
      if (d.order) drafts.completed += 1;
      if (d.invoiceSentAt || d.invoiceUrl) drafts.invoiceSent += 1;
      drafts.totalValue += money(d.totalPriceSet);
      if (!drafts.firstCreated || d.createdAt < drafts.firstCreated) drafts.firstCreated = d.createdAt;
      if (!drafts.lastCreated || d.createdAt > drafts.lastCreated) drafts.lastCreated = d.createdAt;
    });
  } catch (err) {
    drafts.error = err.message;
  }
  result.drafts = { ...drafts, status: topEntries(drafts.status), tags: topEntries(drafts.tags, 40), source: topEntries(drafts.source) };

  const abandoned = { count: 0, tags: {}, totalValue: 0, withEmail: 0, completed: 0 };
  try {
    abandoned.count = await eachJsonl("abandoned_checkouts/abandoned-checkouts.jsonl", (a) => {
      collectTags(a.tags, abandoned.tags);
      abandoned.totalValue += money(a.totalPriceSet);
      if (a.email) abandoned.withEmail += 1;
      if (a.completedAt) abandoned.completed += 1;
    });
  } catch (err) {
    abandoned.error = err.message;
  }
  result.abandoned = { ...abandoned, tags: topEntries(abandoned.tags, 20) };

  const inventory = { count: 0, tracked: 0, untracked: 0, skuBlank: 0, locations: {} };
  try {
    inventory.count = await eachJsonl("inventory/inventory-items.jsonl", (it) => {
      if (it.tracked) inventory.tracked += 1;
      else inventory.untracked += 1;
      if (!it.sku) inventory.skuBlank += 1;
      for (const lvl of it.inventoryLevels?.nodes || []) {
        bump(inventory.locations, lvl.location?.name || lvl.location?.id || "(unknown)");
      }
    });
  } catch (err) {
    inventory.error = err.message;
  }
  result.inventory = { ...inventory, locations: topEntries(inventory.locations) };

  result.metafieldCatalogue = Object.entries(metafieldCatalogue)
    .sort((a, b) => b[1].populatedCount - a[1].populatedCount)
    .map(([id, entry]) => ({
      id,
      ...entry,
      topValues: topEntries(metafieldValues[id] || {}, 12),
    }));

  await writeFile(path.join(OUT, "summary.json"), JSON.stringify(result, null, 2));
  await writeFile(
    path.join(OUT, "metafield-catalogue.json"),
    JSON.stringify(result.metafieldCatalogue, null, 2),
  );
  console.error(
    JSON.stringify(
      {
        products: products.count,
        customers: customers.count,
        companies: companies.count,
        orders: orders.count,
        drafts: drafts.count,
        metafieldKeys: result.metafieldCatalogue.length,
        out: path.join(OUT, "summary.json"),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
