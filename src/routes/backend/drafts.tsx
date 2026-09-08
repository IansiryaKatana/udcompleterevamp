import { createFileRoute } from '@tanstack/react-router'
import { AdminDraftOperations } from '@/admin/drafts/AdminDraftOperations'

export const Route = createFileRoute('/backend/drafts')({
  component: DraftsPage,
})

function DraftsPage() {
  return <AdminDraftOperations />
}
