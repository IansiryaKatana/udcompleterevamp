import { useEffect, useRef } from 'react'
import { CalendarDays, Clock3, Truck } from 'lucide-react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useCms } from '@/contexts/CmsContext'
import { getSectionByKey } from '@/lib/cms/loadCmsSnapshot'
import { UNIQUE_PUBLISHED_DELIVERY } from '@/lib/storefront/uniquePublishedCopy'

gsap.registerPlugin(ScrollTrigger)

const DELIVERY_ICONS = [Truck, Clock3, CalendarDays] as const

export function FinalCTA() {
  const { snapshot } = useCms()
  const section = getSectionByKey(snapshot, 'final_cta')
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!ref.current || !section) return
    const ctx = gsap.context(() => {
      gsap.from('.final-cta-bg', {
        scrollTrigger: { trigger: ref.current, start: 'top 80%' },
        scale: 1.08,
        duration: 1.2,
        ease: 'power2.out',
      })
      gsap.from('.final-cta-content > *', {
        scrollTrigger: { trigger: ref.current, start: 'top 75%' },
        y: 24,
        opacity: 0,
        stagger: 0.12,
        duration: 0.7,
        ease: 'power3.out',
      })
    }, ref)
    return () => ctx.revert()
  }, [section])

  if (!section) return null

  return (
    <section ref={ref} className="mx-6 my-20 overflow-hidden rounded-lg md:mx-14">
      <div className="relative min-h-[300px]">
        <img src={section.imageUrl} alt="" className="final-cta-bg absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/50 to-black/60" />
        <div className="final-cta-content relative z-10 flex min-h-[300px] items-center px-8 py-12 md:px-16">
          <ul className="grid w-full gap-10 md:grid-cols-3 md:gap-0">
            {UNIQUE_PUBLISHED_DELIVERY.map((item, index) => {
              const Icon = DELIVERY_ICONS[index]
              return (
                <li
                  key={item.title}
                  className={
                    index === 0
                      ? 'md:pr-10'
                      : 'md:border-l md:border-white/20 md:px-10'
                  }
                >
                  <Icon className="mb-4 h-8 w-8 text-cta-brown" aria-hidden />
                  <h3 className="font-display text-2xl font-extrabold text-white md:text-3xl">{item.title}</h3>
                  <p className="mt-2 text-sm text-white/80 md:text-base">{item.detail}</p>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </section>
  )
}
