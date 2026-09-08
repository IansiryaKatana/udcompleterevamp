/**
 * Display-only 18+ site entry notice.
 * NOT age verification. NOT a purchase control.
 * Enabled only when site_settings.age_gate_display_enabled=true.
 */
import { useEffect, useState } from 'react'
import { SiteLogo } from '@/components/layout/SiteLogo'
import { tryGetSupabase } from '@/integrations/supabase/client'
import { Button } from '@/components/ui/button'

const STORAGE_KEY = 'ud_age_display_ack_v1'

export function AgeGateDisplayNotice() {
  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const sb = tryGetSupabase()
      if (!sb) return
      const { data } = await (
        sb as unknown as {
          rpc: (fn: string) => Promise<{ data: { enabled?: boolean; is_verification?: boolean } | null }>
        }
      ).rpc('rpc_get_age_gate_display_config')
      if (cancelled || !data?.enabled) return
      setEnabled(true)
      try {
        if (localStorage.getItem(STORAGE_KEY) === '1') return
      } catch {
        /* ignore */
      }
      setOpen(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!enabled || !open) return null

  function accept() {
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      /* ignore */
    }
    setOpen(false)
  }

  function exit() {
    window.location.replace('https://www.google.com')
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-hero-brown/95 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="age-display-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-white/12 bg-footer-dark px-6 py-8 text-cream-text shadow-xl">
        <SiteLogo variant="dark" className="text-cream-text" imageClassName="h-10 max-w-[200px]" />
        <h2 id="age-display-title" className="mt-6 font-display text-3xl font-extrabold leading-tight">
          Adults only (18+)
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-white/75">
          Unique Distribution supplies products intended for adults. This is a display notice only — it is not age
          verification and does not authorise purchase by itself.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button type="button" className="h-11 flex-1 rounded-lg" onClick={accept}>
            I am 18 or over
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 flex-1 rounded-lg border-white/25 bg-transparent text-cream-text hover:bg-white/10"
            onClick={exit}
          >
            Exit
          </Button>
        </div>
      </div>
    </div>
  )
}
