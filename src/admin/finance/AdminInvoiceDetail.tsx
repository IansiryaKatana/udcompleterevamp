import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import {
  addAdminFinanceNote,
  getAdminInvoice,
  listAdminFinanceTimeline,
} from '@/admin/lib/adminRpc'
import {
  canMutateFinance,
  financeMoney,
  formatFinanceLabel,
  fmtFinanceDate,
  invoiceStatusBadgeClass,
  provenanceBadgeClass,
} from '@/admin/lib/financeOps'
import { FinanceActivityPanel } from '@/admin/finance/FinanceActivityPanel'
import { FinanceSubNav } from '@/admin/finance/FinanceSubNav'
import { AdminErrorBanner, AdminLoadingState } from '@/admin/components/AdminPageHeading'
import { useAdminAuth } from '@/contexts/AdminAuthContext'
import { cn } from '@/lib/utils'

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white">
      <div className="border-b border-[var(--admin-border)] px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text)]">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

export function AdminInvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const { role } = useAdminAuth()
  const canMutate = canMutateFinance(role)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [invoice, setInvoice] = useState<Record<string, unknown> | null>(null)
  const [document, setDocument] = useState<Record<string, unknown> | null>(null)
  const [timeline, setTimeline] = useState<Record<string, unknown>[]>([])
  const [timelineTotal, setTimelineTotal] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getAdminInvoice(invoiceId)
      setInvoice((data.invoice as Record<string, unknown>) || null)
      setDocument((data.document as Record<string, unknown>) || null)
      const tl = await listAdminFinanceTimeline({
        entityType: 'invoice',
        entityId: invoiceId,
        limit: 50,
      })
      setTimeline(tl.items)
      setTimelineTotal(tl.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load invoice')
    } finally {
      setLoading(false)
    }
  }, [invoiceId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) return <AdminLoadingState />
  if (error || !invoice) return <AdminErrorBanner message={error || 'Invoice not found'} />

  const currency = String(invoice.currency || 'GBP')
  const lines = (invoice.line_items_snapshot as Record<string, unknown>[]) || []
  const bodyHtml = document?.body_html ? String(document.body_html) : null

  return (
    <div className="space-y-4 pb-10">
      <div>
        <Link
          to="/backend/finance/invoices"
          className="mb-2 inline-flex items-center gap-1 text-sm text-[var(--admin-muted)] hover:text-[var(--admin-primary)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All invoices
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {String(invoice.invoice_number || invoiceId.slice(0, 8))}
          </h1>
          <span className={cn('inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', invoiceStatusBadgeClass(String(invoice.status || '')))}>
            {formatFinanceLabel(String(invoice.status || ''))}
          </span>
          <span className={cn('inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', provenanceBadgeClass(String(invoice.provenance || '')))}>
            {formatFinanceLabel(String(invoice.provenance || ''))}
          </span>
        </div>
      </div>

      <FinanceSubNav />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="space-y-4">
          <Panel title="Totals">
            <dl className="grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-[10px] font-semibold uppercase text-[var(--admin-muted)]">Total</dt>
                <dd className="font-semibold tabular-nums">{financeMoney(invoice.total, currency)}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase text-[var(--admin-muted)]">Paid</dt>
                <dd className="tabular-nums">{financeMoney(invoice.amount_paid, currency)}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase text-[var(--admin-muted)]">
                  Outstanding (operational)
                </dt>
                <dd className="font-semibold tabular-nums text-amber-800">
                  {financeMoney(invoice.outstanding, currency)}
                </dd>
                <p className="mt-1 text-[10px] text-[var(--admin-muted)]">
                  Basis: invoice ledger · see reconciliation queue for SOURCE vs CALCULATED vs REVIEWED
                </p>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase text-[var(--admin-muted)]">Invoice date</dt>
                <dd>{fmtFinanceDate(invoice.invoice_date as string | null)}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase text-[var(--admin-muted)]">Due date</dt>
                <dd>{fmtFinanceDate(invoice.due_date as string | null)}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase text-[var(--admin-muted)]">Order</dt>
                <dd>
                  {invoice.order_id ? (
                    <Link
                      to="/backend/orders/$orderId"
                      params={{ orderId: String(invoice.order_id) }}
                      className="text-[var(--admin-primary)] hover:underline"
                    >
                      {String(invoice.order_number || invoice.order_id)}
                    </Link>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Line items (snapshot)">
            {lines.length === 0 ? (
              <p className="text-sm text-[var(--admin-muted)]">No line snapshot on this invoice.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="text-xs uppercase text-[var(--admin-muted)]">
                    <tr>
                      <th className="px-2 py-1">SKU</th>
                      <th className="px-2 py-1">Description</th>
                      <th className="px-2 py-1 text-right">Qty</th>
                      <th className="px-2 py-1 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, i) => (
                      <tr key={i} className="border-t border-[var(--admin-border)]">
                        <td className="px-2 py-1.5 font-mono text-xs">{String(line.sku || '—')}</td>
                        <td className="px-2 py-1.5">{String(line.title || line.name || line.description || '—')}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{Number(line.quantity ?? 0)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {financeMoney(line.line_total ?? line.amount ?? line.price, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {bodyHtml && (
            <Panel title="Document (HTML)">
              <div
                className="prose prose-sm max-w-none rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4"
                dangerouslySetInnerHTML={{ __html: bodyHtml }}
              />
            </Panel>
          )}
        </div>

        <Panel title="Activity">
          <FinanceActivityPanel
            items={timeline}
            total={timelineTotal}
            canAddNote={canMutate}
            onAddNote={async (body) => {
              await addAdminFinanceNote({ entityType: 'invoice', entityId: invoiceId, body })
              toast.success('Note added')
              const tl = await listAdminFinanceTimeline({
                entityType: 'invoice',
                entityId: invoiceId,
                limit: 50,
              })
              setTimeline(tl.items)
              setTimelineTotal(tl.total)
            }}
          />
        </Panel>
      </div>
    </div>
  )
}
