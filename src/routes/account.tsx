import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { useStorefrontAuth } from '@/contexts/StorefrontAuthContext'
import { useCustomerOrders } from '@/lib/storefront/storefrontQueries'
import { useWishlistProducts } from '@/lib/hooks/useWishlist'
import { getAccountTitle } from '@/lib/accountDisplayName'
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
  const { user, loading, signIn, signUp, resetPassword, signOut } = useStorefrontAuth()
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin')
  const { data: orders = [], isLoading: ordersLoading } = useCustomerOrders(Boolean(user))
  const { data: wishlistProducts = [], isLoading: wishlistLoading } = useWishlistProducts()
  const accountTitle = user ? getAccountTitle(user) : 'My Account'

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AuthValues>({
    resolver: zodResolver(authSchema),
    defaultValues: { email: '', password: '' },
  })

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
    const result = mode === 'signin' ? await signIn(values.email, values.password) : await signUp(values.email, values.password)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success(mode === 'signin' ? 'Welcome back!' : 'Account created — check your email if confirmation is required.')
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
    return (
      <StorefrontLayout>
        <PageHero title={accountTitle} subtitle={user.email ?? ''} backLabel="Back to Home" />

        <SectionContainer className="py-10">
          <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
            <h2 className="font-display text-2xl font-extrabold">My wishlist</h2>
            <Button variant="outline" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>

          <AccountWishlistSection products={wishlistProducts} isLoading={wishlistLoading} />

          <h2 className="mb-6 font-display text-2xl font-extrabold">Order history</h2>

          {ordersLoading ? (
            <p className="text-muted">Loading orders…</p>
          ) : orders.length === 0 ? (
            <div className="rounded-xl border border-[#e8e0d4] p-10 text-center">
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
      <PageHero title="My Account" subtitle="Sign in to view order history" />

      <SectionContainer className="max-w-md py-10">
        <div className="mb-6 flex flex-wrap gap-2">
          <Button type="button" variant={mode === 'signin' ? 'default' : 'outline'} size="sm" onClick={() => setMode('signin')}>
            Sign in
          </Button>
          <Button type="button" variant={mode === 'signup' ? 'default' : 'outline'} size="sm" onClick={() => setMode('signup')}>
            Create account
          </Button>
          <Button type="button" variant={mode === 'reset' ? 'default' : 'outline'} size="sm" onClick={() => setMode('reset')}>
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
            {isSubmitting ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
          </Button>
        </form>
      </SectionContainer>
    </StorefrontLayout>
  )
}
