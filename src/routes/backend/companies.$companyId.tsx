import { createFileRoute } from '@tanstack/react-router'
import { AdminCompanyDetail } from '@/admin/crm/AdminCompanyDetail'

export const Route = createFileRoute('/backend/companies/$companyId')({
  component: CompanyDetailPage,
})

function CompanyDetailPage() {
  const { companyId } = Route.useParams()
  return <AdminCompanyDetail companyId={companyId} />
}
