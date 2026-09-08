import { createFileRoute } from '@tanstack/react-router'
import { AdminPaymentLedger } from '@/admin/finance/AdminPaymentLedger'

export const Route = createFileRoute('/backend/finance/payments')({
  component: FinancePaymentsPage,
})

function FinancePaymentsPage() {
  return <AdminPaymentLedger />
}
