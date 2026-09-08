import { createFileRoute } from '@tanstack/react-router'
import { AdminInvoicesWorkspace } from '@/admin/finance/AdminInvoicesWorkspace'

export const Route = createFileRoute('/backend/finance/invoices')({
  component: FinanceInvoicesPage,
})

function FinanceInvoicesPage() {
  return <AdminInvoicesWorkspace />
}
