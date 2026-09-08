import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { tryGetSupabase } from '@/integrations/supabase/client'
import { useFormatPrice } from '@/lib/currency'

type Suggestion = {
  id: string
  name: string
  slug: string
  image_url: string | null
  price: number
}

export function SearchAutocomplete({ query }: { query: string }) {
  const formatPrice = useFormatPrice()
  const [items, setItems] = useState<Suggestion[]>([])
  const q = query.trim()

  useEffect(() => {
    if (q.length < 2) {
      setItems([])
      return
    }
    const sb = tryGetSupabase()
    if (!sb) return
    const timer = window.setTimeout(() => {
      void sb.rpc('rpc_product_autocomplete', { p_query: q, p_limit: 6 }).then(({ data }) => {
        if (data && (data as { ok: boolean }).ok) {
          setItems((data as { items: Suggestion[] }).items ?? [])
        }
      })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [q])

  if (items.length === 0) return null

  return (
    <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-brand-border bg-white shadow-lg">
      {items.map((item) => (
        <li key={item.id}>
          <Link
            to="/product/$slug"
            params={{ slug: item.slug }}
            className="flex items-center gap-3 px-3 py-2 hover:bg-[#f8f6f2]"
          >
            {item.image_url ? (
              <img src={item.image_url} alt="" className="h-10 w-10 rounded object-cover" />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{item.name}</p>
              <p className="text-xs text-muted">
                {item.price == null || item.price_restricted
                  ? 'Trade pricing on approval'
                  : formatPrice(Number(item.price))}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
