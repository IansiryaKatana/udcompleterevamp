import { cn } from '@/lib/utils'

type ScrollProgressBarProps = {
  progress: number
  visible: boolean
  className?: string
  trackClassName?: string
  fillClassName?: string
  label?: string
}

export function ScrollProgressBar({
  progress,
  visible,
  className,
  trackClassName,
  fillClassName,
  label = 'Scroll progress',
}: ScrollProgressBarProps) {
  if (!visible) return null

  return (
    <div
      className={cn('h-0.5 w-full bg-brand-border/60', trackClassName, className)}
      role="progressbar"
      aria-valuenow={Math.round(progress)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cn('h-full bg-cta-brown/90 transition-[width] duration-150 ease-out', fillClassName)}
        style={{ width: `${progress}%` }}
      />
    </div>
  )
}
