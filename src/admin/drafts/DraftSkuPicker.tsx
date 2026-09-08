import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { searchAdminCatalogVariants, type AdminCatalogVariantHit } from '@/admin/lib/adminRpc'
import { adminBtnSecondary, adminInput, adminLabel } from '@/admin/adminClassNames'
import { draftMoney } from '@/admin/lib/draftOps'
import { cn } from '@/lib/utils'

export type DraftSkuPick = {
  product_id: string
  variant_id: string
  title: string
  variant_title: string | null
  sku_snapshot: string | null
  quantity: number
  original_unit_price: number
  discounted_unit_price: number
}

type Props = {
  currency: string
  disabled?: boolean
  onAdd: (picks: DraftSkuPick[]) => void
}

export function DraftSkuPicker({ currency, disabled, onAdd }: Props) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [hits, setHits] = useState<AdminCatalogVariantHit[]>([])
  const [qtyById, setQtyById] = useState<Record<string, number>>({})
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 250)
    return () => window.clearTimeout(t)
  }, [query])

  useEffect(() => {
    if (!debounced) {
      setHits([])
      return
    }
    let cancelled = false
    setLoading(true)
    void searchAdminCatalogVariants({ search: debounced, limit: 40 })
      .then((res) => {
        if (cancelled) return
        setHits(res.items)
        setQtyById((prev) => {
          const next = { ...prev }
          for (const h of res.items) {
            if (next[h.id] == null) next[h.id] = 1
          }
          return next
        })
      })
      .catch((e) => {
        if (!cancelled) toast.error(e instanceof Error ? e.message : 'Catalog search failed')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debounced])

  function toggle(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  function addSelected() {
    const picks: DraftSkuPick[] = hits
      .filter((h) => selected[h.id])
      .map((h) => {
        const price = Number(h.price ?? 0)
        const qty = Math.max(1, Number(qtyById[h.id] ?? 1))
        return {
          product_id: h.product_id,
          variant_id: h.id,
          title: h.product_name || h.name,
          variant_title: h.name !== h.product_name ? h.name : null,
          sku_snapshot: h.sku,
          quantity: qty,
          original_unit_price: price,
          discounted_unit_price: price,
        }
      })
    if (picks.length === 0) {
      toast.error('Select at least one SKU')
      return
    }
    onAdd(picks)
    setSelected({})
    toast.success(`Added ${picks.length} line${picks.length === 1 ? '' : 's'}`)
  }

  function addOne(h: AdminCatalogVariantHit) {
    const price = Number(h.price ?? 0)
    const qty = Math.max(1, Number(qtyById[h.id] ?? 1))
    onAdd([
      {
        product_id: h.product_id,
        variant_id: h.id,
        title: h.product_name || h.name,
        variant_title: h.name !== h.product_name ? h.name : null,
        sku_snapshot: h.sku,
        quantity: qty,
        original_unit_price: price,
        discounted_unit_price: price,
      },
    ])
    toast.success('SKU added')
  }

  return (
    <div className="space-y-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <label className={adminLabel}>Add wholesale SKUs</label>
          <input
            className={adminInput}
            placeholder="Search SKU / product name…"
            value={query}
            disabled={disabled}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                const first = hits[0]
                if (first && !disabled) addOne(first)
              }
            }}
          />
        </div>
        <button
          type="button"
          className={adminBtnSecondary}
          disabled={disabled || Object.values(selected).every((v) => !v)}
          onClick={addSelected}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add selected
        </button>
      </div>
      <p className="text-[11px] text-[var(--admin-muted)]">
        Enter adds the top result. Search SKU, product name, slug, or barcode when present on the product.
      </p>
      {loading && <p className="text-xs text-[var(--admin-muted)]">Searching…</p>}
      {hits.length > 0 && (
        <div className="max-h-56 overflow-auto rounded border border-[var(--admin-border)] bg-white">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-[var(--admin-surface)] text-[10px] uppercase text-[var(--admin-muted)]">
              <tr>
                <th className="px-2 py-1.5"> </th>
                <th className="px-2 py-1.5">Product</th>
                <th className="px-2 py-1.5">SKU</th>
                <th className="px-2 py-1.5 text-right">Price</th>
                <th className="px-2 py-1.5 text-right">Qty</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {hits.map((h) => (
                <tr key={h.id} className="border-t border-[var(--admin-border)]">
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={!!selected[h.id]}
                      disabled={disabled}
                      onChange={() => toggle(h.id)}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="max-w-[220px] truncate font-medium">{h.product_name}</div>
                    <div className="max-w-[220px] truncate text-xs text-[var(--admin-muted)]">{h.name}</div>
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs">{h.sku || '—'}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{draftMoney(h.price, currency)}</td>
                  <td className="px-2 py-1.5 text-right">
                    <input
                      className={cn(adminInput, 'h-8 w-16 text-right text-xs')}
                      type="number"
                      min={1}
                      disabled={disabled}
                      value={qtyById[h.id] ?? 1}
                      onChange={(e) =>
                        setQtyById((prev) => ({
                          ...prev,
                          [h.id]: Math.max(1, Number(e.target.value) || 1),
                        }))
                      }
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      className="text-xs font-medium text-[var(--admin-primary)] hover:underline"
                      disabled={disabled}
                      onClick={() => addOne(h)}
                    >
                      Add
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
