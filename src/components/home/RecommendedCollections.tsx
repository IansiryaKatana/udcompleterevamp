import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useCms } from '@/contexts/CmsContext'
import { CmsLink } from '@/components/layout/CmsLink'
import { Button } from '@/components/ui/button'
import { SectionContainer } from '@/components/layout/SectionContainer'

gsap.registerPlugin(ScrollTrigger)

function LifestyleCard({
  title,
  ctaLabel,
  ctaUrl,
  imageUrl,
  className,
}: {
  title: string
  ctaLabel: string
  ctaUrl: string
  imageUrl: string
  className?: string
}) {
  return (
    <CmsLink href={ctaUrl} className={`group relative block overflow-hidden rounded-lg ${className ?? ''}`}>
      <img
        src={imageUrl}
        alt=""
        className="absolute inset-0 h-full w-full object-cover transition duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-105"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/45 to-black/5 transition group-hover:from-black/55" />
      <div className="relative flex h-full flex-col justify-end p-6 text-white">
        <h3 className="mb-3 max-w-[80%] font-display text-xl font-extrabold">{title}</h3>
        <Button
          asChild
          variant="pill"
          size="sm"
          className="pointer-events-none w-fit transition group-hover:-translate-y-1"
        >
          <span>{ctaLabel}</span>
        </Button>
      </div>
    </CmsLink>
  )
}

export function RecommendedCollections() {
  const { snapshot } = useCms()
  const cards = snapshot.lifestyleCards
  const large = cards.find((c) => c.layout === 'large')
  const small = cards.filter((c) => c.layout === 'small')
  const wide = cards.find((c) => c.layout === 'wide')
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const ctx = gsap.context(() => {
      gsap.from('.lifestyle-card', {
        scrollTrigger: { trigger: ref.current, start: 'top 80%' },
        y: 36,
        opacity: 0,
        stagger: 0.1,
        duration: 0.7,
        ease: 'power3.out',
      })
    }, ref)
    return () => ctx.revert()
  }, [])

  return (
    <section ref={ref} className="py-10">
      <SectionContainer>
      <div className="mb-8 text-center">
        <h2 className="font-display text-4xl font-extrabold text-text-brown">
          {snapshot.siteSettings.lifestyle_heading || 'Shop the trade catalogue'}
        </h2>
        <p className="mt-2 text-[11px] text-muted">
          {snapshot.siteSettings.lifestyle_subtitle || 'Browse wholesale ranges used by UK retailers.'}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.05fr_1fr]">
        {large && (
          <LifestyleCard
            className="lifestyle-card h-[320px] lg:h-[430px]"
            title={large.title}
            ctaLabel={large.ctaLabel}
            ctaUrl={large.ctaUrl}
            imageUrl={large.imageUrl}
          />
        )}
        <div className="grid gap-5">
          {small.map((card) => (
            <LifestyleCard
              key={card.id}
              className="lifestyle-card h-[205px]"
              title={card.title}
              ctaLabel={card.ctaLabel}
              ctaUrl={card.ctaUrl}
              imageUrl={card.imageUrl}
            />
          ))}
        </div>
        {wide && (
          <LifestyleCard
            className="lifestyle-card col-span-full h-[300px]"
            title={wide.title}
            ctaLabel={wide.ctaLabel}
            ctaUrl={wide.ctaUrl}
            imageUrl={wide.imageUrl}
          />
        )}
      </div>
      </SectionContainer>
    </section>
  )
}
