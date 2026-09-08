import { createFileRoute } from '@tanstack/react-router'
import { CrmCreateCustomerForm } from '@/admin/crm/CrmCreateCustomerForm'

export const Route = createFileRoute('/backend/customers/new')({
  component: NewCustomerPage,
})

function NewCustomerPage() {
  return <CrmCreateCustomerForm />
}
