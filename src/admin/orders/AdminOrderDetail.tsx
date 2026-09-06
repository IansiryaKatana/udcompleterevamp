import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Copy, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import {
  addAdminOrderComment,
  fetchOrderFilterFacets,
  getAdminOrderWorkspace,
  listAdminOrderFulfillments,
  listAdminOrderItems,
  listAdminOrderPayments,
  listAdminOrderTimeline,
  updateAdminOrderOps,
} from '@/admin/lib/adminRpc'
import {
  copyText,
  financialBadgeClass,
  fulfillmentBadgeClass,
  formatStatusLabel,
  isCreditNoteYes,
  limitedHistoryMessage,
} from '@/admin/lib/orderOps'
import { AdminLoadingState, AdminErrorBanner } from '@/admin/components/AdminPageHeading'
import { adminBtnPrimary, adminBtnSecondary, adminInput, adminLabel } from '@/admin/adminClassNames'
import { BrandedSelect } from '@/components/ui/BrandedSelect'
import { formatCurrency } from '@/lib/currency'
import { formatShippingAddress } from '@/lib/formatShippingAddress'
import { cn } from '@/lib/utils'

type Workspace = Awaited<ReturnType<typeof getAdminOrderWorkspace>>

function money(n: unknown, currency: string) {
  return formatCurrency(Number(n ?? 0), currency)
}

function fmtWhen(iso: unknown) {
  if (!iso || typeof iso !== 'string') return '—'
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

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

export function AdminOrderDetail({ orderId }: { orderId: string }) {
  const [ws, setWs] = useState<Workspace | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<Record<string, unknown>[]>([])
  const [itemsTotal, setItemsTotal] = useState(0)
  const [itemSearch, setItemSearch] = useState('')
  const [itemPage, setItemPage] = useState(0)
  const [payments, setPayments] = useState<{ transactions: Record<string, unknown>[]; refunds: Record<string, unknown>[] }>({
    transactions: [],
    refunds: [],
  })
  const [fulfillments, setFulfillments] = useState<Record<string, unknown>[]>([])
  const [timeline, setTimeline] = useState<Record<string, unknown>[]>([])
  const [timelineTotal, setTimelineTotal] = useState(0)
  const [comments, setComments] = useState<Record<string, unknown>[]>([])
  const [noteBody, setNoteBody] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [opsSaving, setOpsSaving] = useState(false)
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([])
  const [spDraft, setSpDraft] = useState('')
  const [cgDraft, setCgDraft] = useState('')
  const [refDraft, setRefDraft] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const order = (ws?.order ?? null) as Record<string, unknown> | null
  const currency = String(order?.currency || 'GBP')

  const loadWorkspace = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getAdminOrderWorkspace(orderId)
      setWs(data)
      setSpDraft(String((data.order as Record<string, unknown>)?.salesperson_id ?? '') || '')
      setCgDraft(String((data.order as Record<string, unknown>)?.cg_assigned_id ?? '') || '')
      setRefDraft(String((data.order as Record<string, unknown>)?.referrer_id ?? '') || '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load order')
    } finally {
      setLoading(false)
    }
  }, [orderId])

  const loadPanels = useCallback(async () => {
    try {
      const [it, pay, ff, tl] = await Promise.all([
        listAdminOrderItems({ orderId, limit: 50, offset: itemPage * 50, search: itemSearch || undefined }),
        listAdminOrderPayments(orderId),
        listAdminOrderFulfillments(orderId),
        listAdminOrderTimeline({ orderId, limit: 50, offset: 0 }),
      ])
      setItems(it.items)
      setItemsTotal(it.total)
      setPayments(pay)
      setFulfillments(ff.fulfillments)
      setTimeline(tl.events)
      setTimelineTotal(tl.total)
      setComments(tl.comments)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load order panels')
    }
  }, [orderId, itemPage, itemSearch])

  useEffect(() => {
    void loadWorkspace()
  }, [loadWorkspace])

  useEffect(() => {
    void loadPanels()
  }, [loadPanels])

  useEffect(() => {
    void fetchOrderFilterFacets()
      .then((f) => setStaff(f.staff))
      .catch(() => {})
  }, [])

  const customer = (ws?.customer ?? null) as Record<string, unknown> | null
  const company = (ws?.company ?? null) as Record<string, unknown> | null
  const draft = (ws?.draft ?? null) as Record<string, unknown> | null
  const lineSummary = (ws?.line_summary ?? {}) as { line_count?: number; item_quantity?: number }
  const metafields = (ws?.metafields ?? []) as {
    namespace: string
    key: string
    value_text: string | null
    value_type: string | null
  }[]
  const tags = (ws?.tags ?? []) as { raw_value: string }[]
  const creditFlag = ws?.credit_note_flag as string | null | undefined

  const historyNote = useMemo(
    () =>
      limitedHistoryMessage(
        Number(ws?.event_count ?? 0),
        String(order?.source_created_at || order?.created_at || ''),
      ),
    [ws?.event_count, order],
  )

  async function saveOwnership() {
    setOpsSaving(true)
    try {
      await updateAdminOrderOps(orderId, {
        salesperson_id: spDraft || null,
        cg_assigned_id: cgDraft || null,
        referrer_id: refDraft || null,
      })
      toast.success('Ownership updated')
      await loadWorkspace()
      await loadPanels()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setOpsSaving(false)
    }
  }

  async function submitNote() {
    if (!noteBody.trim()) return
    setNoteSaving(true)
    try {
      await addAdminOrderComment(orderId, noteBody.trim())
      setNoteBody('')
      toast.success('Staff note added')
      await loadPanels()
      await loadWorkspace()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add note')
    } finally {
      setNoteSaving(false)
    }
  }

  if (loading) return <AdminLoadingState />
  if (error || !order) return <AdminErrorBanner message={error || 'Order not found'} />

  const orderNumber = String(order.source_order_number || order.order_number)
  const shippingAddr = formatShippingAddress(order.shipping_address)
  const uniqueNotes = comments.filter((c) => String(c.source_system || '') === 'unique')
  const shopifyNotes = comments.filter((c) => String(c.source_system || '') !== 'unique')

  return (
    <div className="space-y-4 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to="/backend/orders"
            className="mb-2 inline-flex items-center gap-1 text-sm text-[var(--admin-muted)] hover:text-[var(--admin-primary)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All orders
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{orderNumber}</h1>
          <p className="mt-1 text-sm text-[var(--admin-muted)]">{fmtWhen(order.source_created_at || order.created_at)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={adminBtnSecondary}
            onClick={() =>
              void copyText('Order number', orderNumber).then(() => toast.success('Order number copied'))
            }
          >
            <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy order #
          </button>
          {(customer?.email || order.email) && (
            <button
              type="button"
              className={adminBtnSecondary}
              onClick={() =>
                void copyText('Email', String(customer?.email || order.email)).then(() =>
                  toast.success('Customer email copied'),
                )
              }
            >
              Copy email
            </button>
          )}
        </div>
      </div>

      {/* Header strip */}
      <div className="grid gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-elevated)] p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <Field label="Source">{String(order.order_source || '—')}</Field>
        <Field label="Legacy status">{formatStatusLabel(String(order.status))}</Field>
        <Field label="Payment">
          <span className={cn('rounded px-1.5 py-0.5 text-xs font-semibold', financialBadgeClass(String(order.financial_status)))}>
            {formatStatusLabel(String(order.financial_status))}
          </span>
        </Field>
        <Field label="Fulfilment">
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-xs font-semibold',
              fulfillmentBadgeClass(String(order.commerce_fulfillment_status)),
            )}
          >
            {formatStatusLabel(String(order.commerce_fulfillment_status))}
          </span>
        </Field>
        <Field label="Total">{money(order.total, currency)}</Field>
        <Field label="Paid">{money(order.total_received, currency)}</Field>
        <Field label="Outstanding">
          <span className={Number(order.total_outstanding) > 0 ? 'font-semibold text-amber-800' : ''}>
            {money(order.total_outstanding, currency)}
          </span>
        </Field>
        <Field label="Due">{order.payment_due_on ? String(order.payment_due_on) : '—'}</Field>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-4">
          <Panel title="Customer / company">
            <dl className="grid gap-3 sm:grid-cols-2">
              <Field label="Customer">
                {customer ? (
                  <Link
                    to="/backend/commerce"
                    search={{ tab: 'customers' }}
                    className="font-medium text-[var(--admin-primary)] hover:underline"
                  >
                    {String(customer.display_name || `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Customer')}
                  </Link>
                ) : (
                  '—'
                )}
              </Field>
              <Field label="Company">{company ? String(company.name) : '—'}</Field>
              <Field label="StoreName / trading">{String(order.trading_name_snapshot || customer?.trading_name || '—')}</Field>
              <Field label="Email">{String(customer?.email || order.email || '—')}</Field>
              <Field label="Phone">{String(customer?.phone || '—')}</Field>
              <Field label="Customer type">
                {String(order.customer_type_snapshot || customer?.customer_type || '—')}
              </Field>
              <Field label="Payment due">{order.payment_due_on ? String(order.payment_due_on) : '—'}</Field>
              <Field label="Taxes included">{order.taxes_included ? 'Yes' : 'No'}</Field>
              <Field label="VAT / tax total">{money(order.tax_total, currency)}</Field>
              {isCreditNoteYes(creditFlag) && (
                <Field label="Credit note">
                  <span className="font-semibold text-rose-800">Yes</span>
                </Field>
              )}
              <Field label="Shipping address">
                <span className="whitespace-pre-line text-xs leading-relaxed">{shippingAddr || '—'}</span>
              </Field>
              <Field label="PO">{String(order.purchase_order_number || '—')}</Field>
            </dl>
            {Array.isArray(ws?.customer_tags) && (ws.customer_tags as string[]).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {(ws.customer_tags as string[]).slice(0, 12).map((t) => (
                  <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title={`Line items (${lineSummary.line_count ?? 0} lines · ${lineSummary.item_quantity ?? 0} units)`}
            actions={
              <input
                className={cn(adminInput, 'h-8 w-40 text-xs')}
                placeholder="SKU / product…"
                value={itemSearch}
                onChange={(e) => {
                  setItemPage(0)
                  setItemSearch(e.target.value)
                }}
              />
            }
          >
            <div className="overflow-x-auto">
              <table className="min-w-[900px] w-full text-left text-sm">
                <thead className="text-xs uppercase text-[var(--admin-muted)]">
                  <tr>
                    <th className="pb-2 pr-2">Product</th>
                    <th className="pb-2 pr-2">Variant</th>
                    <th className="pb-2 pr-2">SKU</th>
                    <th className="pb-2 pr-2 text-right">Qty</th>
                    <th className="pb-2 pr-2 text-right">Fulfilled</th>
                    <th className="pb-2 pr-2 text-right">Unit</th>
                    <th className="pb-2 pr-2 text-right">Orig</th>
                    <th className="pb-2 pr-2 text-right">Disc</th>
                    <th className="pb-2 pr-2 text-right">VAT</th>
                    <th className="pb-2 text-right">Line</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((li) => (
                    <tr key={String(li.id)} className="border-t border-[var(--admin-border)]">
                      <td className="py-2 pr-2">
                        <div className="max-w-[220px] font-medium">{String(li.product_name)}</div>
                      </td>
                      <td className="py-2 pr-2 text-xs text-[var(--admin-muted)]">
                        {String(li.variant_title_snapshot || li.variant_name || '—')}
                      </td>
                      <td className="py-2 pr-2 font-mono text-xs">{String(li.sku_snapshot || '—')}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{Number(li.quantity)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{Number(li.fulfilled_quantity ?? 0)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{money(li.unit_price, currency)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {li.original_unit_price == null ? '—' : money(li.original_unit_price, currency)}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">{money(li.discount_total, currency)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{money(li.tax_total, currency)}</td>
                      <td className="py-2 text-right font-medium tabular-nums">{money(li.line_total, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {itemsTotal > 50 && (
              <div className="mt-3 flex items-center justify-between text-sm text-[var(--admin-muted)]">
                <span>
                  Showing {itemPage * 50 + 1}–{Math.min((itemPage + 1) * 50, itemsTotal)} of {itemsTotal}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={adminBtnSecondary}
                    disabled={itemPage === 0}
                    onClick={() => setItemPage((p) => Math.max(0, p - 1))}
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    className={adminBtnSecondary}
                    disabled={(itemPage + 1) * 50 >= itemsTotal}
                    onClick={() => setItemPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </Panel>

          <Panel title="Payments">
            <p className="mb-3 text-sm">
              Outstanding:{' '}
              <strong className={Number(order.total_outstanding) > 0 ? 'text-amber-800' : ''}>
                {money(order.total_outstanding, currency)}
              </strong>
            </p>
            <div className="space-y-2">
              {payments.transactions.map((tx) => (
                <div
                  key={String(tx.id)}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded border border-[var(--admin-border)] px-3 py-2 text-sm"
                >
                  <div>
                    <div className="font-medium">
                      {String(tx.kind || 'TX')} · {String(tx.status || '—')}
                    </div>
                    <div className="text-xs text-[var(--admin-muted)]">
                      {String(tx.formatted_gateway || tx.gateway || '—')} · {fmtWhen(tx.processed_at || tx.created_at)}
                      {tx.authorization_code ? ` · auth ${String(tx.authorization_code)}` : ''}
                    </div>
                  </div>
                  <div className="font-semibold tabular-nums">{money(tx.amount, String(tx.currency || currency))}</div>
                </div>
              ))}
              {payments.transactions.length === 0 && (
                <p className="text-sm text-[var(--admin-muted)]">No payment transactions on file.</p>
              )}
            </div>
            {payments.refunds.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold uppercase text-[var(--admin-muted)]">Refunds</p>
                {payments.refunds.map((rf) => (
                  <div key={String(rf.id)} className="flex justify-between border-t border-[var(--admin-border)] py-2 text-sm">
                    <span>{fmtWhen(rf.source_created_at || rf.created_at)}{rf.note ? ` — ${String(rf.note)}` : ''}</span>
                    <span className="tabular-nums">{money(rf.total_refunded, currency)}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Fulfilment">
            {fulfillments.length === 0 && (
              <p className="text-sm text-[var(--admin-muted)]">No fulfilments recorded for this order.</p>
            )}
            <div className="space-y-4">
              {fulfillments.map((f) => {
                const lines = (f.lines as Record<string, unknown>[]) || []
                const url = f.tracking_url ? String(f.tracking_url) : null
                return (
                  <div key={String(f.id)} className="rounded border border-[var(--admin-border)] p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-medium">
                          {String(f.name || f.status || 'Fulfilment')} · {formatStatusLabel(String(f.display_status || f.status))}
                        </div>
                        <div className="mt-1 text-xs text-[var(--admin-muted)]">
                          {String(f.tracking_company || f.service_name || '—')}
                          {f.tracking_number ? ` · ${String(f.tracking_number)}` : ''}
                          {f.delivered_at ? ` · delivered ${fmtWhen(f.delivered_at)}` : ''}
                          {f.in_transit_at && !f.delivered_at ? ` · in transit ${fmtWhen(f.in_transit_at)}` : ''}
                        </div>
                      </div>
                      {url && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-sm font-medium text-[var(--admin-primary)] hover:underline"
                        >
                          Track <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                    {lines.length > 0 && (
                      <ul className="mt-2 space-y-1 text-xs text-[var(--admin-muted)]">
                        {lines.map((l) => (
                          <li key={String(l.id)}>
                            {String(l.name_snapshot || l.sku_snapshot || 'Line')} × {Number(l.quantity)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Financial summary">
            <dl className="space-y-2 text-sm">
              {(
                [
                  ['Subtotal', order.subtotal],
                  ['Discounts', order.discount_total],
                  ['Shipping', order.shipping_total],
                  ['VAT / tax', order.tax_total],
                  ['Total', order.total],
                  ['Paid', order.total_received],
                  ['Outstanding', order.total_outstanding],
                  ['Refunded', ws?.refunded_total],
                ] as const
              ).map(([label, val]) => (
                <div key={label} className="flex justify-between gap-4 border-b border-[var(--admin-border)]/60 py-1.5">
                  <dt className="text-[var(--admin-muted)]">{label}</dt>
                  <dd className="font-medium tabular-nums">{money(val, currency)}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-[var(--admin-muted)]">
              Historical snapshot from import — not recalculated from the live catalogue.
            </p>
          </Panel>

          {draft && (
            <Panel title="Draft order origin">
              <p className="text-sm font-medium">Created from draft</p>
              <dl className="mt-2 grid gap-2 text-sm">
                <Field label="Draft">{String(draft.name || draft.id)}</Field>
                <Field label="Created">{fmtWhen(draft.source_created_at || draft.created_at)}</Field>
                <Field label="Status">{formatStatusLabel(String(draft.status))}</Field>
              </dl>
              <p className="mt-2 text-xs text-[var(--admin-muted)]">
                Draft admin workspace arrives in a later phase; relationship is validated via{' '}
                <code className="text-[11px]">draft_order_id</code>.
              </p>
            </Panel>
          )}

          <Panel title="Sales ownership">
            <div className="space-y-3">
              <div>
                <label className={adminLabel}>Salesperson</label>
                <BrandedSelect
                  value={spDraft}
                  onValueChange={setSpDraft}
                  allowEmpty
                  emptyLabel="Unassigned"
                  options={staff.map((s) => ({ value: s.id, label: s.name }))}
                />
              </div>
              <div>
                <label className={adminLabel}>CG assigned</label>
                <BrandedSelect
                  value={cgDraft}
                  onValueChange={setCgDraft}
                  allowEmpty
                  emptyLabel="Unassigned"
                  options={staff.map((s) => ({ value: s.id, label: s.name }))}
                />
              </div>
              <div>
                <label className={adminLabel}>Referrer</label>
                <BrandedSelect
                  value={refDraft}
                  onValueChange={setRefDraft}
                  allowEmpty
                  emptyLabel="Unassigned"
                  options={staff.map((s) => ({ value: s.id, label: s.name }))}
                />
              </div>
              <button type="button" className={adminBtnPrimary} disabled={opsSaving} onClick={() => void saveOwnership()}>
                {opsSaving ? 'Saving…' : 'Save ownership'}
              </button>
            </div>
          </Panel>

          <Panel title="Tags">
            <div className="flex flex-wrap gap-1">
              {tags.length === 0 && <span className="text-sm text-[var(--admin-muted)]">No tags</span>}
              {tags.map((t) => (
                <span key={t.raw_value} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                  {t.raw_value}
                </span>
              ))}
            </div>
          </Panel>

          <Panel title="Staff notes (Unique)">
            <div className="space-y-3">
              <textarea
                className={cn(adminInput, 'min-h-[80px]')}
                placeholder="Add an operational note…"
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
              />
              <button type="button" className={adminBtnPrimary} disabled={noteSaving || !noteBody.trim()} onClick={() => void submitNote()}>
                {noteSaving ? 'Saving…' : 'Add note'}
              </button>
              <div className="space-y-2">
                {uniqueNotes.map((c) => (
                  <div key={String(c.id)} className="rounded border border-[var(--admin-border)] px-3 py-2 text-sm">
                    <div className="text-xs text-[var(--admin-muted)]">
                      {String(c.author_name_snapshot || 'Staff')} · {fmtWhen(c.occurred_at || c.created_at)}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap">{String(c.body)}</p>
                  </div>
                ))}
                {uniqueNotes.length === 0 && (
                  <p className="text-sm text-[var(--admin-muted)]">No Unique platform notes yet.</p>
                )}
              </div>
              {shopifyNotes.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer font-medium text-[var(--admin-muted)]">
                    Imported Shopify comments ({shopifyNotes.length})
                  </summary>
                  <div className="mt-2 space-y-2">
                    {shopifyNotes.map((c) => (
                      <div key={String(c.id)} className="rounded bg-slate-50 px-3 py-2">
                        <div className="text-xs text-[var(--admin-muted)]">{fmtWhen(c.occurred_at)}</div>
                        <p className="mt-1 whitespace-pre-wrap">{String(c.body)}</p>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </Panel>

          <Panel title="Activity timeline">
            {historyNote && (
              <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {historyNote}
              </p>
            )}
            <div className="space-y-2">
              {timeline.map((ev) => (
                <div key={String(ev.id)} className="border-l-2 border-[var(--admin-border)] pl-3 text-sm">
                  <div className="text-xs text-[var(--admin-muted)]">
                    {fmtWhen(ev.occurred_at)} · {String(ev.source_system || '—')} · {String(ev.category || '')}/
                    {String(ev.event_type || '')}
                  </div>
                  <div className="mt-0.5">{String(ev.message || ev.actor_name_snapshot || 'Event')}</div>
                </div>
              ))}
              {timeline.length === 0 && (
                <p className="text-sm text-[var(--admin-muted)]">No timeline events available.</p>
              )}
            </div>
            {timelineTotal > timeline.length && (
              <p className="mt-2 text-xs text-[var(--admin-muted)]">
                Showing {timeline.length} of {timelineTotal} events
              </p>
            )}
          </Panel>

          <Panel
            title="Additional Shopify data"
            actions={
              <button type="button" className="text-xs font-medium text-[var(--admin-primary)]" onClick={() => setAdvancedOpen((v) => !v)}>
                {advancedOpen ? 'Hide' : 'Show'}
              </button>
            }
          >
            {advancedOpen ? (
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-[var(--admin-muted)]">
                      <th className="pb-1">Namespace.key</th>
                      <th className="pb-1">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metafields.map((m) => (
                      <tr key={`${m.namespace}.${m.key}`} className="border-t border-[var(--admin-border)] align-top">
                        <td className="py-1.5 pr-2 font-mono">
                          {m.namespace}.{m.key}
                        </td>
                        <td className="py-1.5 break-all">{m.value_text ?? '—'}</td>
                      </tr>
                    ))}
                    {metafields.length === 0 && (
                      <tr>
                        <td colSpan={2} className="py-2 text-[var(--admin-muted)]">
                          No metafields
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-[var(--admin-muted)]">{metafields.length} preserved metafields</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
