import { createFileRoute } from '@tanstack/react-router'
import { AdminArReceivables } from '@/admin/finance/AdminArReceivables'

export const Route = createFileRoute('/backend/finance/receivables')({
  component: FinanceReceivablesPage,
})

function FinanceReceivablesPage() {
  return <AdminArReceivables />
}
