import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { createUniqueCompany, fetchCrmCompanyFilterFacets } from '@/admin/lib/adminRpc'
import { adminBtnPrimary, adminBtnSecondary, adminInput, adminLabel } from '@/admin/adminClassNames'
import { BrandedSelect } from '@/components/ui/BrandedSelect'
import { useAdminAuth } from '@/contexts/AdminAuthContext'

export function CrmCreateCompanyForm() {
  const navigate = useNavigate()
  const { canEdit } = useAdminAuth()
  const [saving, setSaving] = useState(false)
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([])
  const [name, setName] = useState('')
  const [tradingName, setTradingName] = useState('')
  const [legalName, setLegalName] = useState('')
  const [vatNumber, setVatNumber] = useState('')
  const [companyNumber, setCompanyNumber] = useState('')
  const [customerType, setCustomerType] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [notes, setNotes] = useState('')
  const [spId, setSpId] = useState('')
  const [cgId, setCgId] = useState('')
  const [refId, setRefId] = useState('')

  useEffect(() => {
    void fetchCrmCompanyFilterFacets()
      .then((f) => setStaff(f.staff))
      .catch(() => {})
  }, [])

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!canEdit) {
      toast.error('You do not have edit permission')
      return
    }
    if (!name.trim()) {
      toast.error('Company name is required')
      return
    }
    setSaving(true)
    try {
      const res = await createUniqueCompany({
        name: name.trim(),
        trading_name: tradingName.trim() || undefined,
        legal_name: legalName.trim() || undefined,
        vat_number: vatNumber.trim() || undefined,
        company_number: companyNumber.trim() || undefined,
        customer_type: customerType.trim() || undefined,
        payment_terms: paymentTerms.trim() || undefined,
        notes: notes.trim() || undefined,
        salesperson_id: spId || undefined,
        cg_assigned_id: cgId || undefined,
        referrer_id: refId || undefined,
      })
      toast.success('Company created')
      void navigate({ to: '/backend/companies/$companyId', params: { companyId: res.company_id } })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create company')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-10">
      <div>
        <Link
          to="/backend/companies"
          className="mb-2 inline-flex items-center gap-1 text-sm text-[var(--admin-muted)] hover:text-[var(--admin-primary)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All companies
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">New Unique company</h1>
        <p className="mt-1 text-sm text-[var(--admin-muted)]">
          Create a B2B trade account. Add contacts from the company workspace.
        </p>
      </div>

      {!canEdit && (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Viewer role — create is disabled. Server still enforces mutate permissions.
        </p>
      )}

      <form
        onSubmit={(e) => void onCreate(e)}
        className="space-y-4 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white p-4"
      >
        <div>
          <label className={adminLabel}>Company name *</label>
          <input
            className={adminInput}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canEdit}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={adminLabel}>Trading name</label>
            <input
              className={adminInput}
              value={tradingName}
              onChange={(e) => setTradingName(e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div>
            <label className={adminLabel}>Legal name</label>
            <input
              className={adminInput}
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              disabled={!canEdit}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={adminLabel}>VAT number</label>
            <input
              className={adminInput}
              value={vatNumber}
              onChange={(e) => setVatNumber(e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div>
            <label className={adminLabel}>Company number</label>
            <input
              className={adminInput}
              value={companyNumber}
              onChange={(e) => setCompanyNumber(e.target.value)}
              disabled={!canEdit}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={adminLabel}>Customer type</label>
            <input
              className={adminInput}
              value={customerType}
              onChange={(e) => setCustomerType(e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div>
            <label className={adminLabel}>Payment terms</label>
            <input
              className={adminInput}
              placeholder="e.g. Net 30"
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              disabled={!canEdit}
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
              disabled={!canEdit}
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
              disabled={!canEdit}
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
              disabled={!canEdit}
            />
          </div>
        </div>
        <div>
          <label className={adminLabel}>Notes</label>
          <textarea
            className={`${adminInput} min-h-[80px]`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={!canEdit}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={adminBtnPrimary} disabled={!canEdit || saving}>
            {saving ? 'Creating…' : 'Create company'}
          </button>
          <Link to="/backend/companies" className={adminBtnSecondary}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
