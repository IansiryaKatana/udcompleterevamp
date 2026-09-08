import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, tryGetSupabase } from '@/integrations/supabase/client'
import { fetchAdminSession } from '@/admin/lib/adminRpc'

type AdminRole = 'owner' | 'admin' | 'editor' | 'viewer'

type AdminAuthContextValue = {
  session: Session | null
  loading: boolean
  isAdmin: boolean
  canEdit: boolean
  role: AdminRole | null
  staffMemberId: string | null
  salesVisibility: string | null
  canViewAllSales: boolean
  canReassignOwnership: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null)

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [canEdit, setCanEdit] = useState(false)
  const [role, setRole] = useState<AdminRole | null>(null)
  const [staffMemberId, setStaffMemberId] = useState<string | null>(null)
  const [salesVisibility, setSalesVisibility] = useState<string | null>(null)
  const [canViewAllSales, setCanViewAllSales] = useState(true)
  const [canReassignOwnership, setCanReassignOwnership] = useState(false)

  const refreshAdminStatus = useCallback(async (currentSession: Session | null) => {
    if (!currentSession || !isSupabaseConfigured()) {
      setIsAdmin(false)
      setCanEdit(false)
      setRole(null)
      setStaffMemberId(null)
      setSalesVisibility(null)
      setCanViewAllSales(false)
      setCanReassignOwnership(false)
      return
    }

    if (!tryGetSupabase()) {
      setIsAdmin(false)
      setCanEdit(false)
      setRole(null)
      setStaffMemberId(null)
      setSalesVisibility(null)
      setCanViewAllSales(false)
      setCanReassignOwnership(false)
      return
    }

    try {
      const result = await fetchAdminSession()
      if (result.role && ['owner', 'admin', 'editor', 'viewer'].includes(result.role)) {
        setIsAdmin(result.isAdmin)
        setCanEdit(result.canEdit)
        setRole(result.role as AdminRole)
        setStaffMemberId(result.staffMemberId)
        setSalesVisibility(result.salesVisibility)
        setCanViewAllSales(result.canViewAllSales)
        setCanReassignOwnership(result.canReassignOwnership)
      } else {
        setIsAdmin(false)
        setCanEdit(false)
        setRole(null)
        setStaffMemberId(null)
        setSalesVisibility(null)
        setCanViewAllSales(false)
        setCanReassignOwnership(false)
      }
    } catch {
      setIsAdmin(false)
      setCanEdit(false)
      setRole(null)
      setStaffMemberId(null)
      setSalesVisibility(null)
      setCanViewAllSales(false)
      setCanReassignOwnership(false)
    }
  }, [])

  useEffect(() => {
    const supabase = tryGetSupabase()
    if (!supabase) {
      setLoading(false)
      return
    }

    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      void refreshAdminStatus(data.session).finally(() => setLoading(false))
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      void refreshAdminStatus(nextSession)
    })

    return () => sub.subscription.unsubscribe()
  }, [refreshAdminStatus])

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = tryGetSupabase()
    if (!supabase) return { error: 'Supabase is not configured' }

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }

    const { data: sessionData } = await supabase.auth.getSession()
    await refreshAdminStatus(sessionData.session)
    return { error: null }
  }, [refreshAdminStatus])

  const signOut = useCallback(async () => {
    const supabase = tryGetSupabase()
    if (supabase) await supabase.auth.signOut()
    setSession(null)
    setIsAdmin(false)
    setCanEdit(false)
    setRole(null)
    setStaffMemberId(null)
    setSalesVisibility(null)
    setCanViewAllSales(false)
    setCanReassignOwnership(false)
  }, [])

  const value = useMemo(
    () => ({
      session,
      loading,
      isAdmin,
      canEdit,
      role,
      staffMemberId,
      salesVisibility,
      canViewAllSales,
      canReassignOwnership,
      signIn,
      signOut,
    }),
    [
      session,
      loading,
      isAdmin,
      canEdit,
      role,
      staffMemberId,
      salesVisibility,
      canViewAllSales,
      canReassignOwnership,
      signIn,
      signOut,
    ],
  )

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext)
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider')
  return ctx
}
