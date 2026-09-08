import { createFileRoute } from '@tanstack/react-router'
import { AdminCustomerOperations } from '@/admin/crm/AdminCustomerOperations'

export const Route = createFileRoute('/backend/customers')({
  component: CustomersPage,
})

function CustomersPage() {
  return <AdminCustomerOperations />
}
