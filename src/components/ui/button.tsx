import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta-brown/40 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-cta-brown text-white hover:bg-cta-brown/90',
        secondary: 'bg-soft-beige text-text-brown hover:bg-soft-beige/80',
        outline: 'border border-cta-brown/45 bg-transparent text-text-brown hover:bg-soft-beige/50',
        ghost: 'hover:bg-soft-beige/60 text-text-brown',
        destructive: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500/40',
        'destructive-ghost': 'text-red-600 hover:bg-red-50 hover:text-red-700',
        cream: 'bg-cream-text text-text-brown hover:bg-white',
        pill: 'bg-white text-text-brown hover:bg-white/90',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-11 px-8',
        icon: 'h-10 w-10',
        product: 'h-10 min-w-0 flex-1 rounded-md px-4 text-xs leading-none',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
