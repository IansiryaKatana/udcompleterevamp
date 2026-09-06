/**
 * Read-only Shopify Admin GraphQL runner for UD Sales Portal.
 * Uses the existing installed app token. Never sends mutations.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const STORE = "c906ff-0a.myshopify.com";
export const API_VERSION = "2026-07";
export const AUDIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const RAW_DIR = path.join(AUDIT_ROOT, "raw");
export const QUERY_DIR = path.join(AUDIT_ROOT, "queries");
export const TOKEN_FILE = path.join(RAW_DIR, ".session-token.json");

let tokenCache = null;
let lastCost = null;

export async function ensureDirs() {
  await mkdir(RAW_DIR, { recursive: true });
  await mkdir(path.join(AUDIT_ROOT, "analysis"), { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getToken() {
  if (tokenCache) return tokenCache;
  const raw = JSON.parse(await readFile(TOKEN_FILE, "utf8"));
  if (!raw.access_token) throw new Error("Missing access_token in session file");
  tokenCache = raw.access_token;
  return tokenCache;
}

export async function executeQuery({ query, queryFile, variables, attempt = 1 }) {
  let queryText = query;
  if (queryFile) queryText = await readFile(queryFile, "utf8");
  if (!queryText) throw new Error("No GraphQL query provided");

  const token = await getToken();
  let res;
  try {
    res = await fetch(`https://${STORE}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query: queryText, variables: variables || {} }),
    });
  } catch (networkErr) {
    const message = networkErr?.message || "fetch failed";
    if (attempt < 8) {
      const wait = Math.min(60_000, 1500 * 2 ** (attempt - 1));
      console.error(`[retry ${attempt}] ${message} — waiting ${wait}ms`);
      await sleep(wait);
      return executeQuery({ query, queryFile, variables, attempt: attempt + 1 });
    }
    throw networkErr;
  }

  let json;
  try {
    json = await res.json();
  } catch {
    json = { errors: [{ message: `Non-JSON response status ${res.status}` }] };
  }

  lastCost = json.extensions?.cost || null;
  const throttle = lastCost?.throttleStatus;
  if (throttle && throttle.currentlyAvailable < 1000) {
    const wait = Math.ceil(((1000 - throttle.currentlyAvailable) / (throttle.restoreRate || 50)) * 1000);
    if (wait > 0) await sleep(Math.min(wait, 5000));
  }

  const errors = json.errors;
  const message = formatErrors(errors);
  if (!res.ok || errors) {
    if (isRetryable(message || `HTTP ${res.status}`) && attempt < 8) {
      const wait = Math.min(60_000, 1500 * 2 ** (attempt - 1));
      console.error(`[retry ${attempt}] ${(message || `HTTP ${res.status}`).slice(0, 300)} — waiting ${wait}ms`);
      await sleep(wait);
      return executeQuery({ query, queryFile, variables, attempt: attempt + 1 });
    }
    const err = new Error(message || `HTTP ${res.status}`);
    err.errors = errors;
    err.status = res.status;
    err.body = json;
    throw err;
  }

  return { data: json.data, raw: json, cost: lastCost };
}

function formatErrors(errors) {
  if (!errors) return "";
  if (Array.isArray(errors)) {
    return errors
      .map((e) => (typeof e === "string" ? e : e.message || JSON.stringify(e)))
      .join(" | ");
  }
  return typeof errors === "string" ? errors : JSON.stringify(errors);
}

function isRetryable(message) {
  const text = String(message).toLowerCase();
  return (
    text.includes("throttl") ||
    text.includes("429") ||
    text.includes("503") ||
    text.includes("502") ||
    text.includes("timeout") ||
    text.includes("econnreset") ||
    text.includes("socket") ||
    text.includes("temporarily unavailable") ||
    text.includes("max cost") ||
    text.includes("reduce the query complexity") ||
    text.includes("internal error") ||
    text.includes("fetch failed") ||
    text.includes("network")
  );
}

export async function paginateConnection({
  queryFile,
  query,
  connectionPath,
  pageSize = 50,
  extraVariables = {},
  onPage,
  label = "connection",
  keepNodes = true,
  startCursor = null,
  startPage = 0,
  startTotal = 0,
}) {
  let cursor = startCursor;
  let page = startPage;
  let total = startTotal;
  const nodes = [];
  while (true) {
    page += 1;
    const { data } = await executeQuery({
      queryFile,
      query,
      variables: { cursor, first: pageSize, ...extraVariables },
    });
    const conn = getPath(data, connectionPath);
    if (!conn) {
      throw new Error(`${label}: missing connection at ${connectionPath.join(".")}`);
    }
    const pageNodes = conn.nodes ?? conn.edges?.map((e) => e.node) ?? [];
    total += pageNodes.length;
    if (keepNodes) nodes.push(...pageNodes);
    const nextCursor = conn.pageInfo?.endCursor || null;
    if (onPage) await onPage({ page, pageNodes, conn, data, total, cursor: nextCursor });
    const costBit = lastCost ? ` cost=${lastCost.actualQueryCost}/${lastCost.throttleStatus?.currentlyAvailable}` : "";
    console.error(
      `[${label}] page ${page}: +${pageNodes.length} (total ${total}) hasNext=${Boolean(conn.pageInfo?.hasNextPage)}${costBit}`,
    );
    if (!conn.pageInfo?.hasNextPage) break;
    cursor = nextCursor;
  }
  return keepNodes ? nodes : { count: total };
}

export function getPath(obj, pathParts) {
  return pathParts.reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

export async function writeJson(relPath, value) {
  const full = path.join(RAW_DIR, relPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(
    full,
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        apiVersion: API_VERSION,
        store: STORE,
        data: value,
      },
      null,
      2,
    ),
    "utf8",
  );
  return full;
}

export async function appendJsonl(relPath, records) {
  const full = path.join(RAW_DIR, relPath);
  await mkdir(path.dirname(full), { recursive: true });
  const lines = records
    .map((record) =>
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        apiVersion: API_VERSION,
        store: STORE,
        ...record,
      }),
    )
    .join("\n");
  await writeFile(full, lines ? lines + "\n" : "", { flag: "a" });
  return full;
}

/**
 * Continue nested lineItems pagination until hasNextPage=false.
 * Mutates node.lineItems in place (nodes + pageInfo).
 */
export async function expandNestedLineItems(node, {
  kind, // 'order' | 'draft'
  pageSize = 50,
  label = "lineItems",
} = {}) {
  if (!node?.id || !node.lineItems) return node;
  let hasNext = Boolean(node.lineItems.pageInfo?.hasNextPage);
  let cursor = node.lineItems.pageInfo?.endCursor || null;
  const all = [...(node.lineItems.nodes || [])];
  if (!hasNext) {
    node.lineItems = {
      pageInfo: { hasNextPage: false, endCursor: cursor },
      nodes: all,
    };
    return node;
  }

  const queryFile = path.join(
    QUERY_DIR,
    kind === "draft" ? "16-draft-line-items-page.graphql" : "15-order-line-items-page.graphql",
  );
  const rootKey = kind === "draft" ? "draftOrder" : "order";
  let page = 1;
  while (hasNext) {
    page += 1;
    const { data } = await executeQuery({
      queryFile,
      variables: { id: node.id, cursor, first: pageSize },
    });
    const conn = data?.[rootKey]?.lineItems;
    if (!conn) throw new Error(`${label}: missing lineItems for ${node.id}`);
    const pageNodes = conn.nodes || [];
    all.push(...pageNodes);
    hasNext = Boolean(conn.pageInfo?.hasNextPage);
    cursor = conn.pageInfo?.endCursor || null;
    console.error(
      `[${label}] ${node.name || node.id} page ${page}: +${pageNodes.length} (total ${all.length}) hasNext=${hasNext}`,
    );
    if (hasNext && !cursor) throw new Error(`${label}: hasNextPage without endCursor for ${node.id}`);
  }
  node.lineItems = {
    pageInfo: { hasNextPage: false, endCursor: cursor },
    nodes: all,
  };
  return node;
}

/** Fail hard if any completed record still has nested lineItems truncation. */
export function assertNoTruncatedLineItems(records, { label = "records" } = {}) {
  const bad = [];
  for (const rec of records) {
    if (rec?.lineItems?.pageInfo?.hasNextPage) {
      bad.push(rec.id || rec.name || "unknown");
    }
  }
  if (bad.length) {
    throw new Error(
      `${label}: ${bad.length} record(s) still have lineItems.pageInfo.hasNextPage=true (e.g. ${bad.slice(0, 5).join(", ")}). Nested pagination incomplete.`,
    );
  }
}

async function expandNamedConnection(root, {
  queryFile,
  rootKey,
  connKey,
  pageSize = 50,
  label = "connection",
}) {
  if (!root?.id || !root[connKey]) return root;
  let hasNext = Boolean(root[connKey].pageInfo?.hasNextPage);
  let cursor = root[connKey].pageInfo?.endCursor || null;
  const all = [...(root[connKey].nodes || [])];
  while (hasNext) {
    const { data } = await executeQuery({
      queryFile,
      variables: { id: root.id, cursor, first: pageSize },
    });
    const conn = data?.[rootKey]?.[connKey] || data?.[rootKey]?.lineItems || data?.[rootKey]?.events;
    if (!conn) throw new Error(`${label}: missing connection for ${root.id}`);
    const pageNodes = conn.nodes || [];
    all.push(...pageNodes);
    hasNext = Boolean(conn.pageInfo?.hasNextPage);
    cursor = conn.pageInfo?.endCursor || null;
    if (hasNext && !cursor) throw new Error(`${label}: hasNext without cursor for ${root.id}`);
  }
  root[connKey] = { pageInfo: { hasNextPage: false, endCursor: cursor }, nodes: all };
  return root;
}

/** Expand order nested connections: events + each fulfillment/refund lineItems. */
export async function expandOrderNestedConnections(order, { label = "order" } = {}) {
  if (!order?.id) return order;
  if (order.events?.pageInfo?.hasNextPage) {
    await expandNamedConnection(order, {
      queryFile: path.join(QUERY_DIR, "19-order-events-page.graphql"),
      rootKey: "order",
      connKey: "events",
      label: `${label}:events`,
    });
  }
  for (const f of order.fulfillments || []) {
    const conn = f.fulfillmentLineItems;
    if (!conn) continue;
    // Normalize alias used by page query (lineItems) vs extract (fulfillmentLineItems)
    if (!conn.pageInfo?.hasNextPage) {
      f.fulfillmentLineItems = {
        pageInfo: { hasNextPage: false, endCursor: conn.pageInfo?.endCursor || null },
        nodes: [...(conn.nodes || [])],
      };
      continue;
    }
    let hasNext = true;
    let cursor = conn.pageInfo?.endCursor || null;
    const all = [...(conn.nodes || [])];
    while (hasNext) {
      const { data } = await executeQuery({
        queryFile: path.join(QUERY_DIR, "17-fulfillment-line-items-page.graphql"),
        variables: { id: f.id, cursor, first: 50 },
      });
      const pageConn = data?.fulfillment?.lineItems;
      if (!pageConn) throw new Error(`${label}:fulfillmentLineItems missing for ${f.id}`);
      all.push(...(pageConn.nodes || []));
      hasNext = Boolean(pageConn.pageInfo?.hasNextPage);
      cursor = pageConn.pageInfo?.endCursor || null;
    }
    f.fulfillmentLineItems = { pageInfo: { hasNextPage: false, endCursor: cursor }, nodes: all };
  }
  for (const r of order.refunds || []) {
    const conn = r.refundLineItems;
    if (!conn) continue;
    if (!conn.pageInfo?.hasNextPage) {
      r.refundLineItems = {
        pageInfo: { hasNextPage: false, endCursor: conn.pageInfo?.endCursor || null },
        nodes: [...(conn.nodes || [])],
      };
      continue;
    }
    let hasNext = true;
    let cursor = conn.pageInfo?.endCursor || null;
    const all = [...(conn.nodes || [])];
    while (hasNext) {
      const { data } = await executeQuery({
        queryFile: path.join(QUERY_DIR, "18-refund-line-items-page.graphql"),
        variables: { id: r.id, cursor, first: 50 },
      });
      const pageConn = data?.refund?.lineItems;
      if (!pageConn) throw new Error(`${label}:refundLineItems missing for ${r.id}`);
      all.push(...(pageConn.nodes || []));
      hasNext = Boolean(pageConn.pageInfo?.hasNextPage);
      cursor = pageConn.pageInfo?.endCursor || null;
    }
    r.refundLineItems = { pageInfo: { hasNextPage: false, endCursor: cursor }, nodes: all };
  }
  return order;
}

export function assertNoTruncatedOrderNested(records, { label = "orders" } = {}) {
  const bad = [];
  for (const rec of records) {
    if (rec?.events?.pageInfo?.hasNextPage) bad.push(`${rec.name || rec.id}:events`);
    for (const f of rec.fulfillments || []) {
      if (f?.fulfillmentLineItems?.pageInfo?.hasNextPage) {
        bad.push(`${rec.name || rec.id}:fulfillmentLineItems`);
      }
    }
    for (const r of rec.refunds || []) {
      if (r?.refundLineItems?.pageInfo?.hasNextPage) {
        bad.push(`${rec.name || rec.id}:refundLineItems`);
      }
    }
  }
  if (bad.length) {
    throw new Error(
      `${label}: ${bad.length} nested truncation(s) remain (e.g. ${bad.slice(0, 5).join(", ")})`,
    );
  }
}

