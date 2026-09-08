import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import {
  addAdminCrmNote,
  deleteCustomerAddress,
  fetchCrmCustomerFilterFacets,
  getAdminCustomerWorkspace,
  listAdminCrmTimeline,
  setPayLaterEligibility,
  setTradeAccess,
  updateUniqueCustomer,
  unlinkCustomerAuth,
  createCustomerAuthActivation,
  sendTradeActivationEmail,
  fetchCustomerActivationStatus,
  upsertCustomerAddress,
} from '@/admin/lib/adminRpc'
import {
  crmApprovalBadgeClass,
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

type Workspace = Awaited<ReturnType<typeof getAdminCustomerWorkspace>>

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

export function AdminCustomerDetail({ customerId }: { customerId: string }) {
  const { canEdit, canReassignOwnership } = useAdminAuth()
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
  const [tradeNote, setTradeNote] = useState('')
  const [tradeBusy, setTradeBusy] = useState(false)
  const [tradeDraft, setTradeDraft] = useState('ineligible')
  const [activationToken, setActivationToken] = useState<string | null>(null)
  const [activationStatus, setActivationStatus] = useState<Record<string, unknown> | null>(null)

  const [displayName, setDisplayName] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [tradingName, setTradingName] = useState('')
  const [customerType, setCustomerType] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [status, setStatus] = useState('active')
  const [approvalStatus, setApprovalStatus] = useState('pending')
  const [notes, setNotes] = useState('')
  const [taxExempt, setTaxExempt] = useState(false)
  const [spId, setSpId] = useState('')
  const [cgId, setCgId] = useState('')
  const [refId, setRefId] = useState('')
  const [addrBusy, setAddrBusy] = useState(false)
  const [addr1, setAddr1] = useState('')
  const [addrCity, setAddrCity] = useState('')
  const [addrPostcode, setAddrPostcode] = useState('')
  const [addrType, setAddrType] = useState('shipping')

  const customer = (ws?.customer ?? null) as Record<string, unknown> | null
  const version = Number(customer?.version ?? 1)
  const sourceSystem = String(customer?.source_system || '')
  const workspaceCanEdit = Boolean(ws?.can_edit)
  const mutable = canEdit && workspaceCanEdit

  const loadWorkspace = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getAdminCustomerWorkspace(customerId)
      setWs(data)
      const c = data.customer as Record<string, unknown>
      setDisplayName(String(c.display_name || ''))
      setFirstName(String(c.first_name || ''))
      setLastName(String(c.last_name || ''))
      setEmail(String(c.email || ''))
      setPhone(String(c.phone || ''))
      setTradingName(String(c.trading_name || ''))
      setCustomerType(String(c.customer_type || ''))
      setPaymentTerms(String(c.payment_terms || ''))
      setStatus(String(c.status || 'active'))
      setApprovalStatus(String(c.approval_status || 'pending'))
      setNotes(String(c.notes || ''))
      setTaxExempt(Boolean(c.tax_exempt))
      setSpId(String(c.salesperson_id || ''))
      setCgId(String(c.cg_assigned_id || ''))
      setRefId(String(c.referrer_id || ''))
      setTradeDraft(String(c.trade_access_status || 'ineligible'))
      try {
        setActivationStatus(await fetchCustomerActivationStatus(customerId))
      } catch {
        setActivationStatus(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load customer')
    } finally {
      setLoading(false)
    }
  }, [customerId])

  const loadTimeline = useCallback(async () => {
    try {
      const tl = await listAdminCrmTimeline({
        entityType: 'customer',
        entityId: customerId,
        limit: 80,
        offset: 0,
      })
      setTimeline(tl.items)
      setTimelineTotal(tl.total)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load timeline')
    }
  }, [customerId])

  useEffect(() => {
    void loadWorkspace()
  }, [loadWorkspace])

  useEffect(() => {
    void loadTimeline()
  }, [loadTimeline])

  useEffect(() => {
    void fetchCrmCustomerFilterFacets()
      .then((f) => setStaff(f.staff))
      .catch(() => {})
  }, [])

  const metrics = (ws?.commercial ?? ws?.metrics ?? {}) as Record<string, unknown>
  const companies = (ws?.companies ?? []) as Record<string, unknown>[]
  const addresses = (ws?.addresses ?? []) as Record<string, unknown>[]
  const recentOrders = (ws?.recent_orders ?? []) as Record<string, unknown>[]
  const recentDrafts = (ws?.recent_drafts ?? []) as Record<string, unknown>[]
  const tags = (ws?.tags ?? []) as Array<string | { raw_value: string }>
  const metafields = (ws?.metafields ?? []) as {
    namespace: string
    key: string
    value_text: string | null
  }[]
  const tradingResolve = (ws?.trading_name ?? ws?.trading_name_resolve ?? null) as {
    display?: string
    sources?: { source: string; value: string }[]
  } | null

  async function handleConflict(e: unknown) {
    if (isVersionConflict(e)) {
      toast.error('This customer was updated elsewhere. Refreshing…')
      await loadWorkspace()
      await loadTimeline()
      return true
    }
    return false
  }

  async function saveMaster() {
    if (!mutable) return
    setSaving(true)
    try {
      await updateUniqueCustomer(customerId, version, {
        display_name: displayName || null,
        first_name: firstName || null,
        last_name: lastName || null,
        email: email || null,
        phone: phone || null,
        trading_name: tradingName || null,
        customer_type: customerType || null,
        payment_terms: paymentTerms || null,
        status,
        approval_status: approvalStatus,
        notes: notes || null,
        tax_exempt: taxExempt,
        salesperson_id: spId || null,
        cg_assigned_id: cgId || null,
        referrer_id: refId || null,
      })
      toast.success('Customer updated')
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

  if (loading) return <AdminLoadingState />
  if (error || !customer) return <AdminErrorBanner message={error || 'Customer not found'} />

  const title =
    displayName ||
    [firstName, lastName].filter(Boolean).join(' ') ||
    email ||
    'Customer'

  const tagValues = tags.map((t) => (typeof t === 'string' ? t : t.raw_value))

  return (
    <div className="space-y-4 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to="/backend/customers"
            className="mb-2 inline-flex items-center gap-1 text-sm text-[var(--admin-muted)] hover:text-[var(--admin-primary)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All customers
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
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
            <span
              className={cn(
                'inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                crmApprovalBadgeClass(approvalStatus),
              )}
            >
              {formatCrmLabel(approvalStatus)}
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
        <CrmFinanceSummary entityType="customer" entityId={customerId} currency={currency} />
      </Panel>

      <Panel
        title="Trade & commercial access"
        actions={
          canReassignOwnership ? (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-muted)]">
              Owner/admin decide
            </span>
          ) : (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-muted)]">
              View only
            </span>
          )
        }
      >
        {(() => {
          const c = customer ?? {}
          const policyWrap = (ws?.commercial_policy ?? null) as Record<string, unknown> | null
          const policy = (policyWrap?.policy ?? null) as Record<string, unknown> | null
          const history = (ws?.trade_decision_history ?? []) as Record<string, unknown>[]
          const sourceTags = (ws?.commercial_source_tags ?? []) as string[]
          const tradeStatus = String(c.trade_access_status || 'ineligible')
          const payLater = Boolean(c.pay_later_eligible)
          return (
            <div className="space-y-3">
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Trade access">{formatCrmLabel(tradeStatus)}</Field>
                <Field label="Trade eligible">{c.trade_eligible ? 'Yes' : 'No'}</Field>
                <Field label="PAY LATER">{payLater ? 'Yes' : 'No'}</Field>
                <Field label="Payment terms">{String(c.payment_terms || '—')}</Field>
                <Field label="Customer type">{String(c.customer_type || '—')} (descriptive)</Field>
                <Field label="Auth linked">{c.auth_user_id ? 'Yes' : 'No (CRM only)'}</Field>
                <Field label="Credit limit">NO_SOURCE_EVIDENCE</Field>
                <Field label="Price mode">{String(policy?.price_mode || 'base')}</Field>
                <Field label="Compliance status">
                  {String(c.compliance_status || 'NOT_RECORDED')}
                </Field>
                <Field label="Compliance method">{String(c.compliance_method || '—')}</Field>
                <Field label="Compliance checked">
                  {c.compliance_checked_at
                    ? new Date(String(c.compliance_checked_at)).toLocaleString()
                    : '—'}
                </Field>
                <Field label="Trade ≠ age verified">Always separate</Field>
              </dl>
              <p className="text-[10px] text-[var(--admin-muted)]">
                Compliance is independent of trade approval. NOT_RECORDED means no Unique-native compliance check on
                file — not legal age verification.
              </p>
              {(() => {
                const authLink = (ws?.auth_link ?? null) as Record<string, unknown> | null
                return (
                  <div className="rounded border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-xs">
                    <p>
                      <span className="font-semibold">Auth account:</span>{' '}
                      {authLink?.auth_linked
                        ? String(authLink.auth_email || authLink.auth_user_id || 'linked')
                        : 'Not linked'}
                    </p>
                    <p className="mt-1 text-[var(--admin-muted)]">
                      Trade source: {String(c.trade_eligible_source || '—')} · PAY LATER source:{' '}
                      {String(c.pay_later_eligible_source || '—')} (historical tag ≠ current permission)
                    </p>
                  </div>
                )
              })()}
              {activationStatus && (
                <p className="text-xs text-[var(--admin-muted)]">
                  Activation: {activationStatus.auth_linked ? 'auth linked' : 'not linked'}
                  {activationStatus.latest_activation
                    ? ` · invite ${String((activationStatus.latest_activation as Record<string, unknown>).status)}`
                    : ' · no invite'}
                  {canReassignOwnership ? '' : ' (view only — send/link requires owner/admin)'}
                </p>
              )}
              {canReassignOwnership && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={adminBtnSecondary}
                    disabled={tradeBusy || !c.auth_user_id}
                    onClick={() => {
                      void (async () => {
                        setTradeBusy(true)
                        try {
                          await unlinkCustomerAuth(customerId, tradeNote || undefined)
                          toast.success('Auth unlinked — CRM retained')
                          await loadWorkspace()
                          await loadTimeline()
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : 'Unlink failed')
                        } finally {
                          setTradeBusy(false)
                        }
                      })()
                    }}
                  >
                    Unlink auth
                  </button>
                  <button
                    type="button"
                    className={adminBtnSecondary}
                    disabled={tradeBusy || Boolean(c.auth_user_id)}
                    onClick={() => {
                      void (async () => {
                        setTradeBusy(true)
                        try {
                          const res = await createCustomerAuthActivation(
                            customerId,
                            72,
                            tradeNote || undefined,
                          )
                          setActivationToken(String(res.token || ''))
                          toast.success('Activation token created — copy now')
                          await loadWorkspace()
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : 'Activation failed')
                        } finally {
                          setTradeBusy(false)
                        }
                      })()
                    }}
                  >
                    Create activation invite
                  </button>
                  <button
                    type="button"
                    className={adminBtnPrimary}
                    disabled={tradeBusy || Boolean(c.auth_user_id)}
                    onClick={() => {
                      void (async () => {
                        setTradeBusy(true)
                        try {
                          await sendTradeActivationEmail(customerId)
                          toast.success('Activation email sent')
                          await loadWorkspace()
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : 'Send failed')
                        } finally {
                          setTradeBusy(false)
                        }
                      })()
                    }}
                  >
                    Send activation email
                  </button>
                </div>
              )}
              {activationToken && (
                <p className="break-all rounded border border-[var(--admin-border)] bg-white px-2 py-1 font-mono text-[10px]">
                  Token (copy once): {activationToken}
                </p>
              )}
              {sourceTags.length > 0 && (
                <p className="text-xs text-[var(--admin-muted)]">
                  Source tags: {sourceTags.join(', ')}
                </p>
              )}
              {policy && (
                <p className="text-xs text-[var(--admin-muted)]">
                  Policy: catalogue {String(policy.can_view_catalogue)} · price {String(policy.can_view_price)} ·
                  purchase {String(policy.can_purchase)} · quote {String(policy.can_request_quote)} · pay later{' '}
                  {String(policy.can_use_pay_later)} · mode {String(policy.commercial_access_mode)}
                </p>
              )}
              {canReassignOwnership && (
                <div className="flex flex-wrap items-end gap-2 border-t border-[var(--admin-border)] pt-3">
                  <div className="min-w-[160px]">
                    <label className={adminLabel}>Set trade access</label>
                    <BrandedSelect
                      value={tradeDraft}
                      onValueChange={setTradeDraft}
                      options={[
                        { value: 'ineligible', label: 'Ineligible' },
                        { value: 'pending', label: 'Pending' },
                        { value: 'approved', label: 'Approved' },
                        { value: 'rejected', label: 'Rejected' },
                        { value: 'suspended', label: 'Suspended' },
                      ]}
                    />
                  </div>
                  <button
                    type="button"
                    className={adminBtnPrimary}
                    disabled={tradeBusy || tradeDraft === tradeStatus}
                    onClick={() => {
                      void (async () => {
                        setTradeBusy(true)
                        try {
                          await setTradeAccess({
                            customerId,
                            status: tradeDraft as
                              | 'ineligible'
                              | 'pending'
                              | 'approved'
                              | 'rejected'
                              | 'suspended',
                            note: tradeNote || undefined,
                          })
                          toast.success('Trade access updated')
                          setTradeNote('')
                          await loadWorkspace()
                          await loadTimeline()
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : 'Update failed')
                        } finally {
                          setTradeBusy(false)
                        }
                      })()
                    }}
                  >
                    Apply trade status
                  </button>
                  <button
                    type="button"
                    className={adminBtnSecondary}
                    disabled={tradeBusy}
                    onClick={() => {
                      void (async () => {
                        setTradeBusy(true)
                        try {
                          await setPayLaterEligibility({
                            customerId,
                            eligible: !payLater,
                            note: tradeNote || undefined,
                          })
                          toast.success(payLater ? 'PAY LATER disabled' : 'PAY LATER enabled')
                          setTradeNote('')
                          await loadWorkspace()
                          await loadTimeline()
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : 'Update failed')
                        } finally {
                          setTradeBusy(false)
                        }
                      })()
                    }}
                  >
                    {payLater ? 'Disable PAY LATER' : 'Enable PAY LATER'}
                  </button>
                  <div className="min-w-[200px] flex-1">
                    <label className={adminLabel}>Decision note</label>
                    <input
                      className={adminInput}
                      value={tradeNote}
                      onChange={(e) => setTradeNote(e.target.value)}
                      disabled={tradeBusy}
                    />
                  </div>
                </div>
              )}
              {history.length > 0 && (
                <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-[var(--admin-muted)]">
                  {history.map((ev) => (
                    <li key={String(ev.id)}>
                      {String(ev.event_type)} · {fmtCrmDate(ev.occurred_at as string | null)} ·{' '}
                      {String(ev.message || '')}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })()}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-4">
          <Panel title="Master fields">
            {mutable ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={adminLabel}>Display name</label>
                    <input className={adminInput} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                  </div>
                  <div>
                    <label className={adminLabel}>StoreName / trading</label>
                    <input className={adminInput} value={tradingName} onChange={(e) => setTradingName(e.target.value)} />
                  </div>
                  <div>
                    <label className={adminLabel}>First name</label>
                    <input className={adminInput} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                  </div>
                  <div>
                    <label className={adminLabel}>Last name</label>
                    <input className={adminInput} value={lastName} onChange={(e) => setLastName(e.target.value)} />
                  </div>
                  <div>
                    <label className={adminLabel}>Email</label>
                    <input className={adminInput} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div>
                    <label className={adminLabel}>Phone</label>
                    <input className={adminInput} value={phone} onChange={(e) => setPhone(e.target.value)} />
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
                  <div>
                    <label className={adminLabel}>Approval</label>
                    <BrandedSelect
                      value={approvalStatus}
                      onValueChange={setApprovalStatus}
                      options={[
                        { value: 'pending', label: 'Pending' },
                        { value: 'approved', label: 'Approved' },
                        { value: 'rejected', label: 'Rejected' },
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
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={taxExempt} onChange={(e) => setTaxExempt(e.target.checked)} />
                  Tax exempt
                </label>
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
                <Field label="Email">{email || '—'}</Field>
                <Field label="Phone">{phone || '—'}</Field>
                <Field label="StoreName">{tradingName || tradingResolve?.display || '—'}</Field>
                <Field label="Type">{customerType || '—'}</Field>
                <Field label="Terms">{paymentTerms || '—'}</Field>
                <Field label="Tax exempt">{taxExempt ? 'Yes' : 'No'}</Field>
              </dl>
            )}
          </Panel>

          <Panel title={`Companies (${companies.length})`}>
            {companies.length === 0 ? (
              <p className="text-sm text-[var(--admin-muted)]">No company links via contacts.</p>
            ) : (
              <ul className="divide-y divide-[var(--admin-border)] text-sm">
                {companies.map((co) => {
                  const companyId = String(co.company_id || co.id)
                  return (
                  <li key={String(co.contact_id || companyId)} className="flex items-center justify-between gap-2 py-2">
                    <Link
                      to="/backend/companies/$companyId"
                      params={{ companyId }}
                      className="font-medium text-[var(--admin-primary)] hover:underline"
                    >
                      {String(co.name || 'Company')}
                    </Link>
                    <span className="text-xs text-[var(--admin-muted)]">
                      {co.is_primary ? 'Primary' : String(co.title || co.role || '')}
                    </span>
                  </li>
                  )
                })}
              </ul>
            )}
          </Panel>

          <Panel title={`Addresses (${addresses.length})`}>
            {addresses.length === 0 ? (
              <p className="text-sm text-[var(--admin-muted)]">No addresses on file.</p>
            ) : (
              <ul className="space-y-2 text-xs leading-relaxed">
                {addresses.map((a) => (
                  <li key={String(a.id)} className="rounded border border-[var(--admin-border)] px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold uppercase text-[var(--admin-muted)]">
                        {String(a.address_type || 'address')}
                        {a.is_default ? ' · default' : ''}
                      </span>
                      {mutable && (
                        <button
                          type="button"
                          className="text-xs text-rose-700 hover:underline"
                          disabled={addrBusy}
                          onClick={() => {
                            void (async () => {
                              setAddrBusy(true)
                              try {
                                await deleteCustomerAddress(customerId, String(a.id))
                                toast.success('Address removed')
                                await loadWorkspace()
                                await loadTimeline()
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : 'Delete failed')
                              } finally {
                                setAddrBusy(false)
                              }
                            })()
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <p className="mt-1 whitespace-pre-line">
                      {[a.address1, a.address2, [a.city, a.postal_code].filter(Boolean).join(' '), a.country]
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
                  Add CRM address
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <BrandedSelect
                    value={addrType}
                    onValueChange={setAddrType}
                    options={[
                      { value: 'shipping', label: 'Shipping' },
                      { value: 'billing', label: 'Billing' },
                      { value: 'other', label: 'Other' },
                    ]}
                  />
                  <input
                    className={adminInput}
                    placeholder="Address line 1"
                    value={addr1}
                    onChange={(e) => setAddr1(e.target.value)}
                  />
                  <input
                    className={adminInput}
                    placeholder="City"
                    value={addrCity}
                    onChange={(e) => setAddrCity(e.target.value)}
                  />
                  <input
                    className={adminInput}
                    placeholder="Postcode"
                    value={addrPostcode}
                    onChange={(e) => setAddrPostcode(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className={adminBtnSecondary}
                  disabled={addrBusy || !addr1.trim()}
                  onClick={() => {
                    void (async () => {
                      setAddrBusy(true)
                      try {
                        await upsertCustomerAddress({
                          customerId,
                          payload: {
                            address_type: addrType,
                            address1: addr1,
                            city: addrCity,
                            postal_code: addrPostcode,
                            country_code: 'GB',
                            is_default: addresses.length === 0,
                          },
                        })
                        toast.success('Address added')
                        setAddr1('')
                        setAddrCity('')
                        setAddrPostcode('')
                        await loadWorkspace()
                        await loadTimeline()
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : 'Save failed')
                      } finally {
                        setAddrBusy(false)
                      }
                    })()
                  }}
                >
                  {addrBusy ? 'Saving…' : 'Add address'}
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

          {tradingResolve?.sources && tradingResolve.sources.length > 0 && (
            <Panel title="StoreName provenance">
              <ul className="space-y-1 text-xs">
                {tradingResolve.sources.map((s, i) => (
                  <li key={`${s.source}-${i}`}>
                    <span className="font-medium text-[var(--admin-muted)]">{s.source}:</span> {s.value}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="Activity">
            <CrmActivityPanel
              items={timeline}
              total={timelineTotal}
              canAddNote={canEdit}
              onAddNote={async (body) => {
                try {
                  await addAdminCrmNote('customer', customerId, body)
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
