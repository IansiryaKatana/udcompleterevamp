/**
 * Phase 5E fast catalogue import — bulk RPCs.
 * Usage: node scripts/phase5e-catalogue-import-fast.mjs [--limit=N]
 */
import { createReadStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PRODUCTS = path.join(ROOT, 'shopify-forensic-audit/raw/products/products.jsonl')
const COLLECTIONS = path.join(ROOT, 'shopify-forensic-audit/raw/products/collections.jsonl')
const INVENTORY = path.join(ROOT, 'shopify-forensic-audit/raw/inventory/inventory-items.jsonl')
const OUT = path.join(ROOT, 'shopify-forensic-audit/import/out')

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || Infinity)
const BATCH = 40

function unwrap(line) {
  if (!line?.trim()) return null
  try {
    const o = JSON.parse(line)
    return o.record ?? o
  } catch {
    return null
  }
}

async function* eachJsonl(file, max = Infinity) {
  const rl = readline.createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })
  let n = 0
  for await (const line of rl) {
    const rec = unwrap(line)
    if (!rec) continue
    yield rec
    if (++n >= max) break
  }
}

function nodes(c) {
  if (!c) return []
  return Array.isArray(c) ? c : c.nodes || []
}

function money(v) {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  if (v.amount != null) {
    const n = Number(v.amount)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function stripHtml(html) {
  if (!html) return null
  return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000)
}

function mediaUrl(m) {
  return m?.preview?.image?.url || m?.image?.url || m?.originalSource?.url || m?.sources?.[0]?.url || null
}

async function flushRpc(name, args) {
  const { data, error } = await sb.rpc(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
  return data
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const { data: batch, error: be } = await sb
    .from('catalogue_import_batches')
    .insert({ source: 'shopify_forensic_fast', status: 'running', notes: 'Phase 5E fast bulk import' })
    .select('id')
    .single()
  if (be) throw be
  const batchId = batch.id
  console.log('batch', batchId)

  const summary = {
    collections: 0,
    products: 0,
    variants: 0,
    memberships: 0,
    metafields: 0,
    media: 0,
    tags: 0,
    inventory: 0,
    failures: 0,
  }

  // Collections
  let colBuf = []
  for await (const rec of eachJsonl(COLLECTIONS)) {
    const handle = rec.handle || `collection-${rec.legacyResourceId || String(rec.id).split('/').pop()}`
    colBuf.push({
      title: rec.title || handle,
      slug: handle,
      description: stripHtml(rec.descriptionHtml || rec.description),
      description_html: rec.descriptionHtml || null,
      cover_image_url: rec.image?.url || null,
      shopify_collection_gid: rec.id,
      shopify_legacy_id: rec.legacyResourceId ? String(rec.legacyResourceId) : null,
      shopify_handle: handle,
      seo_title: rec.seo?.title || null,
      seo_description: rec.seo?.description || null,
      collection_type: rec.ruleSet ? 'smart' : 'custom',
      source_updated_at: rec.updatedAt || null,
      rule_definition_json: rec.ruleSet || null,
      rule_definition_status: rec.ruleSet ? 'KNOWN' : 'UNKNOWN',
      type: rec.ruleSet ? 'smart' : 'seasonal',
    })
    if (colBuf.length >= BATCH) {
      const r = await flushRpc('rpc_phase5e_bulk_upsert_collections', { p_batch_id: batchId, p_rows: colBuf })
      summary.collections += r.upserted || colBuf.length
      colBuf = []
    }
  }
  if (colBuf.length) {
    const r = await flushRpc('rpc_phase5e_bulk_upsert_collections', { p_batch_id: batchId, p_rows: colBuf })
    summary.collections += r.upserted || colBuf.length
  }
  console.log('collections', summary.collections)

  let prodBuf = []
  let varBuf = []
  let memBuf = []
  let mfBuf = []
  let mediaBuf = []
  let n = 0

  async function flushAll() {
    if (prodBuf.length) {
      const r = await flushRpc('rpc_phase5e_bulk_upsert_products', { p_batch_id: batchId, p_rows: prodBuf })
      summary.products += (r.created || 0) + (r.updated || 0)
      prodBuf = []
    }
    if (varBuf.length) {
      const r = await flushRpc('rpc_phase5e_bulk_upsert_variants', { p_batch_id: batchId, p_rows: varBuf })
      summary.variants += r.upserted || 0
      varBuf = []
    }
    if (memBuf.length) {
      const r = await flushRpc('rpc_phase5e_bulk_link_memberships', { p_batch_id: batchId, p_rows: memBuf })
      summary.memberships += r.upserted || 0
      memBuf = []
    }
    if (mfBuf.length) {
      const r = await flushRpc('rpc_phase5e_bulk_upsert_metafields', { p_rows: mfBuf })
      summary.metafields += r.upserted || 0
      mfBuf = []
    }
    if (mediaBuf.length) {
      const rows = mediaBuf.map((m) => ({
        shopify_product_gid: m._product_gid,
        shopify_media_gid: m.shopify_media_gid,
        position: m.position,
        alt_text: m.alt_text,
        source_url: m.source_url,
        destination_url: m.destination_url,
        status: m.status,
      }))
      const r = await flushRpc('rpc_phase5e_bulk_upsert_media', { p_batch_id: batchId, p_rows: rows })
      summary.media += r.upserted || 0
      mediaBuf = []
    }
  }

  for await (const rec of eachJsonl(PRODUCTS, LIMIT)) {
    n++
    try {
      const handle = rec.handle || `product-${rec.legacyResourceId || n}`
      const variants = nodes(rec.variants)
      const prices = variants.map((v) => money(v.price)).filter((p) => p != null)
      const status = String(rec.status || 'ACTIVE').toUpperCase()
      const mediaNodes = nodes(rec.media)
      const featured = mediaUrl(rec.featuredMedia) || mediaUrl(mediaNodes[0]) || null
      const gallery = mediaNodes.map(mediaUrl).filter(Boolean).filter((u) => u !== featured).slice(0, 24)
      const tags = Array.isArray(rec.tags) ? rec.tags : []

      prodBuf.push({
        name: rec.title || handle,
        slug: handle,
        description: stripHtml(rec.descriptionHtml),
        description_html: rec.descriptionHtml || null,
        price: prices.length ? Math.min(...prices) : 0,
        compare_at_price: money(variants[0]?.compareAtPrice),
        image_url: featured,
        gallery_urls: gallery,
        inventory_count: Number(rec.totalInventory) || 0,
        published: status === 'ACTIVE',
        vendor: rec.vendor || null,
        product_type: rec.productType || null,
        shopify_status: status,
        shopify_product_gid: rec.id,
        shopify_legacy_id: rec.legacyResourceId ? String(rec.legacyResourceId) : null,
        shopify_handle: handle,
        source_created_at: rec.createdAt || null,
        source_updated_at: rec.updatedAt || null,
        seo_title: rec.seo?.title || null,
        seo_description: rec.seo?.description || null,
        options_json: rec.options || [],
        tags_raw: tags,
        tracks_inventory: rec.tracksInventory ?? null,
        total_inventory: rec.totalInventory ?? null,
        published_at: rec.publishedAt || null,
        sku: variants[0]?.sku || null,
      })

      for (const [i, v] of variants.entries()) {
        const optionValues = {}
        for (const o of v.selectedOptions || []) if (o?.name) optionValues[o.name] = o.value
        const inv = v.inventoryItem || {}
        const sku = (v.sku || '').trim()
        const barcode = (v.barcode || '').trim()
        varBuf.push({
          shopify_product_gid: rec.id,
          name: v.title || v.displayName || 'Default',
          sku,
          barcode,
          price: money(v.price),
          compare_at_price: money(v.compareAtPrice),
          inventory_count: Number(v.inventoryQuantity) || 0,
          option_values: optionValues,
          image_url: mediaUrl(v.image),
          shopify_variant_gid: v.id,
          shopify_legacy_id: v.legacyResourceId ? String(v.legacyResourceId) : null,
          shopify_inventory_item_gid: inv.id || null,
          position: v.position ?? i + 1,
          taxable: v.taxable ?? null,
          weight_value: inv.measurement?.weight?.value ?? null,
          weight_unit: inv.measurement?.weight?.unit ?? null,
          source_created_at: v.createdAt || null,
          source_updated_at: v.updatedAt || null,
          available_for_sale: v.availableForSale ?? null,
          sku_quality: sku ? 'VALID' : 'MISSING',
          barcode_quality: barcode ? 'VALID' : 'MISSING',
        })
        for (const mf of nodes(v.metafields)) {
          mfBuf.push({
            owner_type: 'product_variant',
            owner_gid: v.id,
            namespace: mf.namespace,
            key: mf.key,
            value_type: mf.type || null,
            value_text: mf.value != null ? String(mf.value) : null,
            value_json: mf.jsonValue ?? null,
            external_gid: mf.id || null,
            source_updated_at: mf.updatedAt || null,
          })
        }
      }

      for (const mf of nodes(rec.metafields)) {
        mfBuf.push({
          owner_type: 'product',
          owner_gid: rec.id,
          namespace: mf.namespace,
          key: mf.key,
          value_type: mf.type || null,
          value_text: mf.value != null ? String(mf.value) : null,
          value_json: mf.jsonValue ?? null,
          external_gid: mf.id || null,
          source_updated_at: mf.updatedAt || null,
        })
      }

      for (const [ci, c] of nodes(rec.collections).entries()) {
        if (!c.id) continue
        memBuf.push({
          shopify_product_gid: rec.id,
          shopify_collection_gid: c.id,
          position: ci,
        })
      }

      for (const [mi, m] of mediaNodes.entries()) {
        const src = mediaUrl(m)
        if (!src) continue
        mediaBuf.push({
          _product_gid: rec.id,
          shopify_media_gid: m.id || `synthetic:${rec.id}:${mi}`,
          position: mi,
          alt_text: m.alt || null,
          source_url: src,
          destination_url: src,
          status: 'SOURCE_REFERENCED',
          import_batch_id: batchId,
        })
      }

      if (prodBuf.length >= BATCH) {
        await flushAll()
        if (n % 200 === 0) console.log(`progress products=${n}`, summary)
      }
    } catch (e) {
      summary.failures++
      console.error('row fail', rec.id, e.message)
    }
  }
  await flushAll()

  console.log('expand tags + quality…')
  try {
    await flushRpc('rpc_phase5e_expand_product_tags', {})
  } catch (e) {
    console.warn(e.message)
  }
  const quality = await flushRpc('rpc_phase5e_flag_sku_barcode_quality', {})

  // Inventory snapshots (source only)
  console.log('inventory snapshots…')
  let invBuf = []
  for await (const rec of eachJsonl(INVENTORY)) {
    const levels = nodes(rec.inventoryLevels)
    if (!levels.length) {
      invBuf.push({
        shopify_inventory_item_gid: rec.id,
        sku: rec.sku || null,
        tracked: rec.tracked ?? null,
        import_batch_id: batchId,
        metadata: { legacyResourceId: rec.legacyResourceId || null },
      })
    } else {
      for (const lvl of levels) {
        const loc = lvl.location || {}
        const locName = loc.name || null
        let locationClass = 'UNKNOWN'
        if (/UD WH|Warehouse/i.test(locName || '')) locationClass = 'PHYSICAL_WAREHOUSE'
        if (/^UD00[2-8]$/i.test(locName || '')) locationClass = 'SALESPERSON_VIRTUAL'
        const qty = lvl.quantities || []
        const findQ = (name) => {
          const q = qty.find((x) => String(x.name || '').toLowerCase() === name)
          return q?.quantity != null ? Number(q.quantity) : null
        }
        invBuf.push({
          shopify_inventory_item_gid: rec.id,
          shopify_location_gid: loc.id || null,
          location_name: locName,
          location_class: locationClass,
          sku: rec.sku || null,
          barcode: rec.barcode || null,
          available: findQ('available') ?? lvl.available ?? null,
          on_hand: findQ('on_hand'),
          committed: findQ('committed'),
          incoming: findQ('incoming'),
          tracked: rec.tracked ?? null,
          import_batch_id: batchId,
        })
      }
    }
    if (invBuf.length >= 200) {
      const { error } = await sb.from('shopify_inventory_snapshots').insert(invBuf)
      if (!error) summary.inventory += invBuf.length
      else summary.failures++
      invBuf = []
    }
  }
  if (invBuf.length) {
    const { error } = await sb.from('shopify_inventory_snapshots').insert(invBuf)
    if (!error) summary.inventory += invBuf.length
  }

  try {
    await sb.rpc('rpc_admin_classify_regulated_products_from_evidence')
  } catch (e) {
    console.warn('classify', e.message || e)
  }

  await sb
    .from('catalogue_import_batches')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      counts: { ...summary, quality },
      created_count: summary.products,
      failed_count: summary.failures,
    })
    .eq('id', batchId)

  await sb
    .from('delta_watermarks')
    .update({
      cursor_value: new Date().toISOString(),
      last_reconciled_count: summary.products,
      notes: `Phase 5E fast batch ${batchId}`,
      updated_at: new Date().toISOString(),
    })
    .eq('entity_type', 'products')

  const { count: sp } = await sb.from('products').select('*', { count: 'exact', head: true }).eq('catalogue_origin', 'SHOPIFY_IMPORTED')
  const { count: sv } = await sb.from('product_variants').select('*', { count: 'exact', head: true }).eq('source_system', 'shopify')
  const { count: pub } = await sb.from('products').select('*', { count: 'exact', head: true }).eq('published', true)

  const final = { batchId, summary, quality, live: { shopify_products: sp, shopify_variants: sv, published: pub } }
  await writeFile(path.join(OUT, 'phase5e-catalogue-import-fast.json'), JSON.stringify(final, null, 2))
  console.log(JSON.stringify(final, null, 2))
}

function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
