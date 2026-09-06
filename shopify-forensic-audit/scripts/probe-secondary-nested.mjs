#!/usr/bin/env node
/**
 * Probe other exact-N nested risks (discountApplications, abandoned lineItems, product media).
 *   node shopify-forensic-audit/scripts/probe-secondary-nested.mjs
 */
import { createReadStream } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import readline from "node:readline";
import path from "node:path";
import { AUDIT_ROOT, RAW_DIR, executeQuery, API_VERSION, STORE } from "./shopify-exec.mjs";

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

const FULFILLMENTS_PROBE = `
query($id: ID!) {
  order(id: $id) {
    id
    name
    fulfillments(first: 20) {
      id
    }
  }
}`;

async function main() {
  const outDir = path.join(AUDIT_ROOT, "raw_repairs", "secondary_probes");
  await mkdir(outDir, { recursive: true });

  // Sample up to 25 discountApplications exact-20 orders
  const discSuspects = [];
  await eachUnique("orders/orders.jsonl", async (rec) => {
    if ((rec.discountApplications?.nodes || []).length >= 20) {
      discSuspects.push({ orderGid: rec.id, orderName: rec.name, n: rec.discountApplications.nodes.length });
    }
  });
  const discSample = discSuspects.slice(0, 25);
  let discTrunc = 0;
  for (const s of discSample) {
    try {
      const { data } = await executeQuery({ query: DISCOUNT_PROBE, variables: { id: s.orderGid } });
      if (data?.order?.discountApplications?.pageInfo?.hasNextPage) discTrunc += 1;
    } catch (e) {
      console.error("disc fail", e.message);
    }
  }

  // All abandoned exact-50
  const abSuspects = [];
  await eachUnique("abandoned_checkouts/abandoned-checkouts.jsonl", async (rec) => {
    if ((rec.lineItems?.nodes || []).length >= 50) {
      abSuspects.push({ id: rec.id, n: rec.lineItems.nodes.length });
    }
  });
  let abTrunc = 0;
  for (const s of abSuspects) {
    try {
      const { data } = await executeQuery({ query: ABANDONED_PROBE, variables: { id: s.id } });
      if (data?.node?.lineItems?.pageInfo?.hasNextPage) abTrunc += 1;
    } catch (e) {
      console.error("ab fail", e.message);
    }
  }

  // Sample 20 product media exact-20
  const mediaSuspects = [];
  await eachUnique("products/products.jsonl", async (rec) => {
    if ((rec.media?.nodes || []).length >= 20) {
      mediaSuspects.push({ id: rec.id, handle: rec.handle, n: rec.media.nodes.length });
    }
  });
  const mediaSample = mediaSuspects.slice(0, 20);
  let mediaTrunc = 0;
  for (const s of mediaSample) {
    try {
      const { data } = await executeQuery({ query: MEDIA_PROBE, variables: { id: s.id } });
      if (data?.product?.media?.pageInfo?.hasNextPage) mediaTrunc += 1;
    } catch (e) {
      console.error("media fail", e.message);
    }
  }

  // The 1 order with exactly 20 fulfillments
  const ff20 = [];
  await eachUnique("orders/orders.jsonl", async (rec) => {
    if ((rec.fulfillments || []).length >= 20) {
      ff20.push({ id: rec.id, name: rec.name, n: rec.fulfillments.length });
    }
  });
  let ff20Trunc = null;
  for (const s of ff20) {
    try {
      // Shopify fulfillments on Order is often a list not a paginated connection in Admin API
      const { data } = await executeQuery({ query: FULFILLMENTS_PROBE, variables: { id: s.id } });
      ff20Trunc = {
        order: s.name,
        returned: (data?.order?.fulfillments || []).length,
        note: "Order.fulfillments is a list field in Admin GraphQL (not cursor-paginated in this API shape)",
      };
    } catch (e) {
      ff20Trunc = { error: e.message };
    }
  }

  const report = {
    at: new Date().toISOString(),
    apiVersion: API_VERSION,
    store: STORE,
    discountApplications: {
      exact20Suspects: discSuspects.length,
      sampled: discSample.length,
      sampledHasNextPage: discTrunc,
      action:
        discTrunc > 0
          ? "REPAIR_REQUIRED"
          : "NO_TRUNCATION_IN_SAMPLE — exact-20 may be true count",
    },
    abandonedLineItems: {
      exact50Suspects: abSuspects.length,
      confirmedHasNextPage: abTrunc,
      action: abTrunc > 0 ? "REPAIR_REQUIRED" : "NO_TRUNCATION",
    },
    productMedia: {
      exact20Suspects: mediaSuspects.length,
      sampled: mediaSample.length,
      sampledHasNextPage: mediaTrunc,
      action: mediaTrunc > 0 ? "REPAIR_REQUIRED" : "NO_TRUNCATION_IN_SAMPLE",
    },
    orderFulfillmentsExact20: ff20Trunc,
  };
  await writeFile(path.join(outDir, "secondary-probe-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
