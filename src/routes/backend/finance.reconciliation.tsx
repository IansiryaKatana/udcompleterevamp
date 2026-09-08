import { createFileRoute } from '@tanstack/react-router'
import { AdminFinanceReconciliation } from '@/admin/finance/AdminFinanceReconciliation'

export const Route = createFileRoute('/backend/finance/reconciliation')({
  component: FinanceReconciliationPage,
})

function FinanceReconciliationPage() {
  return <AdminFinanceReconciliation />
}
