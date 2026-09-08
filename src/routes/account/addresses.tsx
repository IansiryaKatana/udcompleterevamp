import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { AccountSignInGate } from '@/components/account/AccountSignInGate'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useStorefrontAuth } from '@/contexts/StorefrontAuthContext'
import { storefrontKeys, useMyAddresses } from '@/lib/storefront/storefrontQueries'
import { upsertMyAddress } from '@/lib/storefront/storefrontRpc'
import { useQueryClient } from '@tanstack/react-query'

export const Route = createFileRoute('/account/addresses')({
  component: AccountAddressesPage,
  head: () => ({ meta: [{ title: 'Addresses | Unique Distribution' }] }),
})

function AccountAddressesPage() {
  const { user } = useStorefrontAuth()
  const queryClient = useQueryClient()
  const { data: addresses = [], isLoading } = useMyAddresses(Boolean(user))
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    company: '',
    address1: '',
    address2: '',
    city: '',
    postal_code: '',
    country: 'GB',
    phone: '',
  })

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!form.address1.trim() || !form.city.trim() || !form.postal_code.trim()) {
      toast.error('Address, city and postcode are required')
      return
    }
    setBusy(true)
    try {
      await upsertMyAddress({
        ...form,
        address_type: 'shipping',
        is_default: addresses.length === 0,
      })
      toast.success('Address saved')
      await queryClient.invalidateQueries({ queryKey: storefrontKeys.addresses() })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save address')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AccountSignInGate title="Addresses">
      <p className="mb-6 text-sm text-muted">
        Addresses for this linked customer only. Checkout still uses the server checkout context as authority.
      </p>
      {isLoading ? (
        <p className="text-muted">Loading addresses…</p>
      ) : addresses.length === 0 ? (
        <p className="mb-6 text-muted">No saved addresses yet.</p>
      ) : (
        <ul className="mb-8 grid gap-3 md:grid-cols-2">
          {addresses.map((address) => (
            <li key={address.id} className="rounded-xl border border-brand-border bg-white p-4 text-sm">
              <p className="font-semibold">
                {[address.first_name, address.last_name].filter(Boolean).join(' ') || 'Address'}
                {address.is_default ? ' · Default' : ''}
              </p>
              {address.company ? <p>{address.company}</p> : null}
              <p>{address.address1}</p>
              {address.address2 ? <p>{address.address2}</p> : null}
              <p>
                {[address.city, address.postal_code].filter(Boolean).join(', ')}
              </p>
              <p>{address.country}</p>
            </li>
          ))}
        </ul>
      )}

      <form className="max-w-lg space-y-3 rounded-xl border border-brand-border bg-white p-5" onSubmit={onSubmit}>
        <h2 className="font-display text-lg font-extrabold">Add address</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input placeholder="First name" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          <Input placeholder="Last name" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
        </div>
        <Input placeholder="Company (optional)" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
        <Input placeholder="Address line 1" required value={form.address1} onChange={(e) => setForm({ ...form, address1: e.target.value })} />
        <Input placeholder="Address line 2" value={form.address2} onChange={(e) => setForm({ ...form, address2: e.target.value })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input placeholder="City" required value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          <Input placeholder="Postcode" required value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} />
        </div>
        <Input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save address'}
        </Button>
      </form>
    </AccountSignInGate>
  )
}
