import { createFileRoute, Link } from '@tanstack/react-router'
import { AccountSignInGate } from '@/components/account/AccountSignInGate'
import { Button } from '@/components/ui/button'
import { useStorefrontAuth } from '@/contexts/StorefrontAuthContext'
import { useMyCompany } from '@/lib/storefront/storefrontQueries'
import { useCommercialSession } from '@/lib/storefront/useCommercialSession'

export const Route = createFileRoute('/account/company')({
  component: AccountCompanyPage,
  head: () => ({ meta: [{ title: 'Company | Unique Distribution' }] }),
})

function AccountCompanyPage() {
  const { user } = useStorefrontAuth()
  const { data: session } = useCommercialSession()
  const { data: company, isLoading } = useMyCompany(Boolean(user) && Boolean(session?.company_id))

  return (
    <AccountSignInGate title="Company">
      {isLoading ? (
        <p className="text-muted">Loading company…</p>
      ) : !company ? (
        <div className="rounded-xl border border-brand-border p-8 text-center">
          <p className="text-muted">No company is linked to this customer yet.</p>
          <Button asChild className="mt-4">
            <Link to="/trade">Open a trade account</Link>
          </Button>
        </div>
      ) : (
        <div className="max-w-lg rounded-xl border border-brand-border bg-white p-5 text-sm">
          <h2 className="font-display text-xl font-extrabold">{company.name}</h2>
          {company.trading_name ? <p className="mt-1 text-muted">Trading as {company.trading_name}</p> : null}
          <p className="mt-3 capitalize text-muted">Status: {company.status.replace(/_/g, ' ')}</p>
          <p className="mt-4 text-xs text-muted">
            Ownership review, sales notes and other contacts are not shown on the storefront.
          </p>
        </div>
      )}
    </AccountSignInGate>
  )
}
