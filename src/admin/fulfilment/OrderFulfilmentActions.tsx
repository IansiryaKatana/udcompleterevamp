import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  cancelAdminFulfilment,
  createAdminManualFulfilment,
  generateAdminPackingSlip,
  setAdminFulfilmentTracking,
} from '@/admin/lib/adminRpc'
import {
  canMutateFulfilment,
  inventoryBoundaryNote,
  newFulfilmentIdempotencyKey,
  openHtmlDocument,
} from '@/admin/lib/fulfilmentOps'
import { adminBtnPrimary, adminBtnSecondary, adminInput, adminLabel } from '@/admin/adminClassNames'
import { useAdminAuth } from '@/contexts/AdminAuthContext'

type Line = {
  id: string
  quantity: number
  fulfilled_quantity?: number
  product_name?: string
  sku_snapshot?: string
  name_snapshot?: string
}

type Fulfilment = Record<string, unknown>

type Props = {
  orderId: string
  orderNumber: string
  items: Record<string, unknown>[]
  fulfillments: Fulfilment[]
  shipmentEvents: Record<string, unknown>[]
  locations: { id: string; name: string }[]
  onChanged: () => void
}

export function OrderFulfilmentActions({
  orderId,
  orderNumber,
  items,
  fulfillments,
  shipmentEvents,
  locations,
  onChanged,
}: Props) {
  const { role } = useAdminAuth()
  const canMutate = canMutateFulfilment(role)
  const [openCreate, setOpenCreate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '')
  const [carrier, setCarrier] = useState('')
  const [tracking, setTracking] = useState('')
  const [trackingUrl, setTrackingUrl] = useState('')
  const [qtys, setQtys] = useState<Record<string, number>>({})

  const remainingLines = useMemo(() => {
    return (items as Line[])
      .map((li) => {
        const ordered = Number(li.quantity ?? 0)
        const fulfilled = Number(li.fulfilled_quantity ?? 0)
        const remaining = Math.max(ordered - fulfilled, 0)
        return { ...li, ordered, fulfilled, remaining }
      })
      .filter((li) => li.remaining > 0)
  }, [items])

  function openForm() {
    const init: Record<string, number> = {}
    for (const li of remainingLines) init[li.id] = li.remaining
    setQtys(init)
    setOpenCreate(true)
  }

  async function submitCreate() {
    if (!canMutate) return toast.error('You do not have fulfilment mutation permission')
    const lines = remainingLines
      .map((li) => ({ order_item_id: li.id, quantity: Number(qtys[li.id] ?? 0) }))
      .filter((l) => l.quantity > 0)
    if (lines.length === 0) return toast.error('Select at least one quantity to fulfil')

    const totalQty = lines.reduce((s, l) => s + l.quantity, 0)
    const ok = window.confirm(
      `Create fulfilment for ${orderNumber}?\n\nLines: ${lines.length}\nQty: ${totalQty}\nCarrier: ${carrier || '(none)'}\nTracking: ${tracking || '(none)'}\nEnvironment: Unique-native\n\n${inventoryBoundaryNote()}`,
    )
    if (!ok) return

    setSaving(true)
    try {
      await createAdminManualFulfilment({
        order_id: orderId,
        lines,
        inventory_location_id: locationId || null,
        tracking_company: carrier || null,
        tracking_number: tracking || null,
        tracking_url: trackingUrl || null,
        idempotency_key: newFulfilmentIdempotencyKey('manual'),
      })
      toast.success('Fulfilment created')
      setOpenCreate(false)
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  async function onCancel(f: Fulfilment) {
    if (!canMutate) return
    if (String(f.source_system || '') === 'shopify' || String(f.provenance || '') === 'shopify_imported') {
      return toast.error('Historical Shopify fulfilments are immutable')
    }
    const reason = window.prompt('Cancellation reason?')
    if (!reason?.trim()) return
    const ok = window.confirm(`Cancel fulfilment on ${orderNumber}? This does not restock inventory.`)
    if (!ok) return
    setSaving(true)
    try {
      await cancelAdminFulfilment(String(f.id), reason.trim())
      toast.success('Fulfilment cancelled')
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Cancel failed')
    } finally {
      setSaving(false)
    }
  }

  async function onAddTracking(f: Fulfilment) {
    if (!canMutate) return
    if (String(f.source_system || '') === 'shopify' || String(f.provenance || '') === 'shopify_imported') {
      return toast.error('Historical Shopify fulfilments are immutable')
    }
    const company = window.prompt('Carrier (e.g. DPD)', String(f.tracking_company || 'DPD')) ?? ''
    const number = window.prompt('Tracking number', String(f.tracking_number || '')) ?? ''
    if (!number.trim()) return
    const url = window.prompt('Tracking URL (optional)', String(f.tracking_url || '')) ?? ''
    setSaving(true)
    try {
      await setAdminFulfilmentTracking({
        fulfillment_id: String(f.id),
        tracking_company: company.trim() || null,
        tracking_number: number.trim(),
        tracking_url: url.trim() || null,
      })
      toast.success('Tracking updated')
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Tracking update failed')
    } finally {
      setSaving(false)
    }
  }

  async function onPackingSlip(fulfillmentId?: string) {
    setSaving(true)
    try {
      const doc = await generateAdminPackingSlip(orderId, fulfillmentId ?? null)
      openHtmlDocument(doc.body_html, `Packing slip ${orderNumber}`)
      toast.success('Packing slip generated')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Packing slip failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {canMutate && remainingLines.length > 0 ? (
          <button type="button" className={adminBtnPrimary} disabled={saving} onClick={openForm}>
            Create fulfilment
          </button>
        ) : null}
        <button type="button" className={adminBtnSecondary} disabled={saving} onClick={() => void onPackingSlip()}>
          Packing slip
        </button>
      </div>
      <p className="text-xs text-[var(--admin-muted)]">{inventoryBoundaryNote()}</p>

      {openCreate ? (
        <div className="space-y-3 rounded border border-[var(--admin-border)] p-3">
          <p className="text-sm font-medium">Manual fulfilment — {orderNumber}</p>
          {locations.length > 0 ? (
            <label className="block">
              <span className={adminLabel}>Location</span>
              <select
                className={adminInput}
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="space-y-2">
            {remainingLines.map((li) => (
              <div key={li.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {li.product_name || li.name_snapshot || li.sku_snapshot || 'Line'} · remaining {li.remaining}
                </span>
                <input
                  type="number"
                  min={0}
                  max={li.remaining}
                  className={cnInput()}
                  value={qtys[li.id] ?? 0}
                  onChange={(e) =>
                    setQtys({
                      ...qtys,
                      [li.id]: Math.min(li.remaining, Math.max(0, Number(e.target.value) || 0)),
                    })
                  }
                />
              </div>
            ))}
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            <label className="block">
              <span className={adminLabel}>Carrier (optional)</span>
              <input className={adminInput} value={carrier} onChange={(e) => setCarrier(e.target.value)} />
            </label>
            <label className="block">
              <span className={adminLabel}>Tracking # (optional)</span>
              <input className={adminInput} value={tracking} onChange={(e) => setTracking(e.target.value)} />
            </label>
            <label className="block">
              <span className={adminLabel}>Tracking URL</span>
              <input className={adminInput} value={trackingUrl} onChange={(e) => setTrackingUrl(e.target.value)} />
            </label>
          </div>
          <div className="flex gap-2">
            <button type="button" className={adminBtnPrimary} disabled={saving} onClick={() => void submitCreate()}>
              {saving ? 'Saving…' : 'Confirm create'}
            </button>
            <button type="button" className={adminBtnSecondary} onClick={() => setOpenCreate(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        {fulfillments.map((f) => {
          const shopify = String(f.source_system || '') === 'shopify' || String(f.provenance || '') === 'shopify_imported'
          const cancelled = String(f.status || '').toUpperCase().includes('CANCEL')
          return (
            <div key={String(f.id)} className="rounded border border-[var(--admin-border)] p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-sm">
                    {String(f.name || f.id).slice(0, 36)} · {String(f.display_status || f.status || '—')}
                  </div>
                  <div className="mt-1 text-xs text-[var(--admin-muted)]">
                    {shopify ? 'Shopify (immutable)' : 'Unique-native'}
                    {f.tracking_company ? ` · ${String(f.tracking_company)}` : ''}
                    {f.tracking_number ? ` · ${String(f.tracking_number)}` : ''}
                  </div>
                </div>
                {canMutate && !shopify && !cancelled ? (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={adminBtnSecondary} disabled={saving} onClick={() => void onAddTracking(f)}>
                      Tracking
                    </button>
                    <button type="button" className={adminBtnSecondary} disabled={saving} onClick={() => void onPackingSlip(String(f.id))}>
                      Slip
                    </button>
                    <button type="button" className={adminBtnSecondary} disabled={saving} onClick={() => void onCancel(f)}>
                      Cancel
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-muted)]">Delivery timeline</h3>
        {shipmentEvents.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--admin-muted)]">
            No shipment_events rows. Historical DPD/SKULabs activity may still appear on the order timeline.
          </p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {shipmentEvents.map((ev) => (
              <li key={String(ev.id)} className="border-l-2 border-[var(--admin-border)] pl-3">
                <div className="font-medium">{String(ev.event_type)}</div>
                <div className="text-xs text-[var(--admin-muted)]">
                  {String(ev.status || '—')} · {String(ev.source_app || ev.source_system || '—')} ·{' '}
                  {ev.occurred_at ? new Date(String(ev.occurred_at)).toLocaleString('en-GB') : '—'}
                </div>
                {ev.message ? <div className="text-xs">{String(ev.message)}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function cnInput() {
  return `${adminInput} w-24 text-right`
}
