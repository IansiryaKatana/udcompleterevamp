import { createFileRoute } from '@tanstack/react-router'
import { AdminPaymentDetail } from '@/admin/finance/AdminPaymentDetail'

export const Route = createFileRoute('/backend/finance/payments/$paymentId')({
  component: FinancePaymentDetailPage,
})

function FinancePaymentDetailPage() {
  const { paymentId } = Route.useParams()
  return <AdminPaymentDetail paymentId={paymentId} />
}
