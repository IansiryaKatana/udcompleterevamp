import { createFileRoute, notFound } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useCms } from '@/contexts/CmsContext'
import { usePageMeta } from '@/lib/seo'
import { useStorefrontBundle } from '@/lib/storefront/storefrontQueries'
import { StorefrontLayout } from '@/components/layout/StorefrontLayout'
import { BundleDetailHero } from '@/components/bundle/BundleDetailHero'
import { BundleIncludedItems } from '@/components/bundle/BundleIncludedItems'
import { computeStaticBundleAvailableQuantity } from '@/lib/bundles/staticBundleFallback'
import type { BundleSelection } from '@/lib/stores/cart-store'
import type { ProductVariant } from '@/data/static-cms'
import { sanitizeMarketingHtml } from '@/lib/sanitizeHtml'

export const Route = createFileRoute('/bundle/$slug')({
  component: BundleDetailPage,
})

function BundleDetailPage() {
  const { slug } = Route.useParams()
  const { snapshot } = useCms()
  const { data: bundle, isLoading } = useStorefrontBundle(slug)
  const [selections, setSelections] = useState<BundleSelection[]>([])

  const availableQuantity = useMemo(() => {
    if (!bundle) return 0
    return computeStaticBundleAvailableQuantity(bundle, selections)
  }, [bundle, selections])

  const marqueeText =
    snapshot.siteSettings.footer_tagline?.trim() ||
    `${snapshot.siteName} — UK wholesale for retailers.`

  usePageMeta(
    bundle
      ? {
          title: `${bundle.name} | ${snapshot.siteName}`,
          description: bundle.overview ?? `Shop the ${bundle.name} bundle at ${snapshot.siteName}.`,
        }
      : { title: 'Bundle | Unique Distribution' },
  )

  function handleSelectionChange(bundleItemId: string, variant: ProductVariant | null) {
    setSelections((current) => {
      const rest = current.filter((s) => s.bundleItemId !== bundleItemId)
      if (!variant) return rest
      return [...rest, { bundleItemId, variantId: variant.id }]
    })
  }

  if (isLoading) {
    return (
      <StorefrontLayout>
        <div className="flex justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted" />
        </div>
      </StorefrontLayout>
    )
  }

  if (!bundle) throw notFound()

  const descriptionHtml = bundle.description ? sanitizeMarketingHtml(bundle.description) : ''

  return (
    <StorefrontLayout>
      <BundleDetailHero
        bundle={bundle}
        selections={selections}
        availableQuantity={availableQuantity}
        marqueeText={marqueeText.toUpperCase()}
      />

      <div className="px-6 py-10 md:px-14">
        <div className="mx-auto grid max-w-5xl gap-8">
          <BundleIncludedItems
            bundle={bundle}
            selections={selections}
            onSelectionChange={handleSelectionChange}
          />
          {descriptionHtml ? (
            <div
              className="prose prose-sm max-w-none text-text-brown"
              dangerouslySetInnerHTML={{ __html: descriptionHtml }}
            />
          ) : null}
        </div>
      </div>
    </StorefrontLayout>
  )
}
