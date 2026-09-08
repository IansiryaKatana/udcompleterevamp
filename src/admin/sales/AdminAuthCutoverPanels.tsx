import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  fetchAuthCrmLinkageAudit,
  seedAuthLinkCandidates,
  listAuthLinkCandidates,
  decideAuthLinkCandidate,
  reclassifyPayLaterBackfill,
  previewExplicitTradeBackfillApply,
  fetchTradeCutoverReadiness,
  fetchCommercialDataQuality,
  fetchActivationCohortReport,
  fetchPhase4fTradeCutoverGate,
  fetchShadowDifferenceReport,
  runShadowBaseline,
  fetchPriceLeakAudit,
  listActivationWorkspace,
  sendTradeActivationEmail,
  invalidateActivation,
  createCustomerAuthActivation,
  preflightExplicitSurecustTrade,
  proposePilotActivationCohort,
  fetchPilotSendGate,
  fetchTradeRequiredReadinessPhase4h,
  finalizePilotCohort,
  createPilotBatchFromProposal,
  fetchTradeRequiredCutoverPrecheck,
} from '@/admin/lib/adminRpc'
import { AdminLoadingState } from '@/admin/components/AdminPageHeading'
import { adminBtnPrimary, adminBtnSecondary, adminLabel } from '@/admin/adminClassNames'
import { useAdminAuth } from '@/contexts/AdminAuthContext'

export function AdminAuthLinkPanel() {
  const { canReassignOwnership } = useAdminAuth()
  const [loading, setLoading] = useState(true)
  const [audit, setAudit] = useState<Record<string, unknown> | null>(null)
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [a, list] = await Promise.all([
        fetchAuthCrmLinkageAudit(),
        listAuthLinkCandidates({ status: 'PENDING', limit: 50 }),
      ])
      setAudit(a)
      setRows(list.rows)
      setTotal(list.total)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load auth links')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (loading) return <AdminLoadingState />

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--admin-muted)]">
        CRM ↔ auth linkage preview. Email alone is not permanent identity — Approve+apply only for VERIFIED UNIQUE
        EMAIL / EXPLICIT. Disabling login never deletes the CRM customer.
      </p>
      <div className="grid gap-2 sm:grid-cols-4">
        {(
          [
            ['CRM customers', audit?.TOTAL_CRM_CUSTOMERS],
            ['Auth-linked', audit?.AUTH_LINKED],
            ['Not linked', audit?.NOT_LINKED],
            ['Unique email candidates', audit?.VERIFIED_UNIQUE_EMAIL_CANDIDATES],
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
      <div className="flex flex-wrap gap-2">
        {canReassignOwnership && (
          <button
            type="button"
            className={adminBtnPrimary}
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true)
                try {
                  await seedAuthLinkCandidates()
                  toast.success('Auth link candidates seeded (not applied)')
                  await refresh()
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'Seed failed')
                } finally {
                  setBusy(false)
                }
              })()
            }}
          >
            Seed candidates
          </button>
        )}
        <button type="button" className={adminBtnSecondary} onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      <p className="text-xs text-[var(--admin-muted)]">{total.toLocaleString()} pending candidates</p>
      <div className="overflow-x-auto rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[var(--admin-border)] text-[10px] uppercase tracking-wide text-[var(--admin-muted)]">
            <tr>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Auth user</th>
              <th className="px-3 py-2">Confidence</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-border)]">
            {rows.map((r) => {
              const id = String(r.id)
              const custId = String(r.customer_id)
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
                  <td className="px-3 py-2 font-mono text-xs">{String(r.auth_user_id)}</td>
                  <td className="px-3 py-2 text-xs">{String(r.confidence)}</td>
                  <td className="px-3 py-2 text-right">
                    {canReassignOwnership && (
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          className={adminBtnPrimary}
                          disabled={busy}
                          onClick={() => {
                            void (async () => {
                              setBusy(true)
                              try {
                                await decideAuthLinkCandidate({
                                  reviewId: id,
                                  decision: 'APPROVE',
                                  applyNow: true,
                                })
                                toast.success('Auth linked')
                                await refresh()
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : 'Apply failed')
                              } finally {
                                setBusy(false)
                              }
                            })()
                          }}
                        >
                          Approve+apply
                        </button>
                        <button
                          type="button"
                          className={adminBtnSecondary}
                          disabled={busy}
                          onClick={() => {
                            void (async () => {
                              setBusy(true)
                              try {
                                await decideAuthLinkCandidate({ reviewId: id, decision: 'REJECT' })
                                await refresh()
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : 'Reject failed')
                              } finally {
                                setBusy(false)
                              }
                            })()
                          }}
                        >
                          Reject
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

export function AdminActivationWorkspacePanel() {
  const { canReassignOwnership } = useAdminAuth()
  const [loading, setLoading] = useState(true)
  const [cohort, setCohort] = useState<Record<string, unknown> | null>(null)
  const [pilotGate, setPilotGate] = useState<Record<string, unknown> | null>(null)
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [tradeOnly, setTradeOnly] = useState(true)
  const [notLinked, setNotLinked] = useState(true)
  const [lastOrderDays, setLastOrderDays] = useState<number | ''>(90)
  const [q, setQ] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [c, list, gate] = await Promise.all([
        fetchActivationCohortReport(),
        listActivationWorkspace({
          limit: 40,
          tradeEligible: tradeOnly ? true : null,
          authLinked: notLinked ? false : null,
          lastOrderDays: lastOrderDays === '' ? null : lastOrderDays,
          q: q.trim() || null,
        }),
        fetchPilotSendGate().catch(() => null),
      ])
      setCohort(c)
      setRows(list.rows)
      setTotal(list.total)
      setPilotGate(gate)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load activation workspace')
    } finally {
      setLoading(false)
    }
  }, [tradeOnly, notLinked, lastOrderDays, q])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (loading && !cohort) return <AdminLoadingState />

  const tiers = (cohort?.tiers ?? {}) as Record<string, number>

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--admin-muted)]">
        Controlled activation cohorts — INTERNAL_TEST / PILOT / BATCH only. FULL rollout blocked. No mass email.
        Salespeople may view status on assigned customers; owner/admin send &amp; link authority.
      </p>
      <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {(
          [
            ['CRM', cohort?.TOTAL_CRM_CUSTOMERS],
            ['Trade eligible', cohort?.EXPLICIT_TRADE_ELIGIBLE],
            ['Auth linked', cohort?.AUTH_LINKED],
            ['Trade not linked', cohort?.TRADE_ELIGIBLE_NOT_AUTH_LINKED],
            ['Pending invites', cohort?.PENDING_ACTIVATION],
            ['PAY LATER', cohort?.PAY_LATER_ELIGIBLE_COUNT],
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
      <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white p-3 text-sm">
        <p className="font-semibold">Recommended cohorts (do not auto-send)</p>
        <p className="mt-1 text-[var(--admin-muted)]">
          TIER A (30d): {Number(tiers.TIER_A_30d ?? 0).toLocaleString()} · TIER B (90d):{' '}
          {Number(tiers.TIER_B_90d ?? 0).toLocaleString()} · TIER B (180d):{' '}
          {Number(tiers.TIER_B_180d ?? 0).toLocaleString()} · TIER C (365d):{' '}
          {Number(tiers.TIER_C_365d ?? 0).toLocaleString()} · older/inactive:{' '}
          {Number(tiers.TIER_C_older_or_no_order ?? 0).toLocaleString()}
        </p>
        {pilotGate ? (
          <p className="mt-2 text-xs font-medium text-amber-800">
            PILOT SEND STATUS: {String(pilotGate.PILOT_SEND_STATUS ?? 'READY — OWNER APPROVAL REQUIRED')} ·
            recommended size {String(pilotGate.recommended_size ?? '5-15')} · auto_send=
            {String(pilotGate.auto_send ?? false)}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={tradeOnly} onChange={(e) => setTradeOnly(e.target.checked)} />
          Trade eligible
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={notLinked} onChange={(e) => setNotLinked(e.target.checked)} />
          Not auth-linked
        </label>
        <div>
          <label className={adminLabel}>Last order days</label>
          <input
            className="rounded border border-[var(--admin-border)] px-2 py-1 text-sm"
            type="number"
            min={1}
            value={lastOrderDays}
            onChange={(e) => setLastOrderDays(e.target.value === '' ? '' : Number(e.target.value))}
          />
        </div>
        <div>
          <label className={adminLabel}>Search</label>
          <input
            className="rounded border border-[var(--admin-border)] px-2 py-1 text-sm"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="email / name"
          />
        </div>
        {canReassignOwnership && (
          <>
            <button
              type="button"
              className={adminBtnSecondary}
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true)
                  try {
                    const res = await finalizePilotCohort(12)
                    toast.success(
                      `Finalized ${Number(res.count ?? 0)} PILOT recipients — NOT sent (${String(res.PILOT_SEND_STATUS ?? 'approval required')})`,
                    )
                    await refresh()
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Finalize failed')
                  } finally {
                    setBusy(false)
                  }
                })()
              }}
            >
              Finalize PHASE4I_PILOT_001 (no send)
            </button>
            <button
              type="button"
              className={adminBtnSecondary}
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true)
                  try {
                    const res = await createPilotBatchFromProposal('PHASE4I_PILOT_001', false)
                    toast.success(
                      `Draft batch ${String(res.batch_name ?? '')} · ${Number(res.recipient_count ?? 0)} queued · ${String(res.send_status ?? 'NOT_SENT')}`,
                    )
                    await refresh()
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Batch create failed')
                  } finally {
                    setBusy(false)
                  }
                })()
              }}
            >
              Create draft pilot batch (no send)
            </button>
            <button
              type="button"
              className={adminBtnSecondary}
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true)
                  try {
                    const res = await proposePilotActivationCohort(12)
                    console.info('PILOT cohort proposal (not sent)', res)
                    toast.success(
                      `Proposed ${Array.isArray(res.proposed) ? res.proposed.length : 0} PILOT candidates — not sent`,
                    )
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Propose failed')
                  } finally {
                    setBusy(false)
                  }
                })()
              }}
            >
              Propose PILOT cohort (no send)
            </button>
          </>
        )}
        <button type="button" className={adminBtnSecondary} onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      <p className="text-xs text-[var(--admin-muted)]">{total.toLocaleString()} matching</p>
      <div className="overflow-x-auto rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[var(--admin-border)] text-[10px] uppercase tracking-wide text-[var(--admin-muted)]">
            <tr>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Trade</th>
              <th className="px-3 py-2">Auth</th>
              <th className="px-3 py-2">Invite</th>
              <th className="px-3 py-2">Last order</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-border)]">
            {rows.map((r) => {
              const custId = String(r.id)
              const actId = r.activation_id ? String(r.activation_id) : null
              return (
                <tr key={custId}>
                  <td className="px-3 py-2">
                    <Link
                      to="/backend/customers/$customerId"
                      params={{ customerId: custId }}
                      className="text-[var(--admin-primary)] hover:underline"
                    >
                      {String(r.display_name || r.email || custId)}
                    </Link>
                    <p className="text-[10px] text-[var(--admin-muted)]">{String(r.email ?? '')}</p>
                  </td>
                  <td className="px-3 py-2 text-xs">{String(r.trade_access_status)}</td>
                  <td className="px-3 py-2 text-xs">{r.auth_user_id ? 'linked' : 'not linked'}</td>
                  <td className="px-3 py-2 text-xs">
                    {String(r.activation_status ?? '—')}
                    {r.activation_email_sent_at ? ' · emailed' : ''}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.last_order_at ? new Date(String(r.last_order_at)).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canReassignOwnership && !r.auth_user_id && (
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          className={adminBtnPrimary}
                          disabled={busy || String(pilotGate?.pilot_send_authorized ?? 'false') !== 'true'}
                          title={
                            String(pilotGate?.pilot_send_authorized ?? 'false') !== 'true'
                              ? 'Blocked until owner sets pilot_send_authorized=true'
                              : 'Send activation email'
                          }
                          onClick={() => {
                            void (async () => {
                              setBusy(true)
                              try {
                                await sendTradeActivationEmail(custId)
                                toast.success('Activation email sent')
                                await refresh()
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : 'Send failed')
                              } finally {
                                setBusy(false)
                              }
                            })()
                          }}
                        >
                          Send invite
                        </button>
                        <button
                          type="button"
                          className={adminBtnSecondary}
                          disabled={busy}
                          onClick={() => {
                            void (async () => {
                              setBusy(true)
                              try {
                                const res = await createCustomerAuthActivation(custId, 168)
                                toast.success(`Token created — copy from customer detail if needed (${res.activation_id})`)
                                await refresh()
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : 'Create failed')
                              } finally {
                                setBusy(false)
                              }
                            })()
                          }}
                        >
                          Generate
                        </button>
                        {actId && (
                          <button
                            type="button"
                            className={adminBtnSecondary}
                            disabled={busy}
                            onClick={() => {
                              void (async () => {
                                setBusy(true)
                                try {
                                  await invalidateActivation(actId)
                                  toast.success('Invite invalidated')
                                  await refresh()
                                } catch (e) {
                                  toast.error(e instanceof Error ? e.message : 'Invalidate failed')
                                } finally {
                                  setBusy(false)
                                }
                              })()
                            }}
                          >
                            Invalidate
                          </button>
                        )}
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

export function AdminShadowCutoverPanel() {
  const { canReassignOwnership } = useAdminAuth()
  const [loading, setLoading] = useState(true)
  const [gate, setGate] = useState<Record<string, unknown> | null>(null)
  const [shadow, setShadow] = useState<Record<string, unknown> | null>(null)
  const [leak, setLeak] = useState<Record<string, unknown> | null>(null)
  const [preflight, setPreflight] = useState<Record<string, unknown> | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [g, s, l, p] = await Promise.all([
        fetchPhase4fTradeCutoverGate(),
        fetchShadowDifferenceReport(168),
        fetchPriceLeakAudit(),
        preflightExplicitSurecustTrade(),
      ])
      setGate(g)
      setShadow(s)
      setLeak(l)
      setPreflight(p)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load shadow/cutover')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (loading) return <AdminLoadingState />

  const gateMap = (gate?.gate ?? {}) as Record<string, string>
  const byType = (shadow?.by_request_type ?? []) as Array<Record<string, unknown>>
  const matrix = (leak?.matrix ?? []) as Array<Record<string, unknown>>

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--admin-muted)]">
        Production mode remains <strong>{String(gate?.commercial_access_mode)}</strong>. Shadow evaluates what{' '}
        <code>trade_required</code> would decide without changing live behaviour. Cutover flag:{' '}
        {String(gate?.trade_required_cutover_approved)}.
      </p>
      <div className="flex flex-wrap gap-2">
        {canReassignOwnership && (
          <button
            type="button"
            className={adminBtnPrimary}
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true)
                try {
                  const res = await runShadowBaseline()
                  toast.success(`Shadow baseline logged (${String(res.logged ?? 0)} rows)`)
                  await refresh()
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'Baseline failed')
                } finally {
                  setBusy(false)
                }
              })()
            }}
          >
            Run shadow baseline
          </button>
        )}
        <button type="button" className={adminBtnSecondary} onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white p-3 text-sm">
        <p className="font-semibold">SureCust preflight (post-apply)</p>
        <p className="mt-1 text-[var(--admin-muted)]">
          EXPLICIT {String(preflight?.EXPLICIT_CANDIDATES ?? '—')} · already matched{' '}
          {String(preflight?.ALREADY_IN_TARGET_STATE ?? '—')} · conflict{' '}
          {String(preflight?.CONFLICTING_CURRENT_STATE ?? '—')} · safe to apply{' '}
          {String(preflight?.SAFE_TO_APPLY ?? '—')}
        </p>
      </div>
      <div className="overflow-x-auto rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[var(--admin-border)] text-[10px] uppercase tracking-wide text-[var(--admin-muted)]">
            <tr>
              <th className="px-3 py-2">Cutover gate</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-border)]">
            {Object.entries(gateMap).map(([k, v]) => (
              <tr key={k}>
                <td className="px-3 py-2 font-medium">{k}</td>
                <td className="px-3 py-2 text-xs">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[var(--admin-border)] text-[10px] uppercase tracking-wide text-[var(--admin-muted)]">
            <tr>
              <th className="px-3 py-2">Shadow request</th>
              <th className="px-3 py-2">Total</th>
              <th className="px-3 py-2">Current allow</th>
              <th className="px-3 py-2">Shadow allow</th>
              <th className="px-3 py-2">Shadow deny</th>
              <th className="px-3 py-2">Diff</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-border)]">
            {byType.map((row) => (
              <tr key={String(row.REQUEST_TYPE)}>
                <td className="px-3 py-2">{String(row.REQUEST_TYPE)}</td>
                <td className="px-3 py-2 tabular-nums">{Number(row.TOTAL ?? 0)}</td>
                <td className="px-3 py-2 tabular-nums">{Number(row.CURRENT_ALLOWED ?? 0)}</td>
                <td className="px-3 py-2 tabular-nums">{Number(row.SHADOW_ALLOWED ?? 0)}</td>
                <td className="px-3 py-2 tabular-nums">{Number(row.SHADOW_DENIED ?? 0)}</td>
                <td className="px-3 py-2 tabular-nums">{Number(row.DIFFERENCE ?? 0)}</td>
              </tr>
            ))}
            {byType.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-3 text-[var(--admin-muted)]">
                  No shadow rows yet — run baseline.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[var(--admin-border)] text-[10px] uppercase tracking-wide text-[var(--admin-muted)]">
            <tr>
              <th className="px-3 py-2">Price leak endpoint</th>
              <th className="px-3 py-2">Anon</th>
              <th className="px-3 py-2">Non-approved</th>
              <th className="px-3 py-2">Approved</th>
              <th className="px-3 py-2">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-border)]">
            {matrix.map((row) => (
              <tr key={String(row.ENDPOINT)}>
                <td className="px-3 py-2 font-medium">{String(row.ENDPOINT)}</td>
                <td className="px-3 py-2 text-xs">{String(row.ANONYMOUS)}</td>
                <td className="px-3 py-2 text-xs">{String(row.NON_APPROVED)}</td>
                <td className="px-3 py-2 text-xs">{String(row.APPROVED)}</td>
                <td className="px-3 py-2 text-xs">{String(row.RESULT)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[var(--admin-muted)]">
        Kill switch: set <code>site_settings.commercial_access_mode = catalogue_open</code>. CRM commercial state is
        retained.
      </p>
    </div>
  )
}

export function AdminCutoverReadinessPanel() {
  const { canReassignOwnership } = useAdminAuth()
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState<Record<string, unknown> | null>(null)
  const [dq, setDq] = useState<Record<string, unknown> | null>(null)
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)
  const [phase4h, setPhase4h] = useState<Record<string, unknown> | null>(null)
  const [phase4iPrecheck, setPhase4iPrecheck] = useState<Record<string, unknown> | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [r, d, p, h, pre] = await Promise.all([
        fetchTradeCutoverReadiness(),
        fetchCommercialDataQuality(),
        previewExplicitTradeBackfillApply(),
        fetchTradeRequiredReadinessPhase4h().catch(() => null),
        fetchTradeRequiredCutoverPrecheck().catch(() => null),
      ])
      setReady(r)
      setDq(d)
      setPreview(p)
      setPhase4h(h)
      setPhase4iPrecheck(pre)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load readiness')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (loading) return <AdminLoadingState />
  const matrix = (ready?.matrix ?? []) as Array<Record<string, unknown>>
  const gate4h = (phase4h?.gate ?? {}) as Record<string, string>
  const gate4i = (phase4iPrecheck?.gate ?? {}) as Record<string, string>

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--admin-muted)]">
        Mode: <strong>{String(ready?.commercial_access_mode)}</strong> · Cutover approved flag:{' '}
        {String(ready?.trade_required_cutover_approved)}. Production stays catalogue_open until separate approval.
        Prefer the Shadow / cutover tab for Phase 4F gate detail.
      </p>
      {Object.keys(gate4i).length > 0 ? (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white p-3 text-sm">
          <p className="font-semibold">
            Phase 4I cutover precheck — ok={String(phase4iPrecheck?.ok)} · cutover_allowed_now=
            {String(phase4iPrecheck?.cutover_allowed_now ?? false)}
          </p>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(gate4i).map(([k, v]) => (
              <li key={k} className="text-xs tabular-nums">
                <span className="text-[var(--admin-muted)]">{k}</span>: {v}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {Object.keys(gate4h).length > 0 ? (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white p-3 text-sm">
          <p className="font-semibold">Phase 4H trade_required readiness (informational — do not flip)</p>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(gate4h).map(([k, v]) => (
              <li key={k} className="text-xs tabular-nums">
                <span className="text-[var(--admin-muted)]">{k}</span>: {v}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canReassignOwnership && (
          <button
            type="button"
            className={adminBtnSecondary}
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true)
                try {
                  const res = await reclassifyPayLaterBackfill()
                  toast.success(String(res.recommendation ?? 'PAY LATER reclassified'))
                  await refresh()
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'Reclassify failed')
                } finally {
                  setBusy(false)
                }
              })()
            }}
          >
            Reclassify PAY LATER → historical-only
          </button>
        )}
        <button type="button" className={adminBtnSecondary} onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      <div className="overflow-x-auto rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[var(--admin-border)] text-[10px] uppercase tracking-wide text-[var(--admin-muted)]">
            <tr>
              <th className="px-3 py-2">Capability</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Evidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-border)]">
            {matrix.map((row) => (
              <tr key={String(row.CAPABILITY)}>
                <td className="px-3 py-2 font-medium">{String(row.CAPABILITY)}</td>
                <td className="px-3 py-2 text-xs">{String(row.STATUS)}</td>
                <td className="px-3 py-2 text-xs text-[var(--admin-muted)]">{String(row.EVIDENCE)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white p-4 text-sm">
        <p className="font-semibold">Legacy preview RPC (Phase 4E)</p>
        <p className="mt-1 text-[var(--admin-muted)]">
          EXPLICIT candidates: {String(preview?.EXPLICIT_CANDIDATE_COUNT ?? 0)} · Conflicts:{' '}
          {String(preview?.CONFLICTS ?? 0)} · {String(preview?.note ?? '')}
        </p>
        <p className="mt-2 font-semibold">Data quality</p>
        <pre className="mt-1 max-h-40 overflow-auto text-xs text-[var(--admin-muted)]">
          {JSON.stringify(dq, null, 2)}
        </pre>
      </div>
    </div>
  )
}
