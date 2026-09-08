import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'fs'

const raw = readFileSync('.env', 'utf8')
const env = {}
for (const line of raw.split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue
  const i = line.indexOf('=')
  if (i < 0) continue
  let v = line.slice(i + 1)
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  env[line.slice(0, i)] = v
}

const sb = createClient(env.VITE_SUPABASE_URL || env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const out = {}

{
  const { count } = await sb.from('metafields').select('*', { count: 'exact', head: true })
  out.metafield_count = count
  const { data } = await sb.from('metafields').select('namespace,key,owner_type').limit(2000)
  const keys = {}
  for (const row of data || []) {
    const k = `${row.owner_type}:${row.namespace}.${row.key}`
    keys[k] = (keys[k] || 0) + 1
  }
  out.metafield_key_counts = Object.entries(keys).sort((a, b) => b[1] - a[1]).slice(0, 50)
  out.nicotine_related = Object.entries(keys).filter(([k]) =>
    /nicotine|tpd|age|tobacco|regulated|restrict|18/i.test(k),
  )
}

{
  const { data } = await sb.from('tags').select('name').limit(5000)
  const names = {}
  for (const t of data || []) names[t.name] = (names[t.name] || 0) + 1
  out.tag_top = Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 40)
  out.tag_compliance_ish = Object.entries(names).filter(([n]) =>
    /surecust|verified|wholesale|age|18|restrict|nicotine|trade/i.test(n),
  )
}

{
  const { count: et } = await sb.from('entity_tags').select('*', { count: 'exact', head: true })
  out.entity_tag_count = et
}
{
  const { count } = await sb.from('products').select('*', { count: 'exact', head: true })
  out.product_count = count
}
{
  const { data } = await sb.from('categories').select('name,slug').limit(50)
  out.categories = data
}
{
  const { data } = await sb.from('collections').select('title,slug').limit(50)
  out.collections = data
}
{
  const { data } = await sb.from('shipping_zones').select('name,countries,is_active')
  out.shipping_zones = data
}
{
  const { data } = await sb.from('site_settings').select('key,value').in('key', [
    'commercial_access_mode',
    'trade_required_cutover_approved',
    'pilot_send_authorized',
  ])
  out.settings = Object.fromEntries((data || []).map((r) => [r.key, r.value]))
}

writeFileSync('scripts/_phase5a_audit_out.json', JSON.stringify(out, null, 2))
console.log(JSON.stringify({
  product_count: out.product_count,
  metafield_count: out.metafield_count,
  entity_tag_count: out.entity_tag_count,
  nicotine_related: out.nicotine_related,
  metafield_top: out.metafield_key_counts?.slice(0, 20),
  tag_compliance_ish: out.tag_compliance_ish,
  tag_top: out.tag_top?.slice(0, 15),
  categories: out.categories,
  collections: out.collections,
  shipping_zones: out.shipping_zones,
  settings: out.settings,
}, null, 2))
