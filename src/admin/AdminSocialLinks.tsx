import { useCallback, useEffect, useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { tryGetSupabase } from '@/integrations/supabase/client'
import type { Database } from '@/integrations/supabase/database.types'
import { useCms } from '@/contexts/CmsContext'
import { AdminSheet } from '@/admin/components/AdminSheet'
import { AdminErrorBanner, AdminLoadingState } from '@/admin/components/AdminPageHeading'
import { AdminTabToolbar } from '@/admin/components/AdminTabToolbar'
import { AdminTablePagination } from '@/admin/components/AdminTablePagination'
import { useAdminTablePagination } from '@/admin/useAdminTablePagination'
import { BrandedSelect } from '@/components/ui/BrandedSelect'
import { SOCIAL_ICON_OPTIONS, getSocialIcon } from '@/lib/socialIcons'
import { adminBtnPrimary, adminBtnSecondary, adminInput, adminLabel } from '@/admin/adminClassNames'
import { AdminClickableTableRow, AdminTableStopCell } from '@/admin/components/AdminClickableTableRow'
import { AdminRowActions, adminTableActionsCellClass, adminTableActionsHeadClass, crudRowActions } from '@/admin/components/AdminRowActions'
import { duplicateCopyLabel } from '@/admin/lib/duplicateRecord'

type Row = Database['public']['Tables']['social_links']['Row']

type FormState = {
  label: string
  href: string
  icon: string
  sort_order: string
  is_active: boolean
}

const emptyForm = (): FormState => ({
  label: '',
  href: 'https://',
  icon: SOCIAL_ICON_OPTIONS[0].value,
  sort_order: '0',
  is_active: true,
})

export function AdminSocialLinks() {
  const { refetchCms } = useCms()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Row | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [saving, setSaving] = useState(false)
  const pagination = useAdminTablePagination(rows.length)
  const pageRows = rows.slice(pagination.start, pagination.end)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data, error: fetchError } = await tryGetSupabase().from('social_links').select('*').order('sort_order')
    if (fetchError) setError(fetchError.message)
    else setRows(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setModalOpen(true)
  }

  function openEdit(row: Row) {
    setEditing(row)
    setForm({
      label: row.label,
      href: row.href,
      icon: row.icon,
      sort_order: String(row.sort_order),
      is_active: row.is_active,
    })
    setModalOpen(true)
  }

  function openDuplicate(row: Row) {
    setEditing(null)
    setForm({
      label: duplicateCopyLabel(row.label),
      href: row.href,
      icon: row.icon,
      sort_order: String(row.sort_order),
      is_active: row.is_active,
    })
    setModalOpen(true)
  }

  async function save() {
    if (!form.label.trim()) return setError('Label is required.')
    if (!form.href.trim()) return setError('URL is required.')
    setSaving(true)
    const payload = {
      label: form.label.trim(),
      href: form.href.trim(),
      icon: form.icon,
      sort_order: Number(form.sort_order) || 0,
      is_active: form.is_active,
      updated_at: new Date().toISOString(),
    }
    const result = editing
      ? await tryGetSupabase().from('social_links').update(payload).eq('id', editing.id)
      : await tryGetSupabase().from('social_links').insert(payload)
    setSaving(false)
    if (result.error) return setError(result.error.message)
    toast.success(editing ? 'Social link updated' : 'Social link created')
    setModalOpen(false)
    await refresh()
    await refetchCms()
  }

  async function remove(row: Row) {
    if (!window.confirm(`Delete "${row.label}"?`)) return
    const { error: deleteError } = await tryGetSupabase().from('social_links').delete().eq('id', row.id)
    if (deleteError) return setError(deleteError.message)
    toast.success('Social link deleted')
    await refresh()
    await refetchCms()
  }

  if (loading) return <AdminLoadingState />

  const FormIcon = getSocialIcon(form.icon)

  return (
    <div>
      <AdminTabToolbar
        actions={
          <>
            <button type="button" className={adminBtnSecondary} onClick={() => void refresh()}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            <button type="button" className={adminBtnPrimary} onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Add social link
            </button>
          </>
        }
      />
      <AdminErrorBanner message={error} />
      <p className="mb-4 text-sm text-[var(--admin-muted)]">
        Shown in the site footer with Lucide icons. Use full URLs (https://…) for external profiles.
      </p>
      <div className="admin-table-frame">
        <div className="admin-table-wrap">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="bg-[var(--admin-surface)] text-[var(--admin-muted)]">
              <tr>
                <th className="w-12 px-4 py-3">Icon</th>
                <th className="px-4 py-3">Label</th>
                <th className="px-4 py-3">URL</th>
                <th className="px-4 py-3">Active</th>
                <th className={adminTableActionsHeadClass}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => {
                const Icon = getSocialIcon(row.icon)
                return (
                  <AdminClickableTableRow key={row.id} onOpen={() => openEdit(row)}>
                    <td className="px-4 py-3">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface)]">
                        <Icon className="h-4 w-4" aria-hidden />
                      </span>
                    </td>
                    <td className="px-4 py-3">{row.label}</td>
                    <td className="max-w-[240px] truncate px-4 py-3 text-[var(--admin-muted)]">{row.href}</td>
                    <td className="px-4 py-3">{row.is_active ? 'Yes' : 'No'}</td>
                    <AdminTableStopCell className={adminTableActionsCellClass}>
                      <AdminRowActions
                        label={`Actions for ${row.label}`}
                        actions={crudRowActions({
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
        <div className="border-t border-[var(--admin-border)] p-4">
          <AdminTablePagination {...pagination} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} />
        </div>
      </div>

      <AdminSheet
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editing ? 'Edit social link' : 'New social link'}
        onSave={() => void save()}
        saving={saving}
      >
        <div className="grid gap-4">
          <div className="space-y-2">
            <label className={adminLabel}>Label</label>
            <input
              className={adminInput}
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="Instagram"
            />
          </div>
          <div className="space-y-2">
            <label className={adminLabel}>URL</label>
            <input
              className={adminInput}
              value={form.href}
              onChange={(e) => setForm((f) => ({ ...f, href: e.target.value }))}
              placeholder="https://instagram.com/uniquedistribution"
            />
          </div>
          <div className="space-y-2">
            <label className={adminLabel}>Icon</label>
            <BrandedSelect
              value={form.icon}
              onValueChange={(icon) => setForm((f) => ({ ...f, icon }))}
              options={SOCIAL_ICON_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
            <p className="flex items-center gap-2 text-xs text-[var(--admin-muted)]">
              Preview:
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--admin-border)]">
                <FormIcon className="h-4 w-4" aria-hidden />
              </span>
            </p>
          </div>
          <div className="space-y-2">
            <label className={adminLabel}>Sort order</label>
            <input
              className={adminInput}
              type="number"
              value={form.sort_order}
              onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
            />
            Active
          </label>
        </div>
      </AdminSheet>
    </div>
  )
}
