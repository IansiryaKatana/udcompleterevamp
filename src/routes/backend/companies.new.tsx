import { createFileRoute } from '@tanstack/react-router'
import { CrmCreateCompanyForm } from '@/admin/crm/CrmCreateCompanyForm'

export const Route = createFileRoute('/backend/companies/new')({
  component: NewCompanyPage,
})

function NewCompanyPage() {
  return <CrmCreateCompanyForm />
}
