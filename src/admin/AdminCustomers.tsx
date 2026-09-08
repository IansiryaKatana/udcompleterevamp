import { Link } from '@tanstack/react-router'
import { Building2, UserRound } from 'lucide-react'
import { adminBtnPrimary, adminBtnSecondary } from '@/admin/adminClassNames'

/**
 * Legacy commerce-tab customers list — redirects to Phase 2C CRM.
 * Kept mounted so Commerce hub does not break; no longer a competing customer UI.
 */
export function AdminCustomers() {
  return (
    <div className="mx-auto max-w-xl space-y-4 py-8 text-center">
      <div className="rounded-[var(--admin-radius)] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        The commerce-tab customer list is retired. Use the Unique Distribution CRM workspaces instead.
      </div>
      <h2 className="text-lg font-semibold text-[var(--admin-text)]">Customer & company CRM</h2>
      <p className="text-sm text-[var(--admin-muted)]">
        Operational B2B records, ownership, terms, outstanding balances, and draft defaults live under
        Customers and Companies — not this legacy commerce tab.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link to="/backend/customers" className={adminBtnPrimary}>
          <UserRound className="h-4 w-4" /> Open customers
        </Link>
        <Link to="/backend/companies" className={adminBtnSecondary}>
          <Building2 className="h-4 w-4" /> Open companies
        </Link>
      </div>
    </div>
  )
}
