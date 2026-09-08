import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  fetchCutoverControlCentre,
  runPhase5dDataReconciliation,
  runPhase5dFinanceMoneyReconciliation,
  runPhase5dWmsShadowValidate,
  runPhase5dAutomationDryRun,
  runPhase5dCutoverSelftest,
} from '@/admin/lib/adminRpc'
import { AdminLoadingState, AdminPageHeading } from '@/admin/components/AdminPageHeading'
import { adminBtnSecondary } from '@/admin/adminClassNames'

type Domain = {
  domain: string
  status: string
  reason: string
}

function statusClass(status: string) {
  switch (status) {
    case 'READY':
      return 'bg-emerald-100 text-emerald-900'
    case 'READY_WITH_VALID_UNOWNED':
    case 'READY_WITH_ACCEPTED_VARIANCES':
      return 'bg-teal-100 text-teal-900'
    case 'SHADOW_RECONCILED':
    case 'OPENING_MAPPING_READY':
    case 'FOUNDATION_READY':
    case 'AWAITING_OPENING_APPROVAL':
      return 'bg-sky-100 text-sky-900'
    case 'PARTIAL':
      return 'bg-amber-100 text-amber-900'
    case 'BLOCKED':
      return 'bg-red-100 text-red-900'
    case 'DISABLED':
      return 'bg-slate-200 text-slate-800'
    case 'REVIEW_REQUIRED':
      return 'bg-orange-100 text-orange-900'
    default:
      return 'bg-slate-100 text-slate-700'
  }
}

export function AdminCutoverControlCentre() {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [domains, setDomains] = useState<Domain[]>([])
  const [locked, setLocked] = useState<Record<string, unknown> | null>(null)
  const [recon, setRecon] = useState<Record<string, unknown> | null>(null)
  const [finance, setFinance] = useState<Record<string, unknown> | null>(null)
  const [wms, setWms] = useState<Record<string, unknown> | null>(null)
  const [flow, setFlow] = useState<Record<string, unknown> | null>(null)
  const [selftest, setSelftest] = useState<Record<string, unknown> | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const centre = await fetchCutoverControlCentre()
      setDomains((centre.domains as Domain[]) ?? [])
      setLocked((centre.locked as Record<string, unknown>) ?? null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load cutover centre')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function run(label: string, fn: () => Promise<Record<string, unknown>>, set: (v: Record<string, unknown>) => void) {
    setBusy(true)
    try {
      const result = await fn()
      set(result)
      toast.success(`${label} complete`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${label} failed`)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <AdminLoadingState />

  return (
    <div className="space-y-6">
      <AdminPageHeading
        title="Cutover Control Centre"
        subtitle="Phase 5H CRM/Sales ownership readiness · WMS shadow · finance review — not a production cutover. Gates remain locked."
      />

      {locked && (
        <div className="rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 text-sm">
          <p className="font-medium text-[var(--admin-text)]">Locked state</p>
          <ul className="mt-2 grid gap-1 text-[var(--admin-muted)] sm:grid-cols-2">
            {Object.entries(locked).map(([k, v]) => (
              <li key={k}>
                <span className="font-mono text-xs">{k}</span> = {String(v)}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-[var(--admin-muted)]">
            NO CUSTOMER CONTACT · NO LIVE EXTERNALS · DO NOT CUT OVER
          </p>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--admin-text)]">Domain readiness</h2>
        <div className="grid gap-2">
          {domains.map((d) => (
            <div
              key={d.domain}
              className="flex flex-col gap-2 rounded-md border border-[var(--admin-border)] px-3 py-2 sm:flex-row sm:items-start sm:justify-between"
            >
              <div>
                <div className="font-medium text-[var(--admin-text)]">{d.domain}</div>
                <div className="text-sm text-[var(--admin-muted)]">{d.reason}</div>
              </div>
              <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${statusClass(d.status)}`}>
                {d.status}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-wrap gap-2">
        <button
          type="button"
          className={adminBtnSecondary}
          disabled={busy}
          onClick={() => void refresh()}
        >
          Refresh readiness
        </button>
        <button
          type="button"
          className={adminBtnSecondary}
          disabled={busy}
          onClick={() => void run('Data reconciliation', runPhase5dDataReconciliation, setRecon)}
        >
          Run data reconciliation
        </button>
        <button
          type="button"
          className={adminBtnSecondary}
          disabled={busy}
          onClick={() => void run('Finance reconciliation', runPhase5dFinanceMoneyReconciliation, setFinance)}
        >
          Run finance flags
        </button>
        <button
          type="button"
          className={adminBtnSecondary}
          disabled={busy}
          onClick={() => void run('WMS shadow', runPhase5dWmsShadowValidate, setWms)}
        >
          Run WMS shadow
        </button>
        <button
          type="button"
          className={adminBtnSecondary}
          disabled={busy}
          onClick={() => void run('Automation dry-run', runPhase5dAutomationDryRun, setFlow)}
        >
          Flow-lite dry-run
        </button>
        <button
          type="button"
          className={adminBtnSecondary}
          disabled={busy}
          onClick={() => void run('Phase 5D selftest', runPhase5dCutoverSelftest, setSelftest)}
        >
          Run full selftest
        </button>
      </section>

      {[
        ['Reconciliation', recon],
        ['Finance', finance],
        ['WMS shadow', wms],
        ['Automation dry-run', flow],
        ['Selftest', selftest],
      ].map(([label, data]) =>
        data ? (
          <section key={String(label)} className="space-y-2">
            <h3 className="font-medium text-[var(--admin-text)]">{label as string}</h3>
            <pre className="max-h-80 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-100">
              {JSON.stringify(data, null, 2)}
            </pre>
          </section>
        ) : null,
      )}
    </div>
  )
}
