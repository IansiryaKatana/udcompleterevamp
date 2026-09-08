import { tryGetSupabase } from '@/integrations/supabase/client'

export type StorefrontCommercialSession = {
  ok: boolean
  auth_linked?: boolean
  customer_id?: string | null
  company_id?: string | null
  company_name?: string | null
  trade_access_status?: string | null
  pay_later_eligible?: boolean
  customer_type?: string | null
  commercial_access_mode?: string
  ux_state?: string
  policy?: Record<string, unknown>
  credit_limit_status?: string
}

export async function fetchStorefrontCommercialSession(): Promise<StorefrontCommercialSession | null> {
  const sb = tryGetSupabase()
  if (!sb) return null
  const { data, error } = await sb.rpc('rpc_storefront_commercial_session', { p_force_mode: null })
  if (error) return null
  return data as StorefrontCommercialSession
}

export async function redeemAuthActivation(token: string) {
  const sb = tryGetSupabase()
  if (!sb) throw new Error('Supabase not configured')
  const { data, error } = await sb.rpc('rpc_storefront_redeem_auth_activation', { p_token: token.trim() })
  if (error) throw new Error(error.message)
  const result = data as { ok?: boolean; error?: string; message?: string }
  if (!result?.ok) throw new Error(result.message ?? result.error ?? 'Activation failed')
  return result
}

export async function submitTradeApplication(payload: Record<string, unknown> = {}) {
  const sb = tryGetSupabase()
  if (!sb) throw new Error('Supabase not configured')
  const { data, error } = await sb.rpc('rpc_storefront_submit_trade_application', { p_payload: payload })
  if (error) throw new Error(error.message)
  const result = data as { ok?: boolean; error?: string; message?: string }
  if (!result?.ok) throw new Error(result.message ?? result.error ?? 'Application failed')
  return result
}

/** Server-side commercial gate. Never trust client-submitted CRM IDs for authority. */
export async function assertStorefrontCommercialAction(
  action: 'view_price' | 'purchase' | 'checkout' | 'quote' | 'pay_later' | string,
  paymentOption?: string | null,
) {
  const sb = tryGetSupabase()
  if (!sb) throw new Error('Supabase not configured')
  const { data, error } = await sb.rpc('rpc_assert_storefront_commercial_action', {
    p_action: action,
    p_payment_option: paymentOption ?? null,
    p_customer_id: null,
  })
  if (error) throw new Error(error.message)
  return data as { ok?: boolean; error?: string; message?: string; policy?: Record<string, unknown> }
}

/** Price visibility — returns null unit_price when policy denies protected trade prices. */
export async function fetchCommercialEffectivePrice(options: {
  productId: string
  variantId?: string | null
  quantity?: number
}) {
  const sb = tryGetSupabase()
  if (!sb) throw new Error('Supabase not configured')
  const { data, error } = await sb.rpc('rpc_commercial_effective_price', {
    p_product_id: options.productId,
    p_variant_id: options.variantId ?? null,
    p_customer_id: null,
    p_quantity: options.quantity ?? 1,
  })
  if (error) throw new Error(error.message)
  return data as {
    ok?: boolean
    unit_price?: number | null
    price_restricted?: boolean
    error?: string
    message?: string
  }
}

/** Login alone is never enough — AUTH + CRM linked + trade approved required under trade_required. */
export function canSeeProtectedTradePrice(session?: StorefrontCommercialSession | null): boolean {
  if (!session?.ok) return false
  if (session.commercial_access_mode === 'trade_required') {
    return Boolean(session.auth_linked && session.policy?.can_view_price)
  }
  // catalogue_open: prices remain visible by design until cutover
  return Boolean(session.policy?.can_view_price ?? true)
}

export function commercialUxMessage(ux?: string | null): string {
  switch (ux) {
    case 'SIGN_IN':
      return 'Sign in to access your trade account.'
    case 'APPLY_FOR_TRADE_ACCOUNT':
      return 'Apply for a Unique trade account, or redeem an activation invite if Unique has already created your customer record.'
    case 'APPLICATION_PENDING':
      return 'Your trade application is being reviewed.'
    case 'ACCOUNT_NOT_APPROVED':
      return 'This account is not approved for trade access. Contact Unique Distribution if you need help.'
    case 'ACCESS_SUSPENDED':
      return 'Trade access is suspended. Contact Unique Distribution.'
    case 'TRADE_APPROVED_PAY_LATER_NOT_AVAILABLE':
      return 'Trade access approved. PAY LATER is not available on this account.'
    case 'TRADE_APPROVED':
      return 'Trade access approved.'
    default:
      return ''
  }
}

export function commercialPriceLabel(session?: StorefrontCommercialSession | null, priceRestricted?: boolean): string {
  if (!priceRestricted) return ''
  const ux = session?.ux_state
  if (ux === 'APPLICATION_PENDING') return 'Your trade application is being reviewed'
  if (ux === 'ACCESS_SUSPENDED' || ux === 'ACCOUNT_NOT_APPROVED') {
    return 'Trade pricing is not available on this account'
  }
  if (ux === 'APPLY_FOR_TRADE_ACCOUNT') return 'Trade pricing available to approved accounts'
  return 'Login to view trade pricing'
}

export function canUsePayLater(session?: StorefrontCommercialSession | null): boolean {
  if (!session?.ok) return false
  return Boolean(session.pay_later_eligible && session.policy?.can_use_pay_later)
}

export function isTradeApproved(session?: StorefrontCommercialSession | null): boolean {
  return session?.ux_state === 'TRADE_APPROVED' || session?.ux_state === 'TRADE_APPROVED_PAY_LATER_NOT_AVAILABLE'
}

export async function gateStorefrontPurchase(action: 'add_to_cart' | 'checkout' | 'quote' | 'pay_later' = 'add_to_cart') {
  const session = await fetchStorefrontCommercialSession()
  if (session?.commercial_access_mode === 'trade_required') {
    const gate = await assertStorefrontCommercialAction(action)
    if (!gate?.ok) {
      return { ok: false as const, message: gate?.message ?? 'Sign in with an approved trade account', session }
    }
    if (action !== 'quote' && !canSeeProtectedTradePrice(session)) {
      return { ok: false as const, message: 'Trade pricing requires an approved account', session }
    }
  }
  return { ok: true as const, session }
}
