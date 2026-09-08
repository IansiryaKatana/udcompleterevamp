import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import type { FeatureCard } from '@/data/static-cms'
import { useCms } from '@/contexts/CmsContext'
import { CmsLink } from '@/components/layout/CmsLink'
import { Button } from '@/components/ui/button'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { cn } from '@/lib/utils'

gsap.registerPlugin(ScrollTrigger)

const DESKTOP_PAGE_SIZE = 3

function chunkCards<T>(items: T[], size: number): T[][] {
  const pages: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size))
  }
  return pages
}

function FeatureCardArticle({ card, index }: { card: FeatureCard; index: number }) {
  return (
    <article className="feature-card group relative aspect-[3/4] w-full overflow-hidden rounded-lg">
      <img
        src={card.imageUrl}
        alt=""
        className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-105"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-black/10" />
      <div
        className={cn(
          'relative flex h-full flex-col justify-end p-6 text-white',
          index === 2 ? 'items-start text-left' : '',
        )}
      >
        <h3
          className={cn(
            'mb-4 max-w-[90%] font-display font-extrabold leading-tight',
            index === 2 ? 'text-3xl' : 'text-sm',
          )}
        >
          {card.title}
        </h3>
        <Button
          asChild
          size="sm"
          className="h-8 rounded-md bg-white px-4 text-[11px] font-bold text-text-brown hover:bg-white/90"
        >
          <CmsLink href={card.ctaUrl}>{card.ctaLabel}</CmsLink>
        </Button>
      </div>
    </article>
  )
}

function FeatureCardNavDots({
  count,
  activeIndex,
  onSelect,
  ariaLabel,
  getItemLabel,
}: {
  count: number
  activeIndex: number
  onSelect: (index: number) => void
  ariaLabel: string
  getItemLabel: (index: number) => string
}) {
  if (count <= 1) return null

  return (
    <div className="flex justify-center gap-1.5 pt-5" role="tablist" aria-label={ariaLabel}>
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          role="tab"
          aria-selected={activeIndex === i}
          aria-label={getItemLabel(i)}
          onClick={() => onSelect(i)}
          className={cn(
            'h-1 rounded-md transition-all',
            activeIndex === i ? 'w-6 bg-cta-brown' : 'w-1.5 bg-text-brown/30 hover:bg-text-brown/50',
          )}
        />
      ))}
    </div>
  )
}

function FeatureCardsMobileCarousel({ cards }: { cards: FeatureCard[] }) {
  const [index, setIndex] = useState(0)
  const touchStartX = useRef(0)

  function goTo(next: number) {
    setIndex(Math.min(Math.max(0, next), cards.length - 1))
  }

  if (cards.length === 0) return null

  return (
    <div className="lg:hidden">
      <div
        className="overflow-hidden"
        onTouchStart={(e) => {
          touchStartX.current = e.touches[0]?.clientX ?? 0
        }}
        onTouchEnd={(e) => {
          const delta = touchStartX.current - (e.changedTouches[0]?.clientX ?? 0)
          if (delta > 48) goTo(index + 1)
          else if (delta < -48) goTo(index - 1)
        }}
      >
        <div
          className="flex transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {cards.map((card, i) => (
            <div key={card.id} className="w-full shrink-0">
              <FeatureCardArticle card={card} index={i} />
            </div>
          ))}
        </div>
      </div>

      <FeatureCardNavDots
        count={cards.length}
        activeIndex={index}
        onSelect={goTo}
        ariaLabel="Feature cards"
        getItemLabel={(i) => `Go to card ${i + 1}`}
      />
    </div>
  )
}

function FeatureCardsDesktop({ cards }: { cards: FeatureCard[] }) {
  const [pageIndex, setPageIndex] = useState(0)
  const touchStartX = useRef(0)
  const pages = chunkCards(cards, DESKTOP_PAGE_SIZE)

  function goToPage(next: number) {
    setPageIndex(Math.min(Math.max(0, next), pages.length - 1))
  }

  if (cards.length === 0) return null

  if (cards.length <= DESKTOP_PAGE_SIZE) {
    return (
      <div className="hidden gap-6 lg:grid lg:grid-cols-3">
        {cards.map((card, i) => (
          <FeatureCardArticle key={card.id} card={card} index={i} />
        ))}
      </div>
    )
  }

  return (
    <div className="hidden lg:block">
      <div
        className="overflow-hidden"
        onTouchStart={(e) => {
          touchStartX.current = e.touches[0]?.clientX ?? 0
        }}
        onTouchEnd={(e) => {
          const delta = touchStartX.current - (e.changedTouches[0]?.clientX ?? 0)
          if (delta > 48) goToPage(pageIndex + 1)
          else if (delta < -48) goToPage(pageIndex - 1)
        }}
      >
        <div
          className="flex transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${pageIndex * 100}%)` }}
        >
          {pages.map((pageCards, pageIdx) => (
            <div key={pageIdx} className="grid w-full shrink-0 grid-cols-3 gap-6">
              {pageCards.map((card, i) => (
                <FeatureCardArticle
                  key={card.id}
                  card={card}
                  index={pageIdx * DESKTOP_PAGE_SIZE + i}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <FeatureCardNavDots
        count={pages.length}
        activeIndex={pageIndex}
        onSelect={goToPage}
        ariaLabel="Feature card pages"
        getItemLabel={(i) => `Go to page ${i + 1}`}
      />
    </div>
  )
}

export function FeatureCards() {
  const { snapshot } = useCms()
  const cards = snapshot.featureCards.filter((card) => card.isActive !== false)
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!ref.current || cards.length === 0) return
    const ctx = gsap.context(() => {
      gsap.from('.feature-card', {
        scrollTrigger: { trigger: ref.current, start: 'top 80%' },
        y: 40,
        opacity: 0,
        stagger: 0.1,
        duration: 0.65,
        ease: 'power3.out',
      })
    }, ref)
    return () => ctx.revert()
  }, [cards.length])

  return (
    <section ref={ref} className="py-16 md:py-[72px]">
      <SectionContainer>
        <FeatureCardsDesktop cards={cards} />
        <FeatureCardsMobileCarousel cards={cards} />
      </SectionContainer>
    </section>
  )
}
