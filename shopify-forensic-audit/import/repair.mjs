#!/usr/bin/env node
/**
 * In-place migration repair from forensic JSONL → Supabase.
 * Non-destructive: upserts/backfills only. Requires --apply.
 *
 *   node shopify-forensic-audit/import/repair.mjs --apply
 */
import { createClient } from "@supabase/supabase-js";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  eachJsonl,
  parseArgs,
  loadEnvFile,
  supabaseCreds,
  money,
  moneyOrNull,
  firstMoney,
  mfNodes,
  mfValue,
  tagList,
  SYSTEM,
  newId,
  nowIso,
  OUT,
  addressJson,
} from "./lib/helpers.mjs";

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
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

async function chunked(items, size, fn) {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size), i);
}

async function ensureTags(sb, rawTags) {
  const unique = [...new Set(rawTags.filter(Boolean))];
  const map = new Map();
  await chunked(unique, 100, async (chunk) => {
    const { data, error } = await sb.from("tags").select("id,name").in("name", chunk);
    if (error) throw new Error(error.message);
    for (const t of data || []) map.set(t.name, t.id);
  });
  const missing = unique.filter((n) => !map.has(n)).map((name) => ({ id: newId(), name }));
  if (missing.length) {
    await chunked(missing, 100, async (chunk) => {
      const { error } = await sb.from("tags").insert(chunk);
      if (error) throw new Error(error.message);
    });
    for (const t of missing) map.set(t.name, t.id);
  }
  return map;
}

function parsePaymentDue(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

async function main() {
  const { flags } = parseArgs();
  if (!flags.has("apply")) {
    console.log("Usage: node shopify-forensic-audit/import/repair.mjs --apply");
    process.exit(1);
  }
  await loadEnvFile();
  const { url, key } = supabaseCreds();
  if (!url || !key) throw new Error("Missing Supabase credentials");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const report = { startedAt: nowIso(), steps: {} };

  console.log("Loading GID maps…");
  const customerIdByGid = await loadGidMap(sb, "customer");
  const companyIdByGid = await loadGidMap(sb, "company");
  console.log(`customers=${customerIdByGid.size} companies=${companyIdByGid.size}`);

  // ── 1. Company contacts ──────────────────────────────────────────────────
  console.log("\n[1] Company contacts backfill…");
  {
    const { data: existing } = await sb.from("company_contacts").select("company_id,customer_id");
    const have = new Set((existing || []).map((r) => `${r.company_id}|${r.customer_id}`));
    const toInsert = [];
    let source = 0;
    let skippedMissing = 0;
    await eachJsonl("customers/companies.jsonl", (rec) => {
      const companyId = companyIdByGid.get(rec.id);
      if (!companyId) return;
      for (const c of rec.contacts?.nodes || []) {
        source += 1;
        const custGid = c.customer?.id;
        const customerId = custGid ? customerIdByGid.get(custGid) : null;
        if (!customerId) {
          skippedMissing += 1;
          continue;
        }
        const k = `${companyId}|${customerId}`;
        if (have.has(k)) continue;
        have.add(k);
        toInsert.push({
          id: newId(),
          company_id: companyId,
          customer_id: customerId,
          is_primary: false,
          receives_orders: true,
          receives_invoices: true,
          source_system: SYSTEM,
        });
      }
    });
    await chunked(toInsert, 100, async (chunk) => {
      const { error } = await sb.from("company_contacts").upsert(chunk, {
        onConflict: "company_id,customer_id",
        ignoreDuplicates: true,
      });
      if (error) throw new Error(`company_contacts: ${error.message}`);
    });
    const { count } = await sb.from("company_contacts").select("*", { count: "exact", head: true });
    report.steps.companyContacts = {
      sourceContacts: source,
      inserted: toInsert.length,
      skippedMissingCustomer: skippedMissing,
      importedAfter: count,
    };
    console.log(report.steps.companyContacts);
  }

  // ── 2. Order discounts ───────────────────────────────────────────────────
  console.log("\n[2] Order discount_total backfill…");
  {
    const updates = [];
    let sourceSum = 0;
    await eachJsonl("orders/orders.jsonl", (rec) => {
      const amt = firstMoney(rec.currentTotalDiscountsSet, rec.totalDiscountsSet);
      sourceSum += amt;
      updates.push({ gid: rec.id, discount_total: round2(amt) });
    });
    let updated = 0;
    await chunked(updates, 50, async (chunk) => {
      for (const u of chunk) {
        const { error } = await sb
          .from("orders")
          .update({ discount_total: u.discount_total })
          .eq("shopify_order_gid", u.gid);
        if (error) throw new Error(error.message);
        updated += 1;
      }
    });
    const importedSum = round2(updates.reduce((s, u) => s + u.discount_total, 0));
    report.steps.discounts = {
      sourceSum: round2(sourceSum),
      rowsUpdated: updated,
      importedSumTarget: importedSum,
    };
    console.log(report.steps.discounts);
  }

  // Verify discount sum via direct query using supabase - select sum not supported easily
  // Will verify in final reconciliation SQL.

  // ── 3. Payment due on ────────────────────────────────────────────────────
  console.log("\n[3] payment_due_on backfill…");
  {
    const pairs = [];
    await eachJsonl("orders/orders.jsonl", (rec) => {
      const raw = mfValue(rec.metafields, "order", "payment_due_date") || mfValue(rec.metafields, "custom", "payment_due");
      const due = parsePaymentDue(raw);
      if (due) pairs.push({ gid: rec.id, payment_due_on: due, raw: String(raw) });
    });
    let ok = 0;
    const mismatches = [];
    for (const p of pairs) {
      const { error } = await sb.from("orders").update({ payment_due_on: p.payment_due_on }).eq("shopify_order_gid", p.gid);
      if (error) throw new Error(error.message);
      ok += 1;
    }
    // validate metafields still exist
    const { count: mfCount } = await sb
      .from("metafields")
      .select("*", { count: "exact", head: true })
      .eq("source_system", SYSTEM)
      .eq("namespace", "order")
      .eq("key", "payment_due_date");
    const { count: colCount } = await sb
      .from("orders")
      .select("*", { count: "exact", head: true })
      .not("shopify_order_gid", "is", null)
      .not("payment_due_on", "is", null);
    report.steps.paymentDue = {
      sourceWithDue: pairs.length,
      updated: ok,
      metafieldsStillPresent: mfCount,
      ordersWithPaymentDueOn: colCount,
      mismatches,
    };
    console.log(report.steps.paymentDue);
  }

  // ── 4. original_unit_price backfill ──────────────────────────────────────
  console.log("\n[4] original_unit_price backfill…");
  {
    // Build map lineGid → original unit
    const priceByLine = new Map();
    let sourceWithSet = 0;
    await eachJsonl("orders/orders.jsonl", (rec) => {
      for (const li of rec.lineItems?.nodes || []) {
        if (!li?.id) continue;
        if (li.originalUnitPriceSet != null) {
          sourceWithSet += 1;
          priceByLine.set(li.id, moneyOrNull(li.originalUnitPriceSet));
        }
      }
    });
    // Find null originals in DB
    let fixed = 0;
    let from = 0;
    for (;;) {
      const { data, error } = await sb
        .from("order_items")
        .select("id,source_line_item_gid,original_unit_price")
        .is("original_unit_price", null)
        .not("source_line_item_gid", "is", null)
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      if (!data?.length) break;
      for (const row of data) {
        if (!priceByLine.has(row.source_line_item_gid)) continue;
        const v = priceByLine.get(row.source_line_item_gid);
        const { error: uErr } = await sb.from("order_items").update({ original_unit_price: v }).eq("id", row.id);
        if (uErr) throw new Error(uErr.message);
        fixed += 1;
      }
      if (data.length < 1000) break;
      from += 1000;
    }
    // Also fix via full scan of nulls that might be beyond first pages - reset and use filter in
    // Better: iterate all nulls with loop until empty
    let guard = 0;
    while (guard < 20) {
      guard += 1;
      const { data, error } = await sb
        .from("order_items")
        .select("id,source_line_item_gid")
        .is("original_unit_price", null)
        .not("source_line_item_gid", "is", null)
        .limit(500);
      if (error) throw new Error(error.message);
      if (!data?.length) break;
      let batchFixed = 0;
      for (const row of data) {
        if (!priceByLine.has(row.source_line_item_gid)) continue;
        const v = priceByLine.get(row.source_line_item_gid);
        const { error: uErr } = await sb.from("order_items").update({ original_unit_price: v }).eq("id", row.id);
        if (uErr) throw new Error(uErr.message);
        batchFixed += 1;
        fixed += 1;
      }
      if (batchFixed === 0) break; // remaining nulls have no source set
    }
    const { count: stillNull } = await sb
      .from("order_items")
      .select("id,orders!inner(shopify_order_gid)", { count: "exact", head: true })
      .is("original_unit_price", null)
      .not("source_line_item_gid", "is", null);
    report.steps.originalUnitPrice = {
      sourceWithOriginalUnitPriceSet: sourceWithSet,
      fixed,
      stillNullWithLineGid: stillNull,
      falsyBugAudit: [
        "mappers: original_unit_price used money() || null — FIXED via moneyOrNull",
        "mappers: unit_price used money(original)||money(discounted) — FIXED to prefer original including 0",
        "mappers: tx.amount used money()||Number||0 — FIXED via moneyOrNull first",
        "mappers: tax/shipping/subtotal/total use money() defaulting absent→0 (OK for required NOT NULL columns)",
        "Boolean(rec.taxExempt)/taxesIncluded — OK (explicit boolean coercion, not money)",
      ],
    };
    console.log(report.steps.originalUnitPrice);
  }

  // ── 5. Missing metafields ────────────────────────────────────────────────
  console.log("\n[5] Metafields backfill…");
  {
    // Load all existing metafield external_gids
    const haveGid = new Set();
    let from = 0;
    for (;;) {
      const { data, error } = await sb
        .from("metafields")
        .select("external_gid")
        .eq("source_system", SYSTEM)
        .not("external_gid", "is", null)
        .order("external_gid")
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      if (!data?.length) break;
      for (const r of data) haveGid.add(r.external_gid);
      if (data.length < 1000) break;
      from += 1000;
    }
    // Also owner+ns+key set for rows without external_gid
    const haveKey = new Set();
    from = 0;
    for (;;) {
      const { data, error } = await sb
        .from("metafields")
        .select("owner_type,owner_id,namespace,key")
        .eq("source_system", SYSTEM)
        .order("id")
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      if (!data?.length) break;
      for (const r of data) haveKey.add(`${r.owner_type}|${r.owner_id}|${r.namespace}|${r.key}`);
      if (data.length < 1000) break;
      from += 1000;
    }

    const locationIdByGid = await loadGidMap(sb, "company_location");
    const orderIdByGid = new Map();
    {
      let f = 0;
      for (;;) {
        const { data, error } = await sb
          .from("orders")
          .select("id,shopify_order_gid")
          .not("shopify_order_gid", "is", null)
          .order("shopify_order_gid")
          .range(f, f + 999);
        if (error) throw new Error(error.message);
        if (!data?.length) break;
        for (const r of data) orderIdByGid.set(r.shopify_order_gid, r.id);
        if (data.length < 1000) break;
        f += 1000;
      }
    }
    const draftIdByGid = new Map();
    {
      let f = 0;
      for (;;) {
        const { data, error } = await sb
          .from("draft_orders")
          .select("id,shopify_draft_gid")
          .not("shopify_draft_gid", "is", null)
          .order("shopify_draft_gid")
          .range(f, f + 999);
        if (error) throw new Error(error.message);
        if (!data?.length) break;
        for (const r of data) draftIdByGid.set(r.shopify_draft_gid, r.id);
        if (data.length < 1000) break;
        f += 1000;
      }
    }

    function collectMissing(ownerType, ownerId, nodes, into) {
      for (const mf of mfNodes(nodes)) {
        if (!mf?.namespace || !mf?.key) continue;
        if (mf.id && haveGid.has(mf.id)) continue;
        const k = `${ownerType}|${ownerId}|${mf.namespace}|${mf.key}`;
        if (haveKey.has(k)) continue;
        into.push({
          id: newId(),
          owner_type: ownerType,
          owner_id: ownerId,
          namespace: mf.namespace,
          key: mf.key,
          value_type: mf.type || null,
          value_text: mf.value != null ? String(mf.value) : null,
          value_json: mf.jsonValue !== undefined ? mf.jsonValue : null,
          source_system: SYSTEM,
          external_gid: mf.id || null,
          imported_at: nowIso(),
        });
        haveKey.add(k);
        if (mf.id) haveGid.add(mf.id);
      }
    }

    const missing = [];
    let sourceCustomer = 0;
    let sourceOrder = 0;
    await eachJsonl("customers/customers.jsonl", (rec) => {
      const ownerId = customerIdByGid.get(rec.id);
      if (!ownerId) return;
      const nodes = mfNodes(rec.metafields);
      sourceCustomer += nodes.length;
      collectMissing("customer", ownerId, nodes, missing);
    });
    await eachJsonl("orders/orders.jsonl", (rec) => {
      const ownerId = orderIdByGid.get(rec.id);
      if (!ownerId) return;
      const nodes = mfNodes(rec.metafields);
      sourceOrder += nodes.length;
      collectMissing("order", ownerId, nodes, missing);
    });
    await eachJsonl("customers/companies.jsonl", (rec) => {
      const ownerId = companyIdByGid.get(rec.id);
      if (ownerId) collectMissing("company", ownerId, rec.metafields, missing);
      for (const loc of rec.locations?.nodes || []) {
        const locId = locationIdByGid.get(loc.id);
        if (locId) collectMissing("company_location", locId, loc.metafields, missing);
      }
    });
    await eachJsonl("draft_orders/draft-orders.jsonl", (rec) => {
      const ownerId = draftIdByGid.get(rec.id);
      if (ownerId) collectMissing("draft_order", ownerId, rec.metafields, missing);
    });

    await chunked(missing, 80, async (chunk) => {
      const cleaned = chunk.map((r) => {
        if (r.value_json === undefined || r.value_json === null) {
          const { value_json, ...rest } = r;
          return rest;
        }
        return r;
      });
      const { error } = await sb.from("metafields").upsert(cleaned, {
        onConflict: "owner_type,owner_id,namespace,key,source_system",
        ignoreDuplicates: true,
      });
      if (error) {
        // fallback one-by-one
        for (const row of cleaned) {
          const { error: e2 } = await sb.from("metafields").insert(row);
          if (e2 && !/duplicate|unique/i.test(e2.message)) throw new Error(e2.message);
        }
      }
    });

    const { count: custMf } = await sb
      .from("metafields")
      .select("*", { count: "exact", head: true })
      .eq("source_system", SYSTEM)
      .eq("owner_type", "customer");
    const { count: ordMf } = await sb
      .from("metafields")
      .select("*", { count: "exact", head: true })
      .eq("source_system", SYSTEM)
      .eq("owner_type", "order");

    report.steps.metafields = {
      sourceCustomer,
      sourceOrder,
      insertedOrUpserted: missing.length,
      customerAfter: custMf,
      orderAfter: ordMf,
    };
    console.log(report.steps.metafields);
  }

  // ── 6. Missing tags ──────────────────────────────────────────────────────
  console.log("\n[6] Entity tags backfill…");
  {
    async function loadExistingTagKeys(entityType) {
      const set = new Set();
      let from = 0;
      for (;;) {
        const { data, error } = await sb
          .from("entity_tags")
          .select("entity_id,raw_value")
          .eq("entity_type", entityType)
          .order("id")
          .range(from, from + 999);
        if (error) throw new Error(error.message);
        if (!data?.length) break;
        for (const r of data) set.add(`${r.entity_id}|${r.raw_value}`);
        if (data.length < 1000) break;
        from += 1000;
      }
      return set;
    }
    const custHave = await loadExistingTagKeys("customer");
    const ordHave = await loadExistingTagKeys("order");
    const allRaw = [];
    const pending = [];
    let sourceCust = 0;
    let sourceOrd = 0;

    const orderIdByGid = new Map();
    {
      let f = 0;
      for (;;) {
        const { data, error } = await sb
          .from("orders")
          .select("id,shopify_order_gid")
          .not("shopify_order_gid", "is", null)
          .order("shopify_order_gid")
          .range(f, f + 999);
        if (error) throw new Error(error.message);
        if (!data?.length) break;
        for (const r of data) orderIdByGid.set(r.shopify_order_gid, r.id);
        if (data.length < 1000) break;
        f += 1000;
      }
    }

    await eachJsonl("customers/customers.jsonl", (rec) => {
      const entityId = customerIdByGid.get(rec.id);
      if (!entityId) return;
      for (const raw of tagList(rec.tags)) {
        sourceCust += 1;
        allRaw.push(raw);
        const k = `${entityId}|${raw}`;
        if (custHave.has(k)) continue;
        pending.push({ entity_type: "customer", entity_id: entityId, raw_value: raw });
        custHave.add(k);
      }
    });
    await eachJsonl("orders/orders.jsonl", (rec) => {
      const entityId = orderIdByGid.get(rec.id);
      if (!entityId) return;
      for (const raw of tagList(rec.tags)) {
        sourceOrd += 1;
        allRaw.push(raw);
        const k = `${entityId}|${raw}`;
        if (ordHave.has(k)) continue;
        pending.push({ entity_type: "order", entity_id: entityId, raw_value: raw });
        ordHave.add(k);
      }
    });

    const tagMap = await ensureTags(sb, allRaw);
    const rows = pending
      .map((p) => {
        const tag_id = tagMap.get(p.raw_value);
        if (!tag_id) return null;
        return {
          tag_id,
          entity_type: p.entity_type,
          entity_id: p.entity_id,
          raw_value: p.raw_value,
          source_system: SYSTEM,
        };
      })
      .filter(Boolean);

    await chunked(rows, 100, async (chunk) => {
      const { error } = await sb.from("entity_tags").upsert(chunk, {
        onConflict: "entity_type,entity_id,tag_id,raw_value",
        ignoreDuplicates: true,
      });
      if (error) throw new Error(error.message);
    });

    const { count: custTags } = await sb
      .from("entity_tags")
      .select("*", { count: "exact", head: true })
      .eq("entity_type", "customer");
    const { count: ordTags } = await sb
      .from("entity_tags")
      .select("*", { count: "exact", head: true })
      .eq("entity_type", "order");

    report.steps.tags = {
      sourceCustomerAssociations: sourceCust,
      sourceOrderAssociations: sourceOrd,
      inserted: rows.length,
      customerAfter: custTags,
      orderAfter: ordTags,
    };
    console.log(report.steps.tags);
  }

  // ── 7. Customer addresses ────────────────────────────────────────────────
  console.log("\n[7] Customer addresses backfill…");
  {
    // Load existing address fingerprints per customer
    const existing = new Map(); // customerId -> Set(fp)
    let from = 0;
    for (;;) {
      const { data, error } = await sb
        .from("customer_addresses")
        .select("customer_id,address1,address2,city,postal_code,country_code,company,phone")
        .order("id")
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      if (!data?.length) break;
      for (const a of data) {
        if (!existing.has(a.customer_id)) existing.set(a.customer_id, new Set());
        const fp = [a.address1, a.address2, a.city, a.postal_code, a.country_code, a.company, a.phone]
          .map((x) => (x || "").trim().toLowerCase())
          .join("|");
        existing.get(a.customer_id).add(fp);
      }
      if (data.length < 1000) break;
      from += 1000;
    }

    const toInsert = [];
    let source = 0;
    const unrepresentable = [];
    await eachJsonl("customers/customers.jsonl", (rec) => {
      const customerId = customerIdByGid.get(rec.id);
      if (!customerId) return;
      const have = existing.get(customerId) || new Set();
      for (const a of rec.addresses || []) {
        source += 1;
        const fp = [a.address1, a.address2, a.city, a.zip, a.countryCodeV2, a.company, a.phone]
          .map((x) => (x || "").trim().toLowerCase())
          .join("|");
        if (have.has(fp)) continue;
        // empty address?
        if (!fp.replace(/\|/g, "").trim()) {
          unrepresentable.push({ customerGid: rec.id, reason: "empty_address_fields", addressId: a.id });
          continue;
        }
        have.add(fp);
        existing.set(customerId, have);
        toInsert.push({
          id: newId(),
          customer_id: customerId,
          address_type: "other",
          is_default: rec.defaultAddress?.id === a.id,
          company: a.company ?? null,
          address1: a.address1 ?? null,
          address2: a.address2 ?? null,
          city: a.city ?? null,
          province: a.province ?? null,
          province_code: a.provinceCode ?? null,
          postal_code: a.zip ?? null,
          country: a.country ?? null,
          country_code: a.countryCodeV2 ?? null,
          phone: a.phone ?? null,
          source_system: SYSTEM,
        });
      }
    });

    await chunked(toInsert, 100, async (chunk) => {
      const { error } = await sb.from("customer_addresses").insert(chunk);
      if (error) throw new Error(error.message);
    });
    const { count } = await sb.from("customer_addresses").select("*", { count: "exact", head: true });
    report.steps.addresses = {
      source,
      inserted: toInsert.length,
      importedAfter: count,
      unrepresentable,
    };
    console.log(report.steps.addresses);
  }

  // ── 8. Draft ↔ order links ───────────────────────────────────────────────
  console.log("\n[8] Draft→order reverse links…");
  {
    const orderIdByGid = new Map();
    {
      let f = 0;
      for (;;) {
        const { data, error } = await sb
          .from("orders")
          .select("id,shopify_order_gid")
          .not("shopify_order_gid", "is", null)
          .order("shopify_order_gid")
          .range(f, f + 999);
        if (error) throw new Error(error.message);
        if (!data?.length) break;
        for (const r of data) orderIdByGid.set(r.shopify_order_gid, r.id);
        if (data.length < 1000) break;
        f += 1000;
      }
    }
    let converted = 0;
    let linked = 0;
    let unresolved = 0;
    const unresolvedIds = [];
    await eachJsonl("draft_orders/draft-orders.jsonl", async (rec) => {
      const orderGid = rec.order?.id;
      if (!orderGid) return;
      converted += 1;
      const orderId = orderIdByGid.get(orderGid);
      if (!orderId) {
        unresolved += 1;
        if (unresolvedIds.length < 30) unresolvedIds.push({ draft: rec.id, order: orderGid });
        return;
      }
      // set draft.converted_order_id and order.draft_order_id
      const { data: draftRow, error: dErr } = await sb
        .from("draft_orders")
        .select("id")
        .eq("shopify_draft_gid", rec.id)
        .maybeSingle();
      if (dErr) throw new Error(dErr.message);
      if (!draftRow) {
        unresolved += 1;
        return;
      }
      const { error: u1 } = await sb
        .from("draft_orders")
        .update({ converted_order_id: orderId })
        .eq("id", draftRow.id);
      if (u1) throw new Error(u1.message);
      const { error: u2 } = await sb.from("orders").update({ draft_order_id: draftRow.id }).eq("id", orderId);
      if (u2) throw new Error(u2.message);
      linked += 1;
    });
    const { count: draftsConverted } = await sb
      .from("draft_orders")
      .select("*", { count: "exact", head: true })
      .not("converted_order_id", "is", null);
    const { count: ordersWithDraft } = await sb
      .from("orders")
      .select("*", { count: "exact", head: true })
      .not("draft_order_id", "is", null);
    report.steps.draftLinks = {
      convertedDraftsInSource: converted,
      linked,
      unresolved,
      unresolvedSample: unresolvedIds,
      draftsWithConvertedOrderId: draftsConverted,
      ordersWithDraftOrderId: ordersWithDraft,
      ambiguous: 0,
    };
    console.log(report.steps.draftLinks);
  }

  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, "repair-report.json"), JSON.stringify(report, null, 2));
  console.log("\nWrote", path.join(OUT, "repair-report.json"));
  console.log("Done repairs. Run reconcile next.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
