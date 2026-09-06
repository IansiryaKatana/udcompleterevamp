#!/usr/bin/env node
/**
 * Read-only Shopify forensic fetch.
 * Never uses --allow-mutations.
 *
 * Usage:
 *   node scripts/fetch-all.mjs
 *   node scripts/fetch-all.mjs --phase bootstrap
 *   node scripts/fetch-all.mjs --phase definitions
 *   node scripts/fetch-all.mjs --phase catalog
 *   node scripts/fetch-all.mjs --phase customers
 *   node scripts/fetch-all.mjs --phase orders
 *   node scripts/fetch-all.mjs --phase drafts
 *   node scripts/fetch-all.mjs --phase remaining
 */
import { mkdir, writeFile, readFile, access, unlink } from "node:fs/promises";
import path from "node:path";
import {
  AUDIT_ROOT,
  QUERY_DIR,
  RAW_DIR,
  executeQuery,
  paginateConnection,
  writeJson,
  appendJsonl,
  ensureDirs,
  expandNestedLineItems,
  assertNoTruncatedLineItems,
  expandOrderNestedConnections,
  assertNoTruncatedOrderNested,
} from "./shopify-exec.mjs";

const PHASE = process.argv.includes("--phase")
  ? process.argv[process.argv.indexOf("--phase") + 1]
  : "all";

const OWNER_TYPES = [
  "API_PERMISSION",
  "ARTICLE",
  "BLOG",
  "CARTTRANSFORM",
  "COLLECTION",
  "COMPANY",
  "COMPANY_LOCATION",
  "CUSTOMER",
  "DELIVERY_CUSTOMIZATION",
  "DISCOUNT",
  "DRAFTORDER",
  "FULFILLMENT_CONSTRAINT_RULE",
  "GIFT_CARD_TRANSACTION",
  "LOCATION",
  "MARKET",
  "ORDER",
  "ORDER_ROUTING_LOCATION_RULE",
  "PAGE",
  "PAYMENT_CUSTOMIZATION",
  "PRODUCT",
  "PRODUCTVARIANT",
  "SELLING_PLAN",
  "SHOP",
  "TRANSFER",
  "VALIDATION",
];

const errors = [];

function q(name) {
  return path.join(QUERY_DIR, name);
}

async function exists(rel) {
  try {
    await access(path.join(RAW_DIR, rel));
    return true;
  } catch {
    return false;
  }
}

async function recordError(step, err) {
  const entry = {
    step,
    at: new Date().toISOString(),
    message: err.message,
    errors: err.errors || null,
  };
  errors.push(entry);
  await mkdir(path.join(RAW_DIR, "_errors"), { recursive: true });
  await writeFile(
    path.join(RAW_DIR, "_errors", `${step.replaceAll(/[^a-z0-9_-]/gi, "_")}.json`),
    JSON.stringify(entry, null, 2),
  );
  console.error(`[error] ${step}: ${err.message.slice(0, 500)}`);
}

async function fetchConnection({
  queryFile,
  connectionPath,
  outFile,
  label,
  pageSize = 50,
  extraVariables = {},
  skipIfExists = true,
  expandLineItemsKind = null, // 'order' | 'draft' | null
}) {
  const jsonlPath = outFile.replace(/\.json$/, ".jsonl");
  const summaryPath = outFile.replace(/\.json$/, ".summary.json");
  const progressPath = outFile.replace(/\.json$/, ".progress.json");
  if (skipIfExists && (await exists(summaryPath))) {
    console.error(`[skip] ${label} already cached at ${summaryPath}`);
    return;
  }
  let startCursor = null;
  let startPage = 0;
  let startTotal = 0;
  if (await exists(progressPath)) {
    try {
      const progress = JSON.parse(await readFile(path.join(RAW_DIR, progressPath), "utf8"));
      startCursor = progress.cursor || null;
      startPage = progress.page || 0;
      startTotal = progress.count || 0;
      console.error(`[resume] ${label} page=${startPage} count=${startTotal}`);
    } catch {
      startCursor = null;
    }
  }
  const result = await paginateConnection({
    queryFile,
    connectionPath,
    pageSize,
    extraVariables,
    label,
    keepNodes: false,
    startCursor,
    startPage,
    startTotal,
    onPage: async ({ page, pageNodes, total, cursor }) => {
      let nodes = pageNodes;
      if (expandLineItemsKind) {
        const expanded = [];
        for (const node of pageNodes) {
          let n = await expandNestedLineItems(node, {
            kind: expandLineItemsKind,
            label: `${label}:lineItems`,
          });
          if (expandLineItemsKind === "order") {
            n = await expandOrderNestedConnections(n, { label });
          }
          expanded.push(n);
        }
        assertNoTruncatedLineItems(expanded, { label });
        if (expandLineItemsKind === "order") assertNoTruncatedOrderNested(expanded, { label });
        nodes = expanded;
      }
      await appendJsonl(jsonlPath, nodes.map((node) => ({ record: node })));
      await writeFile(
        path.join(RAW_DIR, progressPath),
        JSON.stringify({ page, count: total, cursor, updatedAt: new Date().toISOString() }),
      );
    },
  });
  const count = result?.count ?? result?.length ?? 0;
  await writeJson(summaryPath, { count, jsonl: jsonlPath });
  try {
    await unlink(path.join(RAW_DIR, progressPath));
  } catch {
    /* ignore */
  }
  return result;
}

async function phaseBootstrap() {
  console.error("[phase] bootstrap");
  const { data, raw } = await executeQuery({ queryFile: q("01-bootstrap.graphql") });
  await writeJson("shop/bootstrap.json", data);
  await writeJson("shop/bootstrap.raw.json", raw);
  const oldest = data?.oldestOrder?.nodes?.[0]?.createdAt || null;
  const newest = data?.newestOrder?.nodes?.[0]?.createdAt || null;
  const scopes = (data?.currentAppInstallation?.accessScopes || []).map((s) => s.handle);
  const summary = {
    shopName: data?.shop?.name,
    domain: data?.shop?.myshopifyDomain,
    primaryDomain: data?.shop?.primaryDomain,
    plan: data?.shop?.plan,
    currency: data?.shop?.currencyCode,
    timezone: data?.shop?.ianaTimezone,
    country: data?.shop?.shopAddress,
    grantedScopes: scopes,
    hasReadAllOrders: scopes.includes("read_all_orders"),
    counts: {
      products: data?.productsCount?.count,
      collections: data?.collectionsCount?.count,
      customers: data?.customersCount?.count,
      orders: data?.ordersCount?.count,
      draftOrders: data?.draftOrdersCount?.count,
      locations: data?.locationsCount?.count,
      abandonedCheckouts: data?.abandonedCheckoutsCount?.count,
    },
    oldestOrder: oldest,
    newestOrder: newest,
    oldestOrderNode: data?.oldestOrder?.nodes?.[0] || null,
    newestOrderNode: data?.newestOrder?.nodes?.[0] || null,
  };
  await writeJson("shop/summary.json", summary);
  console.error(JSON.stringify(summary, null, 2));

  if (!scopes.includes("read_all_orders")) {
    console.error(
      "[BLOCKER] read_all_orders is not granted. Historical order analysis is incomplete.",
    );
  }
  return summary;
}

async function phaseLocations() {
  console.error("[phase] locations/markets");
  try {
    const { data } = await executeQuery({ queryFile: q("03-locations-markets.graphql") });
    await writeJson("shop/locations-markets.json", data);
  } catch (err) {
    await recordError("locations-markets", err);
  }
}

async function phaseDefinitions() {
  console.error("[phase] metafield definitions");
  const byOwner = {};
  for (const ownerType of OWNER_TYPES) {
    try {
      const nodes = await paginateConnection({
        queryFile: q("02-metafield-definitions.graphql"),
        connectionPath: ["metafieldDefinitions"],
        extraVariables: { ownerType },
        pageSize: 250,
        label: `metafieldDefinitions:${ownerType}`,
      });
      byOwner[ownerType] = { ok: true, count: nodes.length, nodes };
    } catch (err) {
      byOwner[ownerType] = { ok: false, error: err.message };
      await recordError(`metafieldDefinitions:${ownerType}`, err);
    }
  }
  await writeJson("metafield_definitions/by-owner.json", byOwner);
}

async function phaseCatalog() {
  console.error("[phase] catalog");
  try {
    await fetchConnection({
      queryFile: q("06-products.graphql"),
      connectionPath: ["products"],
      outFile: "products/products.json",
      label: "products",
      pageSize: 25,
    });
  } catch (err) {
    await recordError("products", err);
  }
  try {
    await fetchConnection({
      queryFile: q("11-collections.graphql"),
      connectionPath: ["collections"],
      outFile: "products/collections.json",
      label: "collections",
    });
  } catch (err) {
    await recordError("collections", err);
  }
  try {
    await fetchConnection({
      queryFile: q("14-inventory.graphql"),
      connectionPath: ["inventoryItems"],
      outFile: "inventory/inventory-items.json",
      label: "inventoryItems",
      pageSize: 25,
    });
  } catch (err) {
    await recordError("inventoryItems", err);
  }
  try {
    await fetchConnection({
      queryFile: q("12-files.graphql"),
      connectionPath: ["files"],
      outFile: "files/files.json",
      label: "files",
    });
  } catch (err) {
    await recordError("files", err);
  }
}

async function phaseCustomers() {
  console.error("[phase] customers");
  try {
    await fetchConnection({
      queryFile: q("05-customers.graphql"),
      connectionPath: ["customers"],
      outFile: "customers/customers.json",
      label: "customers",
      pageSize: 50,
    });
  } catch (err) {
    await recordError("customers", err);
  }
  try {
    await fetchConnection({
      queryFile: q("10-companies.graphql"),
      connectionPath: ["companies"],
      outFile: "customers/companies.json",
      label: "companies",
      pageSize: 25,
    });
  } catch (err) {
    await recordError("companies", err);
  }
}

async function phaseOrders() {
  console.error("[phase] orders");
  try {
    await fetchConnection({
      queryFile: q("04-orders.graphql"),
      connectionPath: ["orders"],
      outFile: "orders/orders.json",
      label: "orders",
      pageSize: 40,
      expandLineItemsKind: "order",
    });
  } catch (err) {
    await recordError("orders", err);
  }
}

async function phaseDrafts() {
  console.error("[phase] draft orders");
  try {
    await fetchConnection({
      queryFile: q("07-draft-orders.graphql"),
      connectionPath: ["draftOrders"],
      outFile: "draft_orders/draft-orders.json",
      label: "draftOrders",
      pageSize: 40,
      expandLineItemsKind: "draft",
    });
  } catch (err) {
    await recordError("draftOrders", err);
  }
}

async function phaseRemaining() {
  console.error("[phase] remaining");
  try {
    await fetchConnection({
      queryFile: q("08-abandoned-checkouts.graphql"),
      connectionPath: ["abandonedCheckouts"],
      outFile: "abandoned_checkouts/abandoned-checkouts.json",
      label: "abandonedCheckouts",
    });
  } catch (err) {
    await recordError("abandonedCheckouts", err);
  }
  try {
    await fetchConnection({
      queryFile: q("09-discounts.graphql"),
      connectionPath: ["discountNodes"],
      outFile: "discounts/discount-nodes.json",
      label: "discountNodes",
    });
  } catch (err) {
    await recordError("discountNodes", err);
  }
  try {
    const defs = await paginateConnection({
      queryFile: q("13-metaobject-definitions.graphql"),
      connectionPath: ["metaobjectDefinitions"],
      label: "metaobjectDefinitions",
    });
    await writeJson("metaobjects/definitions.json", { count: defs.length, nodes: defs });
    for (const def of defs) {
      try {
        await fetchConnection({
          queryFile: q("13b-metaobjects.graphql"),
          connectionPath: ["metaobjects"],
          extraVariables: { type: def.type },
          outFile: `metaobjects/type-${def.type.replaceAll(/[^a-z0-9_-]/gi, "_")}.json`,
          label: `metaobjects:${def.type}`,
          skipIfExists: true,
        });
      } catch (err) {
        await recordError(`metaobjects:${def.type}`, err);
      }
    }
  } catch (err) {
    await recordError("metaobjectDefinitions", err);
  }
}

async function main() {
  await ensureDirs();
  const runLog = { startedAt: new Date().toISOString(), phase: PHASE, steps: [] };
  const run = async (name, fn) => {
    const start = Date.now();
    console.error(`\n=== ${name} ===`);
    try {
      await fn();
      runLog.steps.push({ name, ok: true, ms: Date.now() - start });
    } catch (err) {
      await recordError(name, err);
      runLog.steps.push({ name, ok: false, ms: Date.now() - start, error: err.message });
    }
  };

  if (PHASE === "all" || PHASE === "bootstrap") await run("bootstrap", phaseBootstrap);
  if (PHASE === "all" || PHASE === "bootstrap" || PHASE === "definitions") {
    await run("locations", phaseLocations);
  }
  if (PHASE === "all" || PHASE === "definitions") await run("definitions", phaseDefinitions);
  if (PHASE === "all" || PHASE === "catalog") await run("catalog", phaseCatalog);
  if (PHASE === "all" || PHASE === "customers") await run("customers", phaseCustomers);
  if (PHASE === "all" || PHASE === "orders") await run("orders", phaseOrders);
  if (PHASE === "all" || PHASE === "drafts") await run("drafts", phaseDrafts);
  if (PHASE === "all" || PHASE === "remaining") await run("remaining", phaseRemaining);

  runLog.finishedAt = new Date().toISOString();
  runLog.errorCount = errors.length;
  await writeJson("_run-log.json", runLog);
  console.error(`\nDone phase=${PHASE} errors=${errors.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
