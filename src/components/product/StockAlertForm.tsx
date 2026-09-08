import { useState } from 'react'
import { toast } from 'sonner'
import { tryGetSupabase } from '@/integrations/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type StockAlertFormProps = {
  productId: string
  variantId?: string | null
  disabled?: boolean
}

export function StockAlertForm({ productId, variantId, disabled }: StockAlertFormProps) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)

  if (!disabled) return null

  async function submit() {
    const sb = tryGetSupabase()
    if (!sb) {
      toast.error('Alerts require a live store connection')
      return
    }
    setLoading(true)
    const { data, error } = await sb.rpc('rpc_subscribe_stock_alert', {
      p_email: email.trim(),
      p_product_id: productId,
      p_variant_id: variantId ?? undefined,
    })
    setLoading(false)
    if (error || !(data as { ok?: boolean })?.ok) {
      toast.error((data as { error?: string })?.error ?? error?.message ?? 'Could not subscribe')
      return
    }
    toast.success('We will email you when this item is back in stock')
    setEmail('')
  }

  return (
    <div className="mt-4 rounded-lg border border-brand-border p-4">
      <p className="text-sm font-semibold text-text-brown">Notify me when back in stock</p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="flex-1"
        />
        <Button type="button" disabled={loading || !email.trim()} onClick={() => void submit()}>
          {loading ? 'Saving…' : 'Notify me'}
        </Button>
      </div>
    </div>
  )
}
