import { useRouterState } from '@tanstack/react-router'
import { CmsLink } from '@/components/layout/CmsLink'
import { useStorefrontAuth } from '@/contexts/StorefrontAuthContext'
import { useCommercialSession } from '@/lib/storefront/useCommercialSession'
import { cn } from '@/lib/utils'

type NavItem = { label: string; href: string }

export function accountDashboardLinks(opts: { linked: boolean; hasCompany: boolean }): NavItem[] {
  const links: NavItem[] = [
    { label: 'Overview', href: '/account' },
    { label: 'Orders', href: '/account' },
  ]
  if (opts.linked) {
    links.push(
      { label: 'Quotes', href: '/account/quotes' },
      { label: 'Invoices', href: '/account/invoices' },
      { label: 'Addresses', href: '/account/addresses' },
    )
  }
  if (opts.hasCompany) links.push({ label: 'Company', href: '/account/company' })
  links.push({ label: 'Trade', href: '/trade' })
  return links
}

export function AccountSubNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { user } = useStorefrontAuth()
  const { data: session } = useCommercialSession()
  if (!user) return null
  const links = accountDashboardLinks({
    linked: Boolean(session?.auth_linked),
    hasCompany: Boolean(session?.company_id),
  })

  return (
    <nav aria-label="Account" className="mb-8 flex flex-wrap gap-2">
      {links.map((link) => {
        const active = pathname === link.href || (link.href !== '/account' && pathname.startsWith(link.href))
        return (
          <CmsLink
            key={`${link.href}-${link.label}`}
            href={link.href}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide',
              active ? 'border-cta-brown bg-cta-brown text-white' : 'border-brand-border bg-white text-text-brown',
            )}
          >
            {link.label}
          </CmsLink>
        )
      })}
    </nav>
  )
}
