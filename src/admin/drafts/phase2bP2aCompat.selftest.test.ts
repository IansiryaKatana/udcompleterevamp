/**
 * Phase 2A compatibility check for a Unique draft→order conversion.
 * Creates PHASE2B-STAB-P2A-* records, verifies order workspace/list RPCs as SQL,
 * then deletes only those test rows.
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const configured = Boolean(url && serviceKey)

describe('Phase 2B → Phase 2A order compatibility', () => {
  it.skipIf(!configured)('converted Unique draft is visible and correct in order ops', async () => {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data, error } = await supabase.rpc('rpc_phase2b_p2a_compat_check')
    expect(error).toBeNull()
    const result = data as {
      ok: boolean
      detail?: string
      checks?: Record<string, boolean | string | number | null>
    }
    expect(result?.ok, result?.detail ?? JSON.stringify(result)).toBe(true)
  }, 90_000)
})
