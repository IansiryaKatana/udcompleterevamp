import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  listTradeApplications,
  seedTradeEligibilityBackfillPreview,
  listTradeEligibilityBackfill,
  decideTradeEligibilityBackfill,
  fetchTradeCommercialReport,
  setTradeAccess,
} from '@/admin/lib/adminRpc'
import { AdminLoadingState } from '@/admin/components/AdminPageHeading'
import { adminBtnPrimary, adminBtnSecondary, adminInput, adminLabel } from '@/admin/adminClassNames'
import { BrandedSelect } from '@/components/ui/BrandedSelect'
import { useAdminAuth } from '@/contexts/AdminAuthContext'
import { formatCrmLabel } from '@/admin/lib/crmOps'

export function AdminTradeApplicationsPanel() {
  const { canReassignOwnership } = useAdminAuth()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState('pending')
  const [note, setNote] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listTradeApplications({ status, limit: 50 })
      setRows(data.rows)
      setTotal(data.total)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load applications')
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function decide(customerId: string, next: 'approved' | 'rejected' | 'pending') {
    if (!canReassignOwnership) {
      toast.error('Owner/admin required to decide trade eligibility')
      return
    }
    setBusyId(customerId)
    try {
      await setTradeAccess({ customerId, status: next, note: note || undefined })
      toast.success(`Trade access → ${next}`)
      setNote('')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Decision failed')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <AdminLoadingState />

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--admin-muted)]">
        Pending trade applications ({total}). Customer Type and PAY LATER stay independent. Decisions require
        owner/admin.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[160px]">
          <label className={adminLabel}>Status</label>
          <BrandedSelect
            value={status}
            onValueChange={setStatus}
            options={[
              { value: 'pending', label: 'Pending' },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' },
              { value: 'suspended', label: 'Suspended' },
              { value: 'ineligible', label: 'Ineligible' },
            ]}
          />
        </div>
        <div className="min-w-[220px] flex-1">
          <label className={adminLabel}>Decision note</label>
          <input className={adminInput} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button type="button" className={adminBtnSecondary} onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      <div className="overflow-x-auto rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[var(--admin-border)] text-[10px] uppercase tracking-wide text-[var(--admin-muted)]">
            <tr>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Trade</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">PAY LATER</th>
              <th className="px-3 py-2">Channel</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-border)]">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-[var(--admin-muted)]">
                  No applications in this status.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const id = String(r.id)
                return (
                  <tr key={id}>
                    <td className="px-3 py-2">
                      <Link
                        to="/backend/customers/$customerId"
                        params={{ customerId: id }}
                        className="font-medium text-[var(--admin-primary)] hover:underline"
                      >
                        {String(r.display_name || r.email || id)}
                      </Link>
                      <div className="text-xs text-[var(--admin-muted)]">{String(r.email || '')}</div>
                    </td>
                    <td className="px-3 py-2">{formatCrmLabel(String(r.trade_access_status || ''))}</td>
                    <td className="px-3 py-2">{String(r.customer_type || '—')}</td>
                    <td className="px-3 py-2">{r.pay_later_eligible ? 'Yes' : 'No'}</td>
                    <td className="px-3 py-2 text-xs">{String(r.registration_channel || '—')}</td>
                    <td className="px-3 py-2 text-right">
                      {canReassignOwnership && status === 'pending' && (
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            className={adminBtnPrimary}
                            disabled={busyId === id}
                            onClick={() => void decide(id, 'approved')}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className={adminBtnSecondary}
                            disabled={busyId === id}
                            onClick={() => void decide(id, 'rejected')}
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function AdminTradeBackfillPanel() {
  const { canReassignOwnership } = useAdminAuth()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [report, setReport] = useState<Record<string, unknown> | null>(null)
  const [field, setField] = useState('trade_access')
  const [confidence, setConfidence] = useState('EXPLICIT')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [list, rep] = await Promise.all([
        listTradeEligibilityBackfill({ field, confidence, status: 'PENDING', limit: 50 }),
        fetchTradeCommercialReport(),
      ])
      setRows(list.rows)
      setTotal(list.total)
      setReport(rep)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load backfill')
    } finally {
      setLoading(false)
    }
  }, [field, confidence])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function seed() {
    if (!canReassignOwnership) {
      toast.error('Owner/admin required')
      return
    }
    setBusy(true)
    try {
      const res = await seedTradeEligibilityBackfillPreview()
      toast.success('Backfill preview seeded (not applied)')
      console.info('trade backfill seed', res)
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Seed failed')
    } finally {
      setBusy(false)
    }
  }

  async function decide(id: string, decision: 'APPROVE' | 'REJECT' | 'DEFER', applyNow: boolean) {
    if (!canReassignOwnership) {
      toast.error('Owner/admin required')
      return
    }
    setBusy(true)
    try {
      await decideTradeEligibilityBackfill({ reviewId: id, decision, applyNow })
      toast.success(applyNow ? 'Applied EXPLICIT candidate' : `Marked ${decision}`)
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Decide failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <AdminLoadingState />
  const preview = (report?.backfill_preview ?? {}) as Record<string, unknown>
  const counts = (report?.counts ?? {}) as Record<string, unknown>

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--admin-muted)]">
        Historical eligibility preview. Phase 4F applied EXPLICIT SureCust trade for SAFE candidates
        (batch p4f-surecust-*). AMBIGUOUS is never auto-applied. PAY LATER remains historical-only.
        Phase 4C ownership candidates remain untouched ({String(counts.ownership_candidates_still_pending ?? '—')}{' '}
        pending).
      </p>
      <div className="grid gap-2 sm:grid-cols-4">
        {(
          [
            ['Trade EXPLICIT pending', preview.trade_explicit_pending],
            ['Trade AMBIGUOUS pending', preview.trade_ambiguous_pending],
            ['PAY LATER EXPLICIT', preview.pay_later_explicit_pending],
            ['Applied', preview.applied],
          ] as const
        ).map(([label, val]) => (
          <div
            key={label}
            className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white px-3 py-2"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-muted)]">{label}</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums">{Number(val ?? 0).toLocaleString()}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[140px]">
          <label className={adminLabel}>Field</label>
          <BrandedSelect
            value={field}
            onValueChange={setField}
            options={[
              { value: 'trade_access', label: 'Trade access' },
              { value: 'pay_later', label: 'PAY LATER' },
            ]}
          />
        </div>
        <div className="min-w-[140px]">
          <label className={adminLabel}>Confidence</label>
          <BrandedSelect
            value={confidence}
            onValueChange={setConfidence}
            options={[
              { value: 'EXPLICIT', label: 'EXPLICIT' },
              { value: 'AMBIGUOUS', label: 'AMBIGUOUS' },
              { value: 'HIGH', label: 'HIGH' },
              { value: 'NO_EVIDENCE', label: 'NO_EVIDENCE' },
            ]}
          />
        </div>
        {canReassignOwnership && (
          <button type="button" className={adminBtnPrimary} disabled={busy} onClick={() => void seed()}>
            Seed preview
          </button>
        )}
        <button type="button" className={adminBtnSecondary} onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      <p className="text-xs text-[var(--admin-muted)]">{total.toLocaleString()} matching preview rows</p>
      <div className="overflow-x-auto rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[var(--admin-border)] text-[10px] uppercase tracking-wide text-[var(--admin-muted)]">
            <tr>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Field</th>
              <th className="px-3 py-2">Confidence</th>
              <th className="px-3 py-2">Proposed</th>
              <th className="px-3 py-2">Current</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-border)]">
            {rows.map((r) => {
              const id = String(r.id)
              const custId = String(r.customer_id)
              const conf = String(r.confidence)
              return (
                <tr key={id}>
                  <td className="px-3 py-2">
                    <Link
                      to="/backend/customers/$customerId"
                      params={{ customerId: custId }}
                      className="text-[var(--admin-primary)] hover:underline"
                    >
                      {String(r.display_name || r.email || custId)}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{String(r.field)}</td>
                  <td className="px-3 py-2">{conf}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.field === 'pay_later'
                      ? String(r.proposed_pay_later_eligible)
                      : String(r.proposed_trade_access_status || '—')}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.field === 'pay_later'
                      ? String(r.current_pay_later)
                      : String(r.current_trade_status || '—')}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canReassignOwnership && (
                      <div className="flex justify-end gap-1">
                        {conf === 'EXPLICIT' && (
                          <button
                            type="button"
                            className={adminBtnPrimary}
                            disabled={busy}
                            onClick={() => void decide(id, 'APPROVE', true)}
                          >
                            Approve+apply
                          </button>
                        )}
                        <button
                          type="button"
                          className={adminBtnSecondary}
                          disabled={busy}
                          onClick={() => void decide(id, 'REJECT', false)}
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          className={adminBtnSecondary}
                          disabled={busy}
                          onClick={() => void decide(id, 'DEFER', false)}
                        >
                          Defer
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
