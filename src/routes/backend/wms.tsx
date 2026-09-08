import { createFileRoute } from '@tanstack/react-router'
import { AdminWmsOpeningStock } from '@/admin/wms/AdminWmsOpeningStock'

export const Route = createFileRoute('/backend/wms')({
  component: WmsPage,
})

function WmsPage() {
  return <AdminWmsOpeningStock />
}
