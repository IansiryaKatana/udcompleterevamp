import { Link } from '@tanstack/react-router'
import { useShopNav } from '@/lib/storefront/storefrontQueries'
import { CmsLink } from '@/components/layout/CmsLink'
import { cn } from '@/lib/utils'

const navLinkClass =
  'inline-flex h-6 shrink-0 items-center gap-1 text-[11px] font-semibold uppercase leading-none tracking-[0.14em] text-white/90 transition hover:text-white'

export function ShopMegaMenu({ open, onOpen, onClose }: { open: boolean; onOpen: () => void; onClose: () => void }) {
  const { data } = useShopNav()
  const items = data?.items ?? []
  const viewAll = data?.viewAll ?? { label: 'View all categories', href: '/collection/all' }

  return (
    <div className="relative flex items-center" onMouseEnter={onOpen} onMouseLeave={onClose}>
      <Link to="/collection/$slug" params={{ slug: 'all' }} className={navLinkClass}>
        Shop
      </Link>
      {open ? (
        <div className="absolute left-0 top-full z-30 min-w-[280px] pt-2 lg:min-w-[520px]">
          <div className="overflow-hidden rounded-lg border border-white/10 bg-white shadow-lg">
            <p className="border-b border-brand-border px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-text-brown">
              Shop wholesale
            </p>
            <div className={cn('grid', items.length > 4 ? 'sm:grid-cols-2' : 'grid-cols-1')}>
              {items.map((item) => (
                <CmsLink
                  key={item.href}
                  href={item.href}
                  className="block px-4 py-2.5 text-sm text-text-brown transition hover:bg-content-bg"
                >
                  <span className="font-semibold">{item.label}</span>
                  {item.product_count ? (
                    <span className="ml-2 text-xs text-muted">{item.product_count}</span>
                  ) : null}
                </CmsLink>
              ))}
            </div>
            <CmsLink
              href={viewAll.href}
              className="block border-t border-brand-border px-4 py-2.5 text-sm font-semibold text-cta-brown transition hover:bg-content-bg"
            >
              {viewAll.label}
            </CmsLink>
          </div>
        </div>
      ) : null}
    </div>
  )
}
