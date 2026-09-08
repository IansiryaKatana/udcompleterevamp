import { createFileRoute } from '@tanstack/react-router'
import { AdminCutoverControlCentre } from '@/admin/cutover/AdminCutoverControlCentre'

export const Route = createFileRoute('/backend/cutover')({
  component: CutoverPage,
})

function CutoverPage() {
  return <AdminCutoverControlCentre />
}
