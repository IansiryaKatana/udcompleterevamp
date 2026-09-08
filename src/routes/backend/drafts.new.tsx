import { useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { createUniqueDraft } from '@/admin/lib/adminRpc'
import { adminBtnPrimary, adminBtnSecondary, adminInput, adminLabel } from '@/admin/adminClassNames'
import { DraftCustomerPicker, type DraftCustomerSelection } from '@/admin/drafts/DraftCustomerPicker'
import { useAdminAuth } from '@/contexts/AdminAuthContext'
import { useCms } from '@/contexts/CmsContext'
import { getCurrencyFromSettings } from '@/lib/currency'

export const Route = createFileRoute('/backend/drafts/new')({
  component: NewDraftPage,
})

function NewDraftPage() {
  const navigate = useNavigate()
  const { canEdit } = useAdminAuth()
  const { snapshot } = useCms()
  const currency = getCurrencyFromSettings(snapshot.siteSettings)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [customerSel, setCustomerSel] = useState<DraftCustomerSelection>({
    customerId: null,
    companyId: null,
    email: '',
    phone: '',
    tradingName: '',
    customerType: '',
    label: '',
  })

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!canEdit) {
      toast.error('You do not have edit permission')
      return
    }
    setSaving(true)
    try {
      const res = await createUniqueDraft({
        name: name.trim() || undefined,
        email: email || customerSel.email || undefined,
        phone: customerSel.phone || undefined,
        po_number: poNumber || undefined,
        note: note || undefined,
        customer_id: customerSel.customerId || undefined,
        company_id: customerSel.companyId || undefined,
        trading_name_snapshot: customerSel.tradingName || undefined,
        customer_type_snapshot: customerSel.customerType || undefined,
        payment_terms: customerSel.paymentTerms || undefined,
        salesperson_id: customerSel.salespersonId || undefined,
        cg_assigned_id: customerSel.cgAssignedId || undefined,
        referrer_id: customerSel.referrerId || undefined,
        currency: currency.code || 'GBP',
      })
      toast.success('Unique draft created')
      void navigate({ to: '/backend/drafts/$draftId', params: { draftId: res.draft_id } })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create draft')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-10">
      <div>
        <Link
          to="/backend/drafts"
          className="mb-2 inline-flex items-center gap-1 text-sm text-[var(--admin-muted)] hover:text-[var(--admin-primary)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All drafts
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">New Unique draft</h1>
        <p className="mt-1 text-sm text-[var(--admin-muted)]">
          Create a minimal header, then add wholesale lines on the detail workspace.
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
          <label className={adminLabel}>Draft name</label>
          <input
            className={adminInput}
            placeholder="Optional — auto-generated if blank"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canEdit}
          />
        </div>
        <DraftCustomerPicker
          value={customerSel}
          disabled={!canEdit}
          onChange={(next) => {
            setCustomerSel(next)
            if (next.email) setEmail(next.email)
          }}
        />
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
          <label className={adminLabel}>PO number</label>
          <input
            className={adminInput}
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
            disabled={!canEdit}
          />
        </div>
        <div>
          <label className={adminLabel}>Note</label>
          <textarea
            className={`${adminInput} min-h-[80px]`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={!canEdit}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={adminBtnPrimary} disabled={!canEdit || saving}>
            {saving ? 'Creating…' : 'Create draft'}
          </button>
          <Link to="/backend/drafts" className={adminBtnSecondary}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
