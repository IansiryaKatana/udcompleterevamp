import { createFileRoute } from '@tanstack/react-router'
import { AdminFulfilmentOperations } from '@/admin/fulfilment/AdminFulfilmentOperations'

export const Route = createFileRoute('/backend/fulfilment')({
  component: FulfilmentPage,
})

function FulfilmentPage() {
  return <AdminFulfilmentOperations />
}
