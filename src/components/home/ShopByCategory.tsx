import { ChevronRight } from 'lucide-react'
import { useCms } from '@/contexts/CmsContext'
import { getSectionByKey } from '@/lib/cms/loadCmsSnapshot'
import { shopByCategoryLinks } from '@/lib/storefront/uniqueCatalogueNav'
import { useShopNav } from '@/lib/storefront/storefrontQueries'
import { CmsLink } from '@/components/layout/CmsLink'
import { SectionContainer } from '@/components/layout/SectionContainer'

export function ShopByCategory() {
  const { snapshot } = useCms()
  const section = getSectionByKey(snapshot, 'shop_by_category') ?? getSectionByKey(snapshot, 'trade_proof')
  const { data } = useShopNav()
  const items = data?.shopByCategory?.length ? data.shopByCategory : shopByCategoryLinks()

  return (
    <section id="shop-by-category" className="scroll-mt-8 border-y border-brand-border bg-soft-beige py-10">
      <SectionContainer>
        <div className="mb-6 max-w-2xl">
          <h2 className="font-display text-2xl font-extrabold text-text-brown md:text-3xl">
            {section?.title || 'Shop by category'}
          </h2>
          <p className="mt-2 text-sm text-muted">
            {section?.subtitle || 'Browse wholesale ranges used by UK retailers.'}
          </p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <li key={item.href}>
              <CmsLink
                href={item.href}
                className="flex h-12 items-center justify-between rounded-md border border-brand-border bg-white px-4 text-sm font-semibold text-text-brown transition hover:border-cta-brown/50 hover:bg-content-bg"
              >
                <span className="truncate pr-3">{item.label}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-cta-brown" aria-hidden />
              </CmsLink>
            </li>
          ))}
        </ul>
      </SectionContainer>
    </section>
  )
}
