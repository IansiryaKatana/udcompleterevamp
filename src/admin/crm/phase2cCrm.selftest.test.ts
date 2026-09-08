/**
 * Phase 2C CRM regression — calls service-role SQL selftest.
 * Requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL in env.
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const configured = Boolean(url && serviceKey)

describe('Phase 2C customer & company CRM', () => {
  it.skipIf(!configured)('rpc_phase2c_crm_selftest passes cases A–T', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await supabase.rpc('rpc_phase2c_crm_selftest')
    expect(error).toBeNull()
    const result = data as {
      ok: boolean
      cleanup?: { ok: boolean }
      cases: Record<string, { ok: boolean; detail?: string }>
    }
    expect(result.ok).toBe(true)
    expect(result.cleanup?.ok).toBe(true)
    const required = [
      'A_create_unique_customer',
      'B_create_unique_company',
      'C_company_contact_link',
      'D_permissions_forbidden',
      'E_concurrency_version',
      'F_ownership_audit',
      'G_type_terms_storename_audit',
      'H_crm_note',
      'I_trading_name_provenance',
      'J_commercial_aggregates',
      'K_defaults_for_draft',
      'L_remove_company_contact',
      'M_list_customers_filter',
      'N_list_companies_filter',
      'O_customer_workspace',
      'P_company_workspace',
      'Q_timeline',
      'R_shopify_master_editable_provenance',
      'S_search_customers_companies',
      'T_historical_no_cascade',
    ]
    for (const name of required) {
      expect(result.cases[name], name).toBeTruthy()
      expect(result.cases[name].ok, `${name}: ${result.cases[name]?.detail}`).toBe(true)
    }
  }, 180_000)

  it.skipIf(!configured)('CRM create RPCs reject unauthenticated service calls', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data } = await supabase.rpc('rpc_admin_create_unique_customer', {
      p_payload: { display_name: 'PHASE2C-STAB-SHOULD-FAIL' },
    })
    expect(data).toMatchObject({ ok: false, error: 'Forbidden' })
  })
})
