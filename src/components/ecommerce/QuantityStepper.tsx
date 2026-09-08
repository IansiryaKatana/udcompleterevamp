import { Minus, Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type QuantityStepperProps = {
  value: number
  onChange: (quantity: number) => void
  min?: number
  max?: number
  className?: string
}

const stepperBtn =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-brand-border/80 bg-white text-text-brown transition-colors hover:bg-soft-beige focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta-brown/30 disabled:cursor-not-allowed disabled:opacity-40'

export function QuantityStepper({ value, onChange, min = 1, max, className }: QuantityStepperProps) {
  function setQuantity(next: number) {
    const clamped = max != null ? Math.min(max, Math.max(min, next)) : Math.max(min, next)
    onChange(clamped)
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <button
        type="button"
        className={stepperBtn}
        aria-label="Decrease quantity"
        disabled={value <= min}
        onClick={() => setQuantity(value - 1)}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        aria-label="Quantity"
        onChange={(e) => setQuantity(Number(e.target.value) || min)}
        className="h-8 w-14 px-1 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        className={stepperBtn}
        aria-label="Increase quantity"
        disabled={max != null && value >= max}
        onClick={() => setQuantity(value + 1)}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
