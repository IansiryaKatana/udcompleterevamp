import { useState } from 'react'
import { Navigate } from '@tanstack/react-router'
import { Eye, EyeOff, Loader2, Lock } from 'lucide-react'
import { useAdminAuth } from '@/contexts/AdminAuthContext'
import { isSupabaseConfigured } from '@/integrations/supabase/client'
import { adminBtnPrimary, adminInput, adminLabel } from '@/admin/adminClassNames'
import '@/admin/admin-theme.css'

export function AdminLogin() {
  const { signIn, loading, session, isAdmin } = useAdminAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!loading && session && isAdmin) {
    return <Navigate to="/backend" />
  }

  if (!isSupabaseConfigured()) {
    return (
      <div className="admin-root flex min-h-screen items-center justify-center p-6">
        <div className="admin-card max-w-lg p-6 text-center">
          <h1 className="text-lg font-semibold">Supabase not configured</h1>
          <p className="mt-2 text-sm text-[var(--admin-muted)]">
            Copy <code>.env.example</code> to <code>.env</code> and add your Supabase project credentials.
          </p>
        </div>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!email.trim() || !password) {
      setError('Email and password are required.')
      return
    }

    setSubmitting(true)
    const result = await signIn(email.trim(), password)
    setSubmitting(false)

    if (result.error) {
      setError(result.error)
    }
  }

  return (
    <div className="admin-root flex min-h-screen items-center justify-center p-4">
      <div className="admin-card w-full max-w-md p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[var(--admin-radius)] bg-[var(--admin-primary-muted)] text-[var(--admin-primary)]">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-[var(--admin-text)]">Unique Admin</h1>
            <p className="text-sm text-[var(--admin-muted)]">Sign in to manage the storefront CMS</p>
          </div>
        </div>

        <form className="space-y-4" onSubmit={(e) => void handleSubmit(e)}>
          <div className="space-y-2">
            <label htmlFor="admin-email" className={adminLabel}>
              Email
            </label>
            <input
              id="admin-email"
              type="email"
              autoComplete="email"
              className={adminInput}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="admin-password" className={adminLabel}>
              Password
            </label>
            <div className="relative">
              <input
                id="admin-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                className={`${adminInput} pr-10`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 flex items-center px-3 text-[var(--admin-muted)] hover:text-[var(--admin-text)]"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error ? <p className="text-sm text-[var(--admin-danger)]">{error}</p> : null}

          <button type="submit" className={`${adminBtnPrimary} w-full`} disabled={submitting || loading}>
            {submitting || loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Sign in
          </button>
        </form>
      </div>
    </div>
  )
}
