import { createFileRoute } from '@tanstack/react-router'
import { AdminOrderDetail } from '@/admin/orders/AdminOrderDetail'

export const Route = createFileRoute('/backend/orders/$orderId')({
  component: OrderDetailPage,
})

function OrderDetailPage() {
  const { orderId } = Route.useParams()
  return <AdminOrderDetail orderId={orderId} />
}
