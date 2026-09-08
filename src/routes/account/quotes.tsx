import { createFileRoute, Link } from '@tanstack/react-router'
import { AccountSignInGate } from '@/components/account/AccountSignInGate'
import { Button } from '@/components/ui/button'
import { useStorefrontAuth } from '@/contexts/StorefrontAuthContext'
import { useMyQuotes } from '@/lib/storefront/storefrontQueries'
import { useFormatPrice } from '@/lib/currency'

export const Route = createFileRoute('/account/quotes')({
  component: AccountQuotesPage,
  head: () => ({ meta: [{ title: 'Quotes | Unique Distribution' }] }),
})

function AccountQuotesPage() {
  const { user } = useStorefrontAuth()
  const { data: quotes = [], isLoading } = useMyQuotes(Boolean(user))
  const formatPrice = useFormatPrice()

  return (
    <AccountSignInGate title="Quotes">
      <p className="mb-6 text-sm text-muted">
        Native Unique quote requests only. This list does not include sales notes or internal review comments.
      </p>
      {isLoading ? (
        <p className="text-muted">Loading quotes…</p>
      ) : quotes.length === 0 ? (
        <div className="rounded-xl border border-brand-border p-8 text-center">
          <p className="text-muted">No open quotes on this account.</p>
          <Button asChild className="mt-4">
            <Link to="/cart">Request a quote from your cart</Link>
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-brand-border rounded-xl border border-brand-border bg-white">
          {quotes.map((quote) => (
            <li key={quote.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="font-semibold">{quote.order_number}</p>
                <p className="text-xs text-muted">
                  {new Date(quote.created_at).toLocaleString('en-GB')} · {quote.status.replace(/_/g, ' ')}
                </p>
              </div>
              <p className="font-extrabold">{formatPrice(Number(quote.total))}</p>
            </li>
          ))}
        </ul>
      )}
    </AccountSignInGate>
  )
}
