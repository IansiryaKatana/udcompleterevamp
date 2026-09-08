import { Link, useRouterState } from '@tanstack/react-router'
import { FINANCE_SUBNAV } from '@/admin/lib/financeOps'
import { cn } from '@/lib/utils'

export function FinanceSubNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <nav className="flex flex-wrap gap-1 border-b border-[var(--admin-border)] pb-3">
      {FINANCE_SUBNAV.map((item) => {
        const active = item.exact
          ? pathname === item.to || pathname === `${item.to}/`
          : pathname === item.to || pathname.startsWith(`${item.to}/`)
        return (
          <Link
            key={item.to}
            to={item.to}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'bg-[var(--admin-primary)] text-white'
                : 'text-[var(--admin-muted)] hover:bg-[var(--admin-primary-muted)] hover:text-[var(--admin-text)]',
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
