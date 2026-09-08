import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  fetchPhase5gInventoryBaseline,
  fetchPhase5gOpenOrderStockExposure,
  fetchWmsCutoverReadiness,
  runPhase5gBuildOpeningStaging,
  runPhase5gRebuildIdentityReviews,
  runPhase5gWmsObservability,
} from '@/admin/lib/adminRpc'
import { AdminLoadingState, AdminPageHeading } from '@/admin/components/AdminPageHeading'
import { adminBtnSecondary } from '@/admin/adminClassNames'

export function AdminWmsOpeningStock() {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [baseline, setBaseline] = useState<Record<string, unknown> | null>(null)
  const [readiness, setReadiness] = useState<Record<string, unknown> | null>(null)
  const [exposure, setExposure] = useState<Record<string, unknown> | null>(null)
  const [last, setLast] = useState<Record<string, unknown> | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [b, r, e] = await Promise.all([
        fetchPhase5gInventoryBaseline(),
        fetchWmsCutoverReadiness(),
        fetchPhase5gOpenOrderStockExposure(),
      ])
      setBaseline(b)
      setReadiness(r)
      setExposure(e)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load WMS opening panels')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function run(label: string, fn: () => Promise<Record<string, unknown>>) {
    setBusy(true)
    try {
      const result = await fn()
      setLast(result)
      toast.success(`${label} complete`)
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${label} failed`)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <AdminLoadingState />

  return (
    <div className="space-y-6">
      <AdminPageHeading
        title="WMS opening stock"
        subtitle="Phase 5G staging & shadow only — wms_enabled stays false. No production OPENING to UD_WH_1."
      />

      <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        Shadow warehouse UD_SHADOW is authorized for rehearsal. Production post requires
        wms_opening_post_authorized (currently false). Opening basis needs business approval.
      </div>

      {readiness && (
        <section className="rounded border border-[var(--admin-border)] p-4 text-sm">
          <div className="font-medium">WMS readiness: {String(readiness.status)}</div>
          <div className="mt-1 text-[var(--admin-muted)]">{String(readiness.reason)}</div>
        </section>
      )}

      <section className="flex flex-wrap gap-2">
        <button type="button" className={adminBtnSecondary} disabled={busy} onClick={() => void refresh()}>
          Refresh
        </button>
        <button
          type="button"
          className={adminBtnSecondary}
          disabled={busy}
          onClick={() => void run('Rebuild identity reviews', () => runPhase5gRebuildIdentityReviews())}
        >
          Rebuild identity reviews
        </button>
        <button
          type="button"
          className={adminBtnSecondary}
          disabled={busy}
          onClick={() =>
            void run('Build shadow staging', () =>
              runPhase5gBuildOpeningStaging({
                batchCode: `UI-SHADOW-${Date.now()}`,
                sourceBasis: 'SHOPIFY_ON_HAND',
                targetWarehouseCode: 'UD_SHADOW',
              }),
            )
          }
        >
          Build shadow staging (ON_HAND candidate)
        </button>
        <button
          type="button"
          className={adminBtnSecondary}
          disabled={busy}
          onClick={() => void run('WMS observability', () => runPhase5gWmsObservability())}
        >
          Observability
        </button>
      </section>

      {[
        ['Baseline', baseline],
        ['Open-order exposure', exposure],
        ['Last action', last],
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
