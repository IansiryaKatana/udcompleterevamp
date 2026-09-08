import { createFileRoute } from '@tanstack/react-router'
import { AdminInvoiceDetail } from '@/admin/finance/AdminInvoiceDetail'

export const Route = createFileRoute('/backend/finance/invoices/$invoiceId')({
  component: FinanceInvoiceDetailPage,
})

function FinanceInvoiceDetailPage() {
  const { invoiceId } = Route.useParams()
  return <AdminInvoiceDetail invoiceId={invoiceId} />
}
