import type { Database, Json } from '@/integrations/supabase/database.types'
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
  const result = data as
    | RpcOk<{
        is_admin: boolean
        can_edit: boolean
        role: string | null
        staff_member_id?: string | null
        sales_visibility?: string | null
        can_view_all_sales?: boolean
        can_reassign_ownership?: boolean
      }>
    | RpcErr
  if (!result?.ok) {
    return {
      isAdmin: false,
      canEdit: false,
      role: null as string | null,
      staffMemberId: null as string | null,
      salesVisibility: null as string | null,
      canViewAllSales: false,
      canReassignOwnership: false,
    }
  }
  return {
    isAdmin: Boolean(result.is_admin),
    canEdit: Boolean(result.can_edit),
    role: result.role,
    staffMemberId: (result.staff_member_id as string | null) ?? null,
    salesVisibility: (result.sales_visibility as string | null) ?? null,
    canViewAllSales: Boolean(result.can_view_all_sales),
    canReassignOwnership: Boolean(result.can_reassign_ownership),
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

// ── Draft order operations (Phase 2B) ────────────────────────────────────────

export type AdminDraftListRow = {
  id: string
  name: string | null
  status: string
  email: string | null
  phone: string | null
  po_number: string | null
  currency: string
  subtotal: number
  total_tax: number
  total_shipping: number
  total_discounts: number
  total_price: number
  source_system: string | null
  trading_name_snapshot: string | null
  customer_type_snapshot: string | null
  payment_due_on: string | null
  payment_terms: string | null
  tax_exempt: boolean
  version: number
  customer_id: string | null
  company_id: string | null
  salesperson_id: string | null
  cg_assigned_id: string | null
  referrer_id: string | null
  converted_order_id: string | null
  completed_at: string | null
  draft_date: string
  created_at: string
  updated_at: string
  customer_name: string | null
  customer_email: string | null
  company_name: string | null
  salesperson_name: string | null
  cg_name: string | null
  referrer_name: string | null
  converted_order_number: string | null
  line_count: number
  item_quantity: number
  tags: string[]
}

export type AdminDraftLinePayload = {
  title: string
  quantity?: number
  original_unit_price?: number | string
  discounted_unit_price?: number | string
  product_id?: string | null
  variant_id?: string | null
  variant_title?: string | null
  sku_snapshot?: string | null
  sku?: string | null
  taxable?: boolean
  custom_attributes?: unknown
  tax_lines?: unknown
  deleted_product?: boolean
}

export type AdminCatalogVariantHit = {
  id: string
  product_id: string
  name: string
  sku: string | null
  price: number | null
  inventory_count: number | null
  product_name: string
  product_slug: string | null
  image_url: string | null
}

export type AdminCustomerSearchHit = {
  id: string
  display_name: string | null
  email: string | null
  phone: string | null
  trading_name: string | null
  customer_type: string | null
  company_name_snapshot: string | null
}

export type AdminCompanySearchHit = {
  id: string
  name: string
  trading_name: string | null
  customer_type: string | null
  email: string | null
  phone: string | null
}

type DraftConflictErr = RpcErr & { current_version?: number }

function throwDraftRpc(result: RpcErr | DraftConflictErr, fallback: string): never {
  if (result.error === 'conflict') throw new Error('conflict')
  throw new Error(result.error ?? fallback)
}

export async function fetchDraftFilterFacets() {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_admin_draft_filter_facets')
  if (error) throw new Error(error.message)
  const result = data as
    | RpcOk<{
        statuses: string[]
        source_systems: string[]
        customer_types: string[]
        payment_terms: string[]
        staff: { id: string; name: string }[]
      }>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load draft facets')
  return {
    statuses: result.statuses ?? [],
    sourceSystems: result.source_systems ?? [],
    customerTypes: result.customer_types ?? [],
    paymentTerms: result.payment_terms ?? [],
    staff: result.staff ?? [],
  }
}

export async function listAdminDrafts(options?: {
  limit?: number
  offset?: number
  sort?: string
  filters?: Record<string, unknown>
}) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_list_admin_drafts', {
    p_limit: options?.limit ?? 25,
    p_offset: options?.offset ?? 0,
    p_sort: options?.sort ?? 'date_desc',
    p_filters: options?.filters ?? {},
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ items: AdminDraftListRow[]; total: number }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load drafts')
  return { items: result.items ?? [], total: Number(result.total ?? 0) }
}

export async function getAdminDraftWorkspace(draftId: string) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_get_admin_draft_workspace', {
    p_draft_id: draftId,
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load draft')
  return result
}

export async function listAdminDraftLines(options: {
  draftId: string
  limit?: number
  offset?: number
  search?: string
}) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_list_admin_draft_lines', {
    p_draft_id: options.draftId,
    p_limit: options.limit ?? 50,
    p_offset: options.offset ?? 0,
    p_search: options.search ?? null,
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ items: Record<string, unknown>[]; total: number }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load draft lines')
  return { items: result.items ?? [], total: Number(result.total ?? 0) }
}

/** Load every draft line via pagination (safe for replace-all saves). */
export async function listAllAdminDraftLines(draftId: string, pageSize = 200) {
  const all: Record<string, unknown>[] = []
  let offset = 0
  let total = Infinity
  const lim = Math.min(Math.max(pageSize, 50), 500)
  while (offset < total) {
    const page = await listAdminDraftLines({ draftId, limit: lim, offset })
    total = page.total
    all.push(...page.items)
    if (page.items.length === 0) break
    offset += page.items.length
  }
  return { items: all, total: all.length }
}

export async function listAdminDraftTimeline(options: {
  draftId: string
  limit?: number
  offset?: number
}) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_list_admin_draft_timeline', {
    p_draft_id: options.draftId,
    p_limit: options.limit ?? 50,
    p_offset: options.offset ?? 0,
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ items: Record<string, unknown>[]; total: number }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load draft timeline')
  return { items: result.items ?? [], total: Number(result.total ?? 0) }
}

export async function addAdminDraftNote(draftId: string, body: string) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_admin_add_draft_note', {
    p_draft_id: draftId,
    p_body: body,
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ id: string }> | RpcErr
  if (!result?.ok) throwDraftRpc(result, 'Failed to add draft note')
  return result
}

export async function searchAdminCustomersCompanies(options?: { search?: string; limit?: number }) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_admin_search_customers_companies', {
    p_search: options?.search ?? null,
    p_limit: options?.limit ?? 20,
  })
  if (error) throw new Error(error.message)
  const result = data as
    | RpcOk<{ customers: AdminCustomerSearchHit[]; companies: AdminCompanySearchHit[] }>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to search customers')
  return {
    customers: result.customers ?? [],
    companies: result.companies ?? [],
  }
}

export async function searchAdminCatalogVariants(options?: { search?: string; limit?: number }) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_admin_search_catalog_variants', {
    p_search: options?.search ?? null,
    p_limit: options?.limit ?? 25,
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ items: AdminCatalogVariantHit[] }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to search catalog')
  return { items: result.items ?? [] }
}

export async function createUniqueDraft(payload: Record<string, unknown> = {}) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_admin_create_unique_draft', {
    p_payload: payload as Json,
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ draft_id: string; version: number }> | RpcErr
  if (!result?.ok) throwDraftRpc(result, 'Failed to create draft')
  return result
}

export async function updateUniqueDraft(
  draftId: string,
  expectedVersion: number,
  payload: Record<string, unknown>,
) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_admin_update_unique_draft', {
    p_draft_id: draftId,
    p_expected_version: expectedVersion,
    p_payload: payload as Json,
  })
  if (error) throw new Error(error.message)
  const result = data as
    | RpcOk<{
        draft_id: string
        version: number
        changes: Record<string, unknown>
        totals: Record<string, unknown>
      }>
    | DraftConflictErr
  if (!result?.ok) throwDraftRpc(result, 'Failed to update draft')
  return result
}

export async function replaceUniqueDraftLines(
  draftId: string,
  expectedVersion: number,
  lines: AdminDraftLinePayload[],
  knownLineCount: number,
) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_admin_replace_unique_draft_lines', {
    p_draft_id: draftId,
    p_expected_version: expectedVersion,
    p_lines: lines as unknown as Json,
    p_known_line_count: knownLineCount,
  })
  if (error) throw new Error(error.message)
  const result = data as
    | RpcOk<{
        draft_id: string
        version: number
        line_count: number
        totals: Record<string, unknown>
      }>
    | DraftConflictErr
    | RpcErr
  if (!result?.ok) throwDraftRpc(result, 'Failed to replace draft lines')
  return result
}

export async function duplicateDraftAsUnique(sourceDraftId: string) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_admin_duplicate_draft_as_unique', {
    p_source_draft_id: sourceDraftId,
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ draft_id: string; version: number; name: string }> | RpcErr
  if (!result?.ok) throwDraftRpc(result, 'Failed to duplicate draft')
  return result
}

export async function convertUniqueDraft(draftId: string, expectedVersion: number) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_admin_convert_unique_draft', {
    p_draft_id: draftId,
    p_expected_version: expectedVersion,
  })
  if (error) throw new Error(error.message)
  const result = data as
    | RpcOk<{
        order_id: string
        order_number: string
        draft_version?: number
        idempotent?: boolean
      }>
    | DraftConflictErr
  if (!result?.ok) throwDraftRpc(result, 'Failed to convert draft')
  return result
}

// ── CRM operations (Phase 2C) ────────────────────────────────────────────────

export type AdminCrmCustomerListRow = {
  id: string
  display_name: string | null
  email: string | null
  phone: string | null
  first_name: string | null
  last_name: string | null
  trading_name: string | null
  company_name_snapshot: string | null
  customer_type: string | null
  status: string | null
  approval_status: string | null
  source_system: string | null
  payment_terms: string | null
  version: number
  salesperson_id: string | null
  cg_assigned_id: string | null
  referrer_id: string | null
  salesperson_name: string | null
  cg_name: string | null
  referrer_name: string | null
  companies?: { id: string; name: string }[] | null
  primary_company_id?: string | null
  primary_company_name?: string | null
  company_count?: number
  order_count: number
  lifetime_total: number
  total_received: number
  total_outstanding: number
  open_draft_count: number
  open_draft_value: number
  last_order_at: string | null
  first_order_at: string | null
  created_at: string
  updated_at: string
  tags: string[]
  [key: string]: unknown
}

export type AdminCrmCompanyListRow = {
  id: string
  name: string
  trading_name: string | null
  legal_name: string | null
  customer_type: string | null
  status: string | null
  source_system: string | null
  payment_terms: string | null
  version: number
  salesperson_id: string | null
  cg_assigned_id: string | null
  referrer_id: string | null
  salesperson_name: string | null
  cg_name: string | null
  referrer_name: string | null
  contact_count: number
  location_count: number
  order_count: number
  lifetime_total: number
  total_received: number
  total_outstanding: number
  open_draft_count: number
  open_draft_value: number
  last_order_at: string | null
  first_order_at: string | null
  created_at: string
  updated_at: string
  tags: string[]
  [key: string]: unknown
}

export type AdminCrmDraftDefaults = {
  salesperson_id: string | null
  cg_assigned_id: string | null
  referrer_id: string | null
  payment_terms: string | null
  trading_name: string | null
  customer_type: string | null
  email: string | null
  phone: string | null
  addresses?: Record<string, unknown>[]
  [key: string]: unknown
}

type CrmConflictErr = RpcErr & { current_version?: number }

function throwCrmRpc(result: RpcErr | CrmConflictErr, fallback: string): never {
  if (result.error === 'conflict') throw new Error('conflict')
  throw new Error(result.error ?? fallback)
}

export async function fetchCrmCustomerFilterFacets() {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_admin_crm_customer_filter_facets')
  if (error) throw new Error(error.message)
  const result = data as
    | RpcOk<{
        customer_types: string[]
        statuses: string[]
        approval_statuses?: string[]
        source_systems: string[]
        payment_terms: string[]
        staff: { id: string; name: string }[]
        tags?: string[]
      }>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load customer facets')
  return {
    customerTypes: result.customer_types ?? [],
    statuses: result.statuses ?? [],
    approvalStatuses: result.approval_statuses ?? [],
    sourceSystems: result.source_systems ?? [],
    paymentTerms: result.payment_terms ?? [],
    staff: result.staff ?? [],
    tags: result.tags ?? [],
  }
}

export async function listAdminCrmCustomers(options?: {
  limit?: number
  offset?: number
  sort?: string
  filters?: Record<string, unknown>
}) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_list_admin_crm_customers', {
    p_limit: options?.limit ?? 25,
    p_offset: options?.offset ?? 0,
    p_sort: options?.sort ?? 'name_asc',
    p_filters: options?.filters ?? {},
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ items: AdminCrmCustomerListRow[]; total: number }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load customers')
  return { items: result.items ?? [], total: Number(result.total ?? 0) }
}

export async function fetchCrmCompanyFilterFacets() {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_admin_crm_company_filter_facets')
  if (error) throw new Error(error.message)
  const result = data as
    | RpcOk<{
        customer_types: string[]
        statuses: string[]
        source_systems: string[]
        payment_terms: string[]
        staff: { id: string; name: string }[]
      }>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load company facets')
  return {
    customerTypes: result.customer_types ?? [],
    statuses: result.statuses ?? [],
    sourceSystems: result.source_systems ?? [],
    paymentTerms: result.payment_terms ?? [],
    staff: result.staff ?? [],
  }
}

export async function listAdminCrmCompanies(options?: {
  limit?: number
  offset?: number
  sort?: string
  filters?: Record<string, unknown>
}) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_list_admin_crm_companies', {
    p_limit: options?.limit ?? 25,
    p_offset: options?.offset ?? 0,
    p_sort: options?.sort ?? 'name_asc',
    p_filters: options?.filters ?? {},
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ items: AdminCrmCompanyListRow[]; total: number }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load companies')
  return { items: result.items ?? [], total: Number(result.total ?? 0) }
}

export async function getAdminCustomerWorkspace(customerId: string) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_get_admin_customer_workspace', {
    p_customer_id: customerId,
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load customer')
  return result
}

export async function getAdminCompanyWorkspace(companyId: string) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_get_admin_company_workspace', {
    p_company_id: companyId,
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load company')
  return result
}

export async function listAdminCrmTimeline(options: {
  entityType: 'customer' | 'company'
  entityId: string
  limit?: number
  offset?: number
}) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_list_admin_crm_timeline', {
    p_entity_type: options.entityType,
    p_entity_id: options.entityId,
    p_limit: options.limit ?? 50,
    p_offset: options.offset ?? 0,
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ items: Record<string, unknown>[]; total: number }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load CRM timeline')
  return { items: result.items ?? [], total: Number(result.total ?? 0) }
}

export async function addAdminCrmNote(
  entityType: 'customer' | 'company',
  entityId: string,
  body: string,
) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_admin_add_crm_note', {
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_body: body,
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ id: string }> | RpcErr
  if (!result?.ok) throwCrmRpc(result, 'Failed to add CRM note')
  return result
}

export async function createUniqueCustomer(payload: Record<string, unknown> = {}) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_admin_create_unique_customer', {
    p_payload: payload as Json,
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ customer_id: string; version: number }> | RpcErr
  if (!result?.ok) throwCrmRpc(result, 'Failed to create customer')
  return result
}

export async function updateUniqueCustomer(
  customerId: string,
  expectedVersion: number,
  payload: Record<string, unknown>,
) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_admin_update_unique_customer', {
    p_customer_id: customerId,
    p_expected_version: expectedVersion,
    p_payload: payload as Json,
  })
  if (error) throw new Error(error.message)
  const result = data as
    | RpcOk<{ customer_id: string; version: number; changes?: Record<string, unknown> }>
    | CrmConflictErr
  if (!result?.ok) throwCrmRpc(result, 'Failed to update customer')
  return result
}

export async function createUniqueCompany(payload: Record<string, unknown> = {}) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_admin_create_unique_company', {
    p_payload: payload as Json,
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ company_id: string; version: number }> | RpcErr
  if (!result?.ok) throwCrmRpc(result, 'Failed to create company')
  return result
}

export async function updateUniqueCompany(
  companyId: string,
  expectedVersion: number,
  payload: Record<string, unknown>,
) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_admin_update_unique_company', {
    p_company_id: companyId,
    p_expected_version: expectedVersion,
    p_payload: payload as Json,
  })
  if (error) throw new Error(error.message)
  const result = data as
    | RpcOk<{ company_id: string; version: number; changes?: Record<string, unknown> }>
    | CrmConflictErr
  if (!result?.ok) throwCrmRpc(result, 'Failed to update company')
  return result
}

export async function addCompanyContact(options: {
  companyId: string
  customerId: string
  title?: string | null
  isPrimary?: boolean
}) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_admin_add_company_contact', {
    p_company_id: options.companyId,
    p_customer_id: options.customerId,
    p_title: options.title ?? null,
    p_is_primary: options.isPrimary ?? false,
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<{ contact_id: string; id?: string }> | RpcErr
  if (!result?.ok) throwCrmRpc(result, 'Failed to add company contact')
  return result
}

export async function removeCompanyContact(companyId: string, customerId: string) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_admin_remove_company_contact', {
    p_company_id: companyId,
    p_customer_id: customerId,
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throwCrmRpc(result, 'Failed to remove company contact')
  return result
}

/** Untyped CRM RPC bridge for Phase 4A functions not yet in generated Database types. */
async function crmRpc(name: string, args: Record<string, unknown> = {}) {
  const supabase = getClient()
  const { data, error } = await (
    supabase as unknown as {
      rpc: (
        fn: string,
        params?: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message: string } | null }>
    }
  ).rpc(name, args)
  if (error) throw new Error(error.message)
  return data
}

export async function upsertCustomerAddress(options: {
  customerId: string
  addressId?: string | null
  payload: Record<string, unknown>
}) {
  const result = (await crmRpc('rpc_admin_upsert_customer_address', {
    p_customer_id: options.customerId,
    p_address_id: options.addressId ?? null,
    p_payload: options.payload,
  })) as RpcOk<{ address_id: string }> | RpcErr
  if (!result?.ok) throwCrmRpc(result, 'Failed to save address')
  return result
}

export async function deleteCustomerAddress(customerId: string, addressId: string) {
  const result = (await crmRpc('rpc_admin_delete_customer_address', {
    p_customer_id: customerId,
    p_address_id: addressId,
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throwCrmRpc(result, 'Failed to delete address')
  return result
}

export async function upsertCompanyLocation(options: {
  companyId: string
  locationId?: string | null
  payload: Record<string, unknown>
}) {
  const result = (await crmRpc('rpc_admin_upsert_company_location', {
    p_company_id: options.companyId,
    p_location_id: options.locationId ?? null,
    p_payload: options.payload,
  })) as RpcOk<{ location_id: string }> | RpcErr
  if (!result?.ok) throwCrmRpc(result, 'Failed to save location')
  return result
}

export async function deleteCompanyLocation(companyId: string, locationId: string) {
  const result = (await crmRpc('rpc_admin_delete_company_location', {
    p_company_id: companyId,
    p_location_id: locationId,
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throwCrmRpc(result, 'Failed to delete location')
  return result
}

export async function updateCompanyContact(contactId: string, payload: Record<string, unknown>) {
  const result = (await crmRpc('rpc_admin_update_company_contact', {
    p_contact_id: contactId,
    p_payload: payload,
  })) as RpcOk<{ contact_id: string }> | RpcErr
  if (!result?.ok) throwCrmRpc(result, 'Failed to update contact')
  return result
}

export async function fetchCrmDataQuality() {
  const result = (await crmRpc('rpc_admin_crm_data_quality')) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throwCrmRpc(result, 'Failed to load CRM data quality')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function fetchCrmTaxonomyReport() {
  const result = (await crmRpc('rpc_admin_crm_taxonomy_report')) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throwCrmRpc(result, 'Failed to load CRM taxonomy')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function fetchCrmStaffResolution() {
  const result = (await crmRpc('rpc_admin_crm_staff_resolution')) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throwCrmRpc(result, 'Failed to load staff resolution')
  const { ok: _ok, ...rest } = result
  return rest
}

// ── Phase 4B Sales ops ───────────────────────────────────────────────────────

export type StaffDirectoryRow = {
  id: string
  name: string
  email: string | null
  active: boolean
  staff_type: string
  provenance?: string | null
  notes?: string | null
  linked_admin?: {
    id: string
    email: string
    role: string
    is_active: boolean
    sales_visibility?: string
  } | null
  alias_count: number
  customer_count: number
  company_count: number
  cg_customer_count?: number
  order_hist_count?: number
  draft_hist_count?: number
}

export type CompanyDuplicateReviewRow = {
  id: string
  group_key: string
  company_ids: string[]
  company_names: string[]
  evidence?: Record<string, unknown>
  status: string
  notes?: string | null
  reviewed_at?: string | null
  reviewed_by_name?: string | null
}

export type OwnershipCandidateRow = {
  company_id: string
  company_name: string
  current_owner_id?: string | null
  current_owner_name?: string | null
  proposed_owner_id?: string | null
  proposed_owner_name?: string | null
  evidence_count?: number
  recency?: string | null
  confidence?: string | null
  conflicts?: number
  status: string
}

async function salesRpc(name: string, args: Record<string, unknown> = {}) {
  const supabase = getClient()
  const { data, error } = await (
    supabase as unknown as {
      rpc: (fn: string, params?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
    }
  ).rpc(name, args)
  if (error) throw new Error(error.message)
  return data
}

export async function listStaffDirectory(includeInactive = true) {
  const result = (await salesRpc('rpc_admin_list_staff_directory', {
    p_include_inactive: includeInactive,
  })) as RpcOk<{ items: StaffDirectoryRow[] }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load staff directory')
  return result.items ?? []
}

export async function upsertStaffMember(staffId: string | null, payload: Record<string, unknown>) {
  const result = (await salesRpc('rpc_admin_upsert_staff_member', {
    p_staff_id: staffId,
    p_payload: payload,
  })) as RpcOk<{ staff_id: string }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to save staff')
  return result
}

export async function linkStaffAdmin(staffId: string, adminUserId: string, unlink = false) {
  const result = (await salesRpc('rpc_admin_link_staff_admin', {
    p_staff_id: staffId,
    p_admin_user_id: adminUserId,
    p_unlink: unlink,
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to link staff')
  return result
}

export async function fetchSalesOverview(staffId?: string) {
  const result = (await salesRpc('rpc_admin_sales_overview', {
    p_staff_id: staffId ?? null,
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load sales overview')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function fetchStaffAliasMatrix(limit = 200, status?: string) {
  const result = (await salesRpc('rpc_admin_staff_alias_matrix', {
    p_limit: limit,
    p_status: status ?? null,
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load alias matrix')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function rebuildStaffAliases() {
  const result = (await salesRpc('rpc_admin_rebuild_staff_aliases')) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to rebuild aliases')
  return result
}

export async function listCompanyDuplicateCandidates(status?: string, limit = 100) {
  const result = (await salesRpc('rpc_admin_list_company_duplicate_candidates', {
    p_status: status ?? null,
    p_limit: limit,
  })) as RpcOk<{ items: CompanyDuplicateReviewRow[] }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load duplicate candidates')
  return result.items ?? []
}

export async function rebuildCompanyDuplicateCandidates() {
  const result = (await salesRpc('rpc_admin_rebuild_company_duplicate_candidates')) as
    | RpcOk<Record<string, unknown>>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to rebuild duplicates')
  return result
}

export async function reviewCompanyDuplicate(reviewId: string, status: string, notes?: string) {
  const result = (await salesRpc('rpc_admin_review_company_duplicate', {
    p_review_id: reviewId,
    p_status: status,
    p_notes: notes ?? null,
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to review duplicate')
  return result
}

export async function listCompanyOwnershipCandidates(limit = 100, status?: string) {
  const result = (await salesRpc('rpc_admin_company_ownership_candidates', {
    p_limit: limit,
    p_status: status ?? null,
  })) as RpcOk<{ items: OwnershipCandidateRow[] }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load ownership candidates')
  return result.items ?? []
}

// ── Phase 4C Sales hardening ─────────────────────────────────────────────────

export async function listStaffAdminLinks() {
  const result = (await salesRpc('rpc_admin_list_staff_admin_links')) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load staff/admin links')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function resolveStaffAlias(
  aliasId: string,
  status: string,
  staffId?: string | null,
  notes?: string,
) {
  const result = (await salesRpc('rpc_admin_resolve_staff_alias', {
    p_alias_id: aliasId,
    p_staff_id: staffId ?? null,
    p_status: status,
    p_notes: notes ?? null,
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to resolve alias')
  return result
}

export async function rebuildOwnershipCandidates(entityType: 'customer' | 'company' = 'company', limit = 500) {
  const result = (await salesRpc('rpc_admin_rebuild_ownership_candidates', {
    p_entity_type: entityType,
    p_limit: limit,
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to rebuild candidates')
  return result
}

export async function listOwnershipBackfillCandidates(options?: {
  entityType?: string
  status?: string
  confidence?: string
  limit?: number
  offset?: number
}) {
  const result = (await salesRpc('rpc_admin_list_ownership_candidates', {
    p_entity_type: options?.entityType ?? null,
    p_status: options?.status ?? 'PENDING',
    p_confidence: options?.confidence ?? null,
    p_limit: options?.limit ?? 100,
    p_offset: options?.offset ?? 0,
  })) as RpcOk<{ items: Record<string, unknown>[]; total: number }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to list ownership candidates')
  return { items: result.items ?? [], total: Number(result.total ?? 0) }
}

export async function decideOwnershipCandidate(options: {
  reviewId: string
  decision: 'APPROVE' | 'REJECT' | 'DEFER' | 'MANUAL'
  manualOwnerId?: string | null
  note?: string
  applyNow?: boolean
}) {
  const result = (await salesRpc('rpc_admin_decide_ownership_candidate', {
    p_review_id: options.reviewId,
    p_decision: options.decision,
    p_manual_owner_id: options.manualOwnerId ?? null,
    p_note: options.note ?? null,
    p_apply_now: options.applyNow ?? false,
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to decide candidate')
  return result
}

export async function applyApprovedOwnershipCandidates(reviewIds: string[]) {
  const result = (await salesRpc('rpc_admin_apply_approved_ownership_candidates', {
    p_review_ids: reviewIds,
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to apply candidates')
  return result
}

/** Phase 5H — preview only; never mutates CRM ownership. */
export async function previewApplyOwnershipCandidates(reviewIds: string[]) {
  const result = (await salesRpc('rpc_admin_preview_apply_ownership_candidates', {
    p_review_ids: reviewIds,
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to preview ownership apply')
  return result
}

export async function enrichOwnershipCandidatesPhase5h() {
  const result = (await salesRpc('rpc_admin_enrich_ownership_candidates_phase5h')) as
    | RpcOk<Record<string, unknown>>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to enrich ownership candidates')
  return result
}

export async function fetchOwnershipReviewPack(batch?: string, limit = 200) {
  const result = (await salesRpc('rpc_admin_ownership_review_pack', {
    p_batch: batch ?? null,
    p_limit: limit,
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load ownership review pack')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function fetchStaffDirectoryBaseline() {
  const result = (await salesRpc('rpc_admin_staff_directory_baseline')) as
    | RpcOk<Record<string, unknown>>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load staff baseline')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function fetchOwnershipBaselineReport() {
  const result = (await salesRpc('rpc_admin_ownership_baseline_report')) as
    | RpcOk<Record<string, unknown>>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load ownership baseline')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function fetchUnownedAccountReport(limit = 100) {
  const result = (await salesRpc('rpc_admin_unowned_account_report', { p_limit: limit })) as
    | RpcOk<Record<string, unknown>>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load unowned report')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function fetchSalesOpsDashboard() {
  const result = (await salesRpc('rpc_admin_sales_ops_dashboard')) as
    | RpcOk<Record<string, unknown>>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load sales ops dashboard')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function fetchCrmSalesCutoverReadiness() {
  const result = (await salesRpc('rpc_admin_crm_sales_cutover_readiness')) as
    | RpcOk<Record<string, unknown>>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load CRM/sales readiness')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function fetchInactiveStaffOwnershipReport() {
  const result = (await salesRpc('rpc_admin_inactive_staff_ownership_report')) as
    | RpcOk<Record<string, unknown>>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load inactive staff ownership')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function fetchOwnershipAssignmentPolicy() {
  const result = (await salesRpc('rpc_admin_ownership_assignment_policy')) as
    | RpcOk<Record<string, unknown>>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load assignment policy')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function fetchCrmQualityHub() {
  const result = (await salesRpc('rpc_admin_crm_quality_hub')) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load quality hub')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function fetchOwnershipCoverage() {
  const result = (await salesRpc('rpc_admin_ownership_coverage_report')) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load coverage')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function fetchCgCurrentStatePolicy() {
  const result = (await salesRpc('rpc_admin_cg_current_state_policy')) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load CG policy')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function fetchSalesSecurityMatrix() {
  const result = (await salesRpc('rpc_admin_sales_security_matrix')) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load security matrix')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function setTradeAccess(options: {
  customerId: string
  status: 'ineligible' | 'pending' | 'approved' | 'rejected' | 'suspended'
  note?: string
  source?: string
}) {
  const result = (await salesRpc('rpc_admin_set_trade_access', {
    p_customer_id: options.customerId,
    p_status: options.status,
    p_note: options.note ?? null,
    p_source: options.source ?? 'unique_manual',
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to set trade access')
  return result
}

export async function setPayLaterEligibility(options: {
  customerId: string
  eligible: boolean
  note?: string
  source?: string
}) {
  const result = (await salesRpc('rpc_admin_set_pay_later_eligibility', {
    p_customer_id: options.customerId,
    p_eligible: options.eligible,
    p_note: options.note ?? null,
    p_source: options.source ?? 'unique_manual',
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to set PAY LATER eligibility')
  return result
}

export async function listTradeApplications(options?: {
  status?: string
  limit?: number
  offset?: number
}) {
  const result = (await salesRpc('rpc_admin_list_trade_applications', {
    p_limit: options?.limit ?? 50,
    p_offset: options?.offset ?? 0,
    p_status: options?.status ?? 'pending',
  })) as RpcOk<{ rows: Record<string, unknown>[]; total: number }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to list trade applications')
  return { rows: result.rows ?? [], total: Number(result.total ?? 0) }
}

export async function seedTradeEligibilityBackfillPreview() {
  const result = (await salesRpc('rpc_admin_seed_trade_eligibility_backfill_preview')) as
    | RpcOk<Record<string, unknown>>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to seed trade backfill preview')
  return result
}

export async function listTradeEligibilityBackfill(options?: {
  field?: string
  confidence?: string
  status?: string
  limit?: number
  offset?: number
}) {
  const result = (await salesRpc('rpc_admin_list_trade_eligibility_backfill', {
    p_limit: options?.limit ?? 50,
    p_offset: options?.offset ?? 0,
    p_field: options?.field ?? null,
    p_confidence: options?.confidence ?? null,
    p_status: options?.status ?? 'PENDING',
  })) as RpcOk<{ rows: Record<string, unknown>[]; total: number }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to list trade backfill')
  return { rows: result.rows ?? [], total: Number(result.total ?? 0) }
}

export async function decideTradeEligibilityBackfill(options: {
  reviewId: string
  decision: 'APPROVE' | 'REJECT' | 'DEFER' | 'MANUAL'
  note?: string
  applyNow?: boolean
}) {
  const result = (await salesRpc('rpc_admin_decide_trade_eligibility_backfill', {
    p_review_id: options.reviewId,
    p_decision: options.decision,
    p_note: options.note ?? null,
    p_apply_now: options.applyNow ?? false,
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to decide trade backfill')
  return result
}

export async function fetchTradeCommercialReport() {
  const result = (await salesRpc('rpc_admin_trade_commercial_report')) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load trade report')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function fetchAuthCrmLinkageAudit() {
  const result = (await salesRpc('rpc_admin_auth_crm_linkage_audit')) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load auth linkage audit')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function seedAuthLinkCandidates() {
  const result = (await salesRpc('rpc_admin_seed_auth_link_candidates')) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to seed auth link candidates')
  return result
}

export async function listAuthLinkCandidates(options?: {
  status?: string
  confidence?: string
  limit?: number
  offset?: number
}) {
  const result = (await salesRpc('rpc_admin_list_auth_link_candidates', {
    p_limit: options?.limit ?? 50,
    p_offset: options?.offset ?? 0,
    p_status: options?.status ?? 'PENDING',
    p_confidence: options?.confidence ?? null,
  })) as RpcOk<{ rows: Record<string, unknown>[]; total: number }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to list auth link candidates')
  return { rows: result.rows ?? [], total: Number(result.total ?? 0) }
}

export async function decideAuthLinkCandidate(options: {
  reviewId: string
  decision: 'APPROVE' | 'REJECT' | 'DEFER' | 'MANUAL'
  note?: string
  applyNow?: boolean
}) {
  const result = (await salesRpc('rpc_admin_decide_auth_link_candidate', {
    p_review_id: options.reviewId,
    p_decision: options.decision,
    p_note: options.note ?? null,
    p_apply_now: options.applyNow ?? false,
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to decide auth link')
  return result
}

export async function linkCustomerAuth(options: {
  customerId: string
  authUserId: string
  note?: string
}) {
  const result = (await salesRpc('rpc_admin_link_customer_auth', {
    p_customer_id: options.customerId,
    p_auth_user_id: options.authUserId,
    p_note: options.note ?? null,
    p_source: 'unique_manual',
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to link auth')
  return result
}

export async function unlinkCustomerAuth(customerId: string, note?: string) {
  const result = (await salesRpc('rpc_admin_unlink_customer_auth', {
    p_customer_id: customerId,
    p_note: note ?? null,
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to unlink auth')
  return result
}

export async function createCustomerAuthActivation(customerId: string, ttlHours = 72, note?: string) {
  const result = (await salesRpc('rpc_admin_create_customer_auth_activation', {
    p_customer_id: customerId,
    p_ttl_hours: ttlHours,
    p_note: note ?? null,
  })) as RpcOk<{ activation_id: string; token: string; expires_at: string }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to create activation')
  return result
}

export async function reclassifyPayLaterBackfill() {
  const result = (await salesRpc('rpc_admin_reclassify_pay_later_backfill')) as
    | RpcOk<Record<string, unknown>>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to reclassify PAY LATER')
  return result
}

export async function previewExplicitTradeBackfillApply() {
  const result = (await salesRpc('rpc_admin_preview_explicit_trade_backfill_apply')) as
    | RpcOk<Record<string, unknown>>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to preview trade backfill')
  return result
}

export async function fetchTradeCutoverReadiness() {
  const result = (await salesRpc('rpc_admin_trade_cutover_readiness')) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load cutover readiness')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function fetchCommercialDataQuality() {
  const result = (await salesRpc('rpc_admin_commercial_data_quality')) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load commercial DQ')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function preflightExplicitSurecustTrade() {
  const result = (await salesRpc('rpc_admin_preflight_explicit_surecust_trade')) as
    | RpcOk<Record<string, unknown>>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to preflight SureCust apply')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function fetchActivationCohortReport() {
  const result = (await salesRpc('rpc_admin_activation_cohort_report')) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load activation cohorts')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function fetchPhase4fTradeCutoverGate() {
  const result = (await salesRpc('rpc_admin_trade_cutover_gate_phase4f')) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load Phase 4F cutover gate')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function fetchShadowDifferenceReport(hours = 24) {
  const result = (await salesRpc('rpc_admin_shadow_difference_report', { p_hours: hours })) as
    | RpcOk<Record<string, unknown>>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load shadow report')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function runShadowBaseline() {
  const result = (await salesRpc('rpc_admin_run_shadow_baseline')) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to run shadow baseline')
  return result
}

export async function fetchPriceLeakAudit() {
  const result = (await salesRpc('rpc_admin_price_leak_audit')) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to run price leak audit')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function listActivationWorkspace(options?: {
  limit?: number
  offset?: number
  tradeEligible?: boolean | null
  authLinked?: boolean | null
  invited?: boolean | null
  activated?: boolean | null
  expired?: boolean | null
  hasCompany?: boolean | null
  hasSalesperson?: boolean | null
  lastOrderDays?: number | null
  q?: string | null
}) {
  const result = (await salesRpc('rpc_admin_list_activation_workspace', {
    p_limit: options?.limit ?? 50,
    p_offset: options?.offset ?? 0,
    p_trade_eligible: options?.tradeEligible ?? null,
    p_auth_linked: options?.authLinked ?? null,
    p_invited: options?.invited ?? null,
    p_activated: options?.activated ?? null,
    p_expired: options?.expired ?? null,
    p_has_company: options?.hasCompany ?? null,
    p_has_salesperson: options?.hasSalesperson ?? null,
    p_last_order_days: options?.lastOrderDays ?? null,
    p_q: options?.q ?? null,
  })) as RpcOk<{ rows: Record<string, unknown>[]; total: number }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to list activation workspace')
  return { rows: result.rows ?? [], total: Number(result.total ?? 0) }
}

export async function fetchCustomerActivationStatus(customerId: string) {
  const result = (await salesRpc('rpc_admin_customer_activation_status', {
    p_customer_id: customerId,
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load activation status')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function invalidateActivation(activationId: string) {
  const result = (await salesRpc('rpc_admin_invalidate_activation', {
    p_activation_id: activationId,
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to invalidate activation')
  return result
}

export async function createActivationBatch(options: {
  rolloutMode: 'INTERNAL_TEST' | 'PILOT' | 'BATCH'
  customerIds: string[]
  note?: string
}) {
  const result = (await salesRpc('rpc_admin_create_activation_batch', {
    p_rollout_mode: options.rolloutMode,
    p_customer_ids: options.customerIds,
    p_note: options.note ?? null,
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to create activation batch')
  return result
}

/** Sends a single activation email via edge function. No mass blast. */
export async function sendTradeActivationEmail(customerId: string, ttlHours = 168) {
  const supabase = getClient()
  const { data, error } = await supabase.functions.invoke('send-trade-activation', {
    body: { customer_id: customerId, ttl_hours: ttlHours },
  })
  if (error) throw new Error(error.message)
  const result = data as { ok?: boolean; error?: string; activation_id?: string }
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to send activation email')
  return result
}

export async function proposePilotActivationCohort(limit = 12) {
  const result = (await salesRpc('rpc_admin_propose_pilot_activation_cohort', {
    p_limit: limit,
  })) as RpcOk<{ proposed: Record<string, unknown>[]; note?: string }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to propose pilot cohort')
  return result
}

export async function fetchActivationRolloutMetrics() {
  const result = (await salesRpc('rpc_admin_activation_rollout_metrics')) as
    | RpcOk<Record<string, unknown>>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load activation metrics')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function fetchPilotSendGate() {
  const result = (await salesRpc('rpc_admin_pilot_send_gate')) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load pilot gate')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function fetchTradeRequiredReadinessPhase4h() {
  const result = (await salesRpc('rpc_admin_trade_required_readiness_phase4h')) as
    | RpcOk<Record<string, unknown>>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load readiness')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function finalizePilotCohort(limit = 12, proposalKey = 'PHASE4I_PILOT_001') {
  const result = (await salesRpc('rpc_admin_finalize_pilot_cohort', {
    p_limit: limit,
    p_proposal_key: proposalKey,
  })) as RpcOk<{
    matrix: Record<string, unknown>[]
    count: number
    PILOT_SEND_STATUS?: string
    proposal_key?: string
  }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to finalize pilot cohort')
  return result
}

export async function createPilotBatchFromProposal(proposalKey = 'PHASE4I_PILOT_001', issueTokens = false) {
  const result = (await salesRpc('rpc_admin_create_pilot_batch_from_proposal', {
    p_proposal_key: proposalKey,
    p_issue_tokens: issueTokens,
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to create pilot batch')
  return result
}

export async function fetchTradeRequiredCutoverPrecheck() {
  const result = (await salesRpc('rpc_admin_trade_required_cutover_precheck')) as
    | RpcOk<Record<string, unknown>>
    | RpcErr
  if (!result?.ok && result.error === 'Forbidden') throw new Error('Forbidden')
  if (!result) throw new Error('Failed to load cutover precheck')
  return result
}

export async function fetchPhase4iShadowMatrix() {
  const result = (await salesRpc('rpc_admin_phase4i_shadow_matrix')) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load shadow matrix')
  return result
}

export async function previewNextActivationCohort(limit = 50) {
  const result = (await salesRpc('rpc_admin_preview_next_activation_cohort', {
    p_limit: limit,
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to preview next cohort')
  return result
}

export async function fetchCutoverKillSwitchProcedure() {
  const result = (await salesRpc('rpc_admin_cutover_kill_switch_procedure')) as
    | RpcOk<Record<string, unknown>>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load kill switch procedure')
  return result
}

export async function fetchCutoverControlCentre() {
  const result = (await salesRpc('rpc_admin_cutover_control_centre')) as
    | RpcOk<Record<string, unknown>>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load cutover control centre')
  return result
}

export async function runPhase5dDataReconciliation() {
  const result = (await salesRpc('rpc_phase5d_data_reconciliation')) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result) throw new Error('Failed to run data reconciliation')
  return result as Record<string, unknown>
}

export async function runPhase5dFinanceMoneyReconciliation() {
  const result = (await salesRpc('rpc_phase5d_finance_money_reconciliation')) as
    | RpcOk<Record<string, unknown>>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to run finance reconciliation')
  return result as Record<string, unknown>
}

export async function fetchPhase5gInventoryBaseline() {
  const result = (await salesRpc('rpc_phase5g_inventory_baseline')) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to load WMS inventory baseline')
  return result
}

export async function fetchWmsCutoverReadiness() {
  return (await salesRpc('wms_cutover_readiness_status')) as Record<string, unknown>
}

export async function fetchPhase5gOpenOrderStockExposure() {
  const result = (await salesRpc('rpc_phase5g_open_order_stock_exposure')) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to load open-order stock exposure')
  return result
}

export async function runPhase5gRebuildIdentityReviews() {
  const result = (await salesRpc('rpc_phase5g_rebuild_identity_reviews')) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to rebuild identity reviews')
  return result
}

export async function runPhase5gBuildOpeningStaging(input: {
  batchCode: string
  sourceBasis?: string
  targetWarehouseCode?: string
}) {
  const result = (await salesRpc('rpc_phase5g_build_opening_staging', {
    p_batch_code: input.batchCode,
    p_source_basis: input.sourceBasis ?? 'SHOPIFY_ON_HAND',
    p_target_warehouse_code: input.targetWarehouseCode ?? 'UD_SHADOW',
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to build opening staging')
  return result
}

export async function runPhase5gWmsObservability() {
  return (await salesRpc('rpc_phase5g_wms_observability')) as Record<string, unknown>
}

export async function runPhase5dWmsShadowValidate() {
  const result = (await salesRpc('rpc_phase5d_wms_shadow_validate')) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'WMS shadow validation failed')
  return result as Record<string, unknown>
}

export async function runPhase5dAutomationDryRun() {
  const result = (await salesRpc('rpc_phase5d_automation_dry_run')) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Automation dry-run failed')
  return result as Record<string, unknown>
}

export async function runPhase5dCutoverSelftest() {
  const result = (await salesRpc('rpc_phase5d_cutover_simulation_selftest')) as
    | RpcOk<Record<string, unknown>>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Phase 5D selftest failed')
  return result as Record<string, unknown>
}

export async function fetchComplianceProductInventory() {
  const result = (await salesRpc('rpc_admin_compliance_product_inventory')) as
    | RpcOk<{ inventory: Record<string, unknown>[] }>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load compliance inventory')
  return result
}

export async function classifyRegulatedProductsFromEvidence() {
  const result = (await salesRpc('rpc_admin_classify_regulated_products_from_evidence')) as
    | RpcOk<Record<string, unknown>>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Classification failed')
  return result
}

export async function setCustomerCompliance(options: {
  customerId: string
  status: string
  method?: string | null
  evidenceRef?: string | null
  note?: string | null
  expiresAt?: string | null
}) {
  const result = (await salesRpc('rpc_admin_set_customer_compliance', {
    p_customer_id: options.customerId,
    p_status: options.status,
    p_method: options.method ?? null,
    p_evidence_ref: options.evidenceRef ?? null,
    p_note: options.note ?? null,
    p_expires_at: options.expiresAt ?? null,
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to set compliance')
  return result
}

export async function fetchComplianceReviewQueue(status = 'PENDING_REVIEW', limit = 50, offset = 0) {
  const result = (await salesRpc('rpc_admin_compliance_review_queue', {
    p_status: status,
    p_limit: limit,
    p_offset: offset,
  })) as RpcOk<{ items: Record<string, unknown>[]; total: number }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load compliance queue')
  return result
}

export async function listAppDependencyRegister(blockerOnly = false) {
  const result = (await salesRpc('rpc_admin_list_app_dependency_register', {
    p_blocker_only: blockerOnly,
  })) as RpcOk<{ items: Record<string, unknown>[]; blocker_count: number; locked?: Record<string, string> }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load app dependency register')
  return result
}

export async function listCustomerCompanyLinkCandidates(status = 'PENDING', limit = 100) {
  const result = (await salesRpc('rpc_admin_list_customer_company_link_candidates', {
    p_status: status,
    p_limit: limit,
    p_offset: 0,
  })) as RpcOk<{ items: Record<string, unknown>[] }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load link candidates')
  return result.items ?? []
}

export async function rebuildCustomerCompanyLinkCandidates(limit = 300) {
  const result = (await salesRpc('rpc_admin_rebuild_customer_company_link_candidates', {
    p_limit: limit,
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to rebuild link candidates')
  return result
}

export async function decideCustomerCompanyLink(options: {
  reviewId: string
  decision: 'LINK' | 'NO_COMPANY_REQUIRED' | 'DEFER'
  companyId?: string | null
  note?: string
}) {
  const result = (await salesRpc('rpc_admin_decide_customer_company_link', {
    p_review_id: options.reviewId,
    p_decision: options.decision,
    p_company_id: options.companyId ?? null,
    p_note: options.note ?? null,
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to decide link')
  return result
}

export async function listCustomerDuplicateCandidates(status?: string, limit = 100) {
  const result = (await salesRpc('rpc_admin_list_customer_duplicate_candidates', {
    p_status: status ?? null,
    p_limit: limit,
  })) as RpcOk<{ items: Record<string, unknown>[] }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load customer duplicates')
  return result.items ?? []
}

export async function rebuildCustomerDuplicateCandidates() {
  const result = (await salesRpc('rpc_admin_rebuild_customer_duplicate_candidates')) as
    | RpcOk<Record<string, unknown>>
    | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to rebuild customer duplicates')
  return result
}

export async function reviewCustomerDuplicate(reviewId: string, status: string, notes?: string) {
  const result = (await salesRpc('rpc_admin_review_customer_duplicate', {
    p_review_id: reviewId,
    p_status: status,
    p_notes: notes ?? null,
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to review customer duplicate')
  return result
}

export async function reassignOwnership(options: {
  entityType: 'customer' | 'company'
  entityId: string
  assignmentType: 'salesperson' | 'cg' | 'referrer'
  newStaffId: string | null
  reason?: string
  expectedVersion?: number | null
}) {
  const result = (await salesRpc('rpc_admin_reassign_ownership', {
    p_entity_type: options.entityType,
    p_entity_id: options.entityId,
    p_assignment_type: options.assignmentType,
    p_new_staff_id: options.newStaffId,
    p_reason: options.reason ?? null,
    p_expected_version: options.expectedVersion ?? null,
  })) as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to reassign ownership')
  return result
}

export async function fetchCrmDefaultsForDraft(options?: {
  customerId?: string | null
  companyId?: string | null
}) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc('rpc_admin_crm_defaults_for_draft', {
    p_customer_id: options?.customerId ?? null,
    p_company_id: options?.companyId ?? null,
  })
  if (error) throw new Error(error.message)
  const result = data as RpcOk<AdminCrmDraftDefaults> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load CRM defaults')
  const { ok: _ok, ...defaults } = result
  return defaults as AdminCrmDraftDefaults
}

// ── Phase 2D Finance RPCs (migration 058) ────────────────────────────────────
// Flexible row shapes until database.types.ts is regenerated after 058.

type FinanceConflictErr = RpcErr & {
  current_outstanding?: number
  expected_outstanding?: number
  current_version?: number
}

function throwFinanceRpc(result: RpcErr | FinanceConflictErr, fallback: string): never {
  if (result.error === 'conflict') throw new Error('conflict')
  throw new Error(result.error ?? fallback)
}

/** Untyped rpc bridge for finance functions not yet in generated Database types. */
async function financeRpc(name: string, args: Record<string, unknown> = {}) {
  const supabase = getClient()
  const { data, error } = await (
    supabase as unknown as {
      rpc: (fn: string, params?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
    }
  ).rpc(name, args)
  if (error) throw new Error(error.message)
  return data
}

export type AdminArReceivableRow = {
  id: string
  order_id?: string
  order_number?: string
  invoice_number?: string | null
  invoice_id?: string | null
  order_date?: string | null
  payment_due_on?: string | null
  payment_terms?: string | null
  financial_status?: string | null
  currency?: string | null
  total?: number
  total_received?: number
  total_refunded?: number
  total_outstanding?: number
  days_overdue?: number | null
  aging_bucket?: string | null
  customer_id?: string | null
  customer_name?: string | null
  customer_email?: string | null
  company_id?: string | null
  company_name?: string | null
  trading_name?: string | null
  salesperson_name?: string | null
  cg_name?: string | null
  referrer_name?: string | null
  source_system?: string | null
  [key: string]: unknown
}

export type PaymentSemantic = {
  meaning?: string | null
  affects_received?: boolean
  affects_outstanding?: boolean
  affects_available_to_capture?: boolean
  affects_refunded?: boolean
  terminal_or_transient?: string | null
  confidence?: string | null
  evidence?: string | null
  gateway?: string | null
  kind?: string | null
  status?: string | null
}

export type AdminPaymentTxRow = {
  id: string
  order_id?: string | null
  order_number?: string | null
  parent_transaction_id?: string | null
  kind?: string | null
  status?: string | null
  gateway?: string | null
  formatted_gateway?: string | null
  payment_method?: string | null
  amount?: number
  currency?: string | null
  payment_id?: string | null
  authorization_code?: string | null
  payment_date?: string | null
  processed_at?: string | null
  created_at?: string | null
  source_system?: string | null
  external_gid?: string | null
  internal_note?: string | null
  reversal_of_id?: string | null
  customer_name?: string | null
  company_name?: string | null
  semantic?: PaymentSemantic | null
  [key: string]: unknown
}

export type AdminFinanceRefundRow = {
  id: string
  order_id?: string | null
  order_number?: string | null
  total_refunded?: number
  currency?: string | null
  note?: string | null
  source_system?: string | null
  source_created_at?: string | null
  created_at?: string | null
  customer_name?: string | null
  company_name?: string | null
  [key: string]: unknown
}

export type AdminInvoiceRow = {
  id: string
  invoice_number?: string | null
  order_id?: string | null
  order_number?: string | null
  customer_id?: string | null
  company_id?: string | null
  invoice_date?: string | null
  due_date?: string | null
  currency?: string | null
  total?: number
  amount_paid?: number
  outstanding?: number
  status?: string | null
  provenance?: string | null
  source_system?: string | null
  customer_name?: string | null
  company_name?: string | null
  created_at?: string | null
  [key: string]: unknown
}

export type AdminStatementRow = {
  id: string
  customer_id?: string | null
  company_id?: string | null
  period_from?: string | null
  period_to?: string | null
  opening_balance?: number
  closing_balance?: number
  currency?: string | null
  document_id?: string | null
  customer_name?: string | null
  company_name?: string | null
  created_at?: string | null
  [key: string]: unknown
}

export type AdminFinanceDashboard = {
  total_outstanding?: number
  overdue_outstanding?: number
  due_today?: number
  due_this_week?: number
  current_ar?: number
  unpaid_order_count?: number
  partially_paid_order_count?: number
  paid_order_count?: number
  refunds_total?: number
  refunds_count?: number
  payments_received_period?: number
  payments_count_period?: number
  invoices_issued_period?: number
  aging?: Record<string, number>
  top_outstanding?: Record<string, unknown>[]
  [key: string]: unknown
}

export async function fetchAdminFinanceDashboard(filters: Record<string, unknown> = {}) {
  const data = await financeRpc('rpc_admin_finance_dashboard', { p_filters: filters as Json })
  const result = data as RpcOk<AdminFinanceDashboard> | RpcErr
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to load finance dashboard')
  const { ok: _ok, ...rest } = result
  return rest as AdminFinanceDashboard
}

export async function listAdminArReceivables(options?: {
  limit?: number
  offset?: number
  sort?: string
  filters?: Record<string, unknown>
}) {
  const data = await financeRpc('rpc_list_admin_ar_receivables', {
    p_limit: options?.limit ?? 20,
    p_offset: options?.offset ?? 0,
    p_sort: options?.sort ?? 'outstanding_desc',
    p_filters: (options?.filters ?? {}) as Json,
  })
  const result = data as RpcOk<{ items: AdminArReceivableRow[]; total: number }> | RpcErr
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to load receivables')
  return { items: result.items ?? [], total: Number(result.total ?? 0) }
}

export async function fetchAdminArAgingSummary(filters: Record<string, unknown> = {}) {
  const data = await financeRpc('rpc_admin_ar_aging_summary', { p_filters: filters as Json })
  const result = data as RpcOk<{
    buckets?: Record<string, number>
    by_customer?: Record<string, unknown>[]
    by_company?: Record<string, unknown>[]
    by_salesperson?: Record<string, unknown>[]
    [key: string]: unknown
  }> | RpcErr
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to load aging summary')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function listAdminPaymentTransactions(options?: {
  limit?: number
  offset?: number
  sort?: string
  filters?: Record<string, unknown>
}) {
  const data = await financeRpc('rpc_list_admin_payment_transactions', {
    p_limit: options?.limit ?? 20,
    p_offset: options?.offset ?? 0,
    p_sort: options?.sort ?? 'date_desc',
    p_filters: (options?.filters ?? {}) as Json,
  })
  const result = data as RpcOk<{ items: AdminPaymentTxRow[]; total: number }> | RpcErr
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to load payments')
  return { items: result.items ?? [], total: Number(result.total ?? 0) }
}

export async function getAdminPaymentTransaction(paymentId: string) {
  const data = await financeRpc('rpc_get_admin_payment_transaction', { p_id: paymentId })
  const result = data as RpcOk<{
    payment: AdminPaymentTxRow
    order?: Record<string, unknown> | null
    related?: AdminPaymentTxRow[]
    ledger_boundary?: import('@/admin/lib/financeOps').LedgerBoundary | null
    gateway_gate?: import('@/admin/lib/financeOps').GatewayGate | null
    payment_intent?: Record<string, unknown> | null
    canonical_state?: string | null
    refundable_hint?: number | null
    [key: string]: unknown
  }> | RpcErr
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to load payment')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function postAdminManualPayment(payload: {
  orderId: string
  amount: number
  method: string
  paymentDate: string
  reference?: string | null
  note?: string | null
  idempotencyKey: string
  expectedOutstanding: number
}) {
  const data = await financeRpc('rpc_admin_post_manual_payment', {
    p_order_id: payload.orderId,
    p_amount: payload.amount,
    p_method: payload.method,
    p_payment_date: payload.paymentDate,
    p_reference: payload.reference ?? null,
    p_note: payload.note ?? null,
    p_idempotency_key: payload.idempotencyKey,
    p_expected_outstanding: payload.expectedOutstanding,
  })
  const result = data as
    | RpcOk<{ payment_id: string; order_id?: string; total_received?: number; total_outstanding?: number }>
    | FinanceConflictErr
  if (!result?.ok) throwFinanceRpc(result, 'Failed to post manual payment')
  return result
}

export async function reverseAdminManualPayment(payload: {
  paymentId: string
  reason: string
  idempotencyKey: string
}) {
  const data = await financeRpc('rpc_admin_reverse_manual_payment', {
    p_payment_id: payload.paymentId,
    p_reason: payload.reason,
    p_idempotency_key: payload.idempotencyKey,
  })
  const result = data as
    | RpcOk<{ payment_id: string; reversal_id?: string }>
    | FinanceConflictErr
  if (!result?.ok) throwFinanceRpc(result, 'Failed to reverse payment')
  return result
}

export async function listAdminFinanceRefunds(options?: {
  limit?: number
  offset?: number
  sort?: string
  filters?: Record<string, unknown>
}) {
  const data = await financeRpc('rpc_list_admin_finance_refunds', {
    p_limit: options?.limit ?? 20,
    p_offset: options?.offset ?? 0,
    p_sort: options?.sort ?? 'date_desc',
    p_filters: (options?.filters ?? {}) as Json,
  })
  const result = data as RpcOk<{ items: AdminFinanceRefundRow[]; total: number }> | RpcErr
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to load refunds')
  return { items: result.items ?? [], total: Number(result.total ?? 0) }
}

export async function getAdminFinanceRefund(refundId: string) {
  const data = await financeRpc('rpc_get_admin_finance_refund', { p_refund_id: refundId })
  const result = data as RpcOk<{
    refund: AdminFinanceRefundRow
    lines?: Record<string, unknown>[]
    order?: Record<string, unknown> | null
    [key: string]: unknown
  }> | RpcErr
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to load refund')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function createAdminInvoiceFromOrder(payload: {
  orderId: string
  idempotencyKey: string
  asReconstructed?: boolean
}) {
  const data = await financeRpc('rpc_admin_create_invoice_from_order', {
    p_order_id: payload.orderId,
    p_idempotency_key: payload.idempotencyKey,
    p_as_reconstructed: payload.asReconstructed ?? false,
  })
  const result = data as RpcOk<{ invoice_id: string; invoice_number?: string; document_id?: string }> | RpcErr
  if (!result?.ok) throwFinanceRpc(result, 'Failed to create invoice')
  return result
}

export async function listAdminInvoices(options?: {
  limit?: number
  offset?: number
  sort?: string
  filters?: Record<string, unknown>
}) {
  const data = await financeRpc('rpc_list_admin_invoices', {
    p_limit: options?.limit ?? 20,
    p_offset: options?.offset ?? 0,
    p_sort: options?.sort ?? 'date_desc',
    p_filters: (options?.filters ?? {}) as Json,
  })
  const result = data as RpcOk<{ items: AdminInvoiceRow[]; total: number }> | RpcErr
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to load invoices')
  return { items: result.items ?? [], total: Number(result.total ?? 0) }
}

export async function getAdminInvoice(invoiceId: string) {
  const data = await financeRpc('rpc_get_admin_invoice', { p_invoice_id: invoiceId })
  const result = data as RpcOk<{
    invoice: AdminInvoiceRow
    document?: Record<string, unknown> | null
    order?: Record<string, unknown> | null
    [key: string]: unknown
  }> | RpcErr
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to load invoice')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function generateAdminStatement(payload: {
  customerId?: string | null
  companyId?: string | null
  from: string
  to: string
  idempotencyKey: string
}) {
  const data = await financeRpc('rpc_admin_generate_statement', {
    p_customer_id: payload.customerId ?? null,
    p_company_id: payload.companyId ?? null,
    p_from: payload.from,
    p_to: payload.to,
    p_idempotency_key: payload.idempotencyKey,
  })
  const result = data as RpcOk<{ statement_id: string; document_id?: string }> | RpcErr
  if (!result?.ok) throwFinanceRpc(result, 'Failed to generate statement')
  return result
}

export async function listAdminStatements(options?: {
  limit?: number
  offset?: number
  filters?: Record<string, unknown>
}) {
  const data = await financeRpc('rpc_list_admin_statements', {
    p_limit: options?.limit ?? 20,
    p_offset: options?.offset ?? 0,
    p_filters: (options?.filters ?? {}) as Json,
  })
  const result = data as RpcOk<{ items: AdminStatementRow[]; total: number }> | RpcErr
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to load statements')
  return { items: result.items ?? [], total: Number(result.total ?? 0) }
}

export async function getAdminStatement(statementId: string) {
  const data = await financeRpc('rpc_get_admin_statement', { p_statement_id: statementId })
  const result = data as RpcOk<{
    statement: AdminStatementRow
    document?: Record<string, unknown> | null
    entries?: Record<string, unknown>[]
    [key: string]: unknown
  }> | RpcErr
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to load statement')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function addAdminFinanceNote(payload: {
  entityType: string
  entityId: string
  body: string
}) {
  const data = await financeRpc('rpc_admin_add_finance_note', {
    p_entity_type: payload.entityType,
    p_entity_id: payload.entityId,
    p_body: payload.body,
  })
  const result = data as RpcOk<{ note_id?: string; id?: string }> | RpcErr
  if (!result?.ok) throwFinanceRpc(result, 'Failed to add finance note')
  return result
}

export async function listAdminFinanceTimeline(options: {
  entityType: string
  entityId: string
  limit?: number
  offset?: number
}) {
  const data = await financeRpc('rpc_list_admin_finance_timeline', {
    p_entity_type: options.entityType,
    p_entity_id: options.entityId,
    p_limit: options.limit ?? 50,
    p_offset: options.offset ?? 0,
  })
  const result = data as RpcOk<{ items: Record<string, unknown>[]; total: number }> | RpcErr
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to load finance timeline')
  return { items: result.items ?? [], total: Number(result.total ?? 0) }
}

export async function fetchAdminFinanceReconciliationFlags(limit = 50) {
  const data = await financeRpc('rpc_admin_finance_reconciliation_flags', { p_limit: limit })
  const result = data as RpcOk<{
    items?: Record<string, unknown>[]
    flags?: Record<string, unknown>[]
    total?: number
  }> | RpcErr
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to load reconciliation flags')
  const items = result.items ?? result.flags ?? []
  return { items, total: Number(result.total ?? items.length ?? 0) }
}

export async function fetchAdminFinanceReviewQueue(filters: Record<string, unknown> = {}) {
  const data = await financeRpc('rpc_admin_finance_review_queue', { p_filters: filters })
  const result = data as RpcOk<{ items: Record<string, unknown>[]; total?: number }> | RpcErr
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to load finance review queue')
  return { items: result.items ?? [], total: Number(result.total ?? result.items?.length ?? 0) }
}

export async function submitAdminFinanceReviewDecision(input: {
  orderId: string
  reviewStatus: string
  classification?: string | null
  reason?: string | null
  decision?: string | null
  notes?: string | null
  reviewedOutstanding?: number | null
}) {
  const data = await financeRpc('rpc_admin_finance_review_decision', {
    p_order_id: input.orderId,
    p_review_status: input.reviewStatus,
    p_classification: input.classification ?? null,
    p_reason: input.reason ?? null,
    p_decision: input.decision ?? null,
    p_notes: input.notes ?? null,
    p_reviewed_outstanding: input.reviewedOutstanding ?? null,
  })
  const result = data as RpcOk<{ review?: Record<string, unknown> }> | RpcErr
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to save review decision')
  return result
}

export async function fetchPhase5fFinanceBaseline() {
  const data = await financeRpc('rpc_phase5f_finance_baseline')
  const result = data as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to load finance baseline')
  return result
}

export async function fetchPhase5fOpeningArPreview(limit = 50) {
  const data = await financeRpc('rpc_phase5f_opening_ar_preview', { p_limit: limit })
  const result = data as RpcOk<Record<string, unknown>> | RpcErr
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to load opening AR preview')
  return result
}

export async function getAdminOrderFinancePanel(orderId: string) {
  const data = await financeRpc('rpc_get_admin_order_finance_panel', { p_order_id: orderId })
  const result = data as RpcOk<{
    order?: Record<string, unknown>
    payments?: AdminPaymentTxRow[]
    refunds?: AdminFinanceRefundRow[]
    invoices?: AdminInvoiceRow[]
    outstanding?: number
    total_received?: number
    aging_bucket?: string | null
    ledger_boundary?: import('@/admin/lib/financeOps').LedgerBoundary | null
    gateway_gate?: import('@/admin/lib/financeOps').GatewayGate | null
    [key: string]: unknown
  }> | RpcErr
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to load order finance panel')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function fetchAdminPaymentGatewayConfig() {
  const data = await financeRpc('rpc_admin_payment_gateway_config')
  const result = data as RpcOk<{
    config?: Record<string, unknown> | null
    gate?: import('@/admin/lib/financeOps').GatewayGate | null
  }> | RpcErr
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to load gateway config')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function fetchAdminPaymentSemanticMatrix() {
  const data = await financeRpc('rpc_admin_payment_semantic_matrix')
  const result = data as RpcOk<{
    rows?: Array<PaymentSemantic & { observed_count?: number; observed_amount_sum?: number }>
  }> | RpcErr
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to load semantic matrix')
  return { rows: result.rows ?? [] }
}

export async function getAdminCrmFinanceSummary(entityType: 'customer' | 'company', entityId: string) {
  const data = await financeRpc('rpc_get_admin_crm_finance_summary', {
    p_entity_type: entityType,
    p_entity_id: entityId,
  })
  const result = data as RpcOk<{
    total_outstanding?: number
    overdue_amount?: number
    open_receivable_count?: number
    last_payment_at?: string | null
    last_payment_amount?: number | null
    payment_terms?: string | null
    aging?: Record<string, number>
    recent_invoices?: AdminInvoiceRow[]
    recent_payments?: AdminPaymentTxRow[]
    [key: string]: unknown
  }> | RpcErr
  if (!result?.ok) throw new Error(result?.error ?? 'Failed to load CRM finance summary')
  const { ok: _ok, ...rest } = result
  return rest
}

// ── Fulfilment operations (Phase 3A) ─────────────────────────────────────────

export type AdminFulfilmentWorkspaceRow = {
  id: string
  order_number: string | null
  email: string | null
  trading_name?: string | null
  commerce_fulfillment_status: string | null
  delivery_status: string | null
  dpd_delivery_status?: string | null
  carrier?: string | null
  tracking_number?: string | null
  is_test?: boolean
  order_date?: string | null
  active_fulfillment_count?: number
  primary_carrier?: string | null
  primary_tracking?: string | null
  primary_display_status?: string | null
  has_tracking?: boolean
}

export type AdminFulfilmentMetrics = {
  unfulfilled: number
  partially_fulfilled: number
  fulfilled_today: number
  tracking_missing: number
  in_transit: number
  delivered: number
  failed: number
  note?: string
}

async function fulfilmentRpc(fn: string, args: Record<string, unknown> = {}) {
  const supabase = getClient()
  const { data, error } = await supabase.rpc(fn as never, args as never)
  if (error) throw new Error(error.message)
  return data
}

export async function listAdminFulfilmentWorkspace(options?: {
  limit?: number
  offset?: number
  sort?: string
  filters?: Record<string, unknown>
}) {
  const data = await fulfilmentRpc('rpc_list_admin_fulfilment_workspace', {
    p_filters: options?.filters ?? {},
    p_limit: options?.limit ?? 25,
    p_offset: options?.offset ?? 0,
    p_sort: options?.sort ?? 'date_desc',
  })
  const result = data as RpcOk<{ items: AdminFulfilmentWorkspaceRow[]; total: number }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load fulfilment workspace')
  return { items: result.items ?? [], total: Number(result.total ?? 0) }
}

export async function fetchAdminFulfilmentMetrics(filters?: Record<string, unknown>) {
  const data = await fulfilmentRpc('rpc_admin_fulfilment_metrics', {
    p_filters: filters ?? {},
  })
  const result = data as RpcOk<AdminFulfilmentMetrics> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load fulfilment metrics')
  const { ok: _ok, ...rest } = result
  return rest as AdminFulfilmentMetrics
}

export async function createAdminManualFulfilment(payload: {
  order_id: string
  lines: { order_item_id: string; quantity: number }[]
  inventory_location_id?: string | null
  tracking_company?: string | null
  tracking_number?: string | null
  tracking_url?: string | null
  note?: string | null
  idempotency_key?: string | null
}) {
  const data = await fulfilmentRpc('rpc_admin_create_manual_fulfilment', {
    p_order_id: payload.order_id,
    p_lines: payload.lines,
    p_inventory_location_id: payload.inventory_location_id ?? null,
    p_tracking_company: payload.tracking_company ?? null,
    p_tracking_number: payload.tracking_number ?? null,
    p_tracking_url: payload.tracking_url ?? null,
    p_note: payload.note ?? null,
    p_idempotency_key: payload.idempotency_key ?? null,
  })
  const result = data as RpcOk<{ fulfillment_id: string; commerce_fulfillment_status?: string }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to create fulfilment')
  return result
}

export async function cancelAdminFulfilment(fulfillmentId: string, reason: string) {
  const data = await fulfilmentRpc('rpc_admin_cancel_fulfilment', {
    p_fulfillment_id: fulfillmentId,
    p_reason: reason,
  })
  const result = data as RpcOk<{ commerce_fulfillment_status?: string }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to cancel fulfilment')
  return result
}

export async function setAdminFulfilmentTracking(payload: {
  fulfillment_id: string
  tracking_company?: string | null
  tracking_number: string
  tracking_url?: string | null
}) {
  const data = await fulfilmentRpc('rpc_admin_set_fulfilment_tracking', {
    p_fulfillment_id: payload.fulfillment_id,
    p_tracking_company: payload.tracking_company ?? null,
    p_tracking_number: payload.tracking_number,
    p_tracking_url: payload.tracking_url ?? null,
  })
  const result = data as RpcOk<{ delivery_status?: string }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to set tracking')
  return result
}

export async function listAdminOrderShipmentEvents(orderId: string) {
  const data = await fulfilmentRpc('rpc_list_admin_order_shipment_events', {
    p_order_id: orderId,
  })
  const result = data as RpcOk<{ events: Record<string, unknown>[] }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load shipment events')
  return { events: result.events ?? [] }
}

export async function generateAdminPackingSlip(orderId: string, fulfillmentId?: string | null) {
  const data = await fulfilmentRpc('rpc_admin_generate_packing_slip', {
    p_order_id: orderId,
    p_fulfillment_id: fulfillmentId ?? null,
  })
  const result = data as RpcOk<{ document_id: string; body_html: string }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to generate packing slip')
  return result
}

export async function listAdminInventoryLocations() {
  const data = await fulfilmentRpc('rpc_list_admin_inventory_locations')
  const result = data as RpcOk<{ locations: Record<string, unknown>[] }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load locations')
  return { locations: result.locations ?? [] }
}

export type AdminCarrierConfig = {
  carrier_mode: string
  product_key?: string
  product_status: string
  phase_3b_live_blocked?: boolean
  test_credentials_present?: boolean
  notes?: string
  [key: string]: unknown
}

export async function fetchAdminCarrierConfig() {
  const data = await fulfilmentRpc('rpc_admin_carrier_config_get')
  const result = data as RpcOk<AdminCarrierConfig> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to load carrier config')
  const { ok: _ok, ...rest } = result
  return rest as AdminCarrierConfig
}

export async function previewAdminShipmentEventBackfill() {
  const data = await fulfilmentRpc('rpc_phase3b_shipment_event_backfill_preview')
  const result = data as RpcOk<{
    backfill_executed?: boolean
    proposed_tracking_added?: number
    proposed_delivered?: number
    proposed_ofd?: number
    proposed_in_transit?: number
    proposed_not_delivered?: number
    note?: string
  }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Failed to preview backfill')
  const { ok: _ok, ...rest } = result
  return rest
}

export async function createAdminCarrierShipment(payload: {
  fulfillment_id: string
  idempotency_key: string
  request?: Record<string, unknown>
}) {
  const data = await fulfilmentRpc('rpc_admin_carrier_create_shipment', {
    p_fulfillment_id: payload.fulfillment_id,
    p_idempotency_key: payload.idempotency_key,
    p_request: payload.request ?? {},
  })
  const result = data as RpcOk<{ request_id?: string; status?: string }> | RpcErr
  if (!result?.ok) throw new Error(result.error ?? 'Carrier shipment rejected')
  return result
}
