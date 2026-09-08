import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  fetchCrmDefaultsForDraft,
  searchAdminCustomersCompanies,
  type AdminCompanySearchHit,
  type AdminCustomerSearchHit,
} from '@/admin/lib/adminRpc'
import { adminInput, adminLabel } from '@/admin/adminClassNames'
import { cn } from '@/lib/utils'

export type DraftCustomerSelection = {
  customerId: string | null
  companyId: string | null
  email: string
  phone: string
  tradingName: string
  customerType: string
  label: string
  salespersonId?: string | null
  cgAssignedId?: string | null
  referrerId?: string | null
  paymentTerms?: string
}

type Props = {
  value: DraftCustomerSelection
  disabled?: boolean
  onChange: (next: DraftCustomerSelection) => void
}

async function enrichWithCrmDefaults(
  base: DraftCustomerSelection,
): Promise<DraftCustomerSelection> {
  if (!base.customerId && !base.companyId) return base
  try {
    const defaults = await fetchCrmDefaultsForDraft({
      customerId: base.customerId,
      companyId: base.companyId,
    })
    return {
      ...base,
      email: defaults.email || base.email,
      phone: defaults.phone || base.phone,
      tradingName: defaults.trading_name || base.tradingName,
      customerType: defaults.customer_type || base.customerType,
      paymentTerms: defaults.payment_terms || base.paymentTerms || '',
      salespersonId: defaults.salesperson_id || base.salespersonId || null,
      cgAssignedId: defaults.cg_assigned_id || base.cgAssignedId || null,
      referrerId: defaults.referrer_id || base.referrerId || null,
    }
  } catch {
    // Defaults RPC may be unavailable until migration 057; keep picker selection.
    return base
  }
}

export function DraftCustomerPicker({ value, disabled, onChange }: Props) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [customers, setCustomers] = useState<AdminCustomerSearchHit[]>([])
  const [companies, setCompanies] = useState<AdminCompanySearchHit[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 250)
    return () => window.clearTimeout(t)
  }, [query])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    void searchAdminCustomersCompanies({ search: debounced || undefined, limit: 20 })
      .then((res) => {
        if (cancelled) return
        setCustomers(res.customers)
        setCompanies(res.companies)
      })
      .catch((e) => {
        if (!cancelled) toast.error(e instanceof Error ? e.message : 'Search failed')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debounced, open])

  async function pickCustomer(c: AdminCustomerSearchHit) {
    const base: DraftCustomerSelection = {
      customerId: c.id,
      companyId: value.companyId,
      email: c.email || value.email,
      phone: c.phone || value.phone,
      tradingName: c.trading_name || value.tradingName,
      customerType: c.customer_type || value.customerType,
      label: c.display_name || c.email || 'Customer',
      salespersonId: value.salespersonId ?? null,
      cgAssignedId: value.cgAssignedId ?? null,
      referrerId: value.referrerId ?? null,
      paymentTerms: value.paymentTerms ?? '',
    }
    setOpen(false)
    setQuery('')
    onChange(await enrichWithCrmDefaults(base))
  }

  async function pickCompany(c: AdminCompanySearchHit) {
    const base: DraftCustomerSelection = {
      customerId: value.customerId,
      companyId: c.id,
      email: c.email || value.email,
      phone: c.phone || value.phone,
      tradingName: c.trading_name || c.name || value.tradingName,
      customerType: c.customer_type || value.customerType,
      label: value.label || c.name,
      salespersonId: value.salespersonId ?? null,
      cgAssignedId: value.cgAssignedId ?? null,
      referrerId: value.referrerId ?? null,
      paymentTerms: value.paymentTerms ?? '',
    }
    setOpen(false)
    setQuery('')
    onChange(await enrichWithCrmDefaults(base))
  }

  function clearAll() {
    onChange({
      customerId: null,
      companyId: null,
      email: '',
      phone: '',
      tradingName: '',
      customerType: '',
      label: '',
      salespersonId: null,
      cgAssignedId: null,
      referrerId: null,
      paymentTerms: '',
    })
  }

  return (
    <div className="space-y-2">
      <label className={adminLabel}>Customer / company</label>
      {value.customerId || value.companyId ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm">
          <div className="min-w-0">
            <div className="font-medium">{value.label || 'Selected'}</div>
            <div className="text-xs text-[var(--admin-muted)]">
              {value.companyId ? 'Company linked' : 'Customer linked'}
              {value.email ? ` · ${value.email}` : ''}
              {value.paymentTerms ? ` · ${value.paymentTerms}` : ''}
            </div>
          </div>
          {!disabled && (
            <button
              type="button"
              className="text-xs font-medium text-[var(--admin-primary)] hover:underline"
              onClick={clearAll}
            >
              Clear
            </button>
          )}
        </div>
      ) : null}
      {!disabled && (
        <div className="relative">
          <input
            className={adminInput}
            placeholder="Search customers or companies…"
            value={query}
            disabled={disabled}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
          />
          {open && (
            <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded border border-[var(--admin-border)] bg-white shadow-lg">
              {loading && <p className="px-3 py-2 text-xs text-[var(--admin-muted)]">Searching…</p>}
              {!loading && customers.length === 0 && companies.length === 0 && (
                <p className="px-3 py-2 text-xs text-[var(--admin-muted)]">No matches</p>
              )}
              {customers.length > 0 && (
                <div>
                  <p className="bg-[var(--admin-surface)] px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-muted)]">
                    Customers
                  </p>
                  {customers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={cn(
                        'flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-[var(--admin-primary)]/[0.06]',
                      )}
                      onClick={() => void pickCustomer(c)}
                    >
                      <span className="font-medium">{c.display_name || c.email || 'Customer'}</span>
                      <span className="text-xs text-[var(--admin-muted)]">
                        {[c.email, c.trading_name, c.customer_type].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {companies.length > 0 && (
                <div>
                  <p className="bg-[var(--admin-surface)] px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-muted)]">
                    Companies
                  </p>
                  {companies.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-[var(--admin-primary)]/[0.06]"
                      onClick={() => void pickCompany(c)}
                    >
                      <span className="font-medium">{c.name}</span>
                      <span className="text-xs text-[var(--admin-muted)]">
                        {[c.email, c.trading_name, c.customer_type].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
