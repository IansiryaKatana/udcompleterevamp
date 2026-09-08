import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { User } from 'lucide-react'
import { useStorefrontAuth } from '@/contexts/StorefrontAuthContext'
import { useCommercialSession } from '@/lib/storefront/useCommercialSession'
import { CmsLink } from '@/components/layout/CmsLink'
import { cn } from '@/lib/utils'

type AccountLink = { label: string; href: string }

function accountLinks(opts: {
  signedIn: boolean
  linked: boolean
  hasCompany: boolean
}): AccountLink[] {
  if (!opts.signedIn) return []
  const links: AccountLink[] = [
    { label: 'Overview', href: '/account' },
    { label: 'Orders', href: '/account' },
  ]
  if (opts.linked) {
    links.push(
      { label: 'Quotes', href: '/account/quotes' },
      { label: 'Invoices / statements', href: '/account/invoices' },
      { label: 'Addresses', href: '/account/addresses' },
    )
  }
  if (opts.hasCompany) links.push({ label: 'Company', href: '/account/company' })
  links.push({ label: 'Trade account', href: '/trade' })
  return links
}

export function AccountUtilityNav({ iconClassName }: { iconClassName?: string }) {
  const { user, signOut } = useStorefrontAuth()
  const { data: session } = useCommercialSession()
  const [open, setOpen] = useState(false)
  const linked = Boolean(session?.auth_linked)
  const hasCompany = Boolean(session?.company_id)
  const links = accountLinks({ signedIn: Boolean(user), linked, hasCompany })

  if (!user) {
    return (
      <Link to="/account" aria-label="Sign in" className="hidden rounded-md p-2 transition hover:bg-white/10 sm:inline-flex">
        <User className={cn('h-4 w-4', iconClassName)} />
      </Link>
    )
  }

  return (
    <div
      className="relative hidden sm:block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <Link to="/account" aria-label="My account" className="rounded-md p-2 transition hover:bg-white/10">
        <User className={cn('h-4 w-4', iconClassName)} />
      </Link>
      {open ? (
        <div className="absolute right-0 top-full z-40 min-w-[220px] pt-2">
          <div className="overflow-hidden rounded-lg border border-white/10 bg-white shadow-lg">
            <p className="border-b border-brand-border px-4 py-2 text-xs font-bold uppercase tracking-wide text-text-brown">
              My account
            </p>
            {links.map((link) => (
              <CmsLink
                key={`${link.href}-${link.label}`}
                href={link.href}
                className="block px-4 py-2.5 text-sm text-text-brown transition hover:bg-content-bg"
              >
                {link.label}
              </CmsLink>
            ))}
            <button
              type="button"
              className="block w-full border-t border-brand-border px-4 py-2.5 text-left text-sm text-text-brown transition hover:bg-content-bg"
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function mobileAccountLinks(opts: {
  signedIn: boolean
  linked: boolean
  hasCompany: boolean
}): AccountLink[] {
  if (!opts.signedIn) {
    return [
      { label: 'Trade account', href: '/trade' },
      { label: 'Sign in', href: '/account' },
    ]
  }
  return [...accountLinks(opts), { label: 'Sign out', href: '#sign-out' }]
}
