import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { postAdminManualPayment } from '@/admin/lib/adminRpc'
import {
  MANUAL_PAYMENT_METHODS,
  financeMoney,
  isFinanceConflict,
  isOverpaymentError,
  newIdempotencyKey,
  type ManualPaymentMethod,
} from '@/admin/lib/financeOps'
import { AdminSheet } from '@/admin/components/AdminSheet'
import { adminInput, adminLabel } from '@/admin/adminClassNames'
import { BrandedSelect } from '@/components/ui/BrandedSelect'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  orderId: string
  orderNumber?: string
  outstanding: number
  currency?: string
  onPosted?: (paymentId: string) => void
}

export function AdminManualPaymentForm({
  open,
  onOpenChange,
  orderId,
  orderNumber,
  outstanding,
  currency = 'GBP',
  onPosted,
}: Props) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<ManualPaymentMethod>('bank_transfer')
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey('pay'))

  useEffect(() => {
    if (open) {
      setAmount(outstanding > 0 ? String(outstanding) : '')
      setMethod('bank_transfer')
      setPaymentDate(new Date().toISOString().slice(0, 10))
      setReference('')
      setNote('')
      setFormError(null)
      setIdempotencyKey(newIdempotencyKey('pay'))
    }
  }, [open, outstanding])

  async function submit() {
    setFormError(null)
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0) {
      setFormError('Enter a payment amount greater than zero.')
      return
    }
    if (n > outstanding + 0.0001) {
      setFormError(`Amount exceeds outstanding (${financeMoney(outstanding, currency)}). Overpayments are not accepted.`)
      return
    }
    if (!paymentDate) {
      setFormError('Payment date is required.')
      return
    }

    setSaving(true)
    try {
      const res = await postAdminManualPayment({
        orderId,
        amount: n,
        method,
        paymentDate,
        reference: reference.trim() || null,
        note: note.trim() || null,
        idempotencyKey,
        expectedOutstanding: outstanding,
      })
      toast.success('Manual payment posted')
      onOpenChange(false)
      onPosted?.(res.payment_id)
    } catch (e) {
      if (isFinanceConflict(e)) {
        setFormError(
          'Outstanding balance changed since this form was opened (conflict). Refresh the order and try again.',
        )
      } else if (isOverpaymentError(e)) {
        setFormError(e instanceof Error ? e.message : 'Overpayment rejected.')
      } else {
        setFormError(e instanceof Error ? e.message : 'Failed to post payment')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdminSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Post manual payment"
      description={
        orderNumber
          ? `Order ${orderNumber} · outstanding ${financeMoney(outstanding, currency)}`
          : `Outstanding ${financeMoney(outstanding, currency)}`
      }
      saveLabel="Confirm payment"
      saving={saving}
      onSave={() => void submit()}
      size="lg"
    >
      <div className="space-y-4">
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Outstanding on confirm:{' '}
          <strong className="tabular-nums">{financeMoney(outstanding, currency)}</strong>
          . Server re-checks outstanding before commit.
        </div>

        {formError && (
          <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
            {formError}
          </div>
        )}

        <div>
          <label className={adminLabel}>Amount received</label>
          <input
            className={adminInput}
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div>
          <label className={adminLabel}>Method</label>
          <BrandedSelect
            value={method}
            onValueChange={(v) => setMethod(v as ManualPaymentMethod)}
            options={MANUAL_PAYMENT_METHODS.map((m) => ({ value: m.value, label: m.label }))}
          />
        </div>

        <div>
          <label className={adminLabel}>Payment date</label>
          <input
            type="date"
            className={adminInput}
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
          />
        </div>

        <div>
          <label className={adminLabel}>Reference</label>
          <input
            className={adminInput}
            placeholder="Bank reference / remittance id"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>

        <div>
          <label className={adminLabel}>Internal note</label>
          <textarea
            className={`${adminInput} min-h-[72px]`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional internal note"
          />
        </div>
      </div>
    </AdminSheet>
  )
}
