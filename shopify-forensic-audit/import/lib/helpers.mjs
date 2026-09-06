/**
 * Shared helpers for Shopify → UD commerce import.
 * Read-only against Shopify. Writes to Supabase only when --apply is passed.
 */
import { createReadStream } from "node:fs";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const RAW = path.join(ROOT, "raw");
export const OUT = path.join(ROOT, "import", "out");
export const SYSTEM = "shopify";

export function money(set) {
  if (set == null) return 0;
  if (typeof set === "number") return Number.isFinite(set) ? set : 0;
  if (set.amount != null) {
    const n = Number(set.amount);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(set?.shopMoney?.amount);
  return Number.isFinite(n) ? n : 0;
}

/** Like money(), but null when the MoneyBag is absent (preserves legitimate £0). */
export function moneyOrNull(set) {
  if (set == null) return null;
  if (typeof set === "number") return Number.isFinite(set) ? set : null;
  if (set.amount != null || set?.shopMoney?.amount != null) return money(set);
  // empty object / unknown shape
  if (typeof set === "object" && set.shopMoney == null && set.amount == null) return null;
  return money(set);
}

export function firstMoney(...sets) {
  for (const set of sets) {
    if (set == null) continue;
    return money(set);
  }
  return 0;
}

export function firstMoneyOrNull(...sets) {
  for (const set of sets) {
    const v = moneyOrNull(set);
    if (v != null) return v;
  }
  return null;
}

export function moneyCurrency(set, fallback = "GBP") {
  return set?.shopMoney?.currencyCode || set?.currencyCode || fallback;
}

export function unwrap(line) {
  if (!line || !String(line).trim()) return null;
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    return { __parseError: true, raw: String(line).slice(0, 200) };
  }
  return o.record ?? o;
}

export async function eachJsonl(rel, onRecord, { limit = Infinity } = {}) {
  const full = path.join(RAW, rel);
  const rl = readline.createInterface({
    input: createReadStream(full, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let n = 0;
  let parseErrors = 0;
  const seen = new Set();
  for await (const line of rl) {
    const rec = unwrap(line);
    if (!rec) continue;
    if (rec.__parseError) {
      parseErrors += 1;
      continue;
    }
    const id = rec.id;
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    n += 1;
    await onRecord(rec, n);
    if (n >= limit) break;
  }
  return { count: n, unique: seen.size, parseErrors };
}

export function mfNodes(metafields) {
  if (!metafields) return [];
  if (Array.isArray(metafields)) return metafields;
  return metafields.nodes || [];
}

export function mfValue(metafields, namespace, key) {
  for (const mf of mfNodes(metafields)) {
    if (mf?.namespace === namespace && mf?.key === key) return mf.value ?? null;
  }
  return null;
}

export function tagList(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.filter((t) => t != null && String(t).length > 0).map(String);
  return String(tags)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Staff names that are placeholders — still stored as metafields/tags, not staff_members. */
export const STAFF_PLACEHOLDERS = new Set([
  "no salesperson",
  "no referrer",
  "no cg",
  "none",
  "n/a",
  "na",
  "",
]);

export function normalizeStaffName(raw) {
  if (raw == null) return null;
  const name = String(raw).trim();
  if (!name) return null;
  if (STAFF_PLACEHOLDERS.has(name.toLowerCase())) return null;
  return name;
}

export function isStaffPlaceholder(raw) {
  if (raw == null) return true;
  return STAFF_PLACEHOLDERS.has(String(raw).trim().toLowerCase());
}

export function mapLegacyOrderStatus(financial, cancelledAt) {
  if (cancelledAt) return "cancelled";
  const f = String(financial || "").toUpperCase();
  if (f === "REFUNDED") return "refunded";
  if (f === "PAID" || f === "PARTIALLY_REFUNDED") return "paid";
  if (f === "VOIDED") return "cancelled";
  if (f === "PENDING" || f === "AUTHORIZED" || f === "PARTIALLY_PAID" || f === "EXPIRED") return "pending";
  return "pending";
}

export function mapLegacyFulfillmentStatus(display) {
  const d = String(display || "").toUpperCase();
  if (d === "FULFILLED") return "shipped";
  if (d === "PARTIAL" || d === "IN_PROGRESS" || d === "ON_HOLD" || d === "SCHEDULED") return "processing";
  if (d === "DELIVERED") return "delivered";
  return "unfulfilled";
}

export function shopifyOrderNumber(rec) {
  // Avoid colliding with native UD order numbers: prefer stable Shopify legacy id key.
  const legacy = rec.legacyResourceId || String(rec.id || "").split("/").pop();
  return `SH-${legacy}`;
}

export function addressJson(addr) {
  if (!addr) return {};
  return {
    name: addr.name ?? null,
    first_name: addr.firstName ?? null,
    last_name: addr.lastName ?? null,
    company: addr.company ?? null,
    address1: addr.address1 ?? null,
    address2: addr.address2 ?? null,
    city: addr.city ?? null,
    province: addr.province ?? null,
    province_code: addr.provinceCode ?? null,
    postal_code: addr.zip ?? addr.postalCode ?? null,
    country: addr.country ?? null,
    country_code: addr.countryCodeV2 ?? addr.countryCode ?? null,
    phone: addr.phone ?? null,
  };
}

export function nowIso() {
  return new Date().toISOString();
}

export function newId() {
  return randomUUID();
}

export async function ensureOut() {
  await mkdir(OUT, { recursive: true });
}

export async function writeJson(name, data) {
  await ensureOut();
  const full = path.join(OUT, name);
  await writeFile(full, JSON.stringify(data, null, 2), "utf8");
  return full;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Set();
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        opts[key] = next;
        i += 1;
      } else {
        flags.add(key);
      }
    }
  }
  return { flags, opts };
}

export async function loadEnvFile() {
  // Prefer process env; optionally load repo .env (not committed secrets).
  const candidates = [
    path.resolve(ROOT, "..", ".env"),
    path.resolve(ROOT, ".env"),
  ];
  for (const p of candidates) {
    try {
      const text = await readFile(p, "utf8");
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!m) continue;
        const k = m[1];
        let v = m[2];
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (process.env[k] == null) process.env[k] = v;
      }
    } catch {
      /* missing is fine */
    }
  }
}

export function supabaseCreds() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY;
  return { url, key };
}
