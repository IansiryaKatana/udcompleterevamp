import { createFileRoute } from '@tanstack/react-router'
import { AdminRefundsWorkspace } from '@/admin/finance/AdminRefundsWorkspace'

export const Route = createFileRoute('/backend/finance/refunds')({
  component: FinanceRefundsPage,
})

function FinanceRefundsPage() {
  return <AdminRefundsWorkspace />
}
