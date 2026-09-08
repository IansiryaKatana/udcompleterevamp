import { createFileRoute } from '@tanstack/react-router'
import { AdminSalesHub, SALES_DEFAULT_TAB, SALES_TABS } from '@/admin/sales/AdminSalesHub'
import { createTabSearchSchema } from '@/admin/lib/adminTabSearch'

const salesSearchSchema = createTabSearchSchema(SALES_TABS, SALES_DEFAULT_TAB)

export const Route = createFileRoute('/backend/sales')({
  validateSearch: salesSearchSchema,
  component: SalesPage,
})

function SalesPage() {
  const { tab } = Route.useSearch()
  return <AdminSalesHub tab={tab} />
}
