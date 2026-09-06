#!/usr/bin/env node
/**
 * Fast batched Shopify → UD importer (service role).
 * Idempotent on Shopify GIDs. Default refuses without --apply.
 *
 *   node shopify-forensic-audit/import/run-fast.mjs --apply --phase all
 *   node shopify-forensic-audit/import/run-fast.mjs --apply --phase orders --limit 500
 */
import { createClient } from "@supabase/supabase-js";
import {
  eachJsonl,
  parseArgs,
  loadEnvFile,
  supabaseCreds,
  writeJson,
  SYSTEM,
  nowIso,
  newId,
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
  mapMetafieldRows,
} from "./lib/mappers.mjs";

const BATCH = 80;

function printHelp() {
  console.log(`Fast Shopify → UD importer

  node shopify-forensic-audit/import/run-fast.mjs --apply --phase <staff|customers|companies|company-contacts|orders|drafts|abandoned|all>
  --limit N / --offset N for orders
`);
}

async function chunked(items, size, fn) {
  for (let i = 0; i < items.length; i += size) {
    await fn(items.slice(i, i + size), i);
  }
}

async function insertRows(sb, table, rows) {
  if (!rows.length) return;
  await chunked(rows, BATCH, async (chunk) => {
    let lastErr;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const { error } = await sb.from(table).insert(chunk);
      if (!error) return;
      lastErr = error;
      const msg = error.message || "";
      if (/fetch failed|network|timeout|502|503|504/i.test(msg) || error instanceof TypeError) {
        await new Promise((r) => setTimeout(r, 500 * attempt * attempt));
        continue;
      }
      throw new Error(`${table}: ${msg}`);
    }
    throw new Error(`${table}: ${lastErr?.message || "insert failed"}`);
  });
}

async function upsertRows(sb, table, rows, onConflict) {
  if (!rows.length) return;
  await chunked(rows, BATCH, async (chunk) => {
    const { error } = await sb.from(table).upsert(chunk, {
      onConflict,
      ignoreDuplicates: true,
    });
    if (error) throw new Error(`${table} upsert: ${error.message}`);
  });
}

async function loadStaffMap(sb) {
  const { data, error } = await sb.from("staff_members").select("id,name");
  if (error) throw new Error(error.message);
  const map = new Map();
  for (const r of data || []) map.set(r.name.toLowerCase(), r);
  return map;
}

async function loadGidSet(sb, entityType) {
  const set = new Set();
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("external_system_refs")
      .select("external_gid")
      .eq("system", SYSTEM)
      .eq("entity_type", entityType)
      .not("external_gid", "is", null)
      .order("external_gid")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const r of data) set.add(r.external_gid);
    if (data.length < 1000) break;
    from += 1000;
  }
  return set;
}

async function loadGidMap(sb, entityType) {
  const map = new Map();
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("external_system_refs")
      .select("external_gid,entity_id")
      .eq("system", SYSTEM)
      .eq("entity_type", entityType)
      .not("external_gid", "is", null)
      .order("external_gid")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const r of data) map.set(r.external_gid, r.entity_id);
    if (data.length < 1000) break;
    from += 1000;
  }
  return map;
}

async function loadOrderGidSet(sb) {
  const set = new Set();
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("orders")
      .select("shopify_order_gid")
      .not("shopify_order_gid", "is", null)
      .order("shopify_order_gid")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const r of data) set.add(r.shopify_order_gid);
    if (data.length < 1000) break;
    from += 1000;
  }
  return set;
}

/** Ensure tag dictionary entries; return Map raw → id */
async function ensureTagDictionary(sb, rawTags) {
  const unique = [...new Set(rawTags.filter(Boolean))];
  if (!unique.length) return new Map();

  const { data: existing, error } = await sb.from("tags").select("id,name").in("name", unique);
  if (error) throw new Error(`tags select: ${error.message}`);
  const map = new Map((existing || []).map((t) => [t.name, t.id]));
  const missing = unique.filter((n) => !map.has(n)).map((name) => ({ name, id: newId() }));
  if (missing.length) {
    await insertRows(sb, "tags", missing);
    for (const t of missing) map.set(t.name, t.id);
  }
  return map;
}

async function flushEntityTags(sb, entityType, pairs, tagMap) {
  // pairs: [{ entityId, tags: string[] }]
  const rows = [];
  for (const p of pairs) {
    for (const raw of p.tags) {
      const tagId = tagMap.get(raw);
      if (!tagId) continue;
      rows.push({
        tag_id: tagId,
        entity_type: entityType,
        entity_id: p.entityId,
        raw_value: raw,
        source_system: SYSTEM,
      });
    }
  }
  await upsertRows(sb, "entity_tags", rows, "entity_type,entity_id,tag_id,raw_value");
}

async function flushMetafields(sb, rows) {
  if (!rows.length) return;
  const cleaned = rows.map((r) => {
    if (r.value_json === undefined || r.value_json === null) {
      const { value_json, ...rest } = r;
      return rest;
    }
    return r;
  });
  await upsertRows(sb, "metafields", cleaned, "owner_type,owner_id,namespace,key,source_system");
}

async function phaseStaff(sb) {
  const names = new Set();
  await eachJsonl("customers/customers.jsonl", (rec) => collectStaffNamesFromCustomer(rec, names));
  await eachJsonl("customers/companies.jsonl", (rec) => collectStaffNamesFromCompany(rec, names));
  await eachJsonl("orders/orders.jsonl", (rec) => collectStaffNamesFromOrder(rec, names));
  await eachJsonl("draft_orders/draft-orders.jsonl", (rec) => collectStaffNamesFromOrder(rec, names));
  const staffByName = await loadStaffMap(sb);
  const toInsert = [...names]
    .filter((n) => !staffByName.has(n.toLowerCase()))
    .map((name) => ({ name, staff_type: "sales", active: true, source_system: SYSTEM }));
  if (toInsert.length) await insertRows(sb, "staff_members", toInsert);
  const map = await loadStaffMap(sb);
  console.log(`staff: ${map.size} total (${toInsert.length} inserted)`);
  return map;
}

async function insertRefsIgnoreDup(sb, refs) {
  if (!refs.length) return { inserted: 0, conflicted: [] };
  let inserted = 0;
  const conflicted = [];
  for (const ref of refs) {
    const { error } = await sb.from("external_system_refs").insert(ref);
    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        conflicted.push(ref.entity_id);
        continue;
      }
      throw new Error(`external_system_refs: ${error.message}`);
    }
    inserted += 1;
  }
  if (conflicted.length) {
    await sb.from("customer_addresses").delete().in("customer_id", conflicted);
    await sb.from("customers").delete().in("id", conflicted);
  }
  return { inserted, conflicted };
}

async function phaseCustomers(sb, staffByName) {
  const existing = await loadGidSet(sb, "customer");
  console.log(`customers already imported: ${existing.size}`);

  let buffer = [];
  let inserted = 0;
  let skipped = 0;

  const flush = async () => {
    if (!buffer.length) return;
    const gids = buffer.map((b) => b.ref.external_gid).filter(Boolean);
    const have = new Set();
    await chunked(gids, 40, async (chunk) => {
      const { data, error } = await sb
        .from("external_system_refs")
        .select("external_gid")
        .eq("system", SYSTEM)
        .in("external_gid", chunk);
      if (error) throw new Error(error.message);
      for (const r of data || []) have.add(r.external_gid);
    });
    buffer = buffer.filter((b) => !have.has(b.ref.external_gid));
    if (!buffer.length) return;

    const customers = buffer.map((b) => b.customer);
    const refs = buffer.map((b) => b.ref);
    const addresses = buffer.flatMap((b) => b.addresses);
    const allTags = buffer.flatMap((b) => b.tags);
    const tagMap = await ensureTagDictionary(sb, allTags);

    await insertRows(sb, "customers", customers);
    const refResult = await insertRefsIgnoreDup(sb, refs);
    const okIds = new Set(customers.map((c) => c.id).filter((id) => !refResult.conflicted.includes(id)));
    const okAddresses = addresses.filter((a) => okIds.has(a.customer_id));
    const okBuffer = buffer.filter((b) => okIds.has(b.customer.id));
    await insertRows(sb, "customer_addresses", okAddresses);
    const metafields = okBuffer.flatMap((b) => mapMetafieldRows("customer", b.customer.id, b.metafields));
    const tagPairs = okBuffer.map((b) => ({ entityId: b.customer.id, tags: b.tags }));
    await flushEntityTags(sb, "customer", tagPairs, tagMap);
    await flushMetafields(sb, metafields);

    inserted += okBuffer.length;
    skipped += refResult.conflicted.length;
    console.log(`  customers inserted ${inserted} (skipped ${skipped})…`);
    buffer = [];
  };

  await eachJsonl("customers/customers.jsonl", async (rec) => {
    if (existing.has(rec.id)) {
      skipped += 1;
      return;
    }
    buffer.push(mapCustomer(rec, staffByName));
    existing.add(rec.id);
    if (buffer.length >= BATCH) await flush();
  });
  await flush();
  console.log(`customers done: inserted=${inserted} skipped=${skipped}`);
}

async function phaseCompanies(sb, staffByName) {
  const existing = await loadGidSet(sb, "company");
  const customerIdByGid = await loadGidMap(sb, "customer");
  console.log(`companies already imported: ${existing.size}`);

  let buffer = [];
  let inserted = 0;
  let skipped = 0;

  const flush = async () => {
    if (!buffer.length) return;
    const companies = buffer.map((b) => b.company);
    const refs = buffer.map((b) => b.ref);
    const locations = buffer.flatMap((b) => b.locations.map((l) => l.location));
    const locRefs = buffer.flatMap((b) => b.locations.map((l) => l.ref));
    const locMeta = buffer.flatMap((b) =>
      b.locations.flatMap((l) => mapMetafieldRows("company_location", l.location.id, l.metafields)),
    );
    const contacts = buffer.flatMap((b) =>
      b.contacts.map(({ shopify_contact_gid, ...rest }) => rest),
    );
    const allTags = buffer.flatMap((b) => b.tags);
    const tagMap = await ensureTagDictionary(sb, allTags);
    const metafields = buffer.flatMap((b) => mapMetafieldRows("company", b.company.id, b.metafields));
    const tagPairs = buffer.map((b) => ({ entityId: b.company.id, tags: b.tags }));

    await insertRows(sb, "companies", companies);
    await insertRows(sb, "external_system_refs", refs);
    await insertRows(sb, "company_locations", locations);
    await insertRows(sb, "external_system_refs", locRefs);
    if (contacts.length) await upsertRows(sb, "company_contacts", contacts, "company_id,customer_id");
    await flushEntityTags(sb, "company", tagPairs, tagMap);
    await flushMetafields(sb, metafields);
    await flushMetafields(sb, locMeta);

    inserted += buffer.length;
    console.log(`  companies inserted ${inserted} (skipped ${skipped})…`);
    buffer = [];
  };

  await eachJsonl("customers/companies.jsonl", async (rec) => {
    if (existing.has(rec.id)) {
      skipped += 1;
      return;
    }
    buffer.push(mapCompany(rec, staffByName, customerIdByGid));
    existing.add(rec.id);
    if (buffer.length >= BATCH) await flush();
  });
  await flush();
  console.log(`companies done: inserted=${inserted} skipped=${skipped}`);
}

/** Backfill company_contacts after customers + companies exist (avoids race). */
async function phaseCompanyContacts(sb) {
  const companyIdByGid = await loadGidMap(sb, "company");
  const customerIdByGid = await loadGidMap(sb, "customer");
  console.log(`company-contacts: companies=${companyIdByGid.size} customers=${customerIdByGid.size}`);

  const existing = new Set();
  {
    let from = 0;
    for (;;) {
      const { data, error } = await sb
        .from("company_contacts")
        .select("company_id,customer_id")
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      if (!data?.length) break;
      for (const r of data) existing.add(`${r.company_id}|${r.customer_id}`);
      if (data.length < 1000) break;
      from += 1000;
    }
  }

  const rows = [];
  let source = 0;
  let skippedNoCustomer = 0;
  await eachJsonl("customers/companies.jsonl", (rec) => {
    const companyId = companyIdByGid.get(rec.id);
    if (!companyId) return;
    for (const c of rec.contacts?.nodes || []) {
      source += 1;
      const customerId = c.customer?.id ? customerIdByGid.get(c.customer.id) : null;
      if (!customerId) {
        skippedNoCustomer += 1;
        continue;
      }
      const k = `${companyId}|${customerId}`;
      if (existing.has(k)) continue;
      existing.add(k);
      rows.push({
        id: newId(),
        company_id: companyId,
        customer_id: customerId,
        title: null,
        role: null,
        is_primary: false,
        receives_orders: true,
        receives_invoices: true,
        source_system: SYSTEM,
      });
    }
  });
  await upsertRows(sb, "company_contacts", rows, "company_id,customer_id");
  const { count } = await sb.from("company_contacts").select("*", { count: "exact", head: true });
  console.log(
    `company-contacts done: source=${source} inserted=${rows.length} skippedNoCustomer=${skippedNoCustomer} total=${count}`,
  );
}

async function phaseOrders(sb, staffByName, { limit = Infinity, offset = 0 } = {}) {
  const existing = await loadOrderGidSet(sb);
  const customerIdByGid = await loadGidMap(sb, "customer");
  const companyIdByGid = await loadGidMap(sb, "company");
  const locationIdByGid = await loadGidMap(sb, "company_location");
  const ctx = { staffByName, customerIdByGid, companyIdByGid, locationIdByGid };
  console.log(`orders already imported: ${existing.size}`);

  let buffer = [];
  let inserted = 0;
  let skipped = 0;
  let seen = 0;

  const flush = async () => {
    if (!buffer.length) return;
    const liveCustomerIds = new Set(
      (
        await sb
          .from("customers")
          .select("id")
          .in(
            "id",
            [...new Set(buffer.map((b) => b.order.customer_id).filter(Boolean))],
          )
      ).data?.map((r) => r.id) || [],
    );
    const liveCompanyIds = new Set(
      (
        await sb
          .from("companies")
          .select("id")
          .in(
            "id",
            [...new Set(buffer.map((b) => b.order.company_id).filter(Boolean))],
          )
      ).data?.map((r) => r.id) || [],
    );
    const liveLocationIds = new Set(
      (
        await sb
          .from("company_locations")
          .select("id")
          .in(
            "id",
            [...new Set(buffer.map((b) => b.order.company_location_id).filter(Boolean))],
          )
      ).data?.map((r) => r.id) || [],
    );

    for (const b of buffer) {
      if (b.order.customer_id && !liveCustomerIds.has(b.order.customer_id)) b.order.customer_id = null;
      if (b.order.company_id && !liveCompanyIds.has(b.order.company_id)) b.order.company_id = null;
      if (b.order.company_location_id && !liveLocationIds.has(b.order.company_location_id)) {
        b.order.company_location_id = null;
      }
    }

    const orders = buffer.map((b) => b.order);
    const refs = buffer.map((b) => b.ref);
    const items = buffer.flatMap((b) => b.items);
    const txs = buffer.flatMap((b) => b.transactions);
    const refunds = buffer.flatMap((b) => b.refunds);
    const shipping = buffer.flatMap((b) => b.shippingLines);
    const tax = buffer.flatMap((b) => b.taxLines);
    const events = buffer.flatMap((b) => b.events);
    const comments = buffer.flatMap((b) => b.comments);
    const fulfillments = buffer.flatMap((b) => b.fulfillments.map((f) => f.fulfillment));
    const allTags = buffer.flatMap((b) => b.tags);
    const tagMap = await ensureTagDictionary(sb, allTags);
    const metafields = buffer.flatMap((b) => mapMetafieldRows("order", b.order.id, b.metafields));
    const tagPairs = buffer.map((b) => ({ entityId: b.order.id, tags: b.tags }));

    await insertRows(sb, "orders", orders);
    await insertRows(sb, "external_system_refs", refs);
    await insertRows(sb, "order_items", items);
    if (txs.length) {
      // insert; ignore dupes by catching — partial unique may not support upsert onConflict
      try {
        await insertRows(sb, "payment_transactions", txs);
      } catch (e) {
        // fallback one-by-one skip
        for (const tx of txs) {
          const { error } = await sb.from("payment_transactions").insert(tx);
          if (error && !/duplicate|unique/i.test(error.message)) throw error;
        }
      }
    }
    if (refunds.length) {
      try {
        await insertRows(sb, "refunds", refunds);
      } catch {
        for (const rf of refunds) {
          const { error } = await sb.from("refunds").insert(rf);
          if (error && !/duplicate|unique/i.test(error.message)) throw error;
        }
      }
    }
    await insertRows(sb, "order_shipping_lines", shipping);
    await insertRows(sb, "order_tax_lines", tax);
    await insertRows(sb, "fulfillments", fulfillments);

    // fulfillment lines need order_item ids
    const orderIds = orders.map((o) => o.id);
    const { data: itemRows, error: itemErr } = await sb
      .from("order_items")
      .select("id,order_id,source_line_item_gid")
      .in("order_id", orderIds);
    if (itemErr) throw new Error(itemErr.message);
    const itemByLineGid = new Map((itemRows || []).map((r) => [r.source_line_item_gid, r.id]));

    const flines = [];
    for (const b of buffer) {
      for (const f of b.fulfillments) {
        for (const ln of f.lines) {
          flines.push({
            id: ln.id,
            fulfillment_id: f.fulfillment.id,
            order_item_id: ln.line_item_gid ? itemByLineGid.get(ln.line_item_gid) ?? null : null,
            quantity: ln.quantity,
            sku_snapshot: ln.sku_snapshot,
            name_snapshot: ln.name_snapshot,
            source_system: ln.source_system,
            external_gid: ln.external_gid,
          });
        }
      }
    }
    await insertRows(sb, "fulfillment_line_items", flines);

    if (events.length) {
      try {
        await insertRows(sb, "order_events", events);
      } catch {
        for (const ev of events) {
          const { error } = await sb.from("order_events").insert(ev);
          if (error && !/duplicate|unique/i.test(error.message)) throw error;
        }
      }
    }
    if (comments.length) await insertRows(sb, "order_comments", comments);

    await flushEntityTags(sb, "order", tagPairs, tagMap);
    await flushMetafields(sb, metafields);

    inserted += buffer.length;
    console.log(`  orders inserted ${inserted} (skipped ${skipped})…`);
    buffer = [];
  };

  await eachJsonl("orders/orders.jsonl", async (rec) => {
    seen += 1;
    if (seen <= offset) return;
    if (inserted >= limit) return;
    if (existing.has(rec.id)) {
      skipped += 1;
      return;
    }
    buffer.push(mapOrder(rec, ctx));
    existing.add(rec.id);
    if (buffer.length >= Math.min(40, BATCH)) await flush();
  });
  await flush();
  console.log(`orders done: inserted=${inserted} skipped=${skipped}`);
}

async function phaseDrafts(sb, staffByName) {
  const existing = new Set();
  {
    let from = 0;
    for (;;) {
      const { data, error } = await sb
        .from("draft_orders")
        .select("shopify_draft_gid")
        .not("shopify_draft_gid", "is", null)
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      if (!data?.length) break;
      for (const r of data) existing.add(r.shopify_draft_gid);
      if (data.length < 1000) break;
      from += 1000;
    }
  }
  const customerIdByGid = await loadGidMap(sb, "customer");
  const companyIdByGid = await loadGidMap(sb, "company");
  const locationIdByGid = await loadGidMap(sb, "company_location");
  const orderIdByGid = new Map();
  {
    let from = 0;
    for (;;) {
      const { data, error } = await sb
        .from("orders")
        .select("id,shopify_order_gid")
        .not("shopify_order_gid", "is", null)
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      if (!data?.length) break;
      for (const r of data) orderIdByGid.set(r.shopify_order_gid, r.id);
      if (data.length < 1000) break;
      from += 1000;
    }
  }
  const ctx = { staffByName, customerIdByGid, companyIdByGid, locationIdByGid, orderIdByGid };

  let buffer = [];
  let inserted = 0;
  let skipped = 0;

  const flush = async () => {
    if (!buffer.length) return;
    const drafts = buffer.map((b) => b.draft);
    const lines = buffer.flatMap((b) => b.lines);
    const allTags = buffer.flatMap((b) => b.tags);
    const tagMap = await ensureTagDictionary(sb, allTags);
    const metafields = buffer.flatMap((b) => mapMetafieldRows("draft_order", b.draft.id, b.metafields));
    const tagPairs = buffer.map((b) => ({ entityId: b.draft.id, tags: b.tags }));
    await insertRows(sb, "draft_orders", drafts);
    await insertRows(sb, "draft_order_line_items", lines);
    // Reverse link: orders.draft_order_id ↔ draft_orders.converted_order_id
    const orderPatches = buffer
      .filter((b) => b.draft.converted_order_id)
      .map((b) => ({ id: b.draft.converted_order_id, draft_order_id: b.draft.id }));
    await chunked(orderPatches, BATCH, async (chunk) => {
      for (const p of chunk) {
        const { error } = await sb.from("orders").update({ draft_order_id: p.draft_order_id }).eq("id", p.id);
        if (error) throw new Error(`orders.draft_order_id: ${error.message}`);
      }
    });
    await flushEntityTags(sb, "draft_order", tagPairs, tagMap);
    await flushMetafields(sb, metafields);
    inserted += buffer.length;
    console.log(`  drafts inserted ${inserted}…`);
    buffer = [];
  };

  await eachJsonl("draft_orders/draft-orders.jsonl", async (rec) => {
    if (existing.has(rec.id)) {
      skipped += 1;
      return;
    }
    buffer.push(mapDraft(rec, ctx));
    existing.add(rec.id);
    if (buffer.length >= BATCH) await flush();
  });
  await flush();
  console.log(`drafts done: inserted=${inserted} skipped=${skipped}`);
}

async function phaseAbandoned(sb) {
  const existing = new Set();
  {
    const { data } = await sb.from("abandoned_checkouts").select("shopify_checkout_gid");
    for (const r of data || []) if (r.shopify_checkout_gid) existing.add(r.shopify_checkout_gid);
  }
  const customerIdByGid = await loadGidMap(sb, "customer");
  const rows = [];
  let skipped = 0;
  await eachJsonl("abandoned_checkouts/abandoned-checkouts.jsonl", (rec) => {
    if (existing.has(rec.id)) {
      skipped += 1;
      return;
    }
    rows.push(mapAbandoned(rec, customerIdByGid));
  });
  await insertRows(sb, "abandoned_checkouts", rows);
  console.log(`abandoned done: inserted=${rows.length} skipped=${skipped}`);
}

async function main() {
  const { flags, opts } = parseArgs();
  if (!flags.has("apply")) {
    printHelp();
    process.exit(1);
  }
  await loadEnvFile();
  const { url, key } = supabaseCreds();
  if (!url || !key) {
    console.error("Need SUPABASE_URL/VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const phase = opts.phase || "all";
  const limit = opts.limit ? Number(opts.limit) : Infinity;
  const offset = opts.offset ? Number(opts.offset) : 0;
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  console.log(`FAST APPLY phase=${phase} → ${url}`);

  let staffByName = await loadStaffMap(sb);
  if (phase === "staff" || phase === "all") staffByName = await phaseStaff(sb);
  if (phase === "customers" || phase === "all") {
    if (!staffByName.size) staffByName = await loadStaffMap(sb);
    await phaseCustomers(sb, staffByName);
  }
  if (phase === "companies" || phase === "all") {
    if (!staffByName.size) staffByName = await loadStaffMap(sb);
    await phaseCompanies(sb, staffByName);
  }
  // Always backfill contacts after companies when running full import or explicit phase.
  if (phase === "company-contacts" || phase === "companies" || phase === "all") {
    await phaseCompanyContacts(sb);
  }
  if (phase === "orders" || phase === "all") {
    if (!staffByName.size) staffByName = await loadStaffMap(sb);
    await phaseOrders(sb, staffByName, { limit, offset });
  }
  if (phase === "drafts" || phase === "all") {
    if (!staffByName.size) staffByName = await loadStaffMap(sb);
    await phaseDrafts(sb, staffByName);
  }
  if (phase === "abandoned" || phase === "all") await phaseAbandoned(sb);

  await writeJson("last-apply-summary.json", { finishedAt: nowIso(), phase, mode: "fast" });
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
