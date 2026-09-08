import { createFileRoute } from '@tanstack/react-router'
import { AdminCustomerDetail } from '@/admin/crm/AdminCustomerDetail'

export const Route = createFileRoute('/backend/customers/$customerId')({
  component: CustomerDetailPage,
})

function CustomerDetailPage() {
  const { customerId } = Route.useParams()
  return <AdminCustomerDetail customerId={customerId} />
}
