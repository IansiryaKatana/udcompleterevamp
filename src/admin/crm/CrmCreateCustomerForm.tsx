import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { createUniqueCustomer, fetchCrmCustomerFilterFacets } from '@/admin/lib/adminRpc'
import { adminBtnPrimary, adminBtnSecondary, adminInput, adminLabel } from '@/admin/adminClassNames'
import { BrandedSelect } from '@/components/ui/BrandedSelect'
import { useAdminAuth } from '@/contexts/AdminAuthContext'

export function CrmCreateCustomerForm() {
  const navigate = useNavigate()
  const { canEdit } = useAdminAuth()
  const [saving, setSaving] = useState(false)
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([])
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [tradingName, setTradingName] = useState('')
  const [customerType, setCustomerType] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [notes, setNotes] = useState('')
  const [spId, setSpId] = useState('')
  const [cgId, setCgId] = useState('')
  const [refId, setRefId] = useState('')

  useEffect(() => {
    void fetchCrmCustomerFilterFacets()
      .then((f) => setStaff(f.staff))
      .catch(() => {})
  }, [])

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!canEdit) {
      toast.error('You do not have edit permission')
      return
    }
    setSaving(true)
    try {
      const res = await createUniqueCustomer({
        first_name: firstName.trim() || undefined,
        last_name: lastName.trim() || undefined,
        display_name: displayName.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        trading_name: tradingName.trim() || undefined,
        customer_type: customerType.trim() || undefined,
        payment_terms: paymentTerms.trim() || undefined,
        notes: notes.trim() || undefined,
        salesperson_id: spId || undefined,
        cg_assigned_id: cgId || undefined,
        referrer_id: refId || undefined,
      })
      toast.success('Customer created')
      void navigate({ to: '/backend/customers/$customerId', params: { customerId: res.customer_id } })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create customer')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-10">
      <div>
        <Link
          to="/backend/customers"
          className="mb-2 inline-flex items-center gap-1 text-sm text-[var(--admin-muted)] hover:text-[var(--admin-primary)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All customers
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">New Unique customer</h1>
        <p className="mt-1 text-sm text-[var(--admin-muted)]">
          Create a CRM person record. Link to a company from the workspace afterwards.
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
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={adminLabel}>First name</label>
            <input
              className={adminInput}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div>
            <label className={adminLabel}>Last name</label>
            <input
              className={adminInput}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={!canEdit}
            />
          </div>
        </div>
        <div>
          <label className={adminLabel}>Display name</label>
          <input
            className={adminInput}
            placeholder="Optional — defaults from first/last"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={!canEdit}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={adminLabel}>Email</label>
            <input
              className={adminInput}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div>
            <label className={adminLabel}>Phone</label>
            <input
              className={adminInput}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={!canEdit}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={adminLabel}>StoreName / trading</label>
            <input
              className={adminInput}
              value={tradingName}
              onChange={(e) => setTradingName(e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div>
            <label className={adminLabel}>Customer type</label>
            <input
              className={adminInput}
              value={customerType}
              onChange={(e) => setCustomerType(e.target.value)}
              disabled={!canEdit}
            />
          </div>
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
            {saving ? 'Creating…' : 'Create customer'}
          </button>
          <Link to="/backend/customers" className={adminBtnSecondary}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
