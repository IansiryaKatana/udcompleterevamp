import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCms } from '@/contexts/CmsContext'
import { HeroSlideImage } from '@/components/home/HeroSlideImage'
import { CmsLink } from '@/components/layout/CmsLink'
import { Button } from '@/components/ui/button'

export function HeroSection() {
  const { snapshot } = useCms()
  const slides = snapshot.heroSlides
  const [index, setIndex] = useState(0)
  const sectionRef = useRef<HTMLElement>(null)
  const slide = slides[index] ?? slides[0]

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return

    const ctx = gsap.context(() => {
      const tl = gsap.timeline()
      const titleLines = gsap.utils.toArray<HTMLElement>('.hero-title-line', section)
      const cta = section.querySelector('.hero-cta')
      const image = section.querySelector('.hero-image')
      const controls = section.querySelector('.hero-controls')

      if (titleLines.length > 0) {
        tl.from(titleLines, { y: 42, opacity: 0, stagger: 0.12, duration: 0.8, ease: 'power4.out' }, 0.1)
      }
      if (cta) {
        tl.from(cta, { y: 16, opacity: 0, duration: 0.45 }, titleLines.length > 0 ? '-=0.3' : 0)
      }
      if (image) {
        tl.from(image, { x: 80, opacity: 0, scale: 1.04, duration: 1, ease: 'power4.out' }, '-=0.7')
      }
      if (controls) {
        tl.from(controls, { opacity: 0, duration: 0.4 }, '-=0.4')
      }
    }, section)

    return () => ctx.revert()
  }, [])

  function go(dir: -1 | 1) {
    setIndex((i) => (i + dir + slides.length) % slides.length)
  }

  if (!slide) return null

  return (
    <section
      ref={sectionRef}
      className="hero relative h-[75vh] overflow-hidden"
      style={{ backgroundColor: slide.backgroundColor }}
    >
      <HeroSlideImage slide={slide} siteSettings={snapshot.siteSettings} />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/55 via-black/25 to-transparent md:from-black/50 md:via-black/15 md:to-transparent" />

      <div className="pointer-events-none relative z-10 flex h-full items-center">
        <div className="pointer-events-auto px-8 py-24 md:pl-[70px] md:pr-0">
          <h1 className="max-w-[440px] font-display text-[clamp(2.4rem,5vw,4.5rem)] font-extrabold leading-[0.95] text-cream-text md:max-w-[600px]">
            {slide.headlineLines.map((line) => (
              <span key={line} className="hero-title-line block">
                {line}
              </span>
            ))}
          </h1>
          {snapshot.siteSettings.hero_supporting_copy?.trim() ? (
            <p className="hero-supporting mt-5 max-w-[520px] text-sm leading-relaxed text-white/80 md:text-base">
              {snapshot.siteSettings.hero_supporting_copy}
            </p>
          ) : null}
          <div className="hero-cta mt-8 flex flex-wrap items-center gap-3">
            <Button asChild variant="cream" size="sm" className="h-10 px-6 text-xs font-bold">
              <CmsLink href={slide.ctaUrl}>{slide.ctaLabel}</CmsLink>
            </Button>
            {snapshot.siteSettings.hero_secondary_cta_label?.trim() ? (
              <Button asChild variant="outline" size="sm" className="h-10 border-white/40 bg-transparent px-6 text-xs font-bold text-white hover:bg-white/10">
                <CmsLink href={snapshot.siteSettings.hero_secondary_cta_url || '/trade'}>
                  {snapshot.siteSettings.hero_secondary_cta_label}
                </CmsLink>
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {slides.length > 1 && (
        <div className="hero-controls absolute bottom-7 right-12 z-20 flex gap-2">
          <button
            type="button"
            aria-label="Previous slide"
            onClick={() => go(-1)}
            className="flex h-8 w-8 items-center justify-center rounded-md bg-black text-white"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Next slide"
            onClick={() => go(1)}
            className="flex h-8 w-8 items-center justify-center rounded-md bg-black text-white"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </section>
  )
}
