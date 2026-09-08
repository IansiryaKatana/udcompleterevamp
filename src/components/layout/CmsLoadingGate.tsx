import type { ReactNode } from 'react'
import { useCms } from '@/contexts/CmsContext'
import { productGridClasses } from '@/components/storefront/productGridClasses'

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-brand-border/70 ${className ?? ''}`} />
}

function StorefrontSkeleton() {
  return (
    <div className="min-h-screen bg-content-bg">
      <SkeletonBlock className="h-[75vh] w-full rounded-none" />
      <div className="mx-6 space-y-8 py-12 md:mx-14">
        <SkeletonBlock className="mx-auto h-10 w-64" />
        <div className={productGridClasses}>
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-72 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}

type CmsLoadingGateProps = {
  children: ReactNode
  fallback?: ReactNode
}

/** Avoids flash of static seed CMS before live layout/settings load. */
export function CmsLoadingGate({ children, fallback }: CmsLoadingGateProps) {
  const { loading, mode } = useCms()
  if (loading && mode === 'static') {
    return <>{fallback ?? <StorefrontSkeleton />}</>
  }
  return <>{children}</>
}
