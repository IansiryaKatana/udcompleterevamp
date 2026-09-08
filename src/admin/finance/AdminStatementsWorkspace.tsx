import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  generateAdminStatement,
  getAdminStatement,
  listAdminStatements,
  type AdminStatementRow,
} from '@/admin/lib/adminRpc'
import {
  canMutateFinance,
  filtersToJson,
  financeMoney,
  fmtFinanceDate,
  newIdempotencyKey,
  type StatementListFilters,
} from '@/admin/lib/financeOps'
import { FinanceSubNav } from '@/admin/finance/FinanceSubNav'
import { AdminLoadingState } from '@/admin/components/AdminPageHeading'
import { AdminTablePagination } from '@/admin/components/AdminTablePagination'
import { useAdminTablePagination } from '@/admin/useAdminTablePagination'
import { adminBtnPrimary, adminBtnSecondary, adminInput, adminLabel } from '@/admin/adminClassNames'
import { useAdminAuth } from '@/contexts/AdminAuthContext'
import { useCms } from '@/contexts/CmsContext'
import { getCurrencyFromSettings } from '@/lib/currency'

const EMPTY: StatementListFilters = {}

export function AdminStatementsWorkspace() {
  const { role } = useAdminAuth()
  const canMutate = canMutateFinance(role)
  const { snapshot } = useCms()
  const currency = getCurrencyFromSettings(snapshot.siteSettings).code || 'GBP'
  const [rows, setRows] = useState<AdminStatementRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<StatementListFilters>(EMPTY)
  const [generating, setGenerating] = useState(false)
  const [customerId, setCustomerId] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const pagination = useAdminTablePagination(total, 20)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listAdminStatements({
        limit: pagination.pageSize,
        offset: pagination.start,
        filters: filtersToJson(filters),
      })
      setRows(result.items)
      setTotal(result.total)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load statements')
    } finally {
      setLoading(false)
    }
  }, [pagination.pageSize, pagination.start, filters])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function generate() {
    if (!customerId.trim() && !companyId.trim()) {
      toast.error('Provide customer id and/or company id')
      return
    }
    if (!from || !to) {
      toast.error('Period from/to required')
      return
    }
    setGenerating(true)
    try {
      const res = await generateAdminStatement({
        customerId: customerId.trim() || null,
        companyId: companyId.trim() || null,
        from,
        to,
        idempotencyKey: newIdempotencyKey('stmt'),
      })
      toast.success('Statement generated (download/view only — no email)')
      await refresh()
      const detail = await getAdminStatement(res.statement_id)
      const html = (detail.document as Record<string, unknown> | null)?.body_html
      setPreviewHtml(html ? String(html) : null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Statement generation failed')
    } finally {
      setGenerating(false)
    }
  }

  async function openStatement(id: string) {
    try {
      const detail = await getAdminStatement(id)
      const html = (detail.document as Record<string, unknown> | null)?.body_html
      setPreviewHtml(html ? String(html) : 'No HTML document attached.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load statement')
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--admin-text)]">Statements</h1>
        <p className="mt-1 text-sm text-[var(--admin-muted)]">
          Customer / company account statements · manual download only
        </p>
      </div>
      <FinanceSubNav />

      {canMutate && (
        <div className="space-y-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-elevated)] p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide">Generate statement</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className={adminLabel}>Customer id</label>
              <input className={adminInput} value={customerId} onChange={(e) => setCustomerId(e.target.value)} />
            </div>
            <div>
              <label className={adminLabel}>Company id</label>
              <input className={adminInput} value={companyId} onChange={(e) => setCompanyId(e.target.value)} />
            </div>
            <div>
              <label className={adminLabel}>From</label>
              <input type="date" className={adminInput} value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className={adminLabel}>To</label>
              <input type="date" className={adminInput} value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <button type="button" className={adminBtnPrimary} disabled={generating} onClick={() => void generate()}>
            {generating ? 'Generating…' : 'Generate'}
          </button>
        </div>
      )}

      {loading ? (
        <AdminLoadingState />
      ) : (
        <div className="admin-table-frame overflow-x-auto rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white">
          <table className="min-w-[900px] w-full border-collapse text-left text-sm">
            <thead className="bg-[var(--admin-surface)] text-xs uppercase tracking-wide text-[var(--admin-muted)]">
              <tr>
                <th className="px-3 py-2.5 font-semibold">Statement</th>
                <th className="px-3 py-2.5 font-semibold">Party</th>
                <th className="px-3 py-2.5 font-semibold">Period</th>
                <th className="px-3 py-2.5 font-semibold text-right">Opening</th>
                <th className="px-3 py-2.5 font-semibold text-right">Closing</th>
                <th className="px-3 py-2.5 font-semibold">Created</th>
                <th className="px-3 py-2.5 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const cur = String(row.currency || currency)
                return (
                  <tr key={row.id} className="border-t border-[var(--admin-border)]">
                    <td className="px-3 py-2 font-medium">{row.id.slice(0, 8)}…</td>
                    <td className="px-3 py-2">
                      <div>{String(row.company_name || row.customer_name || '—')}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {fmtFinanceDate(row.period_from as string | null)} → {fmtFinanceDate(row.period_to as string | null)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{financeMoney(row.opening_balance, cur)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {financeMoney(row.closing_balance, cur)}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--admin-muted)]">
                      {fmtFinanceDate(row.created_at as string | null)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" className={adminBtnSecondary} onClick={() => void openStatement(row.id)}>
                        View
                      </button>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-[var(--admin-muted)]">
                    No statements generated yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {previewHtml && (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide">Statement document</h2>
            <button type="button" className={adminBtnSecondary} onClick={() => setPreviewHtml(null)}>
              Close
            </button>
          </div>
          <div
            className="prose prose-sm max-w-none rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>
      )}

      <AdminTablePagination
        page={pagination.page}
        pageSize={pagination.pageSize}
        totalItems={total}
        totalPages={pagination.totalPages}
        hasPrev={pagination.hasPrev}
        hasNext={pagination.hasNext}
        onPageChange={pagination.setPage}
        onPageSizeChange={pagination.setPageSize}
      />
    </div>
  )
}
