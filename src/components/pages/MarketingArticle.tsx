import { sanitizeMarketingHtml } from '@/lib/sanitizeHtml'
import { stripStorefrontMigrationNote } from '@/lib/storefront/uniquePublishedCopy'
import { cn } from '@/lib/utils'

export function MarketingArticle({ html, className }: { html: string; className?: string }) {
  const safe = sanitizeMarketingHtml(stripStorefrontMigrationNote(html))
  if (!safe) return null

  return (
    <div className={cn('px-6 py-16 md:px-14 md:py-24', className)}>
      <article className="marketing-article" dangerouslySetInnerHTML={{ __html: safe }} />
    </div>
  )
}
