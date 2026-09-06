import type { Database } from '@/integrations/supabase/database.types'
import { tryGetSupabase } from '@/integrations/supabase/client'

export const EXPORT_FORMAT_VERSION = 1

export type DataBundleId = 'cms' | 'marketing' | 'commerce'

export type TransferPhase = 'idle' | 'reading' | 'exporting' | 'downloading' | 'importing'

export type TransferProgress = {
  phase: TransferPhase
  label: string
  percent: number
  detail?: string
}

type TableName = keyof Database['public']['Tables']

type TableConfig = {
  table: TableName
  conflict: string
  label: string
  sortRows?: (rows: Record<string, unknown>[]) => Record<string, unknown>[]
}

export const DATA_BUNDLES: Record<
  DataBundleId,
  { id: DataBundleId; label: string; description: string; tables: TableConfig[] }
> = {
  cms: {
    id: 'cms',
    label: 'Storefront CMS',
    description:
      'Categories, collections, products, hero slides, feature & lifestyle cards, homepage sections, nav links, pages, site settings, and media library index.',
    tables: [
      { table: 'categories', conflict: 'id', label: 'Categories', sortRows: sortCategoriesParentFirst },
      { table: 'collections', conflict: 'id', label: 'Collections' },
      { table: 'products', conflict: 'id', label: 'Products' },
      { table: 'hero_slides', conflict: 'id', label: 'Hero slides' },
      { table: 'feature_cards', conflict: 'id', label: 'Feature cards' },
      { table: 'lifestyle_cards', conflict: 'id', label: 'Lifestyle cards' },
      { table: 'homepage_sections', conflict: 'id', label: 'Homepage sections' },
      { table: 'nav_links', conflict: 'id', label: 'Nav links' },
      { table: 'marketing_pages', conflict: 'id', label: 'Pages' },
      { table: 'site_settings', conflict: 'key', label: 'Site settings' },
      { table: 'email_templates', conflict: 'template_key', label: 'Email templates' },
      { table: 'cms_media', conflict: 'id', label: 'Media library' },
    ],
  },
  marketing: {
    id: 'marketing',
    label: 'Marketing & leads',
    description: 'Newsletter subscribers and form submissions.',
    tables: [
      { table: 'newsletter_subscribers', conflict: 'id', label: 'Newsletter subscribers' },
      { table: 'form_submissions', conflict: 'id', label: 'Form submissions' },
    ],
  },
  commerce: {
    id: 'commerce',
    label: 'Orders',
    description: 'Orders and line items. Useful for backups and migrations between environments.',
    tables: [
      { table: 'orders', conflict: 'id', label: 'Orders' },
      { table: 'order_items', conflict: 'id', label: 'Order items' },
    ],
  },
}

export type ExportPayload = {
  version: typeof EXPORT_FORMAT_VERSION
  exportedAt: string
  bundles: DataBundleId[]
  data: Partial<Record<TableName, Record<string, unknown>[]>>
  counts: Partial<Record<TableName, number>>
}

const BATCH_SIZE = 100
const PAGE_SIZE = 500

function sortCategoriesParentFirst(rows: Record<string, unknown>[]) {
  const byId = new Map(rows.map((row) => [String(row.id), row]))
  const sorted: Record<string, unknown>[] = []
  const done = new Set<string>()

  function add(row: Record<string, unknown>) {
    const id = String(row.id)
    if (done.has(id)) return
    const parentId = row.parent_id ? String(row.parent_id) : null
    if (parentId && byId.has(parentId) && !done.has(parentId)) {
      add(byId.get(parentId)!)
    }
    sorted.push(row)
    done.add(id)
  }

  rows.forEach(add)
  return sorted
}

function getSupabase() {
  const sb = tryGetSupabase()
  if (!sb) throw new Error('Supabase is not configured')
  return sb
}

async function fetchAllRows(table: TableName): Promise<Record<string, unknown>[]> {
  const sb = getSupabase()
  const all: Record<string, unknown>[] = []
  let from = 0

  while (true) {
    const { data, error } = await sb.from(table).select('*').range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data?.length) break
    all.push(...(data as Record<string, unknown>[]))
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  return all
}

export function readFileAsTextWithProgress(
  file: File,
  onProgress: (percent: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

function downloadBlob(filename: string, blob: Blob, onProgress?: (percent: number) => void) {
  onProgress?.(10)
  const url = URL.createObjectURL(blob)
  onProgress?.(60)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
  onProgress?.(100)
}

export async function exportDataBundles(
  bundleIds: DataBundleId[],
  onProgress: (progress: TransferProgress) => void,
): Promise<void> {
  if (bundleIds.length === 0) throw new Error('Select at least one bundle to export.')

  const tables = bundleIds.flatMap((id) => DATA_BUNDLES[id].tables)
  const payload: ExportPayload = {
    version: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    bundles: bundleIds,
    data: {},
    counts: {},
  }

  for (let i = 0; i < tables.length; i++) {
    const config = tables[i]
    onProgress({
      phase: 'exporting',
      label: `Fetching ${config.label}`,
      percent: Math.round((i / tables.length) * 85),
      detail: `${i + 1} of ${tables.length}`,
    })
    const rows = await fetchAllRows(config.table)
    payload.data[config.table] = rows
    payload.counts[config.table] = rows.length
  }

  onProgress({
    phase: 'exporting',
    label: 'Building export file',
    percent: 90,
  })

  const json = JSON.stringify(payload, null, 2)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const filename = `unique-export-${stamp}.json`
  const blob = new Blob([json], { type: 'application/json' })

  onProgress({
    phase: 'downloading',
    label: 'Downloading export',
    percent: 92,
  })

  downloadBlob(filename, blob, (pct) => {
    onProgress({
      phase: 'downloading',
      label: 'Downloading export',
      percent: 92 + Math.round(pct * 0.08),
    })
  })

  onProgress({
    phase: 'idle',
    label: 'Export complete',
    percent: 100,
    detail: filename,
  })
}

function parseExportPayload(raw: string): ExportPayload {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Invalid JSON file.')
  }

  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid export format.')
  const payload = parsed as ExportPayload
  if (payload.version !== EXPORT_FORMAT_VERSION) {
    throw new Error(`Unsupported export version (${String(payload.version)}). Expected ${EXPORT_FORMAT_VERSION}.`)
  }
  if (!Array.isArray(payload.bundles) || !payload.data || typeof payload.data !== 'object') {
    throw new Error('Export file is missing bundles or data.')
  }
  return payload
}

async function upsertRows(
  config: TableConfig,
  rows: Record<string, unknown>[],
  onBatch: (done: number, total: number) => void,
) {
  if (rows.length === 0) return
  const sb = getSupabase()
  const ordered = config.sortRows ? config.sortRows(rows) : rows

  for (let i = 0; i < ordered.length; i += BATCH_SIZE) {
    const batch = ordered.slice(i, i + BATCH_SIZE)
    const { error } = await sb.from(config.table).upsert(batch, { onConflict: config.conflict })
    if (error) throw new Error(`${config.label}: ${error.message}`)
    onBatch(Math.min(i + batch.length, ordered.length), ordered.length)
  }
}

export async function importDataBundle(
  file: File,
  onProgress: (progress: TransferProgress) => void,
): Promise<{ imported: Partial<Record<TableName, number>> }> {
  onProgress({ phase: 'reading', label: 'Reading file', percent: 0 })
  const raw = await readFileAsTextWithProgress(file, (pct) => {
    onProgress({ phase: 'reading', label: 'Reading file', percent: Math.round(pct * 0.15) })
  })

  onProgress({ phase: 'importing', label: 'Parsing export', percent: 18 })
  const payload = parseExportPayload(raw)

  const tables = payload.bundles.flatMap((id) => DATA_BUNDLES[id]?.tables ?? [])
  if (tables.length === 0) throw new Error('Export file contains no importable bundles.')

  const imported: Partial<Record<TableName, number>> = {}
  const tableCount = tables.length

  for (let i = 0; i < tables.length; i++) {
    const config = tables[i]
    const rows = payload.data[config.table] ?? []
    imported[config.table] = rows.length

    if (rows.length === 0) {
      onProgress({
        phase: 'importing',
        label: `Skipped ${config.label} (empty)`,
        percent: 20 + Math.round(((i + 1) / tableCount) * 75),
        detail: `${i + 1} of ${tableCount}`,
      })
      continue
    }

    await upsertRows(config, rows, (done, total) => {
      const tableBase = 20 + (i / tableCount) * 75
      const tableSpan = 75 / tableCount
      const within = total > 0 ? done / total : 1
      onProgress({
        phase: 'importing',
        label: `Importing ${config.label}`,
        percent: Math.round(tableBase + within * tableSpan),
        detail: `${done} / ${total} records`,
      })
    })
  }

  onProgress({
    phase: 'idle',
    label: 'Import complete',
    percent: 100,
  })

  return { imported }
}

export function summarizeExportCounts(payload: ExportPayload) {
  return Object.entries(payload.counts ?? {})
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([table, count]) => `${table.replace(/_/g, ' ')} (${count})`)
    .join(', ')
}
