import { createFileRoute } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { StorefrontLayout } from '@/components/layout/StorefrontLayout'
import { PageHero } from '@/components/layout/PageHero'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { BundleCard } from '@/components/bundle/BundleCard'
import { useStorefrontBundleList } from '@/lib/storefront/storefrontQueries'
import { productGridClasses } from '@/components/storefront/productGridClasses'

export const Route = createFileRoute('/bundles/')({
  component: BundlesIndexPage,
  head: () => ({ meta: [{ title: 'Product Bundles | Unique Distribution' }] }),
})

function BundlesIndexPage() {
  const { data, isLoading } = useStorefrontBundleList(48, 0)
  const bundles = data?.items ?? []

  return (
    <StorefrontLayout>
      <PageHero
        title="Product Bundles"
        subtitle="Save when you buy compatible components together."
        backLabel="Continue Shopping"
        backTo="/"
        contained
      />

      <SectionContainer className="py-10">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted" />
          </div>
        ) : bundles.length === 0 ? (
          <p className="text-center text-muted">No bundles are available right now.</p>
        ) : (
          <div className={productGridClasses}>
            {bundles.map((bundle) => (
              <BundleCard key={bundle.id} bundle={bundle} />
            ))}
          </div>
        )}
      </SectionContainer>
    </StorefrontLayout>
  )
}
