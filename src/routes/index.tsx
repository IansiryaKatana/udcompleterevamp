import { createFileRoute } from '@tanstack/react-router'
import { useCms } from '@/contexts/CmsContext'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildOrganizationJsonLd } from '@/lib/seo/jsonLd'
import { SiteHeader } from '@/components/layout/SiteHeader'
import { StorefrontLayout } from '@/components/layout/StorefrontLayout'
import { HeroSection } from '@/components/home/HeroSection'
import { FeatureCards } from '@/components/home/FeatureCards'
import { ProductSection } from '@/components/home/ProductSection'
import { RecommendedCollections } from '@/components/home/RecommendedCollections'
import { ShopByCategory } from '@/components/home/ShopByCategory'
import { FinalCTA } from '@/components/home/FinalCTA'

export const Route = createFileRoute('/')({
  component: HomePage,
  head: () => ({ meta: [{ title: 'Unique Distribution — UK wholesale for retailers' }] }),
})

function HomePage() {
  const { snapshot } = useCms()
  const storeUrl = snapshot.siteSettings.store_url?.trim() || (typeof window !== 'undefined' ? window.location.origin : '')

  return (
    <StorefrontLayout>
      <JsonLd data={buildOrganizationJsonLd(snapshot.siteName, storeUrl)} />
      <div className="relative">
        <SiteHeader />
        <HeroSection />
      </div>
      <FeatureCards />
      <ShopByCategory />
      <ProductSection sectionKey="newly_dropped" />
      <RecommendedCollections />
      <ProductSection sectionKey="summer_collections" />
      <FinalCTA />
    </StorefrontLayout>
  )
}
