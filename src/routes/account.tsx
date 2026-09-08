import { createFileRoute, Link, Outlet, useChildMatches } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { useStorefrontAuth } from '@/contexts/StorefrontAuthContext'
import { useCustomerOrders, useMyCompany, useMyQuotes } from '@/lib/storefront/storefrontQueries'
import { useWishlistProducts } from '@/lib/hooks/useWishlist'
import { getAccountTitle } from '@/lib/accountDisplayName'
import {
  commercialUxMessage,
  fetchStorefrontCommercialSession,
  redeemAuthActivation,
  type StorefrontCommercialSession,
} from '@/lib/storefront/commercialSession'
import { AccountSubNav } from '@/components/account/AccountSubNav'
import { AccountWishlistSection } from '@/components/account/AccountWishlistSection'
import { OrderHistoryTable } from '@/components/account/OrderHistoryTable'
import { PageHero } from '@/components/layout/PageHero'
import { StorefrontLayout } from '@/components/layout/StorefrontLayout'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { z } from 'zod'

export const Route = createFileRoute('/account')({
  component: AccountPage,
  validateSearch: (search: Record<string, unknown>): { activate?: string } => {
    const activate = typeof search.activate === 'string' ? search.activate.trim() : ''
    return activate ? { activate } : {}
  },
  head: () => ({ meta: [{ title: 'My Account | Unique Distribution' }] }),
})

const authSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6, 'Password must be at least 6 characters').optional(),
})

const resetSchema = z.object({
  email: z.string().email(),
})

type AuthValues = z.infer<typeof authSchema>

function AccountPage() {
  const childMatches = useChildMatches()
  if (childMatches.length > 0) return <Outlet />

  return <AccountDashboard />
}

function AccountDashboard() {
  const { activate: activateParam } = Route.useSearch()
  const { user, loading, signIn, signUp, resetPassword, signOut } = useStorefrontAuth()
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin')
  const [commercial, setCommercial] = useState<StorefrontCommercialSession | null>(null)
  const [activationToken, setActivationToken] = useState('')
  const [tradeBusy, setTradeBusy] = useState(false)
  const { data: orders = [], isLoading: ordersLoading } = useCustomerOrders(Boolean(user))
  const { data: quotes = [] } = useMyQuotes(Boolean(user))
  const { data: company } = useMyCompany(Boolean(user) && Boolean(commercial?.company_id))
  const { data: wishlistProducts = [], isLoading: wishlistLoading } = useWishlistProducts()
  const accountTitle = user ? getAccountTitle(user) : 'My Account'

  useEffect(() => {
    if (activateParam?.trim()) {
      setActivationToken(activateParam.trim())
    }
  }, [activateParam])

  useEffect(() => {
    if (!user || !activateParam?.trim()) return
    let cancelled = false
    void (async () => {
      try {
        await redeemAuthActivation(activateParam.trim())
        if (cancelled) return
        toast.success('Account linked')
        setActivationToken('')
        setCommercial(await fetchStorefrontCommercialSession())
      } catch (e) {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : 'Activation failed — paste token below if needed')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user, activateParam])

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AuthValues>({
    resolver: zodResolver(authSchema),
    defaultValues: { email: '', password: '' },
  })

  useEffect(() => {
    if (!user) {
      setCommercial(null)
      return
    }
    void fetchStorefrontCommercialSession().then(setCommercial).catch(() => setCommercial(null))
  }, [user])

  async function onSubmit(values: AuthValues) {
    if (mode === 'reset') {
      const parsed = resetSchema.safeParse(values)
      if (!parsed.success) {
        toast.error(parsed.error.issues[0]?.message ?? 'Valid email required')
        return
      }
      const result = await resetPassword(parsed.data.email)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Password reset link sent — check your email.')
      setMode('signin')
      return
    }

    if (!values.password) {
      toast.error('Password is required')
      return
    }
    const result =
      mode === 'signin' ? await signIn(values.email, values.password) : await signUp(values.email, values.password)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success(
      mode === 'signin' ? 'Welcome back!' : 'Account created — check your email if confirmation is required.',
    )
  }

  if (loading) {
    return (
      <StorefrontLayout>
        <SectionContainer className="flex flex-1 items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted" />
        </SectionContainer>
      </StorefrontLayout>
    )
  }

  if (user) {
    const ux = commercialUxMessage(commercial?.ux_state)
    return (
      <StorefrontLayout>
        <PageHero title={accountTitle} subtitle={user.email ?? ''} backLabel="Back to Home" />

        <SectionContainer className="py-10">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <AccountSubNav />
            <Button variant="outline" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>

          <div className="mb-8 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-brand-border bg-white p-4 text-sm">
              <p className="font-semibold">Trade account</p>
              <p className="mt-1 text-muted">{ux || 'Sign in is complete. Trade status is provided by Unique.'}</p>
              {commercial?.customer_type ? (
                <p className="mt-1 text-xs text-muted">Customer type: {commercial.customer_type}</p>
              ) : null}
              {commercial?.ux_state === 'APPLY_FOR_TRADE_ACCOUNT' ? (
                <Button asChild size="sm" className="mt-3">
                  <Link to="/trade">Apply for trade</Link>
                </Button>
              ) : null}
            </div>
            <div className="rounded-xl border border-brand-border bg-white p-4 text-sm">
              <p className="font-semibold">Company</p>
              <p className="mt-1 text-muted">{company?.name || commercial?.company_name || 'No company linked yet.'}</p>
            </div>
            <div className="rounded-xl border border-brand-border bg-white p-4 text-sm">
              <p className="font-semibold">Open quotes</p>
              <p className="mt-1 text-muted">{quotes.length} quote request(s)</p>
              <Button asChild size="sm" variant="outline" className="mt-3">
                <Link to="/account/quotes">View quotes</Link>
              </Button>
            </div>
          </div>

          {commercial?.ux_state === 'APPLY_FOR_TRADE_ACCOUNT' || activationToken ? (
            <div className="mb-8 rounded-xl border border-brand-border bg-white p-4 text-sm">
              <p className="font-semibold">Activation invite</p>
              <p className="mt-1 text-muted">
                If Unique already created your customer record, paste the invite token here. This page does not send
                invitations.
              </p>
              <div className="mt-3 flex min-w-[220px] max-w-xl gap-2">
                <Input
                  placeholder="Activation invite token"
                  value={activationToken}
                  onChange={(e) => setActivationToken(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={tradeBusy || !activationToken.trim()}
                  onClick={() => {
                    void (async () => {
                      setTradeBusy(true)
                      try {
                        await redeemAuthActivation(activationToken)
                        toast.success('Account linked')
                        setActivationToken('')
                        setCommercial(await fetchStorefrontCommercialSession())
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : 'Activation failed')
                      } finally {
                        setTradeBusy(false)
                      }
                    })()
                  }}
                >
                  Redeem
                </Button>
              </div>
            </div>
          ) : null}

          <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
            <h2 className="font-display text-2xl font-extrabold">My wishlist</h2>
          </div>

          <AccountWishlistSection products={wishlistProducts} isLoading={wishlistLoading} />

          <h2 className="mb-6 font-display text-2xl font-extrabold">Order history</h2>

          {ordersLoading ? (
            <p className="text-muted">Loading orders…</p>
          ) : orders.length === 0 ? (
            <div className="rounded-xl border border-brand-border p-10 text-center">
              <p className="text-muted">No orders yet for this account.</p>
              <Button asChild className="mt-4">
                <Link to="/">Start shopping</Link>
              </Button>
            </div>
          ) : (
            <OrderHistoryTable orders={orders} />
          )}
        </SectionContainer>
      </StorefrontLayout>
    )
  }

  return (
    <StorefrontLayout>
      <PageHero title="My Account" subtitle="Sign in for orders, quotes and trade tools" />

      <SectionContainer className="max-w-md py-10">
        <div className="mb-6 flex flex-wrap gap-2">
          <Button
            type="button"
            variant={mode === 'signin' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('signin')}
          >
            Sign in
          </Button>
          <Button
            type="button"
            variant={mode === 'signup' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('signup')}
          >
            Create account
          </Button>
          <Button
            type="button"
            variant={mode === 'reset' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('reset')}
          >
            Forgot password
          </Button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-semibold">Email</label>
            <Input type="email" {...register('email')} />
            {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
          </div>
          {mode !== 'reset' ? (
            <div>
              <label className="mb-1 block text-sm font-semibold">Password</label>
              <Input type="password" {...register('password')} />
              {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
            </div>
          ) : (
            <p className="text-sm text-muted">We will email you a link to reset your password.</p>
          )}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting
              ? 'Please wait…'
              : mode === 'signin'
                ? 'Sign in'
                : mode === 'signup'
                  ? 'Create account'
                  : 'Send reset link'}
          </Button>
        </form>
      </SectionContainer>
    </StorefrontLayout>
  )
}
