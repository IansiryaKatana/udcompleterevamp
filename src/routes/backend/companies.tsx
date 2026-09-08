import { createFileRoute } from '@tanstack/react-router'
import { AdminCompanyOperations } from '@/admin/crm/AdminCompanyOperations'

export const Route = createFileRoute('/backend/companies')({
  component: CompaniesPage,
})

function CompaniesPage() {
  return <AdminCompanyOperations />
}
