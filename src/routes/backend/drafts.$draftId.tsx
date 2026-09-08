import { createFileRoute } from '@tanstack/react-router'
import { AdminDraftDetail } from '@/admin/drafts/AdminDraftDetail'

export const Route = createFileRoute('/backend/drafts/$draftId')({
  component: DraftDetailPage,
})

function DraftDetailPage() {
  const { draftId } = Route.useParams()
  return <AdminDraftDetail draftId={draftId} />
}
