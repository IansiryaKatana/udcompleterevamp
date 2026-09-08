import { useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Product } from '@/data/static-cms'
import { ProductCard } from '@/components/home/ProductCard'
import { cn } from '@/lib/utils'

export function ProductCarousel({ products, ariaLabel }: { products: Product[]; ariaLabel: string }) {
  const scrollerRef = useRef<HTMLDivElement>(null)

  function scrollByPage(direction: -1 | 1) {
    const node = scrollerRef.current
    if (!node) return
    node.scrollBy({ left: direction * node.clientWidth, behavior: 'smooth' })
  }

  if (products.length === 0) return null

  return (
    <div className="relative mt-10">
      <div
        ref={scrollerRef}
        className="flex snap-x snap-mandatory gap-6 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:gap-7"
        aria-label={ariaLabel}
      >
        {products.map((product) => (
          <div
            key={product.id}
            className="w-[min(100%,280px)] shrink-0 snap-start sm:w-[calc((100%-1.5rem)/2)] lg:w-[calc((100%-5.25rem)/4)]"
          >
            <ProductCard product={product} />
          </div>
        ))}
      </div>

      {products.length > 4 ? (
        <div className="mt-5 flex justify-center gap-2">
          <button
            type="button"
            aria-label="Previous products"
            onClick={() => scrollByPage(-1)}
            className={cn(
              'inline-flex h-9 w-9 items-center justify-center rounded-md border border-brand-border bg-white text-text-brown transition hover:border-cta-brown/50 hover:bg-content-bg',
            )}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Next products"
            onClick={() => scrollByPage(1)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-brand-border bg-white text-text-brown transition hover:border-cta-brown/50 hover:bg-content-bg"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  )
}
