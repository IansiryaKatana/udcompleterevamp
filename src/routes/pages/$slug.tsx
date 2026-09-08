import { createFileRoute, notFound } from '@tanstack/react-router'
import { useCms } from '@/contexts/CmsContext'
import { ContactPage } from '@/components/pages/ContactPage'
import { PageHero } from '@/components/layout/PageHero'
import { MarketingArticle } from '@/components/pages/MarketingArticle'
import { StorefrontLayout } from '@/components/layout/StorefrontLayout'
import { buildMarketingPageMeta, usePageMeta } from '@/lib/seo'

export const Route = createFileRoute('/pages/$slug')({
  component: MarketingPage,
})

function MarketingPage() {
  const { slug } = Route.useParams()
  const { snapshot } = useCms()
  const page = snapshot.marketingPages?.find((p) => p.slug === slug)

  if (!page) throw notFound()

  usePageMeta(buildMarketingPageMeta(
    { title: page.title, metaDescription: page.metaDescription, slug: page.slug },
    snapshot.siteName,
  ))

  if (slug === 'contact') {
    return <ContactPage page={page} />
  }

  return (
    <StorefrontLayout>
      <PageHero title={page.title} />
      <MarketingArticle html={page.bodyHtml} />
    </StorefrontLayout>
  )
}
