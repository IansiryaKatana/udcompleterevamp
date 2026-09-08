import { createFileRoute } from '@tanstack/react-router'
import { AccountSignInGate } from '@/components/account/AccountSignInGate'
import { useStorefrontAuth } from '@/contexts/StorefrontAuthContext'
import { useMyInvoices, useMyStatements } from '@/lib/storefront/storefrontQueries'
import { useFormatPrice } from '@/lib/currency'

export const Route = createFileRoute('/account/invoices')({
  component: AccountInvoicesPage,
  head: () => ({ meta: [{ title: 'Invoices | Unique Distribution' }] }),
})

function AccountInvoicesPage() {
  const { user } = useStorefrontAuth()
  const { data: invoices = [], isLoading } = useMyInvoices(Boolean(user))
  const { data: statements = [] } = useMyStatements(Boolean(user))
  const formatPrice = useFormatPrice()

  return (
    <AccountSignInGate title="Invoices & statements">
      <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        Documents labelled Unique-native are account records, not official production invoices. Invoice numbering is
        still under review and must not be treated as Unique live finance output.
      </p>
      {isLoading ? (
        <p className="text-muted">Loading invoices…</p>
      ) : invoices.length === 0 ? (
        <p className="text-muted">No customer-safe invoices are available on this account yet.</p>
      ) : (
        <ul className="divide-y divide-brand-border rounded-xl border border-brand-border bg-white">
          {invoices.map((invoice) => (
            <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="font-semibold">{invoice.invoice_number}</p>
                <p className="text-xs text-muted">
                  {invoice.invoice_date} · {invoice.status}
                  {invoice.display_kind === 'imported' ? ' · Imported record' : ' · Unique-native account document'}
                </p>
              </div>
              <p className="font-extrabold">{formatPrice(Number(invoice.total))}</p>
            </li>
          ))}
        </ul>
      )}

      {statements.length > 0 ? (
        <div className="mt-8">
          <h2 className="mb-3 font-display text-xl font-extrabold">Statements</h2>
          <ul className="divide-y divide-brand-border rounded-xl border border-brand-border bg-white">
            {statements.map((statement) => (
              <li key={statement.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <p>
                  {statement.period_from} – {statement.period_to}
                </p>
                <p className="font-extrabold">{formatPrice(Number(statement.closing_balance))}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </AccountSignInGate>
  )
}
