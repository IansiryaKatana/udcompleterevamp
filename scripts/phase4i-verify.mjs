import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'fs'

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
const anonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY
const sb = createClient(url, key, { auth: { persistSession: false } })
const anonSb = createClient(url, anonKey, { auth: { persistSession: false } })

const out = { ts: new Date().toISOString() }

{
  const r = await sb.rpc('rpc_phase4i_cutover_validation_selftest')
  out.phase4i = { data: r.data, error: r.error?.message ?? null }
}
{
  const r = await sb.rpc('rpc_phase4h_postgrest_attack_selftest')
  out.phase4h_ok = r.data?.ok ?? false
  out.phase4h_error = r.error?.message ?? null
}
{
  const r = await sb.rpc('effective_commercial_access_mode', { p_force_mode: null })
  out.effective_mode = r.data
  out.effective_err = r.error?.message ?? null
}
{
  const r = await sb.rpc('effective_commercial_access_mode', { p_force_mode: 'trade_required' })
  out.effective_force_trade = r.data
}
{
  const r = await anonSb.from('products').select('id,price').eq('published', true).limit(2)
  out.anon_products_rows = r.data?.length ?? 0
}
{
  const r = await anonSb.from('product_variants').select('id,price').eq('is_active', true).limit(2)
  out.anon_variants_rows = r.data?.length ?? 0
}
{
  const r = await anonSb.rpc('rpc_list_storefront_products', {
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
  out.force_redact = {
    ok: r.data?.ok,
    price_visible: r.data?.price_visible,
    price: r.data?.items?.[0]?.price ?? null,
    restricted: r.data?.items?.[0]?.price_restricted ?? null,
    error: r.error?.message ?? null,
  }
}
{
  const r = await sb.rpc('rpc_admin_finalize_pilot_cohort', {
    p_limit: 12,
    p_proposal_key: 'PHASE4I_PILOT_001',
  })
  out.cohort = {
    ok: r.data?.ok,
    count: r.data?.count,
    status: r.data?.PILOT_SEND_STATUS,
    matrix: r.data?.matrix,
    error: r.error?.message ?? null,
  }
}
{
  const r = await sb.rpc('rpc_admin_create_pilot_batch_from_proposal', {
    p_proposal_key: 'PHASE4I_PILOT_001',
    p_issue_tokens: false,
  })
  out.batch = {
    ok: r.data?.ok,
    batch_id: r.data?.batch_id,
    batch_name: r.data?.batch_name,
    recipient_count: r.data?.recipient_count,
    send_status: r.data?.send_status,
    pilot_status: r.data?.PILOT_SEND_STATUS,
    error: r.error?.message ?? r.data?.error ?? null,
  }
}
{
  const r = await sb.rpc('rpc_admin_trade_required_cutover_precheck')
  out.precheck = { data: r.data, error: r.error?.message ?? null }
}
{
  const r = await sb.rpc('rpc_admin_phase4i_shadow_matrix')
  out.shadow = { ok: r.data?.ok, matrix: r.data?.matrix, error: r.error?.message ?? null }
}
{
  const r = await sb.rpc('rpc_admin_preview_next_activation_cohort', { p_limit: 50 })
  out.next_cohort = { data: r.data, error: r.error?.message ?? null }
}
{
  const r = await sb.rpc('rpc_admin_cutover_kill_switch_procedure')
  out.kill_switch = { ok: r.data?.ok, error: r.error?.message ?? null, procedure: r.data?.procedure }
}
{
  const r = await sb
    .from('site_settings')
    .select('key,value')
    .in('key', [
      'commercial_access_mode',
      'trade_required_cutover_approved',
      'pilot_send_authorized',
      'merchant_feed_price_mode',
      'activation_adhoc_send_enabled',
    ])
  out.settings = Object.fromEntries((r.data || []).map((row) => [row.key, row.value]))
}

writeFileSync('scripts/_phase4i_verify_out.json', JSON.stringify(out, null, 2))
console.log('wrote scripts/_phase4i_verify_out.json')
console.log(JSON.stringify({
  phase4i_ok: out.phase4i?.data?.ok,
  phase4h_ok: out.phase4h_ok,
  effective_mode: out.effective_mode,
  effective_force_trade: out.effective_force_trade,
  anon_products_rows: out.anon_products_rows,
  anon_variants_rows: out.anon_variants_rows,
  force_redact: out.force_redact,
  settings: out.settings,
  cohort_count: out.cohort?.count,
  cohort_status: out.cohort?.status,
  cohort_matrix: out.cohort?.matrix,
  batch: out.batch,
  precheck_ok: out.precheck?.data?.ok,
  precheck_gate: out.precheck?.data?.gate,
  shadow_matrix: out.shadow?.matrix,
  next_cohort: out.next_cohort?.data,
  kill_switch_ok: out.kill_switch?.ok,
}, null, 2))
