import { AdminTabHub } from '@/admin/components/AdminTabHub'
import { AdminOrders } from '@/admin/AdminOrders'
import { AdminCoupons } from '@/admin/AdminCoupons'
import { AdminCustomers } from '@/admin/AdminCustomers'
import { AdminCheckout } from '@/admin/AdminCheckout'
import { AdminIntegrations } from '@/admin/AdminIntegrations'

const TABS = [
  { id: 'orders', label: 'Orders', content: <AdminOrders embedded /> },
  { id: 'customers', label: 'Customers', content: <AdminCustomers /> },
  { id: 'coupons', label: 'Coupons', content: <AdminCoupons /> },
  { id: 'checkout', label: 'Checkout', content: <AdminCheckout /> },
  { id: 'integrations', label: 'Integrations', content: <AdminIntegrations /> },
] as const

type TabId = (typeof TABS)[number]['id']

export function AdminCommerceHub({ tab }: { tab: TabId }) {
  return (
    <AdminTabHub
      title="Commerce"
      subtitle="Orders workspace, checkout settings, and payment integrations."
      hubPath="/backend/commerce"
      tabs={[...TABS]}
      activeTab={tab}
    />
  )
}

export const COMMERCE_TABS = TABS.map((t) => t.id) as unknown as readonly [TabId, ...TabId[]]
export const COMMERCE_DEFAULT_TAB: TabId = 'orders'
