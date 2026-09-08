import { AdminTabHub } from '@/admin/components/AdminTabHub'
import {
  AdminSalesOverviewPanel,
  AdminStaffDirectoryPanel,
  AdminDuplicateCompaniesPanel,
  AdminOwnershipCandidatesPanel,
} from '@/admin/sales/AdminSalesPanels'
import {
  AdminStaffLinksPanel,
  AdminAliasReviewPanel,
  AdminOwnershipApprovalPanel,
  AdminLinkingPanel,
  AdminQualityHubPanel,
  AdminPhase5hOwnershipReadinessPanel,
} from '@/admin/sales/AdminSalesPhase4cPanels'
import { AdminTradeApplicationsPanel, AdminTradeBackfillPanel } from '@/admin/sales/AdminTradePanels'
import {
  AdminAuthLinkPanel,
  AdminActivationWorkspacePanel,
  AdminShadowCutoverPanel,
  AdminCutoverReadinessPanel,
} from '@/admin/sales/AdminAuthCutoverPanels'

const TABS = [
  { id: 'overview', label: 'Overview', content: <AdminSalesOverviewPanel /> },
  { id: 'ownership-readiness', label: 'Ownership readiness', content: <AdminPhase5hOwnershipReadinessPanel /> },
  { id: 'quality', label: 'Data quality', content: <AdminQualityHubPanel /> },
  { id: 'trade', label: 'Trade applications', content: <AdminTradeApplicationsPanel /> },
  { id: 'trade-backfill', label: 'Trade backfill', content: <AdminTradeBackfillPanel /> },
  { id: 'auth-link', label: 'Auth linkage', content: <AdminAuthLinkPanel /> },
  { id: 'activation', label: 'Activation', content: <AdminActivationWorkspacePanel /> },
  { id: 'shadow', label: 'Shadow / cutover', content: <AdminShadowCutoverPanel /> },
  { id: 'cutover', label: 'Cutover readiness', content: <AdminCutoverReadinessPanel /> },
  { id: 'staff', label: 'Staff directory', content: <AdminStaffDirectoryPanel /> },
  { id: 'links', label: 'Staff ↔ admin', content: <AdminStaffLinksPanel /> },
  { id: 'aliases', label: 'Aliases', content: <AdminAliasReviewPanel /> },
  { id: 'approval', label: 'Ownership approval', content: <AdminOwnershipApprovalPanel /> },
  { id: 'linking', label: 'Customer ↔ company', content: <AdminLinkingPanel /> },
  { id: 'duplicates', label: 'Duplicate companies', content: <AdminDuplicateCompaniesPanel /> },
  { id: 'ownership', label: 'Live preview', content: <AdminOwnershipCandidatesPanel /> },
] as const

type TabId = (typeof TABS)[number]['id']

export function AdminSalesHub({ tab }: { tab: TabId }) {
  return (
    <AdminTabHub
      title="Sales operations"
      subtitle="Phase 5H: ownership review & sales cutover readiness — no auto-apply · catalogue_open · no customer contact."
      hubPath="/backend/sales"
      tabs={[...TABS]}
      activeTab={tab}
    />
  )
}

export const SALES_TABS = TABS.map((t) => t.id) as unknown as readonly [TabId, ...TabId[]]
export const SALES_DEFAULT_TAB: TabId = 'overview'
