import type { Database } from '@/integrations/supabase/database.types'
import { isSupabaseConfigured, tryGetSupabase } from '@/integrations/supabase/client'

export type CmsMediaRow = Database['public']['Tables']['cms_media']['Row']
export type CategoryRow = Database['public']['Tables']['categories']['Row']
export type CollectionRow = Database['public']['Tables']['collections']['Row']

type RpcOk<T> = { ok: true } & T
type RpcErr = { ok: false; error: string }

function getClient() {
  if (!isSupabaseConfigured()) throw new Error('Supabase is not configured')
  const supabase = tryGetSupabase()
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

export async function fetchAdminSession() {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_get_admin_session')
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ is_admin: boolean; can_edit: boolean; role: string | null }> | RpcErr
  if (!result?.ok) return { isAdmin: false, canEdit: false, role: null as string | null }
  return {
    isAdmin: Boolean(result.is_admin),
    canEdit: Boolean(result.can_edit),
    role: result.role,
  }
}

export async function fetchAdminEditContext() {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_get_admin_edit_context')
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ categories: CategoryRow[]; collections: CollectionRow[] }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load edit context')
  return {
    categories: result.categories ?? [],
    collections: result.collections ?? [],
  }
}

export async function fetchAdminDashboard() {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_get_admin_dashboard')
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{
    counts: {
      products: number
      collections: number
      unread_quotes?: number
      unread_submissions?: number
      categories?: number
      subscribers?: number
      media: number
      total_sales?: number
      users?: number
    }
    recent_newsletter: Database['public']['Tables']['newsletter_subscribers']['Row'][]
    order_chart?: {
      daily: { label: string; short_label?: string; date?: string; count: number; is_current: boolean }[]
      weekly: { label: string; short_label?: string; date?: string; count: number; is_current: boolean }[]
      monthly: { label: string; year?: number; month?: number; count: number; is_current: boolean }[]
    }
  }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load dashboard')
  return {
    counts: {
      products: Number(result.counts.products ?? 0),
      collections: Number(result.counts.collections ?? 0),
      unreadQuotes: Number(result.counts.unread_quotes ?? 0),
      unreadSubmissions: Number(result.counts.unread_submissions ?? 0),
      media: Number(result.counts.media ?? 0),
      totalSales: Number(result.counts.total_sales ?? result.counts.users ?? 0),
    },
    recentNewsletter: result.recent_newsletter ?? [],
    orderChart: result.order_chart ?? { daily: [], weekly: [], monthly: [] },
  }
}

export async function listCmsMedia(options?: {
  limit?: number
  offset?: number
  kind?: string | null
  search?: string
}) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_list_cms_media', {
    p_limit: options?.limit ?? 48,
    p_offset: options?.offset ?? 0,
    p_kind: options?.kind !== undefined ? options.kind : 'image',
    p_search: options?.search ?? null,
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ items: CmsMediaRow[]; total: number }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load media')
  return { items: result.items ?? [], total: Number(result.total ?? 0) }
}

export async function registerCmsMedia(payload: {
  publicUrl: string
  folder: string
  kind: string
  fileName: string
}) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_register_cms_media', {
    p_public_url: payload.publicUrl,
    p_folder: payload.folder,
    p_kind: payload.kind,
    p_file_name: payload.fileName,
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ media: CmsMediaRow }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to register media')
  return result.media
}

export async function listAdminProducts(options?: { limit?: number; offset?: number; search?: string }) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_list_admin_products', {
    p_limit: options?.limit ?? 20,
    p_offset: options?.offset ?? 0,
    p_search: options?.search ?? null,
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ items: Database['public']['Tables']['products']['Row'][]; total: number }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load products')
  return { items: result.items ?? [], total: Number(result.total ?? 0) }
}

export async function listAdminOrders(options?: { limit?: number; offset?: number; search?: string }) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_list_admin_orders', {
    p_limit: options?.limit ?? 20,
    p_offset: options?.offset ?? 0,
    p_search: options?.search ?? null,
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ items: Database['public']['Tables']['orders']['Row'][]; total: number }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load orders')
  return { items: result.items ?? [], total: Number(result.total ?? 0) }
}

export type AdminOrderListRow = {
  id: string
  order_number: string
  internal_order_number: string
  order_date: string
  email: string
  financial_status: string | null
  commerce_fulfillment_status: string | null
  legacy_fulfillment_status: string | null
  legacy_status: string
  order_source: string | null
  source_app: string | null
  trading_name_snapshot: string | null
  customer_type_snapshot: string | null
  total: number
  total_received: number
  total_outstanding: number
  currency: string
  payment_due_on: string | null
  draft_order_id: string | null
  from_draft: boolean
  customer_id: string | null
  company_id: string | null
  salesperson_id: string | null
  cg_assigned_id: string | null
  referrer_id: string | null
  dpd_delivery_status: string | null
  delivery_status: string | null
  customer_name: string | null
  customer_email: string | null
  company_name: string | null
  salesperson_name: string | null
  cg_name: string | null
  referrer_name: string | null
  item_quantity: number
  line_count: number
  shipping_method: string | null
  has_tracking: boolean
  tags: string[]
}

export async function listAdminOrdersV2(options?: {
  limit?: number
  offset?: number
  sort?: string
  filters?: Record<string, unknown>
}) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_list_admin_orders_v2', {
    p_limit: options?.limit ?? 25,
    p_offset: options?.offset ?? 0,
    p_sort: options?.sort ?? 'date_desc',
    p_filters: options?.filters ?? {},
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ items: AdminOrderListRow[]; total: number }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load orders')
  return { items: result.items ?? [], total: Number(result.total ?? 0) }
}

export async function fetchOrderFilterFacets() {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_admin_order_filter_facets')
  if (error) throw new Error(error.message)
  const result = data as
    | RpcOk<{
        financial_statuses: string[]
        fulfillment_statuses: string[]
        order_sources: string[]
        customer_types: string[]
        delivery_statuses: string[]
        staff: { id: string; name: string }[]
      }>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load facets')
  return {
    financialStatuses: result.financial_statuses ?? [],
    fulfillmentStatuses: result.fulfillment_statuses ?? [],
    orderSources: result.order_sources ?? [],
    customerTypes: result.customer_types ?? [],
    deliveryStatuses: result.delivery_statuses ?? [],
    staff: result.staff ?? [],
  }
}

export async function getAdminOrderWorkspace(orderId: string) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_get_admin_order_workspace', { p_order_id: orderId })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load order')
  return result
}

export async function listAdminOrderItems(options: {
  orderId: string
  limit?: number
  offset?: number
  search?: string
}) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_list_admin_order_items', {
    p_order_id: options.orderId,
    p_limit: options.limit ?? 50,
    p_offset: options.offset ?? 0,
    p_search: options.search ?? null,
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ items: Record<string, unknown>[]; total: number }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load line items')
  return { items: result.items ?? [], total: Number(result.total ?? 0) }
}

export async function listAdminOrderPayments(orderId: string) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_list_admin_order_payments', { p_order_id: orderId })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ transactions: Record<string, unknown>[]; refunds: Record<string, unknown>[] }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load payments')
  return { transactions: result.transactions ?? [], refunds: result.refunds ?? [] }
}

export async function listAdminOrderFulfillments(orderId: string) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_list_admin_order_fulfillments', { p_order_id: orderId })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ fulfillments: Record<string, unknown>[] }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load fulfillments')
  return { fulfillments: result.fulfillments ?? [] }
}

export async function listAdminOrderTimeline(options: { orderId: string; limit?: number; offset?: number }) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_list_admin_order_timeline', {
    p_order_id: options.orderId,
    p_limit: options.limit ?? 50,
    p_offset: options.offset ?? 0,
  })
  if (error) throw new Error(error.message)
  const result = data as
    | RpcOk<{ events: Record<string, unknown>[]; total: number; comments: Record<string, unknown>[] }>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load timeline')
  return {
    events: result.events ?? [],
    total: Number(result.total ?? 0),
    comments: result.comments ?? [],
  }
}

export async function addAdminOrderComment(orderId: string, body: string) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_admin_add_order_comment', {
    p_order_id: orderId,
    p_body: body,
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ id: string }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to add note')
  return result
}

export async function updateAdminOrderOps(orderId: string, patch: Record<string, unknown>) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_admin_update_order_ops', {
    p_order_id: orderId,
    p_patch: patch,
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ changed: boolean; changes?: Record<string, unknown> }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to update order')
  return result
}
