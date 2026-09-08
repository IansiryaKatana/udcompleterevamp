import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { adminBtnSecondary, adminInput } from '@/admin/adminClassNames'
import { draftMoney } from '@/admin/lib/draftOps'
import { cn } from '@/lib/utils'

export type EditableDraftLine = {
  key: string
  product_id?: string | null
  variant_id?: string | null
  title: string
  variant_title?: string | null
  sku_snapshot?: string | null
  quantity: number
  original_unit_price: number
  discounted_unit_price: number
  taxable?: boolean
  deleted_product?: boolean
}

type Totals = {
  subtotal: number
  total_discounts: number
  total_shipping: number
  total_tax: number
  total_price: number
}

type Props = {
  lines: EditableDraftLine[]
  currency: string
  editable: boolean
  serverTotals?: Totals | null
  onChange: (lines: EditableDraftLine[]) => void
  onSave?: () => void
  saving?: boolean
}

export function DraftLinesEditor({
  lines,
  currency,
  editable,
  serverTotals,
  onChange,
  onSave,
  saving,
}: Props) {
  const [filter, setFilter] = useState('')

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return lines
    return lines.filter(
      (l) =>
        l.title.toLowerCase().includes(q) ||
        (l.sku_snapshot || '').toLowerCase().includes(q) ||
        (l.variant_title || '').toLowerCase().includes(q),
    )
  }, [lines, filter])

  const localSubtotal = useMemo(
    () => lines.reduce((sum, l) => sum + Number(l.discounted_unit_price || 0) * Number(l.quantity || 0), 0),
    [lines],
  )
  const itemQty = useMemo(() => lines.reduce((sum, l) => sum + Number(l.quantity || 0), 0), [lines])

  function patchLine(key: string, patch: Partial<EditableDraftLine>) {
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function removeLine(key: string) {
    onChange(lines.filter((l) => l.key !== key))
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--admin-muted)]">
          {lines.length} lines · {itemQty} units
          {filter ? ` · showing ${filtered.length}` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {editable && (
            <button
              type="button"
              className={adminBtnSecondary}
              onClick={() =>
                onChange([
                  ...lines,
                  {
                    key: `custom-${Date.now()}`,
                    product_id: null,
                    variant_id: null,
                    title: 'Custom line',
                    variant_title: null,
                    sku_snapshot: null,
                    quantity: 1,
                    original_unit_price: 0,
                    discounted_unit_price: 0,
                    taxable: true,
                    deleted_product: false,
                  },
                ])
              }
            >
              Add custom line
            </button>
          )}
          <input
            className={cn(adminInput, 'h-8 w-48 text-xs')}
            placeholder="Filter lines…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[900px] w-full text-left text-sm">
          <thead className="text-xs uppercase text-[var(--admin-muted)]">
            <tr>
              <th className="pb-2 pr-2">Product</th>
              <th className="pb-2 pr-2">Variant</th>
              <th className="pb-2 pr-2">SKU</th>
              <th className="pb-2 pr-2 text-right">Qty</th>
              <th className="pb-2 pr-2 text-right">Unit</th>
              <th className="pb-2 pr-2 text-right">Line</th>
              {editable && <th className="pb-2 text-right" />}
            </tr>
          </thead>
          <tbody>
            {filtered.map((li) => {
              const lineTotal = Number(li.discounted_unit_price || 0) * Number(li.quantity || 0)
              return (
                <tr key={li.key} className="border-t border-[var(--admin-border)]">
                  <td className="py-2 pr-2">
                    {editable && !li.product_id && !li.variant_id ? (
                      <input
                        className={cn(adminInput, 'h-8 max-w-[220px] text-xs')}
                        value={li.title}
                        onChange={(e) => patchLine(li.key, { title: e.target.value || 'Custom line' })}
                      />
                    ) : (
                      <div className="max-w-[220px] font-medium">{li.title}</div>
                    )}
                    {li.deleted_product && (
                      <div className="text-[10px] font-medium uppercase text-rose-700">Deleted product</div>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-xs text-[var(--admin-muted)]">{li.variant_title || '—'}</td>
                  <td className="py-2 pr-2 font-mono text-xs">{li.sku_snapshot || '—'}</td>
                  <td className="py-2 pr-2 text-right">
                    {editable ? (
                      <input
                        className={cn(adminInput, 'ml-auto h-8 w-16 text-right text-xs')}
                        type="number"
                        min={1}
                        value={li.quantity}
                        onChange={(e) =>
                          patchLine(li.key, { quantity: Math.max(1, Number(e.target.value) || 1) })
                        }
                      />
                    ) : (
                      <span className="tabular-nums">{li.quantity}</span>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {editable ? (
                      <input
                        className={cn(adminInput, 'ml-auto h-8 w-24 text-right text-xs')}
                        type="number"
                        min={0}
                        step="0.01"
                        value={li.discounted_unit_price}
                        onChange={(e) => {
                          const price = Math.max(0, Number(e.target.value) || 0)
                          patchLine(li.key, {
                            discounted_unit_price: price,
                            original_unit_price:
                              li.original_unit_price > 0 ? li.original_unit_price : price,
                          })
                        }}
                      />
                    ) : (
                      draftMoney(li.discounted_unit_price, currency)
                    )}
                  </td>
                  <td className="py-2 pr-2 text-right font-medium tabular-nums">
                    {draftMoney(lineTotal, currency)}
                  </td>
                  {editable && (
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        className="inline-flex text-[var(--admin-muted)] hover:text-rose-700"
                        onClick={() => removeLine(li.key)}
                        aria-label="Remove line"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={editable ? 7 : 6} className="py-8 text-center text-[var(--admin-muted)]">
                  No line items
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-end justify-between gap-3 border-t border-[var(--admin-border)] bg-white/95 px-1 py-3 backdrop-blur">
        <dl className="grid min-w-[240px] grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <dt className="text-[var(--admin-muted)]">Lines subtotal</dt>
          <dd className="text-right tabular-nums">{draftMoney(localSubtotal, currency)}</dd>
          {serverTotals && (
            <>
              <dt className="text-[var(--admin-muted)]">Discounts</dt>
              <dd className="text-right tabular-nums">{draftMoney(serverTotals.total_discounts, currency)}</dd>
              <dt className="text-[var(--admin-muted)]">Shipping</dt>
              <dd className="text-right tabular-nums">{draftMoney(serverTotals.total_shipping, currency)}</dd>
              <dt className="text-[var(--admin-muted)]">VAT / tax</dt>
              <dd className="text-right tabular-nums">{draftMoney(serverTotals.total_tax, currency)}</dd>
              <dt className="font-semibold">Total</dt>
              <dd className="text-right font-semibold tabular-nums">
                {draftMoney(serverTotals.total_price, currency)}
              </dd>
            </>
          )}
        </dl>
        {editable && onSave && (
          <button type="button" className={adminBtnSecondary} disabled={saving} onClick={onSave}>
            {saving ? 'Saving lines…' : 'Save line changes'}
          </button>
        )}
      </div>
    </div>
  )
}
