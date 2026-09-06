#!/usr/bin/env node
/**
 * Shopify forensic JSONL → UD Supabase importer.
 *
 * Default: refuse to write (prints help). Requires --apply.
 *
 * Usage:
 *   node import/run.mjs --apply --phase staff
 *   node import/run.mjs --apply --phase customers
 *   node import/run.mjs --apply --phase companies
 *   node import/run.mjs --apply --phase orders [--limit 100] [--offset 0]
 *   node import/run.mjs --apply --phase drafts
 *   node import/run.mjs --apply --phase abandoned
 *   node import/run.mjs --apply --phase all [--limit 100]
 *
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY
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

const BATCH = 100;

async function upsertBatch(sb, table, rows, onConflict) {
  if (!rows.length) return { inserted: 0 };
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const q = sb.from(table).upsert(chunk, onConflict ? { onConflict, ignoreDuplicates: false } : undefined);
    const { error } = await q;
    if (error) throw new Error(`${table} upsert: ${error.message}`);
    inserted += chunk.length;
  }
  return { inserted };
}

async function ensureTags(sb, tagCache, rawTags) {
  const tagIds = [];
  for (const raw of rawTags) {
    if (tagCache.has(raw)) {
      tagIds.push({ tag_id: tagCache.get(raw), raw_value: raw });
      continue;
    }
    const { data, error } = await sb.from("tags").upsert({ name: raw }, { onConflict: "name" }).select("id,name").single();
    if (error) {
      // unique on name — fetch existing
      const { data: existing, error: e2 } = await sb.from("tags").select("id,name").eq("name", raw).maybeSingle();
      if (e2 || !existing) throw new Error(`tags: ${error.message}`);
      tagCache.set(raw, existing.id);
      tagIds.push({ tag_id: existing.id, raw_value: raw });
    } else {
      tagCache.set(data.name, data.id);
      tagIds.push({ tag_id: data.id, raw_value: raw });
    }
  }
  return tagIds;
}

async function linkEntityTags(sb, entityType, entityId, links, source = SYSTEM) {
  if (!links.length) return;
  const rows = links.map((l) => ({
    tag_id: l.tag_id,
    entity_type: entityType,
    entity_id: entityId,
    raw_value: l.raw_value,
    source_system: source,
  }));
  const { error } = await sb.from("entity_tags").upsert(rows, {
    onConflict: "entity_type,entity_id,tag_id,raw_value",
    ignoreDuplicates: true,
  });
  if (error) throw new Error(`entity_tags: ${error.message}`);
}

async function upsertMetafields(sb, rows) {
  if (!rows.length) return;
  // Strip null json that may confuse; keep value_text
  const cleaned = rows.map((r) => {
    const { value_json, ...rest } = r;
    if (value_json === undefined || value_json === null) return rest;
    return { ...rest, value_json };
  });
  const { error } = await sb.from("metafields").upsert(cleaned, {
    onConflict: "owner_type,owner_id,namespace,key,source_system",
  });
  if (error) throw new Error(`metafields: ${error.message}`);
}

async function resolveRef(sb, entityType, gid) {
  const { data, error } = await sb
    .from("external_system_refs")
    .select("entity_id")
    .eq("system", SYSTEM)
    .eq("entity_type", entityType)
    .eq("external_gid", gid)
    .maybeSingle();
  if (error) throw new Error(`resolveRef ${entityType}: ${error.message}`);
  return data?.entity_id || null;
}

async function upsertRef(sb, ref) {
  const { error } = await sb.from("external_system_refs").upsert(ref, {
    onConflict: "entity_type,entity_id,system",
  });
  if (error) {
    // Fallback: try by gid uniqueness
    const { error: e2 } = await sb.from("external_system_refs").upsert(ref);
    if (e2) throw new Error(`external_system_refs: ${error.message} / ${e2.message}`);
  }
}

async function discoverStaffNames() {
  const staffNames = new Set();
  await eachJsonl("customers/customers.jsonl", (rec) => collectStaffNamesFromCustomer(rec, staffNames));
  await eachJsonl("customers/companies.jsonl", (rec) => collectStaffNamesFromCompany(rec, staffNames));
  await eachJsonl("orders/orders.jsonl", (rec) => collectStaffNamesFromOrder(rec, staffNames));
  await eachJsonl("draft_orders/draft-orders.jsonl", (rec) => collectStaffNamesFromOrder(rec, staffNames));
  return [...staffNames].sort((a, b) => a.localeCompare(b));
}

async function phaseStaff(sb) {
  const names = await discoverStaffNames();
  const rows = names.map((name) => ({
    name,
    staff_type: "sales",
    active: true,
    source_system: SYSTEM,
  }));
  // Idempotent by lower(name): fetch existing then insert missing
  const { data: existing, error } = await sb.from("staff_members").select("id,name");
  if (error) throw new Error(error.message);
  const have = new Set((existing || []).map((r) => r.name.toLowerCase()));
  const toInsert = rows.filter((r) => !have.has(r.name.toLowerCase()));
  if (toInsert.length) {
    const { error: e2 } = await sb.from("staff_members").insert(toInsert);
    if (e2) throw new Error(e2.message);
  }
  const { data: all } = await sb.from("staff_members").select("id,name");
  const map = new Map();
  for (const r of all || []) map.set(r.name.toLowerCase(), r);
  console.log(`staff: ${all?.length || 0} total (${toInsert.length} inserted)`);
  return map;
}

async function loadStaffMap(sb) {
  const { data, error } = await sb.from("staff_members").select("id,name");
  if (error) throw new Error(error.message);
  const map = new Map();
  for (const r of data || []) map.set(r.name.toLowerCase(), r);
  return map;
}

async function loadGidMap(sb, entityType) {
  const map = new Map();
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await sb
      .from("external_system_refs")
      .select("external_gid,entity_id")
      .eq("system", SYSTEM)
      .eq("entity_type", entityType)
      .not("external_gid", "is", null)
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const r of data) map.set(r.external_gid, r.entity_id);
    if (data.length < page) break;
    from += page;
  }
  return map;
}

async function phaseCustomers(sb, staffByName) {
  const tagCache = new Map();
  let inserted = 0;
  let skipped = 0;
  await eachJsonl("customers/customers.jsonl", async (rec) => {
    const existingId = await resolveRef(sb, "customer", rec.id);
    if (existingId) {
      skipped += 1;
      return;
    }
    const mapped = mapCustomer(rec, staffByName);
    const { error } = await sb.from("customers").insert(mapped.customer);
    if (error) throw new Error(`customers insert: ${error.message}`);
    await upsertRef(sb, mapped.ref);
    if (mapped.addresses.length) {
      const { error: aErr } = await sb.from("customer_addresses").insert(mapped.addresses);
      if (aErr) throw new Error(`customer_addresses: ${aErr.message}`);
    }
    const links = await ensureTags(sb, tagCache, mapped.tags);
    await linkEntityTags(sb, "customer", mapped.customer.id, links);
    await upsertMetafields(sb, mapMetafieldRows("customer", mapped.customer.id, mapped.metafields));
    inserted += 1;
    if (inserted % 200 === 0) console.log(`  customers inserted ${inserted}…`);
  });
  console.log(`customers: inserted=${inserted} skipped_existing=${skipped}`);
}

async function phaseCompanies(sb, staffByName) {
  const tagCache = new Map();
  const customerIdByGid = await loadGidMap(sb, "customer");
  let inserted = 0;
  let skipped = 0;
  await eachJsonl("customers/companies.jsonl", async (rec) => {
    const existingId = await resolveRef(sb, "company", rec.id);
    if (existingId) {
      skipped += 1;
      return;
    }
    const mapped = mapCompany(rec, staffByName, customerIdByGid);
    const { error } = await sb.from("companies").insert(mapped.company);
    if (error) throw new Error(`companies: ${error.message}`);
    await upsertRef(sb, mapped.ref);
    for (const loc of mapped.locations) {
      const { error: lErr } = await sb.from("company_locations").insert(loc.location);
      if (lErr) throw new Error(`company_locations: ${lErr.message}`);
      await upsertRef(sb, loc.ref);
      await upsertMetafields(sb, mapMetafieldRows("company_location", loc.location.id, loc.metafields));
    }
    if (mapped.contacts.length) {
      const contacts = mapped.contacts.map(({ shopify_contact_gid, ...rest }) => rest);
      const { error: cErr } = await sb.from("company_contacts").upsert(contacts, {
        onConflict: "company_id,customer_id",
        ignoreDuplicates: true,
      });
      if (cErr) throw new Error(`company_contacts: ${cErr.message}`);
    }
    const links = await ensureTags(sb, tagCache, mapped.tags);
    await linkEntityTags(sb, "company", mapped.company.id, links);
    await upsertMetafields(sb, mapMetafieldRows("company", mapped.company.id, mapped.metafields));
    inserted += 1;
    if (inserted % 200 === 0) console.log(`  companies inserted ${inserted}…`);
  });
  console.log(`companies: inserted=${inserted} skipped_existing=${skipped}`);
}

async function phaseOrders(sb, staffByName, { limit = Infinity, offset = 0 } = {}) {
  const tagCache = new Map();
  const customerIdByGid = await loadGidMap(sb, "customer");
  const companyIdByGid = await loadGidMap(sb, "company");
  const locationIdByGid = await loadGidMap(sb, "company_location");
  const ctx = { staffByName, customerIdByGid, companyIdByGid, locationIdByGid };
  let inserted = 0;
  let skipped = 0;
  let seen = 0;

  await eachJsonl("orders/orders.jsonl", async (rec) => {
    seen += 1;
    if (seen <= offset) return;
    if (inserted + skipped >= limit) return;

    const { data: existing } = await sb
      .from("orders")
      .select("id")
      .eq("shopify_order_gid", rec.id)
      .maybeSingle();
    if (existing?.id) {
      skipped += 1;
      return;
    }

    const mapped = mapOrder(rec, ctx);
    const { error } = await sb.from("orders").insert(mapped.order);
    if (error) throw new Error(`orders insert ${rec.name}: ${error.message}`);
    await upsertRef(sb, mapped.ref);

    if (mapped.items.length) {
      const { error: iErr } = await sb.from("order_items").insert(mapped.items);
      if (iErr) throw new Error(`order_items: ${iErr.message}`);
    }
    if (mapped.transactions.length) {
      const { error: tErr } = await sb.from("payment_transactions").upsert(mapped.transactions, {
        onConflict: "source_system,external_gid",
        ignoreDuplicates: true,
      });
      if (tErr) throw new Error(`payment_transactions: ${tErr.message}`);
    }
    if (mapped.refunds.length) {
      const { error: rErr } = await sb.from("refunds").upsert(mapped.refunds, {
        onConflict: "source_system,external_gid",
        ignoreDuplicates: true,
      });
      if (rErr) throw new Error(`refunds: ${rErr.message}`);
    }
    if (mapped.shippingLines.length) {
      const { error: sErr } = await sb.from("order_shipping_lines").insert(mapped.shippingLines);
      if (sErr) throw new Error(`order_shipping_lines: ${sErr.message}`);
    }
    if (mapped.taxLines.length) {
      const { error: xErr } = await sb.from("order_tax_lines").insert(mapped.taxLines);
      if (xErr) throw new Error(`order_tax_lines: ${xErr.message}`);
    }

    // Build line gid → order_item id for fulfillment lines
    const { data: itemRows } = await sb
      .from("order_items")
      .select("id,source_line_item_gid")
      .eq("order_id", mapped.order.id);
    const itemByLineGid = new Map((itemRows || []).map((r) => [r.source_line_item_gid, r.id]));

    for (const f of mapped.fulfillments) {
      const { error: fErr } = await sb.from("fulfillments").upsert(f.fulfillment, {
        onConflict: "source_system,external_gid",
        ignoreDuplicates: true,
      });
      if (fErr) throw new Error(`fulfillments: ${fErr.message}`);
      const lines = f.lines.map((ln) => ({
        id: ln.id,
        fulfillment_id: f.fulfillment.id,
        order_item_id: ln.line_item_gid ? itemByLineGid.get(ln.line_item_gid) ?? null : null,
        quantity: ln.quantity,
        sku_snapshot: ln.sku_snapshot,
        name_snapshot: ln.name_snapshot,
        source_system: ln.source_system,
        external_gid: ln.external_gid,
      }));
      if (lines.length) {
        const { error: flErr } = await sb.from("fulfillment_line_items").insert(lines);
        if (flErr) throw new Error(`fulfillment_line_items: ${flErr.message}`);
      }
    }

    if (mapped.events.length) {
      const { error: eErr } = await sb.from("order_events").upsert(mapped.events, {
        onConflict: "source_system,external_event_id",
        ignoreDuplicates: true,
      });
      if (eErr) throw new Error(`order_events: ${eErr.message}`);
    }
    if (mapped.comments.length) {
      const { error: cErr } = await sb.from("order_comments").upsert(mapped.comments, {
        onConflict: "source_system,external_event_id",
        ignoreDuplicates: true,
      });
      if (cErr) throw new Error(`order_comments: ${cErr.message}`);
    }

    const links = await ensureTags(sb, tagCache, mapped.tags);
    await linkEntityTags(sb, "order", mapped.order.id, links);
    await upsertMetafields(sb, mapMetafieldRows("order", mapped.order.id, mapped.metafields));

    // Mirror CMS summary tracking from first fulfillment
    const firstF = mapped.fulfillments[0]?.fulfillment;
    if (firstF?.tracking_number) {
      await sb
        .from("orders")
        .update({
          tracking_number: firstF.tracking_number,
          carrier: firstF.tracking_company,
          shipped_at: firstF.source_created_at,
          primary_fulfillment_id: firstF.id,
        })
        .eq("id", mapped.order.id);
    }

    inserted += 1;
    if (inserted % 50 === 0) console.log(`  orders inserted ${inserted} (skipped ${skipped})…`);
  });

  console.log(`orders: inserted=${inserted} skipped_existing=${skipped}`);
}

async function phaseDrafts(sb, staffByName) {
  const tagCache = new Map();
  const customerIdByGid = await loadGidMap(sb, "customer");
  const companyIdByGid = await loadGidMap(sb, "company");
  const locationIdByGid = await loadGidMap(sb, "company_location");
  // Orders by shopify gid
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
  let inserted = 0;
  let skipped = 0;
  await eachJsonl("draft_orders/draft-orders.jsonl", async (rec) => {
    const { data: existing } = await sb
      .from("draft_orders")
      .select("id")
      .eq("shopify_draft_gid", rec.id)
      .maybeSingle();
    if (existing?.id) {
      skipped += 1;
      return;
    }
    const mapped = mapDraft(rec, ctx);
    const { error } = await sb.from("draft_orders").insert(mapped.draft);
    if (error) throw new Error(`draft_orders: ${error.message}`);
    if (mapped.lines.length) {
      const { error: lErr } = await sb.from("draft_order_line_items").insert(mapped.lines);
      if (lErr) throw new Error(`draft_order_line_items: ${lErr.message}`);
    }
    const links = await ensureTags(sb, tagCache, mapped.tags);
    await linkEntityTags(sb, "draft_order", mapped.draft.id, links);
    await upsertMetafields(sb, mapMetafieldRows("draft_order", mapped.draft.id, mapped.metafields));
    inserted += 1;
    if (inserted % 100 === 0) console.log(`  drafts inserted ${inserted}…`);
  });
  console.log(`drafts: inserted=${inserted} skipped_existing=${skipped}`);
}

async function phaseAbandoned(sb) {
  const customerIdByGid = await loadGidMap(sb, "customer");
  let inserted = 0;
  let skipped = 0;
  await eachJsonl("abandoned_checkouts/abandoned-checkouts.jsonl", async (rec) => {
    const { data: existing } = await sb
      .from("abandoned_checkouts")
      .select("id")
      .eq("shopify_checkout_gid", rec.id)
      .maybeSingle();
    if (existing?.id) {
      skipped += 1;
      return;
    }
    const row = mapAbandoned(rec, customerIdByGid);
    const { error } = await sb.from("abandoned_checkouts").insert(row);
    if (error) throw new Error(`abandoned_checkouts: ${error.message}`);
    inserted += 1;
  });
  console.log(`abandoned: inserted=${inserted} skipped_existing=${skipped}`);
}

function printHelp() {
  console.log(`Shopify → UD importer

Dry-run (no DB):
  node shopify-forensic-audit/import/plan.mjs

Apply (requires service role + migrations 036–048):
  node shopify-forensic-audit/import/run.mjs --apply --phase <staff|customers|companies|orders|drafts|abandoned|all>

Options:
  --limit N     Cap orders processed (with --phase orders|all)
  --offset N    Skip first N unique orders

Safety:
  - Default without --apply exits without writing
  - Products are never imported into catalog
  - Idempotent on Shopify GIDs / external_system_refs`);
}

async function main() {
  const { flags, opts } = parseArgs();
  if (!flags.has("apply")) {
    printHelp();
    process.exit(flags.has("help") || flags.has("h") ? 0 : 1);
  }

  await loadEnvFile();
  const { url, key } = supabaseCreds();
  if (!url || !key) {
    console.error("Missing SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const phase = opts.phase || "all";
  const limit = opts.limit ? Number(opts.limit) : Infinity;
  const offset = opts.offset ? Number(opts.offset) : 0;

  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Import APPLY mode — phase=${phase} limit=${Number.isFinite(limit) ? limit : "∞"} offset=${offset}`);
  console.log(`Target: ${url}`);

  let staffByName = await loadStaffMap(sb);
  if (phase === "staff" || phase === "all") {
    staffByName = await phaseStaff(sb);
  }
  if (phase === "customers" || phase === "all") {
    if (!staffByName.size) staffByName = await loadStaffMap(sb);
    await phaseCustomers(sb, staffByName);
  }
  if (phase === "companies" || phase === "all") {
    if (!staffByName.size) staffByName = await loadStaffMap(sb);
    await phaseCompanies(sb, staffByName);
  }
  if (phase === "orders" || phase === "all") {
    if (!staffByName.size) staffByName = await loadStaffMap(sb);
    await phaseOrders(sb, staffByName, { limit, offset });
  }
  if (phase === "drafts" || phase === "all") {
    if (!staffByName.size) staffByName = await loadStaffMap(sb);
    await phaseDrafts(sb, staffByName);
  }
  if (phase === "abandoned" || phase === "all") {
    await phaseAbandoned(sb);
  }

  const summary = {
    finishedAt: nowIso(),
    phase,
    limit: Number.isFinite(limit) ? limit : null,
    offset,
    target: url,
  };
  await writeJson("last-apply-summary.json", summary);
  console.log("Done.", summary);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
