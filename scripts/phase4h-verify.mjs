import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const raw = readFileSync('.env', 'utf8')
const env = {}
for (const line of raw.split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue
  const i = line.indexOf('=')
  if (i < 0) continue
  let v = line.slice(i + 1)
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1)
  }
  env[line.slice(0, i)] = v
}

const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
const anon = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY
const sb = createClient(url, key, { auth: { persistSession: false } })
const anonSb = createClient(url, anon, { auth: { persistSession: false } })

const attack = await sb.rpc('rpc_phase4h_postgrest_attack_selftest')
const settings = await sb
  .from('site_settings')
  .select('key,value')
  .in('key', [
    'commercial_access_mode',
    'trade_required_cutover_approved',
    'pilot_send_authorized',
    'merchant_feed_price_mode',
  ])

const anonProducts = await anonSb.from('products').select('id,price').eq('published', true).limit(3)
const anonVariants = await anonSb
  .from('product_variants')
  .select('id,price')
  .eq('is_active', true)
  .limit(3)
const anonRpc = await anonSb.rpc('rpc_list_storefront_products', {
  p_filter: 'all',
  p_slug: null,
  p_limit: 1,
  p_offset: 0,
  p_min_price: null,
  p_max_price: null,
  p_in_stock_only: false,
  p_sort: 'default',
  p_force_mode: null,
})
const forceRedact = await anonSb.rpc('rpc_list_storefront_products', {
  p_filter: 'all',
  p_slug: null,
  p_limit: 1,
  p_offset: 0,
  p_min_price: null,
  p_max_price: null,
  p_in_stock_only: false,
  p_sort: 'default',
  p_force_mode: 'trade_required',
})

const out = {
  attack_ok: attack.data?.ok,
  attack_pilot: attack.data?.pilot_send_status,
  attack_mode: attack.data?.commercial_access_mode,
  attack_cutover: attack.data?.trade_required_cutover_approved,
  attack_cases: Object.fromEntries(
    Object.entries(attack.data?.cases || {}).map(([k, v]) => [k, { ok: v?.ok, detail: v?.detail ?? v?.note }]),
  ),
  settings: Object.fromEntries((settings.data || []).map((r) => [r.key, r.value])),
  anon_products_rows: anonProducts.data?.length ?? null,
  anon_products_error: anonProducts.error?.message ?? null,
  anon_variants_rows: anonVariants.data?.length ?? null,
  anon_variants_error: anonVariants.error?.message ?? null,
  catalogue_open_price_visible: anonRpc.data?.price_visible,
  catalogue_open_sample_price: anonRpc.data?.items?.[0]?.price ?? null,
  trade_force_price_visible: forceRedact.data?.price_visible,
  trade_force_sample_price: forceRedact.data?.items?.[0]?.price ?? null,
  trade_force_restricted: forceRedact.data?.items?.[0]?.price_restricted ?? null,
}
console.log(JSON.stringify(out, null, 2))
