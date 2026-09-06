#!/usr/bin/env node
/**
 * Fast SQL-oriented repair remaining steps.
 * Assumes company contacts already repaired.
 *   node shopify-forensic-audit/import/repair-fast.mjs --apply
 */
import { createClient } from "@supabase/supabase-js";
import { writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  eachJsonl,
  parseArgs,
  loadEnvFile,
  supabaseCreds,
  moneyOrNull,
  firstMoney,
  mfNodes,
  mfValue,
  tagList,
  SYSTEM,
  newId,
  nowIso,
  OUT,
  ROOT,
} from "./lib/helpers.mjs";

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function sqlStr(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function runSqlFile(filePath) {
  const repoRoot = path.resolve(ROOT, "..");
  const file = path.resolve(filePath);
  // Quote path: Windows `shell:true` splits on spaces otherwise (E:\work …).
  const cmd = `npx supabase db query --linked -f "${file}" -o table`;
  const r = spawnSync(cmd, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    shell: true,
  });
  if (r.status !== 0) {
    console.error(r.stdout || "");
    console.error(r.stderr || "");
    throw new Error(`SQL failed: ${file}`);
  }
  if (r.stdout?.trim()) console.log(r.stdout.trim().slice(0, 200));
  return r.stdout;
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

async function parallelMap(items, concurrency, fn) {
  let i = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const { flags } = parseArgs();
  if (!flags.has("apply")) {
    console.log("Usage: node shopify-forensic-audit/import/repair-fast.mjs --apply");
    process.exit(1);
  }
  await loadEnvFile();
  const { url, key } = supabaseCreds();
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const report = { startedAt: nowIso(), steps: {} };
  // Prefer OS temp (no spaces) so supabase CLI -f never truncates the path.
  const tmp = path.join(os.tmpdir(), "ud-repair");
  await mkdir(tmp, { recursive: true });
  await mkdir(OUT, { recursive: true });

  console.log("Loading maps…");
  const customerIdByGid = await loadGidMap(sb, "customer");
  const companyIdByGid = await loadGidMap(sb, "company");
  const locationIdByGid = await loadGidMap(sb, "company_location");

  // ── Discounts via SQL batches ────────────────────────────────────────────
  console.log("[2] Building discount SQL…");
  {
    const checkFile = path.join(tmp, "check-disc.sql");
    await writeFile(
      checkFile,
      "select round(coalesce(sum(discount_total),0)::numeric,2)::text as s from public.orders;",
    );
    const out = runSqlFile(checkFile) || "";
    const m = out.match(/\b(\d+\.\d{2})\b/);
    const currentSum = m ? Number(m[1]) : null;
    if (currentSum === 519373.41 && !flags.has("force-discounts")) {
      console.log("  discount_total already £519,373.41 — skip");
      report.steps.discounts = { skipped: true, sourceSum: 519373.41 };
    } else {
      const pairs = [];
      let sourceSum = 0;
      await eachJsonl("orders/orders.jsonl", (rec) => {
        const amt = round2(firstMoney(rec.currentTotalDiscountsSet, rec.totalDiscountsSet));
        sourceSum += amt;
        pairs.push([rec.id, amt]);
      });
      let batch = 0;
      for (let i = 0; i < pairs.length; i += 500) {
        batch += 1;
        const chunk = pairs.slice(i, i + 500);
        const values = chunk.map(([gid, amt]) => `(${sqlStr(gid)}::text, ${amt}::numeric)`).join(",\n");
        const sql = `update public.orders o
set discount_total = v.amt
from (values
${values}
) as v(gid, amt)
where o.shopify_order_gid = v.gid;`;
        const file = path.join(tmp, `repair-disc-${batch}.sql`);
        await writeFile(file, sql);
        console.log(`  applying discount batch ${batch}/${Math.ceil(pairs.length / 500)}…`);
        runSqlFile(file);
      }
      report.steps.discounts = { sourceSum: round2(sourceSum), batches: batch };
    }
  }

  // ── Payment due SQL ──────────────────────────────────────────────────────
  console.log("[3] payment_due_on…");
  {
    const { count: dueCount } = await sb
      .from("orders")
      .select("*", { count: "exact", head: true })
      .not("payment_due_on", "is", null);
    if (dueCount >= 61 && !flags.has("force-payment-due")) {
      console.log(`  payment_due_on already ${dueCount} — skip`);
      report.steps.paymentDue = { skipped: true, sourceWithDue: dueCount };
    } else {
      const pairs = [];
      await eachJsonl("orders/orders.jsonl", (rec) => {
        const raw =
          mfValue(rec.metafields, "order", "payment_due_date") ||
          mfValue(rec.metafields, "custom", "payment_due");
        const due = parsePaymentDue(raw);
        if (due) pairs.push([rec.id, due, String(raw)]);
      });
      if (pairs.length) {
        const values = pairs.map(([gid, due]) => `(${sqlStr(gid)}::text, ${sqlStr(due)}::date)`).join(",\n");
        const sql = `update public.orders o
set payment_due_on = v.due
from (values
${values}
) as v(gid, due)
where o.shopify_order_gid = v.gid;`;
        const file = path.join(tmp, "repair-payment-due.sql");
        await writeFile(file, sql);
        runSqlFile(file);
      }
      report.steps.paymentDue = { sourceWithDue: pairs.length };
    }
  }

  // ── original_unit_price: only rows that need repair (null while source has set) ──
  console.log("[4] original_unit_price…");
  {
    // Load current nulls by source_line_item_gid
    const nullGids = new Set();
    let from = 0;
    for (;;) {
      const { data, error } = await sb
        .from("order_items")
        .select("source_line_item_gid")
        .is("original_unit_price", null)
        .not("source_line_item_gid", "is", null)
        .order("source_line_item_gid")
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      if (!data?.length) break;
      for (const r of data) nullGids.add(r.source_line_item_gid);
      if (data.length < 1000) break;
      from += 1000;
    }
    console.log(`  null original_unit_price rows: ${nullGids.size}`);

    const pairs = [];
    let sourceWithSet = 0;
    await eachJsonl("orders/orders.jsonl", (rec) => {
      for (const li of rec.lineItems?.nodes || []) {
        if (!li?.id || li.originalUnitPriceSet == null) continue;
        sourceWithSet += 1;
        if (!nullGids.has(li.id)) continue;
        const v = moneyOrNull(li.originalUnitPriceSet);
        pairs.push([li.id, v]);
      }
    });
    console.log(`  null rows with source set to backfill: ${pairs.length}`);

    if (pairs.length) {
      let batch = 0;
      for (let i = 0; i < pairs.length; i += 400) {
        batch += 1;
        const chunk = pairs.slice(i, i + 400);
        const values = chunk
          .map(([gid, amt]) => `(${sqlStr(gid)}::text, ${amt == null ? "NULL" : amt}::numeric)`)
          .join(",\n");
        const sql = `update public.order_items oi
set original_unit_price = v.amt
from (values
${values}
) as v(line_gid, amt)
where oi.source_line_item_gid = v.line_gid;`;
        const file = path.join(tmp, `repair-orig-price-${batch}.sql`);
        await writeFile(file, sql);
        console.log(`  original price batch ${batch}/${Math.ceil(pairs.length / 400)}…`);
        runSqlFile(file);
      }
      report.steps.originalUnitPrice = { sourceWithSet, nullBefore: nullGids.size, backfilled: pairs.length, batches: batch };
    } else {
      report.steps.originalUnitPrice = { sourceWithSet, nullBefore: nullGids.size, backfilled: 0, batches: 0 };
    }
  }

  // Load order/draft maps
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

  // ── Metafields ───────────────────────────────────────────────────────────
  console.log("[5] metafields…");
  {
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

    function collect(ownerType, ownerId, nodes, into, exceptions) {
      for (const mf of mfNodes(nodes)) {
        if (!mf?.namespace || !mf?.key) continue;
        if (mf.id && haveGid.has(mf.id)) continue;
        const k = `${ownerType}|${ownerId}|${mf.namespace}|${mf.key}`;
        // Prefer GID presence: if ns+key already stored under a different GID, report — do not silently drop.
        if (haveKey.has(k) && !mf.id) {
          exceptions.push({
            reason: "duplicate_ns_key_without_gid",
            ownerType,
            ownerId,
            namespace: mf.namespace,
            key: mf.key,
          });
          continue;
        }
        if (haveKey.has(k) && mf.id) {
          exceptions.push({
            reason: "ns_key_occupied_distinct_gid",
            ownerType,
            ownerId,
            namespace: mf.namespace,
            key: mf.key,
            external_gid: mf.id,
          });
          // Still attempt insert; DB unique may reject — caller reports failure.
        }
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
    const exceptions = [];
    let sourceCustomer = 0;
    let sourceOrder = 0;
    await eachJsonl("customers/customers.jsonl", (rec) => {
      const ownerId = customerIdByGid.get(rec.id);
      if (!ownerId) return;
      const nodes = mfNodes(rec.metafields);
      sourceCustomer += nodes.length;
      collect("customer", ownerId, nodes, missing, exceptions);
    });
    await eachJsonl("orders/orders.jsonl", (rec) => {
      const ownerId = orderIdByGid.get(rec.id);
      if (!ownerId) return;
      const nodes = mfNodes(rec.metafields);
      sourceOrder += nodes.length;
      collect("order", ownerId, nodes, missing, exceptions);
    });
    await eachJsonl("customers/companies.jsonl", (rec) => {
      const ownerId = companyIdByGid.get(rec.id);
      if (ownerId) collect("company", ownerId, rec.metafields, missing, exceptions);
      for (const loc of rec.locations?.nodes || []) {
        const locId = locationIdByGid.get(loc.id);
        if (locId) collect("company_location", locId, loc.metafields, missing, exceptions);
      }
    });
    await eachJsonl("draft_orders/draft-orders.jsonl", (rec) => {
      const ownerId = draftIdByGid.get(rec.id);
      if (ownerId) collect("draft_order", ownerId, rec.metafields, missing, exceptions);
    });

    const insertFailures = [];
    await chunked(missing, 80, async (chunk) => {
      const cleaned = chunk.map((r) => {
        if (r.value_json === undefined || r.value_json === null) {
          const { value_json, ...rest } = r;
          return rest;
        }
        return r;
      });
      const { error } = await sb.from("metafields").insert(cleaned);
      if (error) {
        for (const row of cleaned) {
          const { error: e2 } = await sb.from("metafields").insert(row);
          if (e2) {
            if (/duplicate|unique/i.test(e2.message)) {
              insertFailures.push({
                reason: "db_unique_reject",
                external_gid: row.external_gid,
                owner_type: row.owner_type,
                owner_id: row.owner_id,
                namespace: row.namespace,
                key: row.key,
                message: e2.message,
              });
            } else {
              throw new Error(e2.message);
            }
          }
        }
      }
    });
    report.steps.metafields = {
      sourceCustomer,
      sourceOrder,
      missingAttempted: missing.length,
      exceptions: exceptions.slice(0, 200),
      exceptionCount: exceptions.length,
      insertFailures: insertFailures.slice(0, 200),
      insertFailureCount: insertFailures.length,
    };
  }

  // ── Tags ─────────────────────────────────────────────────────────────────
  console.log("[6] tags…");
  {
    async function loadExisting(entityType) {
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
    const custHave = await loadExisting("customer");
    const ordHave = await loadExisting("order");
    const pending = [];
    const allRaw = [];
    let sourceCust = 0;
    let sourceOrd = 0;
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
        return { tag_id, entity_type: p.entity_type, entity_id: p.entity_id, raw_value: p.raw_value, source_system: SYSTEM };
      })
      .filter(Boolean);
    await chunked(rows, 100, async (chunk) => {
      const { error } = await sb.from("entity_tags").upsert(chunk, {
        onConflict: "entity_type,entity_id,tag_id,raw_value",
        ignoreDuplicates: true,
      });
      if (error) throw new Error(error.message);
    });
    report.steps.tags = { sourceCust, sourceOrd, inserted: rows.length };
  }

  // ── Addresses ────────────────────────────────────────────────────────────
  console.log("[7] addresses…");
  {
    const existing = new Map();
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
        existing
          .get(a.customer_id)
          .add(
            [a.address1, a.address2, a.city, a.postal_code, a.country_code, a.company, a.phone]
              .map((x) => (x || "").trim().toLowerCase())
              .join("|"),
          );
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
        if (!fp.replace(/\|/g, "").trim()) {
          unrepresentable.push({ customerGid: rec.id, addressId: a.id, reason: "empty_address_fields" });
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
    report.steps.addresses = { source, inserted: toInsert.length, unrepresentable };
  }

  // ── Draft links via SQL ──────────────────────────────────────────────────
  console.log("[8] draft↔order links…");
  {
    const byDraft = new Map();
    await eachJsonl("draft_orders/draft-orders.jsonl", (rec) => {
      const orderGid = rec.order?.id;
      if (!orderGid) return;
      const orderId = orderIdByGid.get(orderGid);
      const draftId = draftIdByGid.get(rec.id);
      if (!orderId || !draftId) {
        byDraft.set(rec.id, { draft: rec.id, order: orderGid, ok: false });
        return;
      }
      byDraft.set(rec.id, { draftId, orderId, draft: rec.id, order: orderGid, ok: true });
    });
    const links = [...byDraft.values()];
    const okLinks = links.filter((l) => l.ok);
    const unresolved = links.filter((l) => !l.ok);
    let batch = 0;
    for (let i = 0; i < okLinks.length; i += 400) {
      batch += 1;
      const chunk = okLinks.slice(i, i + 400);
      const values = chunk
        .map((l) => `(${sqlStr(l.draftId)}::uuid, ${sqlStr(l.orderId)}::uuid)`)
        .join(",\n");
      const sql = `
update public.draft_orders d
set converted_order_id = v.order_id
from (values
${values}
) as v(draft_id, order_id)
where d.id = v.draft_id;

update public.orders o
set draft_order_id = v.draft_id
from (values
${values}
) as v(draft_id, order_id)
where o.id = v.order_id;
`;
      const file = path.join(tmp, `repair-draft-links-${batch}.sql`);
      await writeFile(file, sql);
      console.log(`  draft link batch ${batch}/${Math.ceil(okLinks.length / 400)}…`);
      runSqlFile(file);
    }
    report.steps.draftLinks = {
      convertedDraftsInSource: links.length,
      linked: okLinks.length,
      unresolved: unresolved.length,
      unresolvedSample: unresolved.slice(0, 20),
      ambiguous: 0,
    };
  }

  // Contacts count verify
  {
    const { count } = await sb.from("company_contacts").select("*", { count: "exact", head: true });
    report.steps.companyContacts = { importedAfter: count };
  }

  await writeFile(path.join(OUT, "repair-fast-report.json"), JSON.stringify(report, null, 2));
  console.log("DONE", JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
