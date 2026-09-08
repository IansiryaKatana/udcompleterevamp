import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import {
  addAdminCrmNote,
  addCompanyContact,
  deleteCompanyLocation,
  fetchCrmCompanyFilterFacets,
  getAdminCompanyWorkspace,
  listAdminCrmTimeline,
  removeCompanyContact,
  searchAdminCustomersCompanies,
  updateUniqueCompany,
  upsertCompanyLocation,
} from '@/admin/lib/adminRpc'
import {
  crmMoney,
  crmSourceBadgeClass,
  crmStatusBadgeClass,
  formatCrmLabel,
  formatCrmSourceLabel,
  fmtCrmDate,
  isShopifyCrm,
  isVersionConflict,
} from '@/admin/lib/crmOps'
import { CrmActivityPanel } from '@/admin/crm/CrmActivityPanel'
import { CrmFinanceSummary } from '@/admin/crm/CrmFinanceSummary'
import { AdminErrorBanner, AdminLoadingState } from '@/admin/components/AdminPageHeading'
import { adminBtnPrimary, adminBtnSecondary, adminInput, adminLabel } from '@/admin/adminClassNames'
import { BrandedSelect } from '@/components/ui/BrandedSelect'
import { useAdminAuth } from '@/contexts/AdminAuthContext'
import { useCms } from '@/contexts/CmsContext'
import { getCurrencyFromSettings } from '@/lib/currency'
import { cn } from '@/lib/utils'

type Workspace = Awaited<ReturnType<typeof getAdminCompanyWorkspace>>

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

export function AdminCompanyDetail({ companyId }: { companyId: string }) {
  const { canEdit } = useAdminAuth()
  const { snapshot } = useCms()
  const currency = getCurrencyFromSettings(snapshot.siteSettings).code || 'GBP'
  const [ws, setWs] = useState<Workspace | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [timeline, setTimeline] = useState<Record<string, unknown>[]>([])
  const [timelineTotal, setTimelineTotal] = useState(0)
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [shopifyOpen, setShopifyOpen] = useState(false)
  const [contactQuery, setContactQuery] = useState('')
  const [contactHits, setContactHits] = useState<{ id: string; label: string }[]>([])
  const [contactBusy, setContactBusy] = useState(false)
  const [locBusy, setLocBusy] = useState(false)
  const [locName, setLocName] = useState('')
  const [locAddr1, setLocAddr1] = useState('')
  const [locCity, setLocCity] = useState('')
  const [locPostcode, setLocPostcode] = useState('')

  const [name, setName] = useState('')
  const [tradingName, setTradingName] = useState('')
  const [legalName, setLegalName] = useState('')
  const [vatNumber, setVatNumber] = useState('')
  const [companyNumber, setCompanyNumber] = useState('')
  const [customerType, setCustomerType] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [status, setStatus] = useState('active')
  const [notes, setNotes] = useState('')
  const [spId, setSpId] = useState('')
  const [cgId, setCgId] = useState('')
  const [refId, setRefId] = useState('')

  const company = (ws?.company ?? null) as Record<string, unknown> | null
  const version = Number(company?.version ?? 1)
  const sourceSystem = String(company?.source_system || '')
  const workspaceCanEdit = Boolean(ws?.can_edit)
  const mutable = canEdit && workspaceCanEdit

  const loadWorkspace = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getAdminCompanyWorkspace(companyId)
      setWs(data)
      const c = data.company as Record<string, unknown>
      setName(String(c.name || ''))
      setTradingName(String(c.trading_name || ''))
      setLegalName(String(c.legal_name || ''))
      setVatNumber(String(c.vat_number || ''))
      setCompanyNumber(String(c.company_number || ''))
      setCustomerType(String(c.customer_type || ''))
      setPaymentTerms(String(c.payment_terms || ''))
      setStatus(String(c.status || 'active'))
      setNotes(String(c.notes || ''))
      setSpId(String(c.salesperson_id || ''))
      setCgId(String(c.cg_assigned_id || ''))
      setRefId(String(c.referrer_id || ''))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load company')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  const loadTimeline = useCallback(async () => {
    try {
      const tl = await listAdminCrmTimeline({
        entityType: 'company',
        entityId: companyId,
        limit: 80,
        offset: 0,
      })
      setTimeline(tl.items)
      setTimelineTotal(tl.total)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load timeline')
    }
  }, [companyId])

  useEffect(() => {
    void loadWorkspace()
  }, [loadWorkspace])

  useEffect(() => {
    void loadTimeline()
  }, [loadTimeline])

  useEffect(() => {
    void fetchCrmCompanyFilterFacets()
      .then((f) => setStaff(f.staff))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!mutable || contactQuery.trim().length < 2) {
      setContactHits([])
      return
    }
    const t = window.setTimeout(() => {
      void searchAdminCustomersCompanies({ search: contactQuery.trim(), limit: 12 })
        .then((res) => {
          setContactHits(
            res.customers.map((c) => ({
              id: c.id,
              label: c.display_name || c.email || 'Customer',
            })),
          )
        })
        .catch(() => {})
    }, 250)
    return () => window.clearTimeout(t)
  }, [contactQuery, mutable])

  const metrics = (ws?.commercial ?? ws?.metrics ?? {}) as Record<string, unknown>
  const contacts = (ws?.contacts ?? []) as Record<string, unknown>[]
  const locations = (ws?.locations ?? []) as Record<string, unknown>[]
  const recentOrders = (ws?.recent_orders ?? []) as Record<string, unknown>[]
  const recentDrafts = (ws?.recent_drafts ?? []) as Record<string, unknown>[]
  const tags = (ws?.tags ?? []) as Array<string | { raw_value: string }>
  const metafields = (ws?.metafields ?? []) as {
    namespace: string
    key: string
    value_text: string | null
  }[]

  async function handleConflict(e: unknown) {
    if (isVersionConflict(e)) {
      toast.error('This company was updated elsewhere. Refreshing…')
      await loadWorkspace()
      await loadTimeline()
      return true
    }
    return false
  }

  async function saveMaster() {
    if (!mutable) return
    if (!name.trim()) {
      toast.error('Company name is required')
      return
    }
    setSaving(true)
    try {
      await updateUniqueCompany(companyId, version, {
        name: name.trim(),
        trading_name: tradingName || null,
        legal_name: legalName || null,
        vat_number: vatNumber || null,
        company_number: companyNumber || null,
        customer_type: customerType || null,
        payment_terms: paymentTerms || null,
        status,
        notes: notes || null,
        salesperson_id: spId || null,
        cg_assigned_id: cgId || null,
        referrer_id: refId || null,
      })
      toast.success('Company updated')
      await loadWorkspace()
      await loadTimeline()
    } catch (e) {
      if (!(await handleConflict(e))) {
        toast.error(e instanceof Error ? e.message : 'Update failed')
      }
    } finally {
      setSaving(false)
    }
  }

  async function linkContact(customerId: string) {
    setContactBusy(true)
    try {
      await addCompanyContact({ companyId, customerId })
      toast.success('Contact linked')
      setContactQuery('')
      setContactHits([])
      await loadWorkspace()
      await loadTimeline()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not link contact')
    } finally {
      setContactBusy(false)
    }
  }

  async function unlinkContact(customerId: string) {
    setContactBusy(true)
    try {
      await removeCompanyContact(companyId, customerId)
      toast.success('Contact removed')
      await loadWorkspace()
      await loadTimeline()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove contact')
    } finally {
      setContactBusy(false)
    }
  }

  if (loading) return <AdminLoadingState />
  if (error || !company) return <AdminErrorBanner message={error || 'Company not found'} />

  const tagValues = tags.map((t) => (typeof t === 'string' ? t : t.raw_value))

  return (
    <div className="space-y-4 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to="/backend/companies"
            className="mb-2 inline-flex items-center gap-1 text-sm text-[var(--admin-muted)] hover:text-[var(--admin-primary)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All companies
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{name || 'Company'}</h1>
            <span
              className={cn(
                'inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                crmSourceBadgeClass(sourceSystem),
              )}
            >
              {formatCrmSourceLabel(sourceSystem)}
            </span>
            <span
              className={cn(
                'inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                crmStatusBadgeClass(status),
              )}
            >
              {formatCrmLabel(status)}
            </span>
          </div>
          <p className="mt-1 text-sm text-[var(--admin-muted)]">
            v{version}
            {isShopifyCrm(sourceSystem)
              ? ' · Shopify-imported — operational CRM fields editable; raw metafields/tags preserved'
              : ''}
          </p>
        </div>
        {mutable && (
          <button type="button" className={adminBtnPrimary} disabled={saving} onClick={() => void saveMaster()}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        {(
          [
            ['Orders', metrics.order_count ?? 0],
            ['Lifetime', crmMoney(metrics.lifetime_total, currency)],
            ['Received', crmMoney(metrics.total_received, currency)],
            ['Outstanding', crmMoney(metrics.total_outstanding, currency)],
            ['Open drafts', metrics.open_draft_count ?? 0],
            ['Last order', fmtCrmDate(metrics.last_order_at as string | null)],
          ] as const
        ).map(([label, val]) => (
          <div
            key={label}
            className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white px-3 py-2"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-muted)]">{label}</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums">{val}</p>
          </div>
        ))}
      </div>

      <Panel title="Finance summary">
        <CrmFinanceSummary entityType="company" entityId={companyId} currency={currency} />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-4">
          <Panel title="Master fields">
            {mutable ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className={adminLabel}>Name</label>
                    <input className={adminInput} value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div>
                    <label className={adminLabel}>Trading name</label>
                    <input className={adminInput} value={tradingName} onChange={(e) => setTradingName(e.target.value)} />
                  </div>
                  <div>
                    <label className={adminLabel}>Legal name</label>
                    <input className={adminInput} value={legalName} onChange={(e) => setLegalName(e.target.value)} />
                  </div>
                  <div>
                    <label className={adminLabel}>VAT number</label>
                    <input className={adminInput} value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} />
                  </div>
                  <div>
                    <label className={adminLabel}>Company number</label>
                    <input
                      className={adminInput}
                      value={companyNumber}
                      onChange={(e) => setCompanyNumber(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={adminLabel}>Customer type</label>
                    <input className={adminInput} value={customerType} onChange={(e) => setCustomerType(e.target.value)} />
                  </div>
                  <div>
                    <label className={adminLabel}>Payment terms</label>
                    <input className={adminInput} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
                  </div>
                  <div>
                    <label className={adminLabel}>Status</label>
                    <BrandedSelect
                      value={status}
                      onValueChange={setStatus}
                      options={[
                        { value: 'active', label: 'Active' },
                        { value: 'inactive', label: 'Inactive' },
                        { value: 'blocked', label: 'Blocked' },
                      ]}
                    />
                  </div>
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
                <div>
                  <label className={adminLabel}>Notes</label>
                  <textarea
                    className={cn(adminInput, 'min-h-[72px]')}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <dl className="grid gap-3 sm:grid-cols-2">
                <Field label="Trading">{tradingName || '—'}</Field>
                <Field label="Legal">{legalName || '—'}</Field>
                <Field label="VAT">{vatNumber || '—'}</Field>
                <Field label="Type">{customerType || '—'}</Field>
                <Field label="Terms">{paymentTerms || '—'}</Field>
              </dl>
            )}
          </Panel>

          <Panel title={`Contacts (${contacts.length})`}>
            {mutable && (
              <div className="relative mb-3">
                <label className={adminLabel}>Link existing customer</label>
                <input
                  className={adminInput}
                  placeholder="Search customers…"
                  value={contactQuery}
                  disabled={contactBusy}
                  onChange={(e) => setContactQuery(e.target.value)}
                />
                {contactHits.length > 0 && (
                  <div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded border border-[var(--admin-border)] bg-white shadow-lg">
                    {contactHits.map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        className="flex w-full px-3 py-2 text-left text-sm hover:bg-[var(--admin-primary)]/[0.06]"
                        onClick={() => void linkContact(h.id)}
                      >
                        {h.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {contacts.length === 0 ? (
              <p className="text-sm text-[var(--admin-muted)]">No contacts linked.</p>
            ) : (
              <ul className="divide-y divide-[var(--admin-border)] text-sm">
                {contacts.map((ct) => {
                  const custId = String(ct.customer_id || ct.id)
                  const label = String(
                    ct.display_name ||
                      ct.customer_name ||
                      `${ct.first_name || ''} ${ct.last_name || ''}`.trim() ||
                      ct.email ||
                      'Contact',
                  )
                  return (
                    <li key={String(ct.id || custId)} className="flex items-center justify-between gap-2 py-2">
                      <Link
                        to="/backend/customers/$customerId"
                        params={{ customerId: custId }}
                        className="font-medium text-[var(--admin-primary)] hover:underline"
                      >
                        {label}
                      </Link>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--admin-muted)]">
                          {ct.is_primary ? 'Primary' : String(ct.title || ct.role || '')}
                        </span>
                        {mutable && (
                          <button
                            type="button"
                            className="text-xs text-rose-700 hover:underline"
                            disabled={contactBusy}
                            onClick={() => void unlinkContact(custId)}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>

          <Panel title={`Locations (${locations.length})`}>
            {locations.length === 0 ? (
              <p className="text-sm text-[var(--admin-muted)]">No locations on file.</p>
            ) : (
              <ul className="space-y-2 text-xs leading-relaxed">
                {locations.map((loc) => (
                  <li key={String(loc.id)} className="rounded border border-[var(--admin-border)] px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-[var(--admin-muted)]">
                        {String(loc.name || 'Location')}
                        {loc.is_primary ? ' · primary' : ''}
                      </span>
                      {mutable && (
                        <button
                          type="button"
                          className="text-xs text-rose-700 hover:underline"
                          disabled={locBusy}
                          onClick={() => {
                            void (async () => {
                              setLocBusy(true)
                              try {
                                await deleteCompanyLocation(companyId, String(loc.id))
                                toast.success('Location removed')
                                await loadWorkspace()
                                await loadTimeline()
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : 'Delete failed')
                              } finally {
                                setLocBusy(false)
                              }
                            })()
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <p className="mt-1 whitespace-pre-line">
                      {[loc.address1, loc.address2, [loc.city, loc.postal_code].filter(Boolean).join(' '), loc.country]
                        .filter(Boolean)
                        .join('\n')}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {mutable && (
              <div className="mt-3 space-y-2 border-t border-[var(--admin-border)] pt-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-muted)]">
                  Add location
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    className={adminInput}
                    placeholder="Location name"
                    value={locName}
                    onChange={(e) => setLocName(e.target.value)}
                  />
                  <input
                    className={adminInput}
                    placeholder="Address line 1"
                    value={locAddr1}
                    onChange={(e) => setLocAddr1(e.target.value)}
                  />
                  <input
                    className={adminInput}
                    placeholder="City"
                    value={locCity}
                    onChange={(e) => setLocCity(e.target.value)}
                  />
                  <input
                    className={adminInput}
                    placeholder="Postcode"
                    value={locPostcode}
                    onChange={(e) => setLocPostcode(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className={adminBtnSecondary}
                  disabled={locBusy || !locName.trim()}
                  onClick={() => {
                    void (async () => {
                      setLocBusy(true)
                      try {
                        await upsertCompanyLocation({
                          companyId,
                          payload: {
                            name: locName,
                            address1: locAddr1,
                            city: locCity,
                            postal_code: locPostcode,
                            country_code: 'GB',
                            is_primary: locations.length === 0,
                          },
                        })
                        toast.success('Location added')
                        setLocName('')
                        setLocAddr1('')
                        setLocCity('')
                        setLocPostcode('')
                        await loadWorkspace()
                        await loadTimeline()
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : 'Save failed')
                      } finally {
                        setLocBusy(false)
                      }
                    })()
                  }}
                >
                  {locBusy ? 'Saving…' : 'Add location'}
                </button>
              </div>
            )}
          </Panel>

          <Panel title="Recent orders">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-[var(--admin-muted)]">
                  <tr>
                    <th className="pb-2 font-semibold">Order</th>
                    <th className="pb-2 font-semibold">Date</th>
                    <th className="pb-2 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((o) => (
                    <tr key={String(o.id)} className="border-t border-[var(--admin-border)]">
                      <td className="py-1.5">
                        <Link
                          to="/backend/orders/$orderId"
                          params={{ orderId: String(o.id) }}
                          className="font-medium text-[var(--admin-primary)] hover:underline"
                        >
                          {String(o.order_number || o.internal_order_number || 'Order')}
                        </Link>
                      </td>
                      <td className="py-1.5 text-xs text-[var(--admin-muted)]">
                        {fmtCrmDate(String(o.order_date || o.created_at || ''))}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {crmMoney(o.total, String(o.currency || currency))}
                      </td>
                    </tr>
                  ))}
                  {recentOrders.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-4 text-center text-[var(--admin-muted)]">
                        No orders
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Recent drafts">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-[var(--admin-muted)]">
                  <tr>
                    <th className="pb-2 font-semibold">Draft</th>
                    <th className="pb-2 font-semibold">Status</th>
                    <th className="pb-2 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {recentDrafts.map((d) => (
                    <tr key={String(d.id)} className="border-t border-[var(--admin-border)]">
                      <td className="py-1.5">
                        <Link
                          to="/backend/drafts/$draftId"
                          params={{ draftId: String(d.id) }}
                          className="font-medium text-[var(--admin-primary)] hover:underline"
                        >
                          {String(d.name || 'Draft')}
                        </Link>
                      </td>
                      <td className="py-1.5 text-xs">{formatCrmLabel(String(d.status || ''))}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {crmMoney(d.total_price, String(d.currency || currency))}
                      </td>
                    </tr>
                  ))}
                  {recentDrafts.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-4 text-center text-[var(--admin-muted)]">
                        No drafts
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          {tagValues.length > 0 && (
            <Panel title="Tags">
              <div className="flex flex-wrap gap-1">
                {tagValues.map((t) => (
                  <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">
                    {t}
                  </span>
                ))}
              </div>
            </Panel>
          )}

          {metafields.length > 0 && (
            <Panel
              title="Additional Shopify data"
              actions={
                <button
                  type="button"
                  className={adminBtnSecondary}
                  onClick={() => setShopifyOpen((v) => !v)}
                >
                  {shopifyOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  {shopifyOpen ? 'Hide' : 'Show'}
                </button>
              }
            >
              {shopifyOpen ? (
                <dl className="space-y-2 text-xs">
                  {metafields.map((m) => (
                    <div key={`${m.namespace}.${m.key}`} className="border-b border-[var(--admin-border)]/50 pb-1">
                      <dt className="font-mono text-[var(--admin-muted)]">
                        {m.namespace}.{m.key}
                      </dt>
                      <dd className="mt-0.5 break-all">{m.value_text || '—'}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-xs text-[var(--admin-muted)]">{metafields.length} metafields</p>
              )}
            </Panel>
          )}

          <Panel title="Activity">
            <CrmActivityPanel
              items={timeline}
              total={timelineTotal}
              canAddNote={canEdit}
              onAddNote={async (body) => {
                try {
                  await addAdminCrmNote('company', companyId, body)
                  toast.success('Note added')
                  await loadTimeline()
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
