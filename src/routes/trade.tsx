import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { useStorefrontAuth } from '@/contexts/StorefrontAuthContext'
import { useCommercialSession } from '@/lib/storefront/useCommercialSession'
import { useTradeApplicationFields } from '@/lib/storefront/storefrontQueries'
import { commercialUxMessage, submitTradeApplication } from '@/lib/storefront/commercialSession'
import { PageHero } from '@/components/layout/PageHero'
import { StorefrontLayout } from '@/components/layout/StorefrontLayout'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BrandedSelect } from '@/components/ui/BrandedSelect'

export const Route = createFileRoute('/trade')({
  component: TradePage,
  head: () => ({
    meta: [{ title: 'Open a trade account | Unique Distribution' }],
  }),
})

function TradePage() {
  const { user } = useStorefrontAuth()
  const { data: session, refetch } = useCommercialSession()
  const { data: fields = [] } = useTradeApplicationFields()
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const ux = commercialUxMessage(session?.ux_state)
  const pending = session?.ux_state === 'APPLICATION_PENDING'
  const approved = session?.ux_state === 'TRADE_APPROVED' || session?.ux_state === 'TRADE_APPROVED_PAY_LATER_NOT_AVAILABLE'
  const blocked = session?.ux_state === 'ACCESS_SUSPENDED' || session?.ux_state === 'ACCOUNT_NOT_APPROVED'

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!user) {
      toast.error('Sign in first, then submit your trade application.')
      return
    }
    for (const field of fields) {
      if (field.required && !values[field.field_key]?.trim()) {
        toast.error(`${field.label} is required`)
        return
      }
    }
    setBusy(true)
    try {
      await submitTradeApplication({
        email: user.email,
        ...values,
      })
      toast.success('Trade application submitted')
      await refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Application failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <StorefrontLayout>
      <PageHero
        title="Trade account"
        subtitle="Open a Unique trade account to order wholesale for your retail business."
      />
      <SectionContainer className="grid gap-10 py-12 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-8">
          <section>
            <h2 className="font-display text-2xl font-extrabold">Why retailers use Unique</h2>
            <ul className="mt-4 space-y-2 text-sm text-muted">
              <li>One wholesale catalogue for vapes, nicotine products, confectionery, drinks and retail essentials.</li>
              <li>Trade pricing for approved accounts.</li>
              <li>Quotes, orders and account support from the same platform.</li>
            </ul>
          </section>
          <section>
            <h2 className="font-display text-2xl font-extrabold">How it works</h2>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-muted">
              <li>Create or sign in to your Unique account.</li>
              <li>Submit business details using the trade application form.</li>
              <li>Wait for Unique to review the application.</li>
              <li>Once approved, use trade pricing, quotes and account tools as commercial policy allows.</li>
            </ol>
          </section>
          <section>
            <h2 className="font-display text-2xl font-extrabold">Already a customer?</h2>
            <p className="mt-2 text-sm text-muted">
              Sign in with the email Unique holds for your account. If a customer record already exists, Unique may need
              to send an activation invite — this site will not email customers automatically.
            </p>
            <Button asChild className="mt-4">
              <Link to="/account">Sign in</Link>
            </Button>
          </section>
        </div>

        <div className="rounded-2xl border border-brand-border bg-white p-6">
          <h2 className="font-display text-xl font-extrabold">Apply</h2>
          {ux ? <p className="mt-2 text-sm text-muted">{ux}</p> : null}
          {pending ? (
            <p className="mt-4 text-sm">Your application is being reviewed. We will not show internal review notes here.</p>
          ) : approved ? (
            <p className="mt-4 text-sm">Your trade account is approved.</p>
          ) : blocked ? (
            <p className="mt-4 text-sm">This account cannot apply from the storefront. Contact Unique Distribution.</p>
          ) : !user ? (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-muted">Sign in or create an account first, then return here to apply.</p>
              <Button asChild>
                <Link to="/account">Sign in to apply</Link>
              </Button>
            </div>
          ) : (
            <form className="mt-4 space-y-3" onSubmit={onSubmit}>
              {fields.map((field) => {
                const options = Array.isArray(field.options) ? field.options.map(String) : []
                return (
                  <div key={field.field_key}>
                    <label className="text-sm font-semibold" htmlFor={field.field_key}>
                      {field.label}
                      {field.required ? ' *' : ''}
                    </label>
                    {field.field_type === 'select' ? (
                      <BrandedSelect
                        value={values[field.field_key] ?? ''}
                        onValueChange={(next) => setValues((current) => ({ ...current, [field.field_key]: next }))}
                        options={options.map((option) => ({ value: option, label: option }))}
                        allowEmpty
                        emptyLabel="Select"
                        variant="storefront"
                      />
                    ) : (
                      <Input
                        id={field.field_key}
                        type={field.field_type === 'number' ? 'number' : 'text'}
                        className="mt-1"
                        required={field.required}
                        value={values[field.field_key] ?? ''}
                        onChange={(e) => setValues((current) => ({ ...current, [field.field_key]: e.target.value }))}
                      />
                    )}
                  </div>
                )
              })}
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? 'Submitting…' : 'Submit trade application'}
              </Button>
            </form>
          )}
        </div>
      </SectionContainer>
    </StorefrontLayout>
  )
}
