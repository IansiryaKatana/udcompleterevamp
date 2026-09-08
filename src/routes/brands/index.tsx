import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { PageHero } from '@/components/layout/PageHero'
import { StorefrontLayout } from '@/components/layout/StorefrontLayout'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { Input } from '@/components/ui/input'
import { useStorefrontBrands } from '@/lib/storefront/storefrontQueries'

export const Route = createFileRoute('/brands/')({
  component: BrandsIndexPage,
  head: () => ({ meta: [{ title: 'Shop by brand | Unique Distribution' }] }),
})

export function BrandsIndexPage() {
  const [query, setQuery] = useState('')
  const { data: brands = [], isLoading } = useStorefrontBrands(query)
  const grouped = useMemo(() => {
    const map = new Map<string, typeof brands>()
    for (const brand of brands) {
      const letter = brand.vendor.charAt(0).toUpperCase()
      const key = /[A-Z]/.test(letter) ? letter : '#'
      map.set(key, [...(map.get(key) ?? []), brand])
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [brands])

  return (
    <StorefrontLayout>
      <PageHero title="Brands" subtitle="Browse wholesale brands available in the Unique catalogue." />
      <SectionContainer className="py-10">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search brands"
          aria-label="Search brands"
          className="mb-8 max-w-md"
        />
        {isLoading ? (
          <p className="text-muted">Loading brands…</p>
        ) : brands.length === 0 ? (
          <p className="text-muted">No brands match that search.</p>
        ) : (
          <div className="space-y-8">
            {grouped.map(([letter, items]) => (
              <section key={letter}>
                <h2 className="mb-3 font-display text-2xl font-extrabold">{letter}</h2>
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((brand) => (
                    <li key={brand.handle}>
                      <Link
                        to="/brands/$handle"
                        params={{ handle: brand.handle }}
                        className="flex items-center justify-between rounded-lg border border-brand-border px-4 py-3 text-sm hover:bg-white"
                      >
                        <span className="font-semibold">{brand.vendor}</span>
                        <span className="text-xs text-muted">{brand.product_count}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </SectionContainer>
    </StorefrontLayout>
  )
}
