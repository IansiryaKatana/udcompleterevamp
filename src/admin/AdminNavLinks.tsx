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
import { useAdminTablePagination } from '@/admin/useAdminTablePagination'
import { useBulkSelection } from '@/admin/hooks/useBulkSelection'
import { BrandedSelect } from '@/components/ui/BrandedSelect'
import { adminBtnPrimary, adminBtnSecondary, adminInput, adminLabel } from '@/admin/adminClassNames'
import { AdminClickableTableRow, AdminTableStopCell } from '@/admin/components/AdminClickableTableRow'
import { AdminRowActions, adminTableActionsCellClass, adminTableActionsHeadClass, crudRowActions } from '@/admin/components/AdminRowActions'
import { duplicateCopyLabel } from '@/admin/lib/duplicateRecord'

type Row = Database['public']['Tables']['nav_links']['Row']
type Location = Row['location']

type FormState = { label: string; href: string; location: Location; sort_order: string; is_active: boolean }

const emptyForm = (): FormState => ({ label: '', href: '/', location: 'header', sort_order: '0', is_active: true })

const LOCATIONS: { value: Location; label: string }[] = [
  { value: 'header', label: 'Header' },
  { value: 'footer_shop', label: 'Footer — Shop' },
  { value: 'footer_trade', label: 'Footer — Trade (unused)' },
  { value: 'footer_company', label: 'Footer — Service' },
  { value: 'footer_support', label: 'Footer — Support (unused)' },
  { value: 'footer_categories', label: 'Footer — Categories (legacy)' },
  { value: 'footer_legal', label: 'Footer — Legal' },
  { value: 'footer_help', label: 'Footer — Vape News' },
]

export function AdminNavLinks() {
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
    const { data, error: fetchError } = await tryGetSupabase().from('nav_links').select('*').order('sort_order')
    if (fetchError) setError(fetchError.message)
    else setRows(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  function openCreate() { setEditing(null); setForm(emptyForm()); setModalOpen(true) }
  function openEdit(row: Row) {
    setEditing(row)
    setForm({ label: row.label, href: row.href, location: row.location, sort_order: String(row.sort_order), is_active: row.is_active })
    setModalOpen(true)
  }

  function openDuplicate(row: Row) {
    setEditing(null)
    setForm({
      label: duplicateCopyLabel(row.label),
      href: row.href,
      location: row.location,
      sort_order: String(row.sort_order),
      is_active: row.is_active,
    })
    setModalOpen(true)
  }

  async function save() {
    if (!form.label.trim()) return setError('Label is required.')
    if (!form.href.trim()) return setError('Href is required.')
    setSaving(true)
    const payload = { label: form.label.trim(), href: form.href.trim(), location: form.location, sort_order: Number(form.sort_order) || 0, is_active: form.is_active, updated_at: new Date().toISOString() }
    const result = editing ? await tryGetSupabase().from('nav_links').update(payload).eq('id', editing.id) : await tryGetSupabase().from('nav_links').insert(payload)
    setSaving(false)
    if (result.error) return setError(result.error.message)
    toast.success(editing ? 'Nav link updated' : 'Nav link created')
    setModalOpen(false)
    await refresh()
    await refetchCms()
  }

  async function remove(row: Row) {
    if (!window.confirm(`Delete "${row.label}"?`)) return
    const { error: deleteError } = await tryGetSupabase().from('nav_links').delete().eq('id', row.id)
    if (deleteError) return setError(deleteError.message)
    toast.success('Nav link deleted')
    await refresh()
    await refetchCms()
  }

  async function bulkDelete() {
    if (bulk.selectedIds.length === 0) return
    if (!window.confirm(`Delete ${bulk.selectedIds.length} nav link(s)?`)) return
    setBulkBusy(true)
    const { error: deleteError } = await tryGetSupabase().from('nav_links').delete().in('id', bulk.selectedIds)
    setBulkBusy(false)
    if (deleteError) return setError(deleteError.message)
    toast.success(`${bulk.selectedIds.length} nav link(s) deleted`)
    bulk.clear()
    await refresh()
    await refetchCms()
  }

  async function bulkSetActive(is_active: boolean) {
    if (bulk.selectedIds.length === 0) return
    setBulkBusy(true)
    const { error: updateError } = await tryGetSupabase()
      .from('nav_links')
      .update({ is_active, updated_at: new Date().toISOString() })
      .in('id', bulk.selectedIds)
    setBulkBusy(false)
    if (updateError) return setError(updateError.message)
    toast.success(is_active ? 'Nav links activated' : 'Nav links deactivated')
    bulk.clear()
    await refresh()
    await refetchCms()
  }

  if (loading) return <AdminLoadingState />

  return (
    <div>
      <AdminTabToolbar actions={<><button type="button" className={adminBtnSecondary} onClick={() => void refresh()}><RefreshCw className="h-4 w-4" />Refresh</button><button type="button" className={adminBtnPrimary} onClick={openCreate}><Plus className="h-4 w-4" />Add link</button></>} />
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
                <th className="px-4 py-3">Label</th><th className="px-4 py-3">Href</th><th className="px-4 py-3">Location</th><th className="px-4 py-3">Active</th><th className={adminTableActionsHeadClass}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <AdminClickableTableRow key={row.id} onOpen={() => setDetail(row)}>
                  <AdminTableStopCell className="w-10 px-4 py-3"><input type="checkbox" checked={bulk.selected.has(row.id)} onChange={() => bulk.toggle(row.id)} aria-label={`Select ${row.label}`} /></AdminTableStopCell>
                  <td className="px-4 py-3">{row.label}</td>
                  <td className="px-4 py-3 text-[var(--admin-muted)]">{row.href}</td>
                  <td className="px-4 py-3">{row.location}</td>
                  <td className="px-4 py-3">{row.is_active ? 'Yes' : 'No'}</td>
                  <AdminTableStopCell className={adminTableActionsCellClass}>
                    <AdminRowActions
                      label={`Actions for ${row.label}`}
                      actions={crudRowActions({
                        onView: () => setDetail(row),
                        onEdit: () => openEdit(row),
                        onDuplicate: () => openDuplicate(row),
                        onDelete: () => void remove(row),
                      })}
                    />
                  </AdminTableStopCell>
                </AdminClickableTableRow>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-[var(--admin-border)] p-4"><AdminTablePagination {...pagination} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} /></div>
      </div>
      <AdminSheet open={modalOpen} onOpenChange={setModalOpen} title={editing ? 'Edit nav link' : 'New nav link'} onSave={() => void save()} saving={saving}>
        <div className="grid gap-4">
          <div className="space-y-2"><label className={adminLabel}>Label</label><input className={adminInput} value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} /></div>
          <div className="space-y-2"><label className={adminLabel}>Href</label><input className={adminInput} value={form.href} onChange={(e) => setForm((f) => ({ ...f, href: e.target.value }))} /></div>
          <div className="space-y-2"><label className={adminLabel}>Location</label><BrandedSelect value={form.location} onValueChange={(location) => setForm((f) => ({ ...f, location: location as Location }))} options={LOCATIONS.map((l) => ({ value: l.value, label: l.label }))} /></div>
          <div className="space-y-2"><label className={adminLabel}>Sort order</label><input className={adminInput} type="number" value={form.sort_order} onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />Active</label>
        </div>
      </AdminSheet>
      <EntityDetailSheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)} title={detail?.label ?? ''} fields={detail ? [{ label: 'Href', value: detail.href }, { label: 'Location', value: detail.location }] : []} />
    </div>
  )
}
