import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { gateStorefrontPurchase } from '@/lib/storefront/commercialSession'
import { toast } from 'sonner'

export function RequestQuoteButton({ className }: { className?: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      className={className}
      onClick={() => {
        void (async () => {
          try {
            const gate = await gateStorefrontPurchase('quote')
            if (!gate.ok) {
              toast.error(gate.message)
              return
            }
            window.location.href = '/checkout'
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Unable to start a quote')
          }
        })()
      }}
    >
      Request a quote
    </Button>
  )
}

export function RequestQuoteLink({ className }: { className?: string }) {
  return (
    <Button asChild variant="outline" className={className}>
      <Link to="/checkout">Request a quote</Link>
    </Button>
  )
}
