import { AdminTabHub } from '@/admin/components/AdminTabHub'
import { AdminSiteSettings } from '@/admin/AdminSiteSettings'
import { AdminUsers } from '@/admin/AdminUsers'
import { AdminDataTransfer } from '@/admin/AdminDataTransfer'

const TABS = [
  { id: 'site-settings', label: 'Site Settings', content: <AdminSiteSettings /> },
  { id: 'users', label: 'Users', content: <AdminUsers /> },
  { id: 'data-transfer', label: 'Import / Export', content: <AdminDataTransfer /> },
] as const

type TabId = (typeof TABS)[number]['id']

export function AdminSettingsHub({ tab }: { tab: TabId }) {
  return (
    <AdminTabHub
      title="Settings"
      subtitle="Store configuration, branding, admin users, and data transfer."
      hubPath="/backend/settings"
      tabs={[...TABS]}
      activeTab={tab}
    />
  )
}

export const SETTINGS_TABS = TABS.map((t) => t.id) as unknown as readonly [TabId, ...TabId[]]
export const SETTINGS_DEFAULT_TAB: TabId = 'site-settings'
