import { useCallback, useEffect, useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { tryGetSupabase } from '@/integrations/supabase/client'
import type { Database } from '@/integrations/supabase/database.types'
import { useCms } from '@/contexts/CmsContext'
import { AdminSheet } from '@/admin/components/AdminSheet'
import { AdminBulkToolbar } from '@/admin/components/AdminBulkToolbar'
import { EntityDetailSheet } from '@/admin/components/EntityDetailSheet'
import { AdminTablePagination } from '@/admin/components/AdminTablePagination'
import { AdminErrorBanner, AdminLoadingState } from '@/admin/components/AdminPageHeading'
import { AdminTabToolbar } from '@/admin/components/AdminTabToolbar'
import { ImageUploadField } from '@/admin/components/ImageUploadField'
import { useAdminTablePagination } from '@/admin/useAdminTablePagination'
import { useBulkSelection } from '@/admin/hooks/useBulkSelection'
import { adminBtnPrimary, adminBtnSecondary, adminInput, adminLabel } from '@/admin/adminClassNames'
import { AdminClickableTableRow, AdminTableStopCell } from '@/admin/components/AdminClickableTableRow'
import { AdminRowActions, adminTableActionsCellClass, adminTableActionsHeadClass, crudRowActions } from '@/admin/components/AdminRowActions'
import { DEFAULT_HERO_BACKGROUND } from '@/lib/brandPalette'

type Row = Database['public']['Tables']['hero_slides']['Row']

type FormState = {
  headline_lines: string
  cta_label: string
  cta_url: string
  image_url: string
  image_url_tablet: string
  image_url_mobile: string
  background_color: string
  sort_order: string
  is_active: boolean
}

const emptyForm = (): FormState => ({
  headline_lines: '',
  cta_label: 'Shop Now',
  cta_url: '/collection/all',
  image_url: '',
  image_url_tablet: '',
  image_url_mobile: '',
  background_color: DEFAULT_HERO_BACKGROUND,
  sort_order: '0',
  is_active: true,
})

export function AdminHeroSlides() {
  const { refetchCms } = useCms()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Row | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [detail, setDetail] = useState<Row | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const pagination = useAdminTablePagination(rows.length)
  const pageRows = rows.slice(pagination.start, pagination.end)
  const bulk = useBulkSelection(pageRows.map((r) => r.id))

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data, error: fetchError } = await tryGetSupabase().from('hero_slides').select('*').order('sort_order')
    if (fetchError) setError(fetchError.message)
    else setRows(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  function parseLines(value: string) {
    return value.split('\n').map((l) => l.trim()).filter(Boolean)
  }

  function openCreate() { setEditing(null); setForm(emptyForm()); setModalOpen(true) }
  function openEdit(row: Row) {
    const lines = Array.isArray(row.headline_lines) ? (row.headline_lines as string[]) : []
    setEditing(row)
    setForm({
      headline_lines: lines.join('\n'),
      cta_label: row.cta_label ?? '',
      cta_url: row.cta_url ?? '',
      image_url: row.image_url ?? '',
      image_url_tablet: row.image_url_tablet ?? '',
      image_url_mobile: row.image_url_mobile ?? '',
      background_color: row.background_color ?? DEFAULT_HERO_BACKGROUND,
      sort_order: String(row.sort_order),
      is_active: row.is_active,
    })
    setModalOpen(true)
  }

  function openDuplicate(row: Row) {
    const lines = Array.isArray(row.headline_lines) ? (row.headline_lines as string[]) : []
    setEditing(null)
    setForm({
      headline_lines: lines.join('\n'),
      cta_label: row.cta_label ?? '',
      cta_url: row.cta_url ?? '',
      image_url: row.image_url ?? '',
      image_url_tablet: row.image_url_tablet ?? '',
      image_url_mobile: row.image_url_mobile ?? '',
      background_color: row.background_color ?? DEFAULT_HERO_BACKGROUND,
      sort_order: String(row.sort_order),
      is_active: row.is_active,
    })
    setModalOpen(true)
  }

  async function save() {
    const lines = parseLines(form.headline_lines)
    if (lines.length === 0) return setError('At least one headline line is required.')
    setSaving(true)
    const payload = {
      headline_lines: lines,
      cta_label: form.cta_label.trim() || null,
      cta_url: form.cta_url.trim() || null,
      image_url: form.image_url.trim() || null,
      image_url_tablet: form.image_url_tablet.trim() || null,
      image_url_mobile: form.image_url_mobile.trim() || null,
      background_color: form.background_color,
      sort_order: Number(form.sort_order) || 0,
      is_active: form.is_active,
      updated_at: new Date().toISOString(),
    }
    const result = editing
      ? await tryGetSupabase().from('hero_slides').update(payload).eq('id', editing.id)
      : await tryGetSupabase().from('hero_slides').insert(payload)
    setSaving(false)
    if (result.error) return setError(result.error.message)
    toast.success(editing ? 'Hero slide updated' : 'Hero slide created')
    setModalOpen(false)
    await refresh()
    await refetchCms()
  }

  async function remove(row: Row) {
    if (!window.confirm('Delete this hero slide?')) return
    const { error: deleteError } = await tryGetSupabase().from('hero_slides').delete().eq('id', row.id)
    if (deleteError) return setError(deleteError.message)
    toast.success('Hero slide deleted')
    await refresh()
    await refetchCms()
  }

  async function bulkDelete() {
    if (bulk.selectedIds.length === 0) return
    if (!window.confirm(`Delete ${bulk.selectedIds.length} hero slide(s)?`)) return
    setBulkBusy(true)
    const { error: deleteError } = await tryGetSupabase().from('hero_slides').delete().in('id', bulk.selectedIds)
    setBulkBusy(false)
    if (deleteError) return setError(deleteError.message)
    toast.success(`${bulk.selectedIds.length} hero slide(s) deleted`)
    bulk.clear()
    await refresh()
    await refetchCms()
  }

  async function bulkSetActive(is_active: boolean) {
    if (bulk.selectedIds.length === 0) return
    setBulkBusy(true)
    const { error: updateError } = await tryGetSupabase()
      .from('hero_slides')
      .update({ is_active, updated_at: new Date().toISOString() })
      .in('id', bulk.selectedIds)
    setBulkBusy(false)
    if (updateError) return setError(updateError.message)
    toast.success(is_active ? 'Hero slides activated' : 'Hero slides deactivated')
    bulk.clear()
    await refresh()
    await refetchCms()
  }

  if (loading) return <AdminLoadingState />

  return (
    <div>
      <AdminTabToolbar actions={
        <>
          <button type="button" className={adminBtnSecondary} onClick={() => void refresh()}><RefreshCw className="h-4 w-4" />Refresh</button>
          <button type="button" className={adminBtnPrimary} onClick={openCreate}><Plus className="h-4 w-4" />Add slide</button>
        </>
      } />
      <AdminErrorBanner message={error} />
      <AdminBulkToolbar
        selectedCount={bulk.selectedIds.length}
        onClear={bulk.clear}
        onDelete={() => void bulkDelete()}
        onPublish={() => void bulkSetActive(true)}
        onUnpublish={() => void bulkSetActive(false)}
        busy={bulkBusy}
      />
      <div className="admin-table-frame">
        <div className="admin-table-wrap">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="bg-[var(--admin-surface)] text-[var(--admin-muted)]">
              <tr>
                <th className="w-10 px-4 py-3"><input type="checkbox" checked={bulk.allSelected} onChange={bulk.toggleAll} aria-label="Select all on page" /></th>
                <th className="px-4 py-3">Headline</th><th className="px-4 py-3">CTA</th><th className="px-4 py-3">Active</th><th className={adminTableActionsHeadClass}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => {
                const lines = Array.isArray(row.headline_lines) ? (row.headline_lines as string[]) : []
                return (
                  <AdminClickableTableRow key={row.id} onOpen={() => setDetail(row)}>
                    <AdminTableStopCell className="w-10 px-4 py-3"><input type="checkbox" checked={bulk.selected.has(row.id)} onChange={() => bulk.toggle(row.id)} aria-label="Select hero slide" /></AdminTableStopCell>
                    <td className="px-4 py-3">{lines[0] ?? '—'}</td>
                    <td className="px-4 py-3">{row.cta_label}</td>
                    <td className="px-4 py-3">{row.is_active ? 'Yes' : 'No'}</td>
                    <AdminTableStopCell className={adminTableActionsCellClass}>
                      <AdminRowActions
                        label="Hero slide actions"
                        actions={crudRowActions({
                          onView: () => setDetail(row),
                          onEdit: () => openEdit(row),
                          onDuplicate: () => openDuplicate(row),
                          onDelete: () => void remove(row),
                        })}
                      />
                    </AdminTableStopCell>
                  </AdminClickableTableRow>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-[var(--admin-border)] p-4"><AdminTablePagination {...pagination} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} /></div>
      </div>
      <AdminSheet open={modalOpen} onOpenChange={setModalOpen} title={editing ? 'Edit hero slide' : 'New hero slide'} onSave={() => void save()} saving={saving} size="lg">
        <div className="grid gap-4">
          <div className="space-y-2"><label className={adminLabel}>Headline lines (one per line)</label><textarea className={`${adminInput} min-h-24 py-2`} value={form.headline_lines} onChange={(e) => setForm((f) => ({ ...f, headline_lines: e.target.value }))} /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><label className={adminLabel}>CTA label</label><input className={adminInput} value={form.cta_label} onChange={(e) => setForm((f) => ({ ...f, cta_label: e.target.value }))} /></div>
            <div className="space-y-2"><label className={adminLabel}>CTA URL</label><input className={adminInput} value={form.cta_url} onChange={(e) => setForm((f) => ({ ...f, cta_url: e.target.value }))} /></div>
          </div>
          <div className="space-y-3 rounded-lg border border-[var(--admin-border)] p-4">
            <p className="text-sm font-medium">Background images</p>
            <p className="text-xs text-[var(--admin-muted)]">
              Upload desktop, tablet, and mobile versions. Empty fields fall back to Site Settings hero defaults.
            </p>
            <ImageUploadField label="Desktop (1024px+)" value={form.image_url} onChange={(url) => setForm((f) => ({ ...f, image_url: url }))} folder="hero" />
            <ImageUploadField label="Tablet (640px – 1023px)" value={form.image_url_tablet} onChange={(url) => setForm((f) => ({ ...f, image_url_tablet: url }))} folder="hero" />
            <ImageUploadField label="Mobile (below 640px)" value={form.image_url_mobile} onChange={(url) => setForm((f) => ({ ...f, image_url_mobile: url }))} folder="hero" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><label className={adminLabel}>Background color</label><input className={adminInput} type="color" value={form.background_color} onChange={(e) => setForm((f) => ({ ...f, background_color: e.target.value }))} /></div>
            <div className="space-y-2"><label className={adminLabel}>Sort order</label><input className={adminInput} type="number" value={form.sort_order} onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />Active</label>
        </div>
      </AdminSheet>
      <EntityDetailSheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)} title="Hero slide" fields={detail ? [
        { label: 'Headlines', value: (Array.isArray(detail.headline_lines) ? detail.headline_lines as string[] : []).join(' / ') },
        { label: 'CTA', value: `${detail.cta_label} → ${detail.cta_url}` },
      ] : []} />
    </div>
  )
}
