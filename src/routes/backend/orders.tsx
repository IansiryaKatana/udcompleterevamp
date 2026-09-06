import { createFileRoute } from '@tanstack/react-router'
import { AdminOrderOperations } from '@/admin/orders/AdminOrderOperations'

export const Route = createFileRoute('/backend/orders')({
  component: OrdersPage,
})

function OrdersPage() {
  return <AdminOrderOperations />
}
