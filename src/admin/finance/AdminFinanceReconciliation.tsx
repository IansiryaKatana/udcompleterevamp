import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  fetchAdminFinanceReconciliationFlags,
  fetchAdminFinanceReviewQueue,
  fetchPhase5fFinanceBaseline,
  fetchPhase5fOpeningArPreview,
} from '@/admin/lib/adminRpc'
import {
  formatFinanceLabel,
  fmtFinanceWhen,
  financeMoney,
  reconciliationFlagBadgeClass,
} from '@/admin/lib/financeOps'
import { FinanceSubNav } from '@/admin/finance/FinanceSubNav'
import { AdminLoadingState } from '@/admin/components/AdminPageHeading'
import { adminBtnSecondary, adminInput } from '@/admin/adminClassNames'
import { cn } from '@/lib/utils'

const CLASSIFICATIONS = [
  '',
  'SEMANTICALLY_EXPLAINED',
  'SOURCE_INCONSISTENCY',
  'IMPORT_DEFECT',
  'CALCULATION_DEFECT',
  'REFUND_TIMING',
  'PAYMENT_TIMING',
  'LEGACY_MANUAL_WORKFLOW',
  'INSUFFICIENT_EVIDENCE',
  'BUSINESS_REVIEW_REQUIRED',
]

const SEVERITIES = ['', 'INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
const REVIEW_STATUSES = [
  '',
  'UNREVIEWED',
  'EXPLAINED',
  'ACCEPTED_SOURCE_VARIANCE',
  'REQUIRES_ACTION',
  'RESOLVED_BY_CODE_FIX',
]

export function AdminFinanceReconciliation() {
  const [items, setItems] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [baseline, setBaseline] = useState<Record<string, unknown> | null>(null)
  const [opening, setOpening] = useState<Record<string, unknown> | null>(null)
  const [classification, setClassification] = useState('')
  const [severity, setSeverity] = useState('')
  const [reviewStatus, setReviewStatus] = useState('UNREVIEWED')
  const [gateway, setGateway] = useState('')
  const [minAbs, setMinAbs] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const filters: Record<string, unknown> = { limit: 100 }
      if (classification) filters.classification = classification
      if (severity) filters.severity = severity
      if (reviewStatus) filters.review_status = reviewStatus
      if (gateway.trim()) filters.gateway = gateway.trim()
      if (minAbs.trim()) filters.min_abs_variance = Number(minAbs)

      let result: { items: Record<string, unknown>[]; total: number }
      try {
        result = await fetchAdminFinanceReviewQueue(filters)
      } catch {
        result = await fetchAdminFinanceReconciliationFlags(100)
      }
      setItems(result.items)
      setTotal(result.total)

      try {
        setBaseline(await fetchPhase5fFinanceBaseline())
        setOpening(await fetchPhase5fOpeningArPreview(5))
      } catch {
        /* optional panels */
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load reconciliation queue')
    } finally {
      setLoading(false)
    }
  }, [classification, severity, reviewStatus, gateway, minAbs])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const exposure = (baseline?.material_exposure ?? null) as Record<string, unknown> | null
  const exceptions = (baseline?.exceptions ?? null) as Record<string, unknown> | null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--admin-text)]">
            Finance reconciliation
          </h1>
          <p className="mt-1 text-sm text-[var(--admin-muted)]">
            Phase 5F review queue · {total.toLocaleString()} rows · source snapshots immutable
          </p>
        </div>
        <button type="button" className={adminBtnSecondary} onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      <FinanceSubNav />

      <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        Three views preserved: imported source · calculated Unique ledger · reconciliation status. Review
        decisions do not rewrite Shopify history. PENDING ≠ received.
      </div>

      {(exposure || exceptions) && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          {exceptions &&
            Object.entries(exceptions).map(([k, v]) => (
              <div key={k} className="rounded border border-[var(--admin-border)] px-3 py-2">
                <div className="text-xs text-[var(--admin-muted)]">{formatFinanceLabel(k)}</div>
                <div className="font-semibold">{Number(v).toLocaleString()}</div>
              </div>
            ))}
          {exposure && (
            <div className="rounded border border-[var(--admin-border)] px-3 py-2 sm:col-span-2">
              <div className="text-xs text-[var(--admin-muted)]">Absolute mismatch exposure</div>
              <div className="font-semibold">
                {financeMoney(Number(exposure.total_absolute_mismatch ?? 0), 'GBP')}
              </div>
              <div className="text-xs text-[var(--admin-muted)]">
                Net {financeMoney(Number(exposure.net_mismatch ?? 0), 'GBP')} · not auto-collectible AR
              </div>
            </div>
          )}
        </div>
      )}

      {opening?.model && (
        <div className="rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm">
          <div className="font-medium">Opening AR model (preview)</div>
          <div className="mt-1 text-[var(--admin-muted)]">
            {String((opening.model as Record<string, unknown>).rule ?? '')}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <select
          className={adminInput}
          value={classification}
          onChange={(e) => setClassification(e.target.value)}
        >
          {CLASSIFICATIONS.map((c) => (
            <option key={c || 'all'} value={c}>
              {c ? formatFinanceLabel(c) : 'All classifications'}
            </option>
          ))}
        </select>
        <select className={adminInput} value={severity} onChange={(e) => setSeverity(e.target.value)}>
          {SEVERITIES.map((s) => (
            <option key={s || 'all'} value={s}>
              {s || 'All severities'}
            </option>
          ))}
        </select>
        <select
          className={adminInput}
          value={reviewStatus}
          onChange={(e) => setReviewStatus(e.target.value)}
        >
          {REVIEW_STATUSES.map((s) => (
            <option key={s || 'all'} value={s}>
              {s ? formatFinanceLabel(s) : 'All review statuses'}
            </option>
          ))}
        </select>
        <input
          className={adminInput}
          placeholder="Gateway contains…"
          value={gateway}
          onChange={(e) => setGateway(e.target.value)}
        />
        <input
          className={adminInput}
          placeholder="Min |variance|"
          value={minAbs}
          onChange={(e) => setMinAbs(e.target.value)}
        />
      </div>

      {loading ? (
        <AdminLoadingState />
      ) : (
        <div className="admin-table-frame overflow-x-auto rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white">
          <table className="min-w-[1100px] w-full border-collapse text-left text-sm">
            <thead className="bg-[var(--admin-surface)] text-xs uppercase tracking-wide text-[var(--admin-muted)]">
              <tr>
                <th className="px-3 py-2.5 font-semibold">Classification</th>
                <th className="px-3 py-2.5 font-semibold">Severity</th>
                <th className="px-3 py-2.5 font-semibold">Order</th>
                <th className="px-3 py-2.5 font-semibold">|Variance|</th>
                <th className="px-3 py-2.5 font-semibold">Gateway</th>
                <th className="px-3 py-2.5 font-semibold">Opening basis</th>
                <th className="px-3 py-2.5 font-semibold">Review</th>
                <th className="px-3 py-2.5 font-semibold">Reason</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row, i) => {
                const orderId = row.order_id ? String(row.order_id) : null
                return (
                  <tr
                    key={String(row.id || `${row.classification}-${i}`)}
                    className="border-t border-[var(--admin-border)]"
                  >
                    <td className="px-3 py-2 font-medium">
                      {formatFinanceLabel(
                        String(row.classification || row.flag_type || row.flag || 'flag'),
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          'inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                          reconciliationFlagBadgeClass(String(row.severity || '')),
                        )}
                      >
                        {formatFinanceLabel(String(row.severity || 'info'))}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {orderId ? (
                        <Link
                          to="/backend/orders/$orderId"
                          params={{ orderId }}
                          className="text-[var(--admin-primary)] hover:underline"
                        >
                          {String(row.order_number || orderId.slice(0, 8))}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {financeMoney(Number(row.abs_variance ?? 0), 'GBP')}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--admin-muted)]">
                      {String(row.gateway_summary || '—')}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {formatFinanceLabel(String(row.opening_basis || '—'))}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {formatFinanceLabel(String(row.review_status || 'UNREVIEWED'))}
                      <div className="text-[var(--admin-muted)]">
                        {fmtFinanceWhen(String(row.classified_at || row.detected_at || ''))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-sm text-[var(--admin-muted)] max-w-md">
                      {String(row.reason || row.message || row.detail || '—')}
                    </td>
                  </tr>
                )
              })}
              {items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-[var(--admin-muted)]">
                    No reconciliation rows for these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
