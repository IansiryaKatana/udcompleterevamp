import { createFileRoute } from '@tanstack/react-router'
import { AdminStatementsWorkspace } from '@/admin/finance/AdminStatementsWorkspace'

export const Route = createFileRoute('/backend/finance/statements')({
  component: FinanceStatementsPage,
})

function FinanceStatementsPage() {
  return <AdminStatementsWorkspace />
}
