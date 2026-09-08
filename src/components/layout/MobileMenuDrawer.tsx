import { Link } from '@tanstack/react-router'
import { ChevronDown, Search, ShoppingBag, User, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStorefrontAuth } from '@/contexts/StorefrontAuthContext'
import { CmsLink } from '@/components/layout/CmsLink'
import { SiteLogo } from '@/components/layout/SiteLogo'
import { mobileAccountLinks } from '@/components/layout/AccountUtilityNav'
import { useShopNav } from '@/lib/storefront/storefrontQueries'
import { headerCategoryLinks, UNIQUE_OTHERS_NAV } from '@/lib/storefront/uniqueCatalogueNav'
import { useCommercialSession } from '@/lib/storefront/useCommercialSession'
import { useCartStore } from '@/lib/stores/cart-store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type MobileMenuDrawerProps = {
  open: boolean
  onClose: () => void
}

export function MobileMenuDrawer({ open, onClose }: MobileMenuDrawerProps) {
  const { user, signOut } = useStorefrontAuth()
  const { data: session } = useCommercialSession()
  const { data: shopNav } = useShopNav()
  const headerLinks = shopNav?.header?.length ? shopNav.header : headerCategoryLinks()
  const othersLinks = shopNav?.others?.length ? shopNav.others : UNIQUE_OTHERS_NAV
  const [othersOpen, setOthersOpen] = useState(false)
  const cartCount = useCartStore((s) => s.items.reduce((sum, i) => sum + i.quantity, 0))
  const openCart = useCartStore((s) => s.openCart)
  const accountItems = mobileAccountLinks({
    signedIn: Boolean(user),
    linked: Boolean(session?.auth_linked),
    hasCompany: Boolean(session?.company_id),
  })

  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open) setOthersOpen(false)
  }, [open])

  if (!open) return null

  function handleOpenCart() {
    onClose()
    openCart()
  }

  return (
    <div
      className="mobile-menu-drawer fixed inset-0 z-[60] flex flex-col bg-content-bg lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation menu"
    >
      <div className="flex shrink-0 items-center justify-between bg-hero-brown px-6 py-5 text-cream-text md:px-8">
        <SiteLogo variant="dark" className="text-white" imageClassName="h-10 max-w-[200px]" onNavigate={onClose} />
        <button
          type="button"
          aria-label="Close menu"
          onClick={onClose}
          className="rounded-md p-2.5 text-cream-text transition hover:bg-white/10"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex flex-1 flex-col overflow-y-auto px-6 py-6 md:px-8 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <Link
          to="/"
          onClick={onClose}
          className="border-b border-brand-border py-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-brown transition hover:text-cta-brown"
        >
          Home
        </Link>

        {headerLinks.map((link) => (
          <CmsLink
            key={link.href}
            href={link.href}
            onClick={onClose}
            className="border-b border-brand-border py-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-brown transition hover:text-cta-brown"
          >
            {link.label}
          </CmsLink>
        ))}

        <div className="border-b border-brand-border">
          <button
            type="button"
            aria-expanded={othersOpen}
            onClick={() => setOthersOpen((value) => !value)}
            className="flex w-full items-center justify-between gap-3 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-text-brown transition hover:text-cta-brown"
          >
            <span>Others</span>
            <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted transition-transform duration-200', othersOpen && 'rotate-180')} />
          </button>
          {othersOpen ? (
            <div className="flex flex-col gap-1 pb-4 pl-1">
              {othersLinks.map((item) => (
                <CmsLink
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className="rounded-lg px-3 py-2.5 text-sm text-text-brown transition hover:bg-soft-beige"
                >
                  {item.label}
                </CmsLink>
              ))}
            </div>
          ) : null}
        </div>

        <CmsLink href="/account" onClick={onClose} className="border-b border-brand-border py-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-brown transition hover:text-cta-brown">
          Trade login
        </CmsLink>
        <CmsLink href="/trade" onClick={onClose} className="border-b border-brand-border py-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-brown transition hover:text-cta-brown">
          Trade registration
        </CmsLink>
        <CmsLink href="/pages/help" onClick={onClose} className="border-b border-brand-border py-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-brown transition hover:text-cta-brown">
          Help
        </CmsLink>
        <CmsLink href="/pages/contact" onClick={onClose} className="border-b border-brand-border py-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-brown transition hover:text-cta-brown">
          Contact
        </CmsLink>

        {accountItems.map((item) =>
          item.href === '#sign-out' ? (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                void signOut()
                onClose()
              }}
              className="border-b border-brand-border py-4 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-text-brown transition hover:text-cta-brown"
            >
              {item.label}
            </button>
          ) : (
            <CmsLink
              key={`${item.href}-${item.label}`}
              href={item.href}
              onClick={onClose}
              className="border-b border-brand-border py-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-brown transition hover:text-cta-brown"
            >
              {item.label}
            </CmsLink>
          ),
        )}
      </nav>

      <div className="shrink-0 border-t border-brand-border bg-soft-beige px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-8">
        <div className="grid grid-cols-3 gap-2">
          <Link
            to="/search"
            onClick={onClose}
            className="flex flex-col items-center gap-1.5 rounded-xl bg-content-bg px-2 py-3 text-center text-xs font-semibold text-text-brown transition hover:bg-white"
          >
            <Search className="h-5 w-5 text-cta-brown" />
            Search
          </Link>
          <Link
            to="/account"
            onClick={onClose}
            className="flex flex-col items-center gap-1.5 rounded-xl bg-content-bg px-2 py-3 text-center text-xs font-semibold text-text-brown transition hover:bg-white"
          >
            <User className="h-5 w-5 text-cta-brown" />
            {user ? 'Account' : 'Sign in'}
          </Link>
          <button
            type="button"
            onClick={handleOpenCart}
            className="relative flex flex-col items-center gap-1.5 rounded-xl bg-content-bg px-2 py-3 text-center text-xs font-semibold text-text-brown transition hover:bg-white"
          >
            <ShoppingBag className="h-5 w-5 text-cta-brown" />
            Cart
            {cartCount > 0 ? (
              <span className="absolute right-3 top-2 flex h-4 min-w-4 items-center justify-center rounded-md bg-hero-brown px-1 text-[9px] font-bold text-cream-text">
                {cartCount}
              </span>
            ) : null}
          </button>
        </div>

        <Button type="button" variant="cream" className="mt-3 h-11 w-full rounded-md text-sm font-bold" onClick={onClose}>
          Close menu
        </Button>
      </div>
    </div>
  )
}
