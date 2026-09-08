import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Copy } from 'lucide-react'
import { toast } from 'sonner'
import {
  addAdminDraftNote,
  convertUniqueDraft,
  duplicateDraftAsUnique,
  fetchDraftFilterFacets,
  getAdminDraftWorkspace,
  listAllAdminDraftLines,
  listAdminDraftTimeline,
  replaceUniqueDraftLines,
  updateUniqueDraft,
} from '@/admin/lib/adminRpc'
import {
  copyText,
  draftMoney,
  draftSourceBadgeClass,
  draftStatusBadgeClass,
  formatDraftSourceLabel,
  formatDraftStatusLabel,
  fmtDraftWhen,
  isShopifyDraft,
  isUniqueDraft,
  isVersionConflict,
} from '@/admin/lib/draftOps'
import { DraftActivityPanel } from '@/admin/drafts/DraftActivityPanel'
import { DraftCustomerPicker, type DraftCustomerSelection } from '@/admin/drafts/DraftCustomerPicker'
import { DraftLinesEditor, type EditableDraftLine } from '@/admin/drafts/DraftLinesEditor'
import { DraftSkuPicker, type DraftSkuPick } from '@/admin/drafts/DraftSkuPicker'
import { AdminErrorBanner, AdminLoadingState } from '@/admin/components/AdminPageHeading'
import { adminBtnPrimary, adminBtnSecondary, adminInput, adminLabel } from '@/admin/adminClassNames'
import { BrandedSelect } from '@/components/ui/BrandedSelect'
import { useAdminAuth } from '@/contexts/AdminAuthContext'
import { formatShippingAddress } from '@/lib/formatShippingAddress'
import { cn } from '@/lib/utils'

type Workspace = Awaited<ReturnType<typeof getAdminDraftWorkspace>>

function Panel({
  title,
  children,
  actions,
}: {
  title: string
  children: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <section className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--admin-border)] px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--admin-text)]">{title}</h2>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-muted)]">{label}</dt>
      <dd className="mt-0.5 text-sm text-[var(--admin-text)]">{children}</dd>
    </div>
  )
}

function lineKey(li: Record<string, unknown>, index: number) {
  return String(li.id || `tmp-${index}`)
}

function toEditableLines(items: Record<string, unknown>[]): EditableDraftLine[] {
  return items.map((li, i) => ({
    key: lineKey(li, i),
    product_id: (li.product_id as string | null) ?? null,
    variant_id: (li.variant_id as string | null) ?? null,
    title: String(li.title || 'Line'),
    variant_title: (li.variant_title as string | null) ?? null,
    sku_snapshot: (li.sku_snapshot as string | null) ?? null,
    quantity: Number(li.quantity ?? 1),
    original_unit_price: Number(li.original_unit_price ?? 0),
    discounted_unit_price: Number(li.discounted_unit_price ?? li.original_unit_price ?? 0),
    taxable: li.taxable !== false,
    deleted_product: Boolean(li.deleted_product),
  }))
}

export function AdminDraftDetail({ draftId }: { draftId: string }) {
  const navigate = useNavigate()
  const { canEdit } = useAdminAuth()
  const [ws, setWs] = useState<Workspace | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [lines, setLines] = useState<EditableDraftLine[]>([])
  const [linesTotal, setLinesTotal] = useState(0)
  const [linesFullyLoaded, setLinesFullyLoaded] = useState(false)
  const [timeline, setTimeline] = useState<Record<string, unknown>[]>([])
  const [timelineTotal, setTimelineTotal] = useState(0)
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([])
  const [headerSaving, setHeaderSaving] = useState(false)
  const [linesSaving, setLinesSaving] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)

  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [paymentDueOn, setPaymentDueOn] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [taxExempt, setTaxExempt] = useState(false)
  const [spId, setSpId] = useState('')
  const [cgId, setCgId] = useState('')
  const [refId, setRefId] = useState('')
  const [tradingName, setTradingName] = useState('')
  const [customerType, setCustomerType] = useState('')
  const [shippingTitle, setShippingTitle] = useState('Standard')
  const [shippingAmount, setShippingAmount] = useState('0')
  const [discountType, setDiscountType] = useState<'fixed' | 'percentage'>('fixed')
  const [discountValue, setDiscountValue] = useState('0')
  const [customerSel, setCustomerSel] = useState<DraftCustomerSelection>({
    customerId: null,
    companyId: null,
    email: '',
    phone: '',
    tradingName: '',
    customerType: '',
    label: '',
  })

  const draft = (ws?.draft ?? null) as Record<string, unknown> | null
  const currency = String(draft?.currency || 'GBP')
  const version = Number(draft?.version ?? 1)
  const sourceSystem = String(draft?.source_system || '')
  const status = String(draft?.status || '')
  const workspaceCanEdit = Boolean(ws?.can_edit)
  const mutable = canEdit && workspaceCanEdit && isUniqueDraft(sourceSystem) && status === 'open'
  const shopifyHistorical = isShopifyDraft(sourceSystem)

  const loadWorkspace = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getAdminDraftWorkspace(draftId)
      setWs(data)
      const d = data.draft as Record<string, unknown>
      const customer = (data.customer ?? null) as Record<string, unknown> | null
      const company = (data.company ?? null) as Record<string, unknown> | null
      setEmail(String(d.email || ''))
      setPhone(String(d.phone || ''))
      setNote(String(d.note || ''))
      setPoNumber(String(d.po_number || ''))
      setPaymentDueOn(d.payment_due_on ? String(d.payment_due_on).slice(0, 10) : '')
      setPaymentTerms(String(d.payment_terms || ''))
      setTaxExempt(Boolean(d.tax_exempt))
      setSpId(String(d.salesperson_id || ''))
      setCgId(String(d.cg_assigned_id || ''))
      setRefId(String(d.referrer_id || ''))
      setTradingName(String(d.trading_name_snapshot || ''))
      setCustomerType(String(d.customer_type_snapshot || ''))
      {
        const ship = (d.shipping_line ?? null) as Record<string, unknown> | null
        setShippingTitle(String(ship?.title || ship?.name || 'Standard'))
        setShippingAmount(String(ship?.price ?? ship?.amount ?? d.total_shipping ?? '0'))
        const disc = (d.discount_snapshot ?? null) as Record<string, unknown> | null
        const dtype = String(disc?.value_type || disc?.type || 'fixed').toLowerCase()
        setDiscountType(dtype.includes('percent') ? 'percentage' : 'fixed')
        setDiscountValue(String(disc?.value ?? disc?.amount ?? '0'))
      }
      setCustomerSel({
        customerId: d.customer_id ? String(d.customer_id) : null,
        companyId: d.company_id ? String(d.company_id) : null,
        email: String(d.email || customer?.email || ''),
        phone: String(d.phone || customer?.phone || ''),
        tradingName: String(d.trading_name_snapshot || ''),
        customerType: String(d.customer_type_snapshot || ''),
        label: String(
          customer?.display_name ||
            company?.name ||
            d.email ||
            'Linked party',
        ),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load draft')
    } finally {
      setLoading(false)
    }
  }, [draftId])

  const loadPanels = useCallback(async () => {
    try {
      setLinesFullyLoaded(false)
      const [ln, tl] = await Promise.all([
        listAllAdminDraftLines(draftId),
        listAdminDraftTimeline({ draftId, limit: 80, offset: 0 }),
      ])
      setLines(toEditableLines(ln.items))
      setLinesTotal(ln.total)
      setLinesFullyLoaded(ln.items.length === ln.total)
      setTimeline(tl.items)
      setTimelineTotal(tl.total)
    } catch (e) {
      setLinesFullyLoaded(false)
      toast.error(e instanceof Error ? e.message : 'Failed to load draft panels')
    }
  }, [draftId])

  useEffect(() => {
    void loadWorkspace()
  }, [loadWorkspace])

  useEffect(() => {
    void loadPanels()
  }, [loadPanels])

  useEffect(() => {
    void fetchDraftFilterFacets()
      .then((f) => setStaff(f.staff))
      .catch(() => {})
  }, [])

  const customer = (ws?.customer ?? null) as Record<string, unknown> | null
  const company = (ws?.company ?? null) as Record<string, unknown> | null
  const converted = (ws?.converted_order ?? null) as Record<string, unknown> | null
  const lineSummary = (ws?.line_summary ?? {}) as { line_count?: number; item_quantity?: number }
  const tags = (ws?.tags ?? []) as { raw_value: string }[]
  const metafields = (ws?.metafields ?? []) as {
    namespace: string
    key: string
    value_text: string | null
  }[]

  const serverTotals = useMemo(() => {
    if (!draft) return null
    return {
      subtotal: Number(draft.subtotal ?? 0),
      total_discounts: Number(draft.total_discounts ?? 0),
      total_shipping: Number(draft.total_shipping ?? 0),
      total_tax: Number(draft.total_tax ?? 0),
      total_price: Number(draft.total_price ?? 0),
    }
  }, [draft])

  async function handleConflict(e: unknown) {
    if (isVersionConflict(e)) {
      toast.error('This draft was updated elsewhere. Refreshing…')
      await loadWorkspace()
      await loadPanels()
      return true
    }
    return false
  }

  async function saveHeader() {
    if (!mutable) return
    setHeaderSaving(true)
    try {
      await updateUniqueDraft(draftId, version, {
        customer_id: customerSel.customerId,
        company_id: customerSel.companyId,
        email: email || customerSel.email || null,
        phone: phone || customerSel.phone || null,
        note,
        po_number: poNumber || null,
        payment_due_on: paymentDueOn || null,
        payment_terms: paymentTerms || null,
        tax_exempt: taxExempt,
        salesperson_id: spId || null,
        cg_assigned_id: cgId || null,
        referrer_id: refId || null,
        trading_name_snapshot: tradingName || customerSel.tradingName || null,
        customer_type_snapshot: customerType || customerSel.customerType || null,
        shipping_line: {
          title: shippingTitle || 'Shipping',
          price: String(Number(shippingAmount || 0)),
        },
        discount_snapshot: {
          value_type: discountType,
          value: String(Number(discountValue || 0)),
          title: discountType === 'percentage' ? 'Order % discount' : 'Order discount',
        },
      })
      toast.success('Draft updated')
      await loadWorkspace()
      await loadPanels()
    } catch (e) {
      if (!(await handleConflict(e))) {
        toast.error(e instanceof Error ? e.message : 'Update failed')
      }
    } finally {
      setHeaderSaving(false)
    }
  }

  async function saveLines() {
    if (!mutable) return
    if (!linesFullyLoaded) {
      toast.error('Lines are still loading or incomplete. Refresh before saving.')
      return
    }
    setLinesSaving(true)
    try {
      await replaceUniqueDraftLines(
        draftId,
        version,
        lines.map((l) => ({
          title: l.title,
          quantity: l.quantity,
          original_unit_price: l.original_unit_price,
          discounted_unit_price: l.discounted_unit_price,
          product_id: l.product_id,
          variant_id: l.variant_id,
          variant_title: l.variant_title,
          sku_snapshot: l.sku_snapshot,
          taxable: l.taxable !== false,
          deleted_product: Boolean(l.deleted_product),
        })),
        linesTotal,
      )
      toast.success('Lines saved')
      await loadWorkspace()
      await loadPanels()
    } catch (e) {
      if (!(await handleConflict(e))) {
        toast.error(e instanceof Error ? e.message : 'Could not save lines')
      }
    } finally {
      setLinesSaving(false)
    }
  }

  function onAddSkus(picks: DraftSkuPick[]) {
    setLines((prev) => [
      ...prev,
      ...picks.map((p, i) => ({
        key: `new-${Date.now()}-${i}-${p.variant_id}`,
        product_id: p.product_id,
        variant_id: p.variant_id,
        title: p.title,
        variant_title: p.variant_title,
        sku_snapshot: p.sku_snapshot,
        quantity: p.quantity,
        original_unit_price: p.original_unit_price,
        discounted_unit_price: p.discounted_unit_price,
        taxable: true,
        deleted_product: false,
      })),
    ])
  }

  async function onDuplicate() {
    if (!canEdit) return
    setActionBusy(true)
    try {
      const res = await duplicateDraftAsUnique(draftId)
      toast.success('Duplicated as Unique draft')
      void navigate({ to: '/backend/drafts/$draftId', params: { draftId: res.draft_id } })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Duplicate failed')
    } finally {
      setActionBusy(false)
    }
  }

  async function onConvert() {
    if (!mutable) return
    if (!window.confirm('Convert this Unique draft into a live order?')) return
    setActionBusy(true)
    try {
      const res = await convertUniqueDraft(draftId, version)
      toast.success(`Converted to ${res.order_number}`)
      void navigate({ to: '/backend/orders/$orderId', params: { orderId: res.order_id } })
    } catch (e) {
      if (!(await handleConflict(e))) {
        toast.error(e instanceof Error ? e.message : 'Convert failed')
      }
    } finally {
      setActionBusy(false)
    }
  }

  if (loading) return <AdminLoadingState />
  if (error || !draft) return <AdminErrorBanner message={error || 'Draft not found'} />

  const draftName = String(draft.name || 'Untitled draft')
  const shippingAddr = formatShippingAddress(draft.shipping_address)

  return (
    <div className="space-y-4 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to="/backend/drafts"
            className="mb-2 inline-flex items-center gap-1 text-sm text-[var(--admin-muted)] hover:text-[var(--admin-primary)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All drafts
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{draftName}</h1>
          <p className="mt-1 text-sm text-[var(--admin-muted)]">
            {fmtDraftWhen(String(draft.source_created_at || draft.created_at))} · v{version}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={adminBtnSecondary}
            onClick={() =>
              void copyText('Draft name', draftName).then(() => toast.success('Draft name copied'))
            }
          >
            <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy name
          </button>
          {canEdit && (
            <button type="button" className={adminBtnSecondary} disabled={actionBusy} onClick={() => void onDuplicate()}>
              Duplicate as Unique draft
            </button>
          )}
          {mutable && (
            <button type="button" className={adminBtnPrimary} disabled={actionBusy} onClick={() => void onConvert()}>
              Convert to order
            </button>
          )}
        </div>
      </div>

      {shopifyHistorical && (
        <div className="rounded-[var(--admin-radius)] border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950">
          Historical Shopify draft — commercial fields are read-only. Duplicate as a Unique draft to edit and convert.
        </div>
      )}

      <div className="grid gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-elevated)] p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <Field label="Source">
          <span className={cn('rounded px-1.5 py-0.5 text-xs font-semibold', draftSourceBadgeClass(sourceSystem))}>
            {formatDraftSourceLabel(sourceSystem)}
          </span>
        </Field>
        <Field label="Status">
          <span className={cn('rounded px-1.5 py-0.5 text-xs font-semibold', draftStatusBadgeClass(status))}>
            {formatDraftStatusLabel(status)}
          </span>
        </Field>
        <Field label="Total">{draftMoney(draft.total_price, currency)}</Field>
        <Field label="Lines">{lineSummary.line_count ?? linesTotal}</Field>
        <Field label="Units">{lineSummary.item_quantity ?? '—'}</Field>
        <Field label="Due">{draft.payment_due_on ? String(draft.payment_due_on) : '—'}</Field>
        <Field label="Converted">
          {converted ? (
            <Link
              to="/backend/orders/$orderId"
              params={{ orderId: String(converted.id) }}
              className="font-medium text-[var(--admin-primary)] hover:underline"
            >
              {String(converted.order_number || 'Order')}
            </Link>
          ) : (
            '—'
          )}
        </Field>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-4">
          <Panel
            title="Customer / commercial"
            actions={
              mutable ? (
                <button
                  type="button"
                  className={adminBtnSecondary}
                  disabled={headerSaving}
                  onClick={() => void saveHeader()}
                >
                  {headerSaving ? 'Saving…' : 'Save header'}
                </button>
              ) : undefined
            }
          >
            {mutable ? (
              <div className="space-y-4">
                <DraftCustomerPicker
                  value={customerSel}
                  onChange={(next) => {
                    setCustomerSel(next)
                    if (next.email) setEmail(next.email)
                    if (next.phone) setPhone(next.phone)
                    if (next.tradingName) setTradingName(next.tradingName)
                    if (next.customerType) setCustomerType(next.customerType)
                    if (next.paymentTerms) setPaymentTerms(next.paymentTerms)
                    if (next.salespersonId) setSpId(next.salespersonId)
                    if (next.cgAssignedId) setCgId(next.cgAssignedId)
                    if (next.referrerId) setRefId(next.referrerId)
                  }}
                />
                {(customerSel.customerId || customerSel.companyId) && (
                  <div className="flex flex-wrap gap-3 text-xs">
                    {customerSel.customerId && (
                      <Link
                        to="/backend/customers/$customerId"
                        params={{ customerId: customerSel.customerId }}
                        className="font-medium text-[var(--admin-primary)] hover:underline"
                      >
                        Open customer →
                      </Link>
                    )}
                    {customerSel.companyId && (
                      <Link
                        to="/backend/companies/$companyId"
                        params={{ companyId: customerSel.companyId }}
                        className="font-medium text-[var(--admin-primary)] hover:underline"
                      >
                        Open company →
                      </Link>
                    )}
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={adminLabel}>Email</label>
                    <input className={adminInput} value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div>
                    <label className={adminLabel}>Phone</label>
                    <input className={adminInput} value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </div>
                  <div>
                    <label className={adminLabel}>PO number</label>
                    <input className={adminInput} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
                  </div>
                  <div>
                    <label className={adminLabel}>StoreName / trading</label>
                    <input
                      className={adminInput}
                      value={tradingName}
                      onChange={(e) => setTradingName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={adminLabel}>Customer type</label>
                    <input
                      className={adminInput}
                      value={customerType}
                      onChange={(e) => setCustomerType(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={adminLabel}>Payment due</label>
                    <input
                      type="date"
                      className={adminInput}
                      value={paymentDueOn}
                      onChange={(e) => setPaymentDueOn(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={adminLabel}>Payment terms</label>
                    <input
                      className={adminInput}
                      value={paymentTerms}
                      onChange={(e) => setPaymentTerms(e.target.value)}
                    />
                  </div>
                  <div className="flex items-end pb-2">
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={taxExempt}
                        onChange={(e) => setTaxExempt(e.target.checked)}
                      />
                      Tax exempt
                    </label>
                  </div>
                  <div>
                    <label className={adminLabel}>Shipping method</label>
                    <input
                      className={adminInput}
                      value={shippingTitle}
                      onChange={(e) => setShippingTitle(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={adminLabel}>Shipping amount</label>
                    <input
                      className={adminInput}
                      inputMode="decimal"
                      value={shippingAmount}
                      onChange={(e) => setShippingAmount(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={adminLabel}>Order discount type</label>
                    <BrandedSelect
                      value={discountType}
                      onValueChange={(v) => setDiscountType(v as 'fixed' | 'percentage')}
                      options={[
                        { value: 'fixed', label: 'Fixed (£)' },
                        { value: 'percentage', label: 'Percentage (%)' },
                      ]}
                    />
                  </div>
                  <div>
                    <label className={adminLabel}>Order discount value</label>
                    <input
                      className={adminInput}
                      inputMode="decimal"
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className={adminLabel}>Internal note</label>
                  <textarea
                    className={cn(adminInput, 'min-h-[72px]')}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className={adminLabel}>Salesperson</label>
                    <BrandedSelect
                      value={spId}
                      onValueChange={setSpId}
                      allowEmpty
                      emptyLabel="—"
                      options={staff.map((s) => ({ value: s.id, label: s.name }))}
                    />
                  </div>
                  <div>
                    <label className={adminLabel}>CG assigned</label>
                    <BrandedSelect
                      value={cgId}
                      onValueChange={setCgId}
                      allowEmpty
                      emptyLabel="—"
                      options={staff.map((s) => ({ value: s.id, label: s.name }))}
                    />
                  </div>
                  <div>
                    <label className={adminLabel}>Referrer</label>
                    <BrandedSelect
                      value={refId}
                      onValueChange={setRefId}
                      allowEmpty
                      emptyLabel="—"
                      options={staff.map((s) => ({ value: s.id, label: s.name }))}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <dl className="grid gap-3 sm:grid-cols-2">
                <Field label="Customer">
                  {customer?.id ? (
                    <Link
                      to="/backend/customers/$customerId"
                      params={{ customerId: String(customer.id) }}
                      className="font-medium text-[var(--admin-primary)] hover:underline"
                    >
                      {String(
                        customer.display_name ||
                          `${customer.first_name || ''} ${customer.last_name || ''}`.trim() ||
                          'Customer',
                      )}
                    </Link>
                  ) : customer ? (
                    String(
                      customer.display_name ||
                        `${customer.first_name || ''} ${customer.last_name || ''}`.trim() ||
                        'Customer',
                    )
                  ) : (
                    '—'
                  )}
                </Field>
                <Field label="Company">
                  {company?.id ? (
                    <Link
                      to="/backend/companies/$companyId"
                      params={{ companyId: String(company.id) }}
                      className="font-medium text-[var(--admin-primary)] hover:underline"
                    >
                      {String(company.name)}
                    </Link>
                  ) : company ? (
                    String(company.name)
                  ) : (
                    '—'
                  )}
                </Field>
                <Field label="StoreName / trading">{String(draft.trading_name_snapshot || '—')}</Field>
                <Field label="Email">{String(draft.email || customer?.email || '—')}</Field>
                <Field label="Phone">{String(draft.phone || customer?.phone || '—')}</Field>
                <Field label="Customer type">{String(draft.customer_type_snapshot || '—')}</Field>
                <Field label="PO">{String(draft.po_number || '—')}</Field>
                <Field label="Payment due">{draft.payment_due_on ? String(draft.payment_due_on) : '—'}</Field>
                <Field label="Payment terms">{String(draft.payment_terms || '—')}</Field>
                <Field label="Shipping">
                  {(() => {
                    const ship = (draft.shipping_line ?? null) as Record<string, unknown> | null
                    const title = String(ship?.title || ship?.name || '')
                    return title
                      ? `${title} · ${draftMoney(draft.total_shipping, currency)}`
                      : draftMoney(draft.total_shipping, currency)
                  })()}
                </Field>
                <Field label="Tax exempt">{draft.tax_exempt ? 'Yes' : 'No'}</Field>
                <Field label="Salesperson">
                  {String((ws?.salesperson as { name?: string } | null)?.name || '—')}
                </Field>
                <Field label="CG">
                  {String((ws?.cg_assigned as { name?: string } | null)?.name || '—')}
                </Field>
                <Field label="Referrer">
                  {String((ws?.referrer as { name?: string } | null)?.name || '—')}
                </Field>
                <Field label="Shipping address">
                  <span className="whitespace-pre-line text-xs leading-relaxed">{shippingAddr || '—'}</span>
                </Field>
                {note && (
                  <Field label="Note">
                    <span className="whitespace-pre-wrap text-xs">{note}</span>
                  </Field>
                )}
              </dl>
            )}
          </Panel>

          <Panel title={`Line items (${lineSummary.line_count ?? lines.length})`}>
            {mutable && <DraftSkuPicker currency={currency} onAdd={onAddSkus} />}
            <div className={mutable ? 'mt-4' : undefined}>
              <DraftLinesEditor
                lines={lines}
                currency={currency}
                editable={mutable}
                serverTotals={serverTotals}
                onChange={setLines}
                onSave={() => void saveLines()}
                saving={linesSaving}
              />
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Financial summary">
            <dl className="space-y-2 text-sm">
              {(
                [
                  ['Subtotal', draft.subtotal],
                  ['Discounts', draft.total_discounts],
                  ['Shipping', draft.total_shipping],
                  ['VAT / tax', draft.total_tax],
                  ['Total', draft.total_price],
                ] as const
              ).map(([label, val]) => (
                <div key={label} className="flex justify-between gap-4 border-b border-[var(--admin-border)]/60 py-1.5">
                  <dt className="text-[var(--admin-muted)]">{label}</dt>
                  <dd className="font-medium tabular-nums">{draftMoney(val, currency)}</dd>
                </div>
              ))}
            </dl>
            {shopifyHistorical && (
              <p className="mt-3 text-xs text-[var(--admin-muted)]">
                Historical Shopify commercial snapshot — not recalculated from the live catalogue.
              </p>
            )}
          </Panel>

          {tags.length > 0 && (
            <Panel title="Tags">
              <div className="flex flex-wrap gap-1">
                {tags.map((t) => (
                  <span key={t.raw_value} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">
                    {t.raw_value}
                  </span>
                ))}
              </div>
            </Panel>
          )}

          {metafields.length > 0 && (
            <Panel title="Metafields">
              <dl className="space-y-2 text-xs">
                {metafields.slice(0, 24).map((m) => (
                  <div key={`${m.namespace}.${m.key}`} className="border-b border-[var(--admin-border)]/50 pb-1">
                    <dt className="font-mono text-[var(--admin-muted)]">
                      {m.namespace}.{m.key}
                    </dt>
                    <dd className="mt-0.5 break-all">{m.value_text || '—'}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          )}

          <Panel title="Activity">
            <DraftActivityPanel
              items={timeline}
              total={timelineTotal}
              canAddNote={canEdit}
              onAddNote={async (body) => {
                try {
                  await addAdminDraftNote(draftId, body)
                  toast.success('Note added')
                  await loadPanels()
                  await loadWorkspace()
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'Could not add note')
                  throw e
                }
              }}
            />
          </Panel>
        </div>
      </div>
    </div>
  )
}
