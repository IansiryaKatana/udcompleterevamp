import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import {
  addAdminFinanceNote,
  getAdminPaymentTransaction,
  listAdminFinanceTimeline,
  reverseAdminManualPayment,
} from '@/admin/lib/adminRpc'
import {
  GATEWAY_LIVE_ACTIONS_DISABLED,
  WORLDPAY_DISABLED_MESSAGE,
  canMutateFinance,
  financeMoney,
  formatFinanceLabel,
  formatGatewayGateMessage,
  formatPaymentMethodLabel,
  fmtFinanceWhen,
  ledgerBoundaryLabel,
  newIdempotencyKey,
  paymentKindBadgeClass,
  paymentStatusBadgeClass,
  reconciliationStatusBadgeClass,
  formatReconciliationStatus,
} from '@/admin/lib/financeOps'
import type { GatewayGate, LedgerBoundary } from '@/admin/lib/financeOps'
import { FinanceActivityPanel } from '@/admin/finance/FinanceActivityPanel'
import { FinanceSubNav } from '@/admin/finance/FinanceSubNav'
import { AdminErrorBanner, AdminLoadingState } from '@/admin/components/AdminPageHeading'
import { adminBtnDanger, adminBtnSecondary, adminInput, adminLabel } from '@/admin/adminClassNames'
import { useAdminAuth } from '@/contexts/AdminAuthContext'
import { cn } from '@/lib/utils'

function Panel({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--admin-border)] px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text)]">{title}</h2>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-muted)]">{label}</dt>
      <dd className="mt-0.5 text-sm text-[var(--admin-text)]">{children}</dd>
    </div>
  )
}

export function AdminPaymentDetail({ paymentId }: { paymentId: string }) {
  const { role } = useAdminAuth()
  const canMutate = canMutateFinance(role)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [payment, setPayment] = useState<Record<string, unknown> | null>(null)
  const [order, setOrder] = useState<Record<string, unknown> | null>(null)
  const [related, setRelated] = useState<Record<string, unknown>[]>([])
  const [ledgerBoundary, setLedgerBoundary] = useState<LedgerBoundary | null>(null)
  const [gatewayGate, setGatewayGate] = useState<GatewayGate | null>(null)
  const [timeline, setTimeline] = useState<Record<string, unknown>[]>([])
  const [timelineTotal, setTimelineTotal] = useState(0)
  const [reverseReason, setReverseReason] = useState('')
  const [reversing, setReversing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getAdminPaymentTransaction(paymentId)
      setPayment((data.payment as Record<string, unknown>) || null)
      setOrder((data.order as Record<string, unknown>) || null)
      setRelated((data.related as Record<string, unknown>[]) || [])
      setLedgerBoundary((data.ledger_boundary as LedgerBoundary) ?? null)
      setGatewayGate((data.gateway_gate as GatewayGate) ?? null)
      const tl = await listAdminFinanceTimeline({
        entityType: 'payment',
        entityId: paymentId,
        limit: 50,
      })
      setTimeline(tl.items)
      setTimelineTotal(tl.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load payment')
    } finally {
      setLoading(false)
    }
  }, [paymentId])

  useEffect(() => {
    void load()
  }, [load])

  async function handleReverse() {
    if (!reverseReason.trim()) {
      toast.error('Enter a reversal reason')
      return
    }
    setReversing(true)
    try {
      await reverseAdminManualPayment({
        paymentId,
        reason: reverseReason.trim(),
        idempotencyKey: newIdempotencyKey('rev'),
      })
      toast.success('Payment reversed')
      setReverseReason('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reversal failed')
    } finally {
      setReversing(false)
    }
  }

  if (loading) return <AdminLoadingState />
  if (error || !payment) return <AdminErrorBanner message={error || 'Payment not found'} />

  const currency = String(payment.currency || 'GBP')
  const source = String(payment.source_system || '').toLowerCase()
  const isUnique = source === 'unique'
  const alreadyReversed = Boolean(payment.reversal_of_id) || String(payment.status || '').toLowerCase() === 'reversed'
  const gateway = String(payment.gateway || payment.formatted_gateway || '').toLowerCase()
  const looksWorldpay = gateway.includes('worldpay')
  const semantic = (payment.semantic as Record<string, unknown> | undefined) ?? null
  const worldpayActionsDisabled = GATEWAY_LIVE_ACTIONS_DISABLED || !gatewayGate?.allowed
  const gateMessage = formatGatewayGateMessage(gatewayGate)

  return (
    <div className="space-y-4 pb-10">
      <div>
        <Link
          to="/backend/finance/payments"
          className="mb-2 inline-flex items-center gap-1 text-sm text-[var(--admin-muted)] hover:text-[var(--admin-primary)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All payments
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Payment {paymentId.slice(0, 8)}…</h1>
        <p className="mt-1 text-sm text-[var(--admin-muted)]">
          {formatFinanceLabel(source)} · {fmtFinanceWhen(String(payment.processed_at || payment.created_at || ''))}
        </p>
      </div>

      <FinanceSubNav />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-4">
          <Panel title="Transaction">
            <dl className="grid gap-3 sm:grid-cols-2">
              <Field label="Amount">
                <span className="text-lg font-semibold tabular-nums">{financeMoney(payment.amount, currency)}</span>
              </Field>
              <Field label="Kind / status">
                <div className="flex flex-wrap gap-1.5">
                  <span className={cn('inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', paymentKindBadgeClass(String(payment.kind || '')))}>
                    {String(payment.kind || '—')}
                  </span>
                  <span className={cn('inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', paymentStatusBadgeClass(String(payment.status || '')))}>
                    {formatFinanceLabel(String(payment.status || ''))}
                  </span>
                </div>
              </Field>
              <Field label="Gateway">{String(payment.formatted_gateway || payment.gateway || '—')}</Field>
              <Field label="Method">{formatPaymentMethodLabel(payment.payment_method as string | null)}</Field>
              <Field label="Reference">{String(payment.payment_id || payment.authorization_code || '—')}</Field>
              <Field label="Payment date">{String(payment.payment_date || '—')}</Field>
              <Field label="External GID">
                <span className="break-all text-xs">{String(payment.external_gid || '—')}</span>
              </Field>
              <Field label="Internal note">{String(payment.internal_note || '—')}</Field>
            </dl>
          </Panel>

          {semantic && (
            <Panel title="Semantic classification">
              <dl className="grid gap-3 sm:grid-cols-2">
                <Field label="Meaning">{formatFinanceLabel(String(semantic.meaning || '—'))}</Field>
                <Field label="Affects received">
                  <span
                    className={cn(
                      'inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                      semantic.affects_received ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700',
                    )}
                  >
                    {semantic.affects_received ? 'Yes' : 'No'}
                  </span>
                </Field>
                <Field label="Confidence">{formatFinanceLabel(String(semantic.confidence || '—'))}</Field>
                <Field label="Terminal / transient">{formatFinanceLabel(String(semantic.terminal_or_transient || '—'))}</Field>
                <Field label="Evidence">
                  <span className="text-xs text-[var(--admin-muted)]">{String(semantic.evidence || '—')}</span>
                </Field>
              </dl>
            </Panel>
          )}

          {ledgerBoundary?.ok && (
            <Panel title="Ledger boundary">
              <dl className="grid gap-3 sm:grid-cols-2 text-sm">
                <Field label="Mode">{ledgerBoundaryLabel(ledgerBoundary.money_ledger_mode)}</Field>
                <Field label="Reconciliation">
                  <span
                    className={cn(
                      'inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                      reconciliationStatusBadgeClass(String(ledgerBoundary.reconciliation_status || '')),
                    )}
                  >
                    {formatReconciliationStatus(String(ledgerBoundary.reconciliation_status || ''))}
                  </span>
                </Field>
                <Field label="Imported received">
                  {financeMoney(ledgerBoundary.imported?.received, currency)}
                </Field>
                <Field label="Calculated received">
                  {financeMoney(ledgerBoundary.calculated?.net_received, currency)}
                </Field>
                {ledgerBoundary.variance?.received != null && Math.abs(Number(ledgerBoundary.variance.received)) >= 0.01 && (
                  <Field label="Variance (received)">
                    <span className="font-semibold text-amber-800 tabular-nums">
                      {financeMoney(ledgerBoundary.variance.received, currency)}
                    </span>
                  </Field>
                )}
              </dl>
            </Panel>
          )}

          <Panel title="Order">
            {order?.id ? (
              <div className="space-y-2 text-sm">
                <Link
                  to="/backend/orders/$orderId"
                  params={{ orderId: String(order.id) }}
                  className="font-semibold text-[var(--admin-primary)] hover:underline"
                >
                  {String(order.order_number || order.id)}
                </Link>
                <p className="text-[var(--admin-muted)]">
                  Outstanding {financeMoney(order.total_outstanding, String(order.currency || currency))} · Received{' '}
                  {financeMoney(order.total_received, String(order.currency || currency))}
                </p>
              </div>
            ) : (
              <p className="text-sm text-[var(--admin-muted)]">No order linked.</p>
            )}
          </Panel>

          {related.length > 0 && (
            <Panel title="Related transactions">
              <ul className="space-y-2">
                {related.map((tx) => (
                  <li key={String(tx.id)} className="flex justify-between gap-2 text-sm">
                    <Link
                      to="/backend/finance/payments/$paymentId"
                      params={{ paymentId: String(tx.id) }}
                      className="text-[var(--admin-primary)] hover:underline"
                    >
                      {String(tx.kind)} · {String(tx.status)}
                    </Link>
                    <span className="tabular-nums">{financeMoney(tx.amount, String(tx.currency || currency))}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <div className="space-y-4">
          <Panel title="Actions">
            {looksWorldpay && (
              <p className="mb-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {gateMessage}
              </p>
            )}
            {gatewayGate && (
              <p className="mb-3 text-xs text-[var(--admin-muted)]">
                Gateway gate: mode={String(gatewayGate.mode ?? '—')}
                {gatewayGate.error ? ` · ${gatewayGate.error}` : ''}
              </p>
            )}
            <button
              type="button"
              className={adminBtnSecondary}
              disabled={worldpayActionsDisabled}
              title={worldpayActionsDisabled ? WORLDPAY_DISABLED_MESSAGE : 'Worldpay actions'}
            >
              Worldpay capture / refund / void
            </button>
            <p className="mt-1 text-xs text-[var(--admin-muted)]">
              {worldpayActionsDisabled ? WORLDPAY_DISABLED_MESSAGE : gateMessage}
            </p>

            {canMutate && isUnique && !alreadyReversed && (
              <div className="mt-6 space-y-2 border-t border-[var(--admin-border)] pt-4">
                <label className={adminLabel}>Reverse Unique manual payment</label>
                <textarea
                  className={cn(adminInput, 'min-h-[72px]')}
                  placeholder="Reason for reversal…"
                  value={reverseReason}
                  onChange={(e) => setReverseReason(e.target.value)}
                />
                <button
                  type="button"
                  className={adminBtnDanger}
                  disabled={reversing || !reverseReason.trim()}
                  onClick={() => void handleReverse()}
                >
                  {reversing ? 'Reversing…' : 'Reverse payment'}
                </button>
              </div>
            )}
            {!isUnique && (
              <p className="mt-4 text-sm text-[var(--admin-muted)]">
                Imported Shopify transactions are immutable.
              </p>
            )}
            {!canMutate && (
              <p className="mt-4 text-sm text-[var(--admin-muted)]">
                Finance mutations require owner or admin role.
              </p>
            )}
          </Panel>

          <Panel title="Activity">
            <FinanceActivityPanel
              items={timeline}
              total={timelineTotal}
              canAddNote={canMutate}
              onAddNote={async (body) => {
                await addAdminFinanceNote({ entityType: 'payment', entityId: paymentId, body })
                toast.success('Note added')
                const tl = await listAdminFinanceTimeline({
                  entityType: 'payment',
                  entityId: paymentId,
                  limit: 50,
                })
                setTimeline(tl.items)
                setTimelineTotal(tl.total)
              }}
            />
          </Panel>
        </div>
      </div>
    </div>
  )
}
