/**
 * Phase 5E — Idempotent Shopify forensic catalogue → Unique Commerce OS import.
 * Read-only vs Shopify. Writes Unique catalogue only.
 * Usage: node scripts/phase5e-catalogue-import.mjs [--limit=N]
 */
import { createReadStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PRODUCTS_JSONL = path.join(ROOT, 'shopify-forensic-audit/raw/products/products.jsonl')
const COLLECTIONS_JSONL = path.join(ROOT, 'shopify-forensic-audit/raw/products/collections.jsonl')
const INVENTORY_JSONL = path.join(ROOT, 'shopify-forensic-audit/raw/inventory/inventory-items.jsonl')
const OUT_DIR = path.join(ROOT, 'shopify-forensic-audit/import/out')

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : Infinity

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
  const rl = readline.createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })
  let n = 0
  for await (const line of rl) {
    const rec = unwrap(line)
    if (!rec) continue
    yield rec
    n++
    if (n >= max) break
  }
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

function nodes(conn) {
  if (!conn) return []
  if (Array.isArray(conn)) return conn
  return conn.nodes || []
}

function stripHtml(html) {
  if (!html) return null
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000)
}

function mediaUrl(m) {
  return (
    m?.preview?.image?.url ||
    m?.image?.url ||
    m?.originalSource?.url ||
    m?.sources?.[0]?.url ||
    null
  )
}

async function assertGates() {
  const { data } = await sb
    .from('site_settings')
    .select('key,value')
    .in('key', [
      'commercial_access_mode',
      'pilot_send_authorized',
      'wms_enabled',
      'trade_required_cutover_approved',
      'compliance_enforcement_mode',
    ])
  const map = Object.fromEntries((data || []).map((r) => [r.key, r.value]))
  if (map.commercial_access_mode !== 'catalogue_open') throw new Error('Gate: commercial_access_mode')
  if (map.pilot_send_authorized !== 'false') throw new Error('Gate: pilot_send_authorized')
  if (map.wms_enabled !== 'false') throw new Error('Gate: wms_enabled')
  if (map.trade_required_cutover_approved !== 'false') throw new Error('Gate: cutover')
}

async function main() {
  await assertGates()
  await mkdir(OUT_DIR, { recursive: true })

  const { data: batch, error: batchErr } = await sb
    .from('catalogue_import_batches')
    .insert({
      source: 'shopify_forensic',
      status: 'running',
      notes: 'Phase 5E full catalogue import',
      watermark: { products_jsonl: PRODUCTS_JSONL, started: new Date().toISOString() },
    })
    .select('*')
    .single()
  if (batchErr) throw batchErr
  const batchId = batch.id
  console.log('batch', batchId)

  const counts = {
    collections_upserted: 0,
    products_created: 0,
    products_updated: 0,
    variants_upserted: 0,
    memberships: 0,
    metafields: 0,
    tags: 0,
    media: 0,
    inventory_snapshots: 0,
    conflicts: 0,
    failures: 0,
    warnings: 0,
  }

  // ── Collections first ────────────────────────────────────────────────────
  const collectionByGid = new Map()
  for await (const rec of eachJsonl(COLLECTIONS_JSONL)) {
    const gid = rec.id
    if (!gid) continue
    const handle = rec.handle || `collection-${rec.legacyResourceId || gid.split('/').pop()}`
    const row = {
      title: rec.title || handle,
      slug: handle,
      description: stripHtml(rec.descriptionHtml || rec.description),
      description_html: rec.descriptionHtml || null,
      cover_image_url: rec.image?.url || rec.image?.src || null,
      shopify_collection_gid: gid,
      shopify_legacy_id: rec.legacyResourceId ? String(rec.legacyResourceId) : null,
      shopify_handle: handle,
      seo_title: rec.seo?.title || null,
      seo_description: rec.seo?.description || null,
      collection_type: rec.ruleSet ? 'smart' : 'custom',
      source_system: 'shopify',
      source_updated_at: rec.updatedAt || null,
      rule_definition_json: rec.ruleSet || null,
      rule_definition_status: rec.ruleSet ? 'KNOWN' : 'UNKNOWN',
      is_active: true,
      import_batch_id: batchId,
      type: rec.ruleSet ? 'smart' : 'seasonal',
    }
    const { data: existing } = await sb
      .from('collections')
      .select('id')
      .eq('shopify_collection_gid', gid)
      .maybeSingle()
    let id
    if (existing?.id) {
      const { error } = await sb.from('collections').update(row).eq('id', existing.id)
      if (error) {
        counts.failures++
        console.error('collection update', gid, error.message)
        continue
      }
      id = existing.id
    } else {
      // slug collision with Unique-native?
      const { data: bySlug } = await sb.from('collections').select('id,shopify_collection_gid').eq('slug', handle).maybeSingle()
      if (bySlug && !bySlug.shopify_collection_gid) {
        row.slug = `${handle}-shopify`
        await sb.from('catalogue_import_conflicts').insert({
          batch_id: batchId,
          conflict_type: 'COLLECTION_HANDLE',
          shopify_gid: gid,
          unique_entity_type: 'collection',
          unique_entity_id: bySlug.id,
          details: { handle, remapped_slug: row.slug },
        })
        counts.conflicts++
      }
      const { data: ins, error } = await sb.from('collections').insert(row).select('id').single()
      if (error) {
        counts.failures++
        console.error('collection insert', gid, error.message)
        continue
      }
      id = ins.id
    }
    collectionByGid.set(gid, id)
    counts.collections_upserted++
  }
  console.log('collections', counts.collections_upserted)

  // Preload existing product gids
  const { data: existingProducts } = await sb
    .from('products')
    .select('id,shopify_product_gid,slug,catalogue_origin')
    .not('shopify_product_gid', 'is', null)
  const productByGid = new Map((existingProducts || []).map((p) => [p.shopify_product_gid, p]))

  // SKU frequency for quality flags (two-pass light: build while importing, update later)
  const skuFreq = new Map()
  const barcodeFreq = new Map()

  let productN = 0
  for await (const rec of eachJsonl(PRODUCTS_JSONL, LIMIT)) {
    productN++
    const gid = rec.id
    if (!gid) continue
    try {
      const handle = rec.handle || `product-${rec.legacyResourceId || productN}`
      const variants = nodes(rec.variants)
      const prices = variants.map((v) => money(v.price)).filter((p) => p != null)
      const basePrice = prices.length ? Math.min(...prices) : 0
      const status = String(rec.status || 'ACTIVE').toUpperCase()
      const published = status === 'ACTIVE'
      const mediaNodes = nodes(rec.media)
      const featured =
        mediaUrl(rec.featuredMedia) ||
        mediaUrl(mediaNodes[0]) ||
        null
      const gallery = mediaNodes
        .map(mediaUrl)
        .filter(Boolean)
        .filter((u) => u !== featured)
        .slice(0, 24)

      const tags = Array.isArray(rec.tags) ? rec.tags : []
      const productRow = {
        name: rec.title || handle,
        slug: handle,
        description: stripHtml(rec.descriptionHtml),
        description_html: rec.descriptionHtml || null,
        price: basePrice,
        compare_at_price: money(variants[0]?.compareAtPrice),
        image_url: featured,
        gallery_urls: gallery,
        inventory_count: Number(rec.totalInventory) || 0,
        published,
        vendor: rec.vendor || null,
        product_type: rec.productType || null,
        shopify_status: status,
        source_system: 'shopify',
        shopify_product_gid: gid,
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
        catalogue_origin: 'SHOPIFY_IMPORTED',
        import_batch_id: batchId,
        sku: variants[0]?.sku || null,
      }

      let productId
      const existing = productByGid.get(gid)
      if (existing) {
        const { error } = await sb.from('products').update(productRow).eq('id', existing.id)
        if (error) throw error
        productId = existing.id
        counts.products_updated++
      } else {
        const { data: slugHit } = await sb
          .from('products')
          .select('id,shopify_product_gid,catalogue_origin')
          .eq('slug', handle)
          .maybeSingle()
        if (slugHit && !slugHit.shopify_product_gid) {
          productRow.slug = `${handle}-shopify`
          await sb.from('catalogue_import_conflicts').insert({
            batch_id: batchId,
            conflict_type: 'PRODUCT_HANDLE',
            shopify_gid: gid,
            unique_entity_type: 'product',
            unique_entity_id: slugHit.id,
            details: { handle, remapped_slug: productRow.slug, origin: slugHit.catalogue_origin },
          })
          counts.conflicts++
          await sb.from('products').update({ catalogue_origin: 'POSSIBLE_CONFLICT' }).eq('id', slugHit.id)
        }
        const { data: ins, error } = await sb.from('products').insert(productRow).select('id').single()
        if (error) throw error
        productId = ins.id
        productByGid.set(gid, { id: productId, shopify_product_gid: gid })
        counts.products_created++
      }

      // Variants — replace by upsert on gid
      for (const [i, v] of variants.entries()) {
        const vgid = v.id
        if (!vgid) continue
        const sku = (v.sku || '').trim()
        const barcode = (v.barcode || '').trim()
        if (sku) skuFreq.set(sku, (skuFreq.get(sku) || 0) + 1)
        if (barcode) barcodeFreq.set(barcode, (barcodeFreq.get(barcode) || 0) + 1)

        const optionValues = {}
        for (const o of v.selectedOptions || []) {
          if (o?.name) optionValues[o.name] = o.value
        }
        const inv = v.inventoryItem || {}
        const variantRow = {
          product_id: productId,
          name: v.title || v.displayName || 'Default',
          sku: sku || null,
          barcode: barcode || null,
          price: money(v.price),
          compare_at_price: money(v.compareAtPrice),
          inventory_count: Number(v.inventoryQuantity) || 0,
          option_values: optionValues,
          image_url: mediaUrl(v.image) || null,
          shopify_variant_gid: vgid,
          shopify_legacy_id: v.legacyResourceId ? String(v.legacyResourceId) : null,
          shopify_inventory_item_gid: inv.id || null,
          position: v.position ?? i + 1,
          taxable: v.taxable ?? null,
          weight_value: inv.measurement?.weight?.value ?? inv.weight ?? null,
          weight_unit: inv.measurement?.weight?.unit ?? inv.weightUnit ?? null,
          source_system: 'shopify',
          source_created_at: v.createdAt || null,
          source_updated_at: v.updatedAt || null,
          available_for_sale: v.availableForSale ?? null,
          sku_quality: sku ? 'VALID' : 'MISSING',
          barcode_quality: barcode ? 'VALID' : 'MISSING',
          import_batch_id: batchId,
        }

        const { data: vex } = await sb
          .from('product_variants')
          .select('id')
          .eq('shopify_variant_gid', vgid)
          .maybeSingle()
        if (vex?.id) {
          const { error } = await sb.from('product_variants').update(variantRow).eq('id', vex.id)
          if (error) throw error
        } else {
          const { error } = await sb.from('product_variants').insert(variantRow)
          if (error) throw error
        }
        counts.variants_upserted++

        // Variant metafields
        for (const mf of nodes(v.metafields)) {
          await upsertMetafield('product_variant', await variantUuid(vgid), mf, batchId, counts)
        }
      }

      // Product metafields
      for (const mf of nodes(rec.metafields)) {
        await upsertMetafield('product', productId, mf, batchId, counts)
      }

      // Tags
      for (const raw of tags) {
        if (!raw) continue
        let tagId
        const { data: tEx } = await sb.from('tags').select('id').eq('name', raw).maybeSingle()
        if (tEx?.id) tagId = tEx.id
        else {
          const { data: tIns, error } = await sb
            .from('tags')
            .insert({ name: raw, normalized_name: String(raw).toLowerCase() })
            .select('id')
            .single()
          if (error) {
            // race
            const { data: t2 } = await sb.from('tags').select('id').eq('name', raw).maybeSingle()
            tagId = t2?.id
          } else tagId = tIns.id
        }
        if (!tagId) continue
        await sb.from('entity_tags').upsert(
          {
            tag_id: tagId,
            entity_type: 'product',
            entity_id: productId,
            raw_value: raw,
            source_system: 'shopify',
          },
          { onConflict: 'entity_type,entity_id,tag_id,raw_value', ignoreDuplicates: true },
        )
        counts.tags++
      }

      // Collections membership
      let firstCollectionId = null
      for (const [ci, c] of nodes(rec.collections).entries()) {
        const cgid = c.id
        let cid = collectionByGid.get(cgid)
        if (!cid && cgid) {
          // collection may appear only on product — create stub
          const h = c.handle || `col-${cgid.split('/').pop()}`
          const { data: stub, error } = await sb
            .from('collections')
            .upsert(
              {
                title: c.title || h,
                slug: h,
                shopify_collection_gid: cgid,
                shopify_handle: h,
                source_system: 'shopify',
                is_active: true,
                import_batch_id: batchId,
                rule_definition_status: 'UNKNOWN',
                type: 'seasonal',
              },
              { onConflict: 'shopify_collection_gid' },
            )
            .select('id')
            .single()
          // upsert on unique index may need manual
          if (error) {
            const { data: found } = await sb
              .from('collections')
              .select('id')
              .eq('shopify_collection_gid', cgid)
              .maybeSingle()
            cid = found?.id
          } else {
            cid = stub?.id
            if (cid) collectionByGid.set(cgid, cid)
          }
        }
        if (!cid) continue
        if (!firstCollectionId) firstCollectionId = cid
        const { error: memErr } = await sb.from('product_collections').upsert(
          {
            product_id: productId,
            collection_id: cid,
            position: ci,
            source_system: 'shopify',
            import_batch_id: batchId,
          },
          { onConflict: 'product_id,collection_id' },
        )
        if (!memErr) counts.memberships++
      }
      if (firstCollectionId) {
        await sb.from('products').update({ collection_id: firstCollectionId }).eq('id', productId)
      }

      // Media provenance (CDN referenced; copy later)
      for (const [mi, m] of mediaNodes.entries()) {
        const src = mediaUrl(m)
        if (!src) continue
        const mgid = m.id || null
        const row = {
          product_id: productId,
          shopify_media_gid: mgid,
          position: mi,
          alt_text: m.alt || m.preview?.image?.altText || null,
          source_url: src,
          destination_url: src,
          status: 'SOURCE_REFERENCED',
          width: m.preview?.image?.width || null,
          height: m.preview?.image?.height || null,
          import_batch_id: batchId,
        }
        if (mgid) {
          const { data: mex } = await sb
            .from('product_media')
            .select('id')
            .eq('shopify_media_gid', mgid)
            .maybeSingle()
          if (mex?.id) await sb.from('product_media').update(row).eq('id', mex.id)
          else await sb.from('product_media').insert(row)
        } else {
          await sb.from('product_media').insert(row)
        }
        counts.media++
      }

      if (productN % 50 === 0) console.log(`products ${productN}…`, counts)
    } catch (e) {
      counts.failures++
      console.error('product fail', gid, e.message || e)
    }
  }

  // Mark duplicate SKU/barcode quality
  console.log('flagging duplicate SKU/barcode…')
  const dupSkus = [...skuFreq.entries()].filter(([, n]) => n > 1).map(([s]) => s)
  const dupBars = [...barcodeFreq.entries()].filter(([, n]) => n > 1).map(([s]) => s)
  for (const chunk of chunkArr(dupSkus, 100)) {
    if (!chunk.length) continue
    await sb.from('product_variants').update({ sku_quality: 'DUPLICATE' }).in('sku', chunk)
  }
  for (const chunk of chunkArr(dupBars, 100)) {
    if (!chunk.length) continue
    await sb.from('product_variants').update({ barcode_quality: 'DUPLICATE' }).in('barcode', chunk)
  }

  // Inventory snapshot (source only)
  if (LIMIT === Infinity) {
    console.log('inventory snapshots…')
    for await (const rec of eachJsonl(INVENTORY_JSONL)) {
      const gid = rec.id
      const levels = nodes(rec.inventoryLevels)
      if (!levels.length) {
        const { error } = await sb.from('shopify_inventory_snapshots').insert({
          shopify_inventory_item_gid: gid,
          sku: rec.sku || null,
          tracked: rec.tracked ?? null,
          snapshot_at: new Date().toISOString(),
          import_batch_id: batchId,
          metadata: { legacyResourceId: rec.legacyResourceId || null },
        })
        if (!error) counts.inventory_snapshots++
        continue
      }
      for (const lvl of levels) {
        const loc = lvl.location || {}
        const locName = loc.name || null
        let locationClass = 'UNKNOWN'
        if (/UD WH|Warehouse/i.test(locName || '')) locationClass = 'PHYSICAL_WAREHOUSE'
        if (/^UD00[2-8]$/i.test(locName || '')) locationClass = 'SALESPERSON_VIRTUAL'
        const qty = lvl.quantities || []
        const findQ = (name) => {
          const q = qty.find((x) => String(x.name).toLowerCase() === name)
          return q?.quantity != null ? Number(q.quantity) : null
        }
        const { error } = await sb.from('shopify_inventory_snapshots').insert({
          shopify_inventory_item_gid: gid,
          shopify_location_gid: loc.id || null,
          location_name: locName,
          location_class: locationClass,
          sku: rec.sku || null,
          barcode: rec.barcode || null,
          available: findQ('available') ?? lvl.available ?? null,
          on_hand: findQ('on_hand') ?? null,
          committed: findQ('committed') ?? null,
          incoming: findQ('incoming') ?? null,
          tracked: rec.tracked ?? null,
          snapshot_at: new Date().toISOString(),
          import_batch_id: batchId,
          metadata: { legacyResourceId: rec.legacyResourceId || null },
        })
        if (!error) counts.inventory_snapshots++
      }
    }
  }

  // Compliance reclassify
  console.log('compliance classify…')
  try {
    await sb.rpc('rpc_admin_classify_regulated_products_from_evidence')
  } catch (e) {
    counts.warnings++
    console.warn('classify', e.message || e)
  }

  await sb
    .from('catalogue_import_batches')
    .update({
      status: counts.failures > 100 ? 'partial' : 'completed',
      completed_at: new Date().toISOString(),
      counts,
      created_count: counts.products_created,
      updated_count: counts.products_updated,
      failed_count: counts.failures,
      warning_count: counts.warnings,
      watermark: {
        completed: new Date().toISOString(),
        source_products: 2213,
        source_variants: 12677,
      },
    })
    .eq('id', batchId)

  // Update delta watermarks
  await sb
    .from('delta_watermarks')
    .update({
      cursor_value: new Date().toISOString(),
      last_reconciled_count: counts.products_created + counts.products_updated,
      updated_at: new Date().toISOString(),
      notes: `Phase 5E batch ${batchId}`,
    })
    .eq('entity_type', 'products')

  const summary = { batchId, counts, dupSkuGroups: dupSkus.length, dupBarcodeGroups: dupBars.length }
  await writeFile(path.join(OUT_DIR, 'phase5e-catalogue-import.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
}

const variantCache = new Map()
async function variantUuid(vgid) {
  if (variantCache.has(vgid)) return variantCache.get(vgid)
  const { data } = await sb.from('product_variants').select('id').eq('shopify_variant_gid', vgid).maybeSingle()
  if (data?.id) variantCache.set(vgid, data.id)
  return data?.id
}

async function upsertMetafield(ownerType, ownerId, mf, batchId, counts) {
  if (!ownerId || !mf?.namespace || !mf?.key) return
  const row = {
    owner_type: ownerType,
    owner_id: ownerId,
    namespace: mf.namespace,
    key: mf.key,
    value_type: mf.type || mf.valueType || null,
    value_text: mf.value != null ? String(mf.value) : null,
    value_json: mf.jsonValue ?? (mf.value != null ? { value: mf.value } : null),
    source_system: 'shopify',
    external_gid: mf.id || null,
    source_updated_at: mf.updatedAt || null,
    imported_at: new Date().toISOString(),
  }
  const { data: ex } = await sb
    .from('metafields')
    .select('id')
    .eq('owner_type', ownerType)
    .eq('owner_id', ownerId)
    .eq('namespace', mf.namespace)
    .eq('key', mf.key)
    .eq('source_system', 'shopify')
    .maybeSingle()
  if (ex?.id) {
    await sb.from('metafields').update(row).eq('id', ex.id)
  } else {
    const { error } = await sb.from('metafields').insert(row)
    if (error) return
  }
  counts.metafields++
}

function chunkArr(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
