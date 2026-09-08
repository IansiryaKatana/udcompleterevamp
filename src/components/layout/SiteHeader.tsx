import { Link } from '@tanstack/react-router'
import { ChevronDown, Menu, Search, ShoppingBag } from 'lucide-react'
import { useState } from 'react'
import { useCms } from '@/contexts/CmsContext'
import { CmsLink } from '@/components/layout/CmsLink'
import { MobileMenuDrawer } from '@/components/layout/MobileMenuDrawer'
import { SiteLogo } from '@/components/layout/SiteLogo'
import { AccountUtilityNav } from '@/components/layout/AccountUtilityNav'
import { useShopNav } from '@/lib/storefront/storefrontQueries'
import { headerCategoryLinks, UNIQUE_OTHERS_NAV } from '@/lib/storefront/uniqueCatalogueNav'
import { useCartStore } from '@/lib/stores/cart-store'
import { cn } from '@/lib/utils'

const navLinkClass =
  'inline-flex h-6 shrink-0 items-center text-[11px] font-semibold uppercase leading-none tracking-[0.12em] text-white/90 transition hover:text-white'

const utilityLinkClass =
  'text-[10px] font-semibold uppercase tracking-[0.12em] text-white/75 transition hover:text-white'

export function SiteHeader() {
  const { snapshot } = useCms()
  const { data: shopNav } = useShopNav()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [othersOpen, setOthersOpen] = useState(false)
  const cartCount = useCartStore((s) => s.items.reduce((sum, i) => sum + i.quantity, 0))
  const openCart = useCartStore((s) => s.openCart)
  const headerLinks = shopNav?.header?.length ? shopNav.header : headerCategoryLinks()
  const othersLinks = shopNav?.others?.length ? shopNav.others : UNIQUE_OTHERS_NAV
  const phone = snapshot.siteSettings.contact_phone?.trim()
  const email =
    snapshot.siteSettings.contact_notification_email?.trim() || 'info@uniquedistribution.com'

  return (
    <>
      <header className="site-header pointer-events-auto absolute inset-x-0 top-0 z-30 text-cream-text">
        <div className="hidden bg-footer-dark lg:block">
          <div className="flex items-center justify-between gap-4 px-6 py-2 text-white/80 md:px-14">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
              {phone ? (
                <a href={`tel:${phone.replace(/\s+/g, '')}`} className={utilityLinkClass}>
                  {phone}
                </a>
              ) : null}
              <a href={`mailto:${email}`} className={utilityLinkClass}>
                {email}
              </a>
            </div>
            <div className="flex flex-wrap items-center gap-x-4">
              <Link to="/account" className={utilityLinkClass}>
                Trade login
              </Link>
              <Link to="/trade" className={utilityLinkClass}>
                Trade registration
              </Link>
              <CmsLink href="/pages/help" className={utilityLinkClass}>
                Help
              </CmsLink>
              <CmsLink href="/pages/contact" className={utilityLinkClass}>
                Contact
              </CmsLink>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 px-6 py-3 md:px-14">
          <SiteLogo variant="dark" className="text-white" imageClassName="h-7 max-w-[130px] lg:h-10 lg:max-w-[200px]" />

          <nav className="hidden min-w-0 items-center gap-3 xl:flex xl:gap-4" aria-label="Primary">
            {headerLinks.map((link) => (
              <CmsLink
                key={link.href}
                href={link.href}
                className={cn(
                  navLinkClass,
                  link.highlight && 'h-7 rounded-md bg-cta-brown px-2.5 text-white hover:bg-cta-brown/90 hover:text-white',
                )}
              >
                {link.label}
              </CmsLink>
            ))}
            <div
              className="relative"
              onMouseEnter={() => setOthersOpen(true)}
              onMouseLeave={() => setOthersOpen(false)}
            >
              <button type="button" className={navLinkClass} aria-expanded={othersOpen}>
                Others
                <ChevronDown className="ml-0.5 h-3 w-3" />
              </button>
              {othersOpen ? (
                <div className="absolute right-0 top-full z-30 min-w-[220px] pt-2">
                  <div className="overflow-hidden rounded-lg border border-white/10 bg-white shadow-lg">
                    {othersLinks.map((item) => (
                      <CmsLink
                        key={item.href}
                        href={item.href}
                        className="block px-4 py-2.5 text-sm text-text-brown transition hover:bg-content-bg"
                      >
                        {item.label}
                      </CmsLink>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </nav>

          <div className="flex items-center gap-3 text-white">
            <Link to="/search" aria-label="Search" className="rounded-md p-2 transition hover:bg-white/10">
              <Search className="h-4 w-4" />
            </Link>
            <AccountUtilityNav />
            <button
              type="button"
              aria-label="Cart"
              onClick={openCart}
              className="relative rounded-md p-2 transition hover:bg-white/10"
            >
              <ShoppingBag className="h-4 w-4" />
              {cartCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-md bg-white px-1 text-[9px] font-bold text-text-brown">
                  {cartCount}
                </span>
              )}
            </button>
            <button
              type="button"
              aria-label="Open menu"
              aria-expanded={mobileOpen}
              className="rounded-md p-2 transition hover:bg-white/10 xl:hidden"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <MobileMenuDrawer open={mobileOpen} onClose={() => setMobileOpen(false)} />
    </>
  )
}
