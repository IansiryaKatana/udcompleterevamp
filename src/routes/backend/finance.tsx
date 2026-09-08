import { createFileRoute } from '@tanstack/react-router'
import { AdminFinanceDashboard } from '@/admin/finance/AdminFinanceDashboard'

export const Route = createFileRoute('/backend/finance')({
  component: FinancePage,
})

function FinancePage() {
  return <AdminFinanceDashboard />
}
