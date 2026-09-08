#!/usr/bin/env node
/**
 * Phase 3D — READ-ONLY SKULabs / warehouse forensic analysis over cached Shopify JSONL.
 * No Shopify mutations. No Supabase writes. Outputs analysis/phase3d-skulabs.json
 */
import { createReadStream } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(ROOT, "raw");
const OUT = path.join(ROOT, "analysis");

function bump(map, key, n = 1) {
  if (key == null || key === "") return;
  const k = String(key);
  map[k] = (map[k] || 0) + n;
}

function topEntries(map, n = 40) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, value]) => ({ key, value }));
}

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

function normalizeMsg(msg) {
  return String(msg || "")
    .replace(/\b[A-Z0-9]{8,}\b/g, "[ID]")
    .replace(/\b\d{10,}\b/g, "[NUM]")
    .replace(/#\d+/g, "#N")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function messageFamily(msg) {
  const m = String(msg || "").toLowerCase();
  if (!m) return "(empty)";
  if (m.includes("fulfillment") && m.includes("created")) return "fulfillment_created";
  if (m.includes("fulfillment") && (m.includes("cancelled") || m.includes("canceled"))) return "fulfillment_cancelled";
  if (m.includes("tracking")) return "tracking_related";
  if (m.includes("shipped") || m.includes("shipping")) return "shipping_related";
  if (m.includes("picked") || m.includes("picking") || m.includes("pick ")) return "pick_related";
  if (m.includes("packed") || m.includes("packing") || m.includes("pack ")) return "pack_related";
  if (m.includes("inventory") || m.includes("stock") || m.includes("quantity")) return "inventory_related";
  if (m.includes("label")) return "label_related";
  if (m.includes("hold")) return "hold_related";
  if (m.includes("cancel")) return "cancel_related";
  if (m.includes("refund") || m.includes("return") || m.includes("restock")) return "return_restock_related";
  if (m.includes("order was edited") || m.includes("edited")) return "order_edited";
  if (m.includes("confirmed") || m.includes("received") || m.includes("imported")) return "order_ingest_related";
  return "other";
}

async function eachJsonl(rel, onRecord) {
  const full = path.join(RAW, rel);
  const rl = readline.createInterface({
    input: createReadStream(full, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  const seen = new Set();
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
    await onRecord(rec);
  }
  if (skipped) console.error(`[phase3d] ${rel} skipped ${skipped} corrupt lines`);
}

async function main() {
  const locationsDoc = JSON.parse(
    await readFile(path.join(RAW, "shop", "locations-markets.json"), "utf8"),
  );
  const locationNodes =
    locationsDoc?.data?.locations?.nodes ||
    locationsDoc?.record?.locations?.nodes ||
    locationsDoc?.locations?.nodes ||
    [];
  const locations = locationNodes.map((loc) => ({
    id: loc.id,
    name: loc.name,
    isActive: loc.isActive,
    isPrimary: loc.isPrimary ?? null,
    fulfillsOnlineOrders: loc.fulfillsOnlineOrders,
    hasActiveInventory: loc.hasActiveInventory,
    hasUnfulfilledOrders: loc.hasUnfulfilledOrders ?? null,
    shipsInventory: loc.shipsInventory ?? null,
    fulfillmentService: loc.fulfillmentService,
    address: {
      address1: loc.address?.address1 || null,
      city: loc.address?.city || null,
      zip: loc.address?.zip || null,
      province: loc.address?.province || null,
      countryCode: loc.address?.countryCode || loc.address?.countryCodeV2 || null,
      phone: loc.address?.phone || null,
    },
  }));

  // ── Inventory items ──────────────────────────────────────────────────────
  const inv = {
    count: 0,
    tracked: 0,
    untracked: 0,
    skuBlank: 0,
    skuPresent: 0,
    skuDupGroups: 0,
    skuDupItemCount: 0,
    barcodeBlank: 0,
    barcodePresent: 0,
    barcodeDupGroups: 0,
    barcodeDupItemCount: 0,
    locations: {},
    qtyByLocation: {},
    totalAvailable: 0,
    totalOnHand: 0,
    totalCommitted: 0,
    totalIncoming: 0,
    totalReserved: 0,
    itemsWithCommitted: 0,
    itemsWithReserved: 0,
    itemsWithIncoming: 0,
    sampleBlankSkuIds: [],
    sampleDupSkus: [],
    sampleDupBarcodes: [],
  };
  const skuToItems = new Map();
  const barcodeToItems = new Map();

  await eachJsonl("inventory/inventory-items.jsonl", (it) => {
    inv.count += 1;
    if (it.tracked) inv.tracked += 1;
    else inv.untracked += 1;
    const sku = (it.sku || "").trim();
    if (!sku) {
      inv.skuBlank += 1;
      if (inv.sampleBlankSkuIds.length < 5) inv.sampleBlankSkuIds.push(it.id || it.legacyResourceId);
    } else {
      inv.skuPresent += 1;
      if (!skuToItems.has(sku)) skuToItems.set(sku, []);
      skuToItems.get(sku).push(it.id);
    }
    // inventoryLevel(s)
    const levels = Array.isArray(it.inventoryLevels?.nodes)
      ? it.inventoryLevels.nodes
      : it.inventoryLevel
        ? [it.inventoryLevel]
        : [];
    for (const lvl of levels) {
      const locName = lvl.location?.name || "(unknown)";
      bump(inv.locations, locName);
      const qty = (name) => {
        const n = Number(lvl.quantities?.find?.((q) => q.name === name)?.quantity ?? 0);
        return Number.isFinite(n) ? n : 0;
      };
      const avail = qty("available");
      const onHand = qty("on_hand");
      const committed = qty("committed");
      const incoming = qty("incoming");
      const reserved = qty("reserved");
      inv.qtyByLocation[locName] = inv.qtyByLocation[locName] || {
        available: 0,
        onHand: 0,
        committed: 0,
        incoming: 0,
        reserved: 0,
        items: 0,
      };
      inv.qtyByLocation[locName].available += avail;
      inv.qtyByLocation[locName].onHand += onHand;
      inv.qtyByLocation[locName].committed += committed;
      inv.qtyByLocation[locName].incoming += incoming;
      inv.qtyByLocation[locName].reserved += reserved;
      inv.qtyByLocation[locName].items += 1;
      inv.totalAvailable += avail;
      inv.totalOnHand += onHand;
      inv.totalCommitted += committed;
      inv.totalIncoming += incoming;
      inv.totalReserved += reserved;
      if (committed > 0) inv.itemsWithCommitted += 1;
      if (reserved > 0) inv.itemsWithReserved += 1;
      if (incoming > 0) inv.itemsWithIncoming += 1;
    }
  });

  for (const [sku, ids] of skuToItems) {
    if (ids.length > 1) {
      inv.skuDupGroups += 1;
      inv.skuDupItemCount += ids.length;
      if (inv.sampleDupSkus.length < 8) inv.sampleDupSkus.push({ sku, count: ids.length });
    }
  }

  // ── Products / variants (SKU + barcode + bin metafields) ─────────────────
  const products = {
    count: 0,
    variants: 0,
    withSku: 0,
    withoutSku: 0,
    withBarcode: 0,
    withoutBarcode: 0,
    skuDupGroups: 0,
    barcodeDupGroups: 0,
    sampleDupSkus: [],
    sampleDupBarcodes: [],
    barcodePatterns: {},
    binMetafieldPopulated: {},
    batchMetafieldPopulated: {},
    pickTipPopulated: {},
    packSizePopulated: {},
    status: {},
  };
  const variantSkuMap = new Map();
  const variantBarcodeMap = new Map();
  const BIN_KEYS = [
    "my_fields.bin_location",
    "mas.binloc",
    "scanpacker.storage_location",
    "custom.ProductLocation",
    "custom.VariantLocation",
    "custom.ProductPickPackTip",
    "custom.PickPackTip",
    "custom.batch_number",
    "custom.batch_number_variant",
    "custom.pack_size",
    "custom.pack_size_rule",
  ];

  await eachJsonl("products/products.jsonl", (p) => {
    products.count += 1;
    bump(products.status, p.status);
    const mfs = p.metafields?.nodes || [];
    for (const mf of mfs) {
      const id = `${mf.namespace}.${mf.key}`;
      if (BIN_KEYS.includes(id) || /bin|location|pick|pack|batch|lot|serial|barcode/i.test(id)) {
        if (/bin|location|storage/i.test(id)) bump(products.binMetafieldPopulated, id);
        if (/batch|lot|serial|expir/i.test(id)) bump(products.batchMetafieldPopulated, id);
        if (/pick|pack.?tip/i.test(id)) bump(products.pickTipPopulated, id);
        if (/pack_size/i.test(id)) bump(products.packSizePopulated, id);
      }
    }
    for (const v of p.variants?.nodes || []) {
      products.variants += 1;
      const sku = (v.sku || "").trim();
      const barcode = (v.barcode || "").trim();
      if (sku) {
        products.withSku += 1;
        if (!variantSkuMap.has(sku)) variantSkuMap.set(sku, []);
        variantSkuMap.get(sku).push(v.id);
      } else products.withoutSku += 1;
      if (barcode) {
        products.withBarcode += 1;
        if (!variantBarcodeMap.has(barcode)) variantBarcodeMap.set(barcode, []);
        variantBarcodeMap.get(barcode).push(v.id);
        let pattern = "other";
        if (/^\d{8}$/.test(barcode)) pattern = "EAN-8";
        else if (/^\d{12}$/.test(barcode)) pattern = "UPC-A";
        else if (/^\d{13}$/.test(barcode)) pattern = "EAN-13";
        else if (/^\d{14}$/.test(barcode)) pattern = "ITF-14";
        else if (/^[A-Za-z0-9\-_]+$/.test(barcode) && barcode.length < 8) pattern = "short_alnum";
        else if (/^\d+$/.test(barcode)) pattern = `numeric_len_${barcode.length}`;
        bump(products.barcodePatterns, pattern);
      } else products.withoutBarcode += 1;
      const vmfs = v.metafields?.nodes || [];
      for (const mf of vmfs) {
        const id = `${mf.namespace}.${mf.key}`;
        if (/bin|location|storage/i.test(id)) bump(products.binMetafieldPopulated, `VARIANT:${id}`);
        if (/batch|lot|serial|expir/i.test(id)) bump(products.batchMetafieldPopulated, `VARIANT:${id}`);
        if (/pick|pack.?tip/i.test(id)) bump(products.pickTipPopulated, `VARIANT:${id}`);
      }
    }
  });

  for (const [sku, ids] of variantSkuMap) {
    if (ids.length > 1) {
      products.skuDupGroups += 1;
      if (products.sampleDupSkus.length < 8) products.sampleDupSkus.push({ sku, count: ids.length });
    }
  }
  for (const [bc, ids] of variantBarcodeMap) {
    if (ids.length > 1) {
      products.barcodeDupGroups += 1;
      if (products.sampleDupBarcodes.length < 8)
        products.sampleDupBarcodes.push({ barcode: bc.slice(0, 24), count: ids.length });
    }
  }

  // Re-scan inventory barcodes if present on inventory items
  await eachJsonl("inventory/inventory-items.jsonl", (it) => {
    // Some pulls have barcode on variant only; inventory item may expose none.
    const bc = (it.barcode || "").trim();
    if (!bc) {
      // already counted blank elsewhere only if field exists — skip re-count
      return;
    }
    inv.barcodePresent += 1;
    if (!barcodeToItems.has(bc)) barcodeToItems.set(bc, []);
    barcodeToItems.get(bc).push(it.id);
  });
  for (const [bc, ids] of barcodeToItems) {
    if (ids.length > 1) {
      inv.barcodeDupGroups += 1;
      inv.barcodeDupItemCount += ids.length;
      if (inv.sampleDupBarcodes.length < 8)
        inv.sampleDupBarcodes.push({ barcode: bc.slice(0, 24), count: ids.length });
    }
  }
  inv.barcodeBlank = Math.max(0, inv.count - inv.barcodePresent);

  // ── Orders / SKULabs events / fulfilment / release / returns ─────────────
  const skulabs = {
    eventCount: 0,
    orderCount: 0,
    ordersWithEvents: new Set(),
    firstSeen: null,
    lastSeen: null,
    messageFamilies: {},
    messageNormTop: {},
    sampleMessages: [],
    attributeToApp: 0,
    attributeToUser: 0,
    withFulfillment: 0,
    withoutFulfillment: 0,
    multiFulfillmentOrders: 0,
    multiFulfillmentWithSkulabs: 0,
    financialStatus: {},
    displayFulfillmentStatus: {},
    tagsOnSkulabsOrders: {},
    gatewayOnSkulabsOrders: {},
    sourceNameOnSkulabsOrders: {},
    monthlyEvents: {},
    monthlyOrders: {},
    eventsPerOrderHist: {},
    truncatedLikely: 0, // orders with exactly 50 events in pull
  };

  const fulfilment = {
    total: 0,
    services: {},
    locationNames: {},
    trackingCompanies: {},
    status: {},
    createdByAppHint: {}, // from events near fulfilment — approximate
  };

  const release = {
    orders: 0,
    paidWithSkulabs: 0,
    pendingWithSkulabs: 0,
    authorizedWithSkulabs: 0,
    partiallyPaidWithSkulabs: 0,
    onHoldWithSkulabs: 0,
    onHoldTotal: 0,
    payLaterTagWithSkulabs: 0,
    bankDepositWithSkulabs: 0,
    worldpayWithSkulabs: 0,
    fromDraftWithSkulabs: 0,
    websiteOrderWithSkulabs: 0,
    unfulfilledWithSkulabs: 0,
    fulfilledWithSkulabs: 0,
    partialWithSkulabs: 0,
  };

  const returns = {
    refundOrders: 0,
    refundLineItems: 0,
    restockTypes: {},
    nativeReturns: 0,
    skulabsOnRefundOrders: 0,
  };

  const lineSku = {
    lines: 0,
    withSku: 0,
    withoutSku: 0,
    deletedProduct: 0,
  };

  const staff = {
    skulabsEventsAttributeToUser: 0,
    skulabsEventsAttributeToApp: 0,
    commentEvents: 0,
  };

  const holdCancel = {
    onHoldOrders: 0,
    cancelledFulfillments: 0,
    skulabsCancelMessages: 0,
    skulabsHoldMessages: 0,
  };

  const multiParcel = {
    fulfillmentsWithMultiTracking: 0,
    ordersMultiFulfillment: 0,
  };

  let orderCount = 0;

  await eachJsonl("orders/orders.jsonl", (o) => {
    orderCount += 1;
    const tags = Array.isArray(o.tags)
      ? o.tags
      : String(o.tags || "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
    const tagSet = new Set(tags);
    if (tagSet.has("ON_HOLD")) {
      holdCancel.onHoldOrders += 1;
      release.onHoldTotal += 1;
    }

    const fulfillments = o.fulfillments || [];
    if (fulfillments.length > 1) {
      multiParcel.ordersMultiFulfillment += 1;
      skulabs.multiFulfillmentOrders += 1;
    }
    for (const f of fulfillments) {
      fulfilment.total += 1;
      bump(fulfilment.services, f.service?.serviceName || f.service?.handle || "(none)");
      bump(fulfilment.status, f.status || f.displayStatus || "(none)");
      bump(fulfilment.locationNames, f.location?.name || "(none)");
      const ti = f.trackingInfo || [];
      if (Array.isArray(ti) && ti.length > 1) multiParcel.fulfillmentsWithMultiTracking += 1;
      for (const t of ti) bump(fulfilment.trackingCompanies, t.company || "(none)");
      if (String(f.status || "").toUpperCase().includes("CANCEL")) holdCancel.cancelledFulfillments += 1;
    }

    // refunds / restock
    const refunds = o.refunds || [];
    if (refunds.length) {
      returns.refundOrders += 1;
      for (const r of refunds) {
        for (const rli of r.refundLineItems?.nodes || r.refundLineItems || []) {
          returns.refundLineItems += 1;
          bump(returns.restockTypes, rli.restockType || "(null)");
        }
      }
    }
    if ((o.returns?.nodes || []).length) returns.nativeReturns += (o.returns?.nodes || []).length;

    for (const li of o.lineItems?.nodes || []) {
      lineSku.lines += 1;
      if ((li.sku || "").trim()) lineSku.withSku += 1;
      else lineSku.withoutSku += 1;
      // deleted/archived product references: product null while line remains
      if (li.product == null) lineSku.deletedProduct += 1;
    }

    const events = o.events?.nodes || [];
    if (events.length >= 50) skulabs.truncatedLikely += 1;

    const skulabsEvents = events.filter((ev) => String(ev.appTitle || "") === "SKULabs");
    if (!skulabsEvents.length) return;

    skulabs.orderCount += 1;
    skulabs.ordersWithEvents.add(o.id);
    skulabs.eventCount += skulabsEvents.length;
    bump(skulabs.eventsPerOrderHist, String(skulabsEvents.length));

    const monthKey = (iso) => (iso ? String(iso).slice(0, 7) : "(none)");
    bump(skulabs.monthlyOrders, monthKey(o.createdAt));

    if (fulfillments.length) skulabs.withFulfillment += 1;
    else skulabs.withoutFulfillment += 1;
    if (fulfillments.length > 1) skulabs.multiFulfillmentWithSkulabs += 1;

    bump(skulabs.financialStatus, o.displayFinancialStatus || o.financialStatus || "(none)");
    bump(skulabs.displayFulfillmentStatus, o.displayFulfillmentStatus || "(none)");
    bump(skulabs.sourceNameOnSkulabsOrders, o.sourceName || "(none)");
    for (const t of tags) bump(skulabs.tagsOnSkulabsOrders, t);
    for (const g of o.paymentGatewayNames || []) bump(skulabs.gatewayOnSkulabsOrders, g);

    // release correlations
    release.orders += 1;
    const fin = String(o.displayFinancialStatus || "").toUpperCase();
    if (fin === "PAID") release.paidWithSkulabs += 1;
    if (fin === "PENDING") release.pendingWithSkulabs += 1;
    if (fin === "AUTHORIZED") release.authorizedWithSkulabs += 1;
    if (fin === "PARTIALLY_PAID") release.partiallyPaidWithSkulabs += 1;
    if (tagSet.has("ON_HOLD")) release.onHoldWithSkulabs += 1;
    if ([...tagSet].some((t) => /pay.?later/i.test(t))) release.payLaterTagWithSkulabs += 1;
    if ((o.paymentGatewayNames || []).some((g) => /bank.?deposit/i.test(g)))
      release.bankDepositWithSkulabs += 1;
    if ((o.paymentGatewayNames || []).some((g) => /worldpay/i.test(g)))
      release.worldpayWithSkulabs += 1;
    if (tagSet.has("FromDraft") || tagSet.has("fromDraft")) release.fromDraftWithSkulabs += 1;
    if (tagSet.has("WebsiteOrder")) release.websiteOrderWithSkulabs += 1;
    const dfs = String(o.displayFulfillmentStatus || "").toUpperCase();
    if (dfs === "UNFULFILLED") release.unfulfilledWithSkulabs += 1;
    if (dfs === "FULFILLED") release.fulfilledWithSkulabs += 1;
    if (dfs === "PARTIAL") release.partialWithSkulabs += 1;
    if (refunds.length) returns.skulabsOnRefundOrders += 1;

    for (const ev of skulabsEvents) {
      const at = ev.createdAt || null;
      if (at) {
        if (!skulabs.firstSeen || at < skulabs.firstSeen) skulabs.firstSeen = at;
        if (!skulabs.lastSeen || at > skulabs.lastSeen) skulabs.lastSeen = at;
        bump(skulabs.monthlyEvents, monthKey(at));
      }
      const fam = messageFamily(ev.message);
      bump(skulabs.messageFamilies, fam);
      const norm = normalizeMsg(ev.message);
      bump(skulabs.messageNormTop, norm);
      if (skulabs.sampleMessages.length < 25 && !skulabs.sampleMessages.includes(norm)) {
        skulabs.sampleMessages.push(norm);
      }
      if (ev.attributeToApp) {
        skulabs.attributeToApp += 1;
        staff.skulabsEventsAttributeToApp += 1;
      }
      if (ev.attributeToUser) {
        skulabs.attributeToUser += 1;
        staff.skulabsEventsAttributeToUser += 1;
      }
      if (fam === "cancel_related" || fam === "fulfillment_cancelled") {
        holdCancel.skulabsCancelMessages += 1;
      }
      if (fam === "hold_related") holdCancel.skulabsHoldMessages += 1;
    }
  });

  // Customers skulabs.shopname — from analysis metafield catalogue if present
  let skulabsShopname = null;
  try {
    const slim = JSON.parse(await readFile(path.join(OUT, "slim.json"), "utf8"));
    skulabsShopname = (slim.metafieldLiveTop || []).find((m) => m.id === "skulabs.shopname") || null;
    if (!skulabsShopname) {
      const cat = slim.metafieldCatalogue || [];
      // slim may not have full catalogue; try metafield-catalogue.json
    }
  } catch {
    /* ignore */
  }
  try {
    const cat = JSON.parse(await readFile(path.join(OUT, "metafield-catalogue.json"), "utf8"));
    const list = Array.isArray(cat) ? cat : cat.entries || [];
    const hit = list.find((m) => m.id === "skulabs.shopname" || `${m.namespace}.${m.key}` === "skulabs.shopname");
    if (hit) skulabsShopname = hit;
  } catch {
    /* ignore */
  }

  // Metafield definitions for warehouse-related
  let warehouseMetafieldDefs = [];
  try {
    const defs = JSON.parse(await readFile(path.join(OUT, "metafield-definitions.json"), "utf8"));
    const arr = Array.isArray(defs)
      ? defs
      : defs.definitions || defs.metafieldDefinitions || defs.data?.metafieldDefinitions?.nodes || [];
    warehouseMetafieldDefs = arr
      .filter((d) => {
        const ns = `${d.namespace || ""}.${d.key || ""}`;
        const name = `${d.name || ""} ${d.description || ""}`;
        return /skulabs|bin|pick|pack|scan|batch|lot|serial|location|warehouse|barcode|inventory/i.test(
          `${ns} ${name}`,
        );
      })
      .map((d) => ({
        namespace: d.namespace,
        key: d.key,
        name: d.name,
        ownerType: d.ownerType,
        description: (d.description || "").slice(0, 160),
      }));
  } catch {
    /* ignore */
  }

  const report = {
    generatedAt: new Date().toISOString(),
    phase: "3D",
    scope: "READ_ONLY_SKULabs_warehouse_forensics",
    shopifyStore: "c906ff-0a.myshopify.com",
    totals: {
      orders: orderCount,
      skulabsEvents: skulabs.eventCount,
      skulabsOrders: skulabs.orderCount,
      skulabsOrderPct: orderCount ? Number(((skulabs.orderCount / orderCount) * 100).toFixed(2)) : 0,
    },
    locations,
    inventory: {
      ...inv,
      locations: topEntries(inv.locations),
      qtyByLocation: inv.qtyByLocation,
    },
    products: {
      ...products,
      binMetafieldPopulated: topEntries(products.binMetafieldPopulated, 30),
      batchMetafieldPopulated: topEntries(products.batchMetafieldPopulated, 30),
      pickTipPopulated: topEntries(products.pickTipPopulated, 20),
      packSizePopulated: topEntries(products.packSizePopulated, 20),
      barcodePatterns: topEntries(products.barcodePatterns, 20),
      status: topEntries(products.status),
    },
    skulabs: {
      eventCount: skulabs.eventCount,
      orderCount: skulabs.orderCount,
      firstSeen: skulabs.firstSeen,
      lastSeen: skulabs.lastSeen,
      withFulfillment: skulabs.withFulfillment,
      withoutFulfillment: skulabs.withoutFulfillment,
      multiFulfillmentOrdersInPull: skulabs.multiFulfillmentOrders,
      multiFulfillmentWithSkulabs: skulabs.multiFulfillmentWithSkulabs,
      attributeToApp: skulabs.attributeToApp,
      attributeToUser: skulabs.attributeToUser,
      truncatedLikely50EventOrders: skulabs.truncatedLikely,
      messageFamilies: topEntries(skulabs.messageFamilies, 30),
      messageNormTop: topEntries(skulabs.messageNormTop, 40),
      sampleMessages: skulabs.sampleMessages,
      financialStatus: topEntries(skulabs.financialStatus),
      displayFulfillmentStatus: topEntries(skulabs.displayFulfillmentStatus),
      tagsTop: topEntries(skulabs.tagsOnSkulabsOrders, 40),
      gateways: topEntries(skulabs.gatewayOnSkulabsOrders, 20),
      sourceNames: topEntries(skulabs.sourceNameOnSkulabsOrders, 15),
      monthlyEvents: topEntries(skulabs.monthlyEvents, 36),
      monthlyOrders: topEntries(skulabs.monthlyOrders, 36),
      eventsPerOrderHist: topEntries(skulabs.eventsPerOrderHist, 20),
      shopnameMetafield: skulabsShopname
        ? {
            id: skulabsShopname.id || "skulabs.shopname",
            populatedCount: skulabsShopname.populatedCount,
            ownerTypes: skulabsShopname.ownerTypes,
            topValues: (skulabsShopname.topValues || []).slice(0, 8),
            sampleValues: (skulabsShopname.sampleValues || []).slice(0, 5),
          }
        : null,
    },
    fulfilment,
    multiParcel,
    release,
    returns: {
      ...returns,
      restockTypes: topEntries(returns.restockTypes, 20),
    },
    lineSku,
    holdCancel,
    staff,
    warehouseMetafieldDefs,
    envCheck: {
      note: "Checked at report time via Phase 3D — no SKULabs credentials expected in repo",
    },
  };

  // Convert Sets
  report.skulabs.ordersWithEventsCount = skulabs.ordersWithEvents.size;

  await mkdir(OUT, { recursive: true });
  const outPath = path.join(OUT, "phase3d-skulabs.json");
  await writeFile(outPath, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        outPath,
        orders: orderCount,
        skulabsEvents: skulabs.eventCount,
        skulabsOrders: skulabs.orderCount,
        firstSeen: skulabs.firstSeen,
        lastSeen: skulabs.lastSeen,
        topFamilies: topEntries(skulabs.messageFamilies, 12),
        topMessages: topEntries(skulabs.messageNormTop, 15),
        inventoryLocations: inv.qtyByLocation,
        variantSku: {
          with: products.withSku,
          without: products.withoutSku,
          dupGroups: products.skuDupGroups,
        },
        barcode: {
          with: products.withBarcode,
          without: products.withoutBarcode,
          dupGroups: products.barcodeDupGroups,
        },
        release,
        restockTypes: topEntries(returns.restockTypes, 10),
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
