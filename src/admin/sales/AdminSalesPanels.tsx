import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import {
  fetchSalesOverview,
  fetchSalesOpsDashboard,
  listStaffDirectory,
  listCompanyDuplicateCandidates,
  reviewCompanyDuplicate,
  rebuildCompanyDuplicateCandidates,
  listCompanyOwnershipCandidates,
  fetchStaffAliasMatrix,
  rebuildStaffAliases,
  upsertStaffMember,
  type StaffDirectoryRow,
  type CompanyDuplicateReviewRow,
  type OwnershipCandidateRow,
} from '@/admin/lib/adminRpc'
import { AdminLoadingState, AdminErrorBanner } from '@/admin/components/AdminPageHeading'
import { adminBtnPrimary, adminBtnSecondary, adminInput, adminLabel } from '@/admin/adminClassNames'
import { BrandedSelect } from '@/components/ui/BrandedSelect'
import { useAdminAuth } from '@/contexts/AdminAuthContext'
import { useCms } from '@/contexts/CmsContext'
import { getCurrencyFromSettings, formatCurrency } from '@/lib/currency'

function money(n: unknown, code: string) {
  return formatCurrency(Number(n ?? 0), { code, locale: 'en-GB' })
}

export function AdminSalesOverviewPanel() {
  const { staffMemberId } = useAdminAuth()
  const { snapshot } = useCms()
  const currency = getCurrencyFromSettings(snapshot.siteSettings).code || 'GBP'
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [ops, setOps] = useState<Record<string, unknown> | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [overview, dashboard] = await Promise.all([
        fetchSalesOverview(staffMemberId ?? undefined),
        fetchSalesOpsDashboard().catch(() => null),
      ])
      setData(overview)
      setOps(dashboard)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load sales overview')
    } finally {
      setLoading(false)
    }
  }, [staffMemberId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (loading) return <AdminLoadingState />
  if (!data) return <AdminErrorBanner message="No sales overview data." />

  const current = (data.current_ownership ?? {}) as Record<string, number>
  const hist = (data.historical_attribution ?? {}) as Record<string, number>
  const metrics = (ops?.metrics ?? {}) as Record<string, number>

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--admin-text)]">Sales overview</h2>
          <p className="mt-1 text-sm text-[var(--admin-muted)]">
            {String(data.staff_name ?? 'No linked staff')} · current ownership vs historical attribution
          </p>
        </div>
        <button type="button" className={adminBtnSecondary} onClick={() => void refresh()}>
          <RefreshCw className="size-4" /> Refresh
        </button>
      </div>
      {!staffMemberId && (
        <p className="rounded-md border border-[var(--admin-border)] px-3 py-2 text-sm text-[var(--admin-muted)]">
          Link your admin account to a staff member under Staff directory to enable My metrics.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Assigned customers', current.customers ?? metrics.assigned_customers],
          ['Assigned companies', current.companies ?? metrics.assigned_companies],
          ['Orders attributed (hist.)', hist.orders],
          ['Open drafts', metrics.open_drafts ?? hist.open_drafts],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-md border border-[var(--admin-border)] p-3">
            <div className="text-xs text-[var(--admin-muted)]">{label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{Number(value ?? 0).toLocaleString()}</div>
          </div>
        ))}
      </div>
      {ops && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Recent orders (30d)', metrics.recent_orders_30d],
            ['Open AR accounts', metrics.open_ar_accounts],
            ['Trade pending', metrics.trade_pending],
            ['Ownership reviews', metrics.ownership_review_workload],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-md border border-[var(--admin-border)] p-3">
              <div className="text-xs text-[var(--admin-muted)]">{label}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{Number(value ?? 0).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-[var(--admin-border)] p-3">
          <div className="text-xs text-[var(--admin-muted)]">Outstanding AR (current CRM owner)</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">
            {money(data.outstanding_ar_current_crm, currency)}
          </div>
        </div>
        <div className="rounded-md border border-[var(--admin-border)] p-3">
          <div className="text-xs text-[var(--admin-muted)]">Overdue AR (explicit due dates only)</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">
            {money(data.overdue_ar_explicit_due_only, currency)}
          </div>
          <p className="mt-1 text-xs text-[var(--admin-muted)]">no_due_date is never overdue</p>
        </div>
      </div>
      <p className="text-xs text-[var(--admin-muted)]">
        Order value attributed = {money(hist.order_value_attributed, currency)} (not cash collected · no
        commissions · no staff leaderboard).{' '}
        <Link to="/backend/customers" className="underline">
          Customers
        </Link>
        {' · '}
        <Link to="/backend/companies" className="underline">
          Companies
        </Link>
        {' · '}
        <Link to="/backend/finance/receivables" className="underline">
          Receivables
        </Link>
        {' · '}
        <Link to="/backend/sales" className="underline">
          Ownership approval
        </Link>
      </p>
    </div>
  )
}

export function AdminStaffDirectoryPanel() {
  const { canReassignOwnership } = useAdminAuth()
  const [rows, setRows] = useState<StaffDirectoryRow[]>([])
  const [aliases, setAliases] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [staff, matrix] = await Promise.all([listStaffDirectory(true), fetchStaffAliasMatrix(80)])
      setRows(staff)
      setAliases(matrix)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load staff')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function createStaff() {
    if (!name.trim()) return
    try {
      await upsertStaffMember(null, { name: name.trim(), active: true, provenance: 'unique_manual' })
      setName('')
      toast.success('Staff member created')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed')
    }
  }

  async function toggleActive(row: StaffDirectoryRow) {
    try {
      await upsertStaffMember(row.id, { active: !row.active })
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    }
  }

  if (loading) return <AdminLoadingState />

  const aliasItems = (aliases?.items as Array<Record<string, unknown>> | undefined) ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1">
          <label className={adminLabel}>New staff name</label>
          <input className={adminInput} value={name} onChange={(e) => setName(e.target.value)} disabled={!canReassignOwnership} />
        </div>
        <button type="button" className={adminBtnPrimary} disabled={!canReassignOwnership} onClick={() => void createStaff()}>
          Add staff
        </button>
        <button
          type="button"
          className={adminBtnSecondary}
          onClick={() =>
            void rebuildStaffAliases()
              .then(() => refresh())
              .then(() => toast.success('Aliases rebuilt'))
              .catch((e) => toast.error(e instanceof Error ? e.message : 'Rebuild failed'))
          }
        >
          Rebuild aliases
        </button>
      </div>

      <div className="overflow-x-auto rounded-md border border-[var(--admin-border)]">
        <table className="min-w-full text-sm">
          <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-muted)]">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Active</th>
              <th className="px-3 py-2">Admin link</th>
              <th className="px-3 py-2">Customers</th>
              <th className="px-3 py-2">Companies</th>
              <th className="px-3 py-2">Aliases</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[var(--admin-border)]">
                <td className="px-3 py-2 font-medium">{r.name}</td>
                <td className="px-3 py-2">{r.active ? 'Yes' : 'No'}</td>
                <td className="px-3 py-2 text-[var(--admin-muted)]">
                  {r.linked_admin ? `${r.linked_admin.email} (${r.linked_admin.role})` : '—'}
                </td>
                <td className="px-3 py-2 tabular-nums">{r.customer_count}</td>
                <td className="px-3 py-2 tabular-nums">{r.company_count}</td>
                <td className="px-3 py-2 tabular-nums">{r.alias_count}</td>
                <td className="px-3 py-2 text-right">
                  {canReassignOwnership && (
                    <button type="button" className={adminBtnSecondary} onClick={() => void toggleActive(r)}>
                      {r.active ? 'Deactivate' : 'Activate'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-[var(--admin-text)]">Staff alias matrix (preview)</h3>
        <p className="mt-1 text-xs text-[var(--admin-muted)]">
          Exact-name matches only auto-resolve. Ambiguous values stay unresolved.
        </p>
        <div className="mt-2 max-h-72 overflow-auto rounded-md border border-[var(--admin-border)]">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-[var(--admin-surface-2)] text-left text-xs uppercase text-[var(--admin-muted)]">
              <tr>
                <th className="px-3 py-2">Raw</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Count</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Staff</th>
              </tr>
            </thead>
            <tbody>
              {aliasItems.map((a) => (
                <tr key={String(a.id)} className="border-t border-[var(--admin-border)]">
                  <td className="px-3 py-2">{String(a.raw_value)}</td>
                  <td className="px-3 py-2 text-xs text-[var(--admin-muted)]">{String(a.source)}</td>
                  <td className="px-3 py-2 tabular-nums">{Number(a.occurrence_count)}</td>
                  <td className="px-3 py-2">{String(a.status)}</td>
                  <td className="px-3 py-2">{String(a.staff_name ?? '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export function AdminDuplicateCompaniesPanel() {
  const [rows, setRows] = useState<CompanyDuplicateReviewRow[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await listCompanyDuplicateCandidates(status || undefined))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load duplicates')
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function setReview(id: string, next: string) {
    try {
      await reviewCompanyDuplicate(id, next)
      toast.success(`Marked ${next.replace(/_/g, ' ').toLowerCase()}`)
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Review failed')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <BrandedSelect
          value={status}
          onValueChange={setStatus}
          allowEmpty
          emptyLabel="All statuses"
          options={[
            { value: 'POTENTIAL_DUPLICATE', label: 'Potential duplicate' },
            { value: 'REVIEWED', label: 'Reviewed' },
            { value: 'NOT_DUPLICATE', label: 'Not duplicate' },
          ]}
        />
        <button
          type="button"
          className={adminBtnSecondary}
          onClick={() =>
            void rebuildCompanyDuplicateCandidates()
              .then(() => refresh())
              .then(() => toast.success('Candidates rebuilt'))
              .catch((e) => toast.error(e instanceof Error ? e.message : 'Rebuild failed'))
          }
        >
          Rebuild candidates
        </button>
      </div>
      <p className="text-xs text-[var(--admin-muted)]">Review only — no merge in Phase 4B.</p>
      {loading ? (
        <AdminLoadingState />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-md border border-[var(--admin-border)] p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{r.company_names?.join(' · ')}</div>
                  <div className="text-xs text-[var(--admin-muted)]">
                    {r.status} · {r.company_ids?.length ?? 0} records · {r.group_key}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={adminBtnSecondary} onClick={() => void setReview(r.id, 'REVIEWED')}>
                    Mark reviewed
                  </button>
                  <button type="button" className={adminBtnSecondary} onClick={() => void setReview(r.id, 'NOT_DUPLICATE')}>
                    Not duplicate
                  </button>
                  <button
                    type="button"
                    className={adminBtnSecondary}
                    onClick={() => void setReview(r.id, 'POTENTIAL_DUPLICATE')}
                  >
                    Potential
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function AdminOwnershipCandidatesPanel() {
  const [rows, setRows] = useState<OwnershipCandidateRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void listCompanyOwnershipCandidates(80)
      .then(setRows)
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load candidates'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <AdminLoadingState />

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--admin-muted)]">
        Preview only — no bulk ownership backfill. Approve separately in a later phase.
      </p>
      <div className="overflow-x-auto rounded-md border border-[var(--admin-border)]">
        <table className="min-w-full text-sm">
          <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase text-[var(--admin-muted)]">
            <tr>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Current</th>
              <th className="px-3 py-2">Proposed</th>
              <th className="px-3 py-2">Evidence</th>
              <th className="px-3 py-2">Confidence</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.company_id} className="border-t border-[var(--admin-border)]">
                <td className="px-3 py-2">
                  <Link to="/backend/companies/$companyId" params={{ companyId: r.company_id }} className="underline">
                    {r.company_name}
                  </Link>
                </td>
                <td className="px-3 py-2">{r.current_owner_name ?? '—'}</td>
                <td className="px-3 py-2">{r.proposed_owner_name ?? '—'}</td>
                <td className="px-3 py-2 tabular-nums">{r.evidence_count ?? 0}</td>
                <td className="px-3 py-2">{r.confidence ?? '—'}</td>
                <td className="px-3 py-2">{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
