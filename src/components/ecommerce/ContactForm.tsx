import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { contactSchema, type ContactFormValues } from '@/lib/validators/contact.schema'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { cn } from '@/lib/utils'

type ContactFormProps = {
  className?: string
}

export function ContactForm({ className }: ContactFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: { name: '', email: '', message: '' },
  })

  async function onSubmit(values: ContactFormValues) {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-contact-form`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(values),
    })

    const body = await res.json().catch(() => ({}))
    if (!res.ok || !body.ok) {
      toast.error((body as { error?: string }).error ?? 'Could not send message')
      return
    }

    toast.success('Message sent — we will reply soon.')
    reset()
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className={cn('space-y-4 rounded-xl border border-brand-border bg-white p-6 text-text-brown shadow-lg', className)}
    >
      <div>
        <label className="mb-1 block text-sm font-semibold">Name</label>
        <Input {...register('name')} placeholder="Your name" />
        {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
      </div>
      <div>
        <label className="mb-1 block text-sm font-semibold">Email</label>
        <Input type="email" {...register('email')} placeholder="you@example.com" />
        {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
      </div>
      <div>
        <label className="mb-1 block text-sm font-semibold">Message</label>
        <textarea
          {...register('message')}
          rows={5}
          placeholder="How can we help?"
          className="flex w-full rounded-md border border-brand-border/80 bg-white px-3 py-2 text-sm text-text-brown focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta-brown/30"
        />
        {errors.message && <p className="mt-1 text-xs text-red-600">{errors.message.message}</p>}
      </div>
      <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
        {isSubmitting ? 'Sending…' : 'Send message'}
      </Button>
    </form>
  )
}
