import { useState } from 'react'
import { adminBtnPrimary, adminInput } from '@/admin/adminClassNames'
import { formatFinanceLabel, fmtFinanceWhen } from '@/admin/lib/financeOps'
import { cn } from '@/lib/utils'

type Props = {
  items: Record<string, unknown>[]
  total: number
  canAddNote: boolean
  onAddNote: (body: string) => Promise<void>
}

export function FinanceActivityPanel({ items, total, canAddNote, onAddNote }: Props) {
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!body.trim()) return
    setSaving(true)
    try {
      await onAddNote(body.trim())
      setBody('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {canAddNote && (
        <div className="space-y-2">
          <textarea
            className={cn(adminInput, 'min-h-[80px] resize-y')}
            placeholder="Add finance / AR note…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <button
            type="button"
            className={adminBtnPrimary}
            disabled={saving || !body.trim()}
            onClick={() => void submit()}
          >
            {saving ? 'Saving…' : 'Add note'}
          </button>
        </div>
      )}

      <p className="text-xs text-[var(--admin-muted)]">{total.toLocaleString()} timeline entries</p>

      <ol className="space-y-3">
        {items.map((ev) => {
          const kind = String(ev.kind || ev.entry_kind || 'event')
          const isNote = kind === 'note'
          return (
            <li
              key={`${kind}-${String(ev.id)}`}
              className="rounded border border-[var(--admin-border)] px-3 py-2 text-sm"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--admin-muted)]">
                  {isNote
                    ? 'Note'
                    : formatFinanceLabel(String(ev.event_type || ev.category || 'event'))}
                </span>
                <span className="text-xs text-[var(--admin-muted)]">
                  {fmtFinanceWhen(String(ev.occurred_at || ev.created_at || ''))}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[var(--admin-text)]">
                {String(ev.body || ev.message || ev.summary || '—')}
              </p>
              {Boolean(ev.actor_name_snapshot || ev.author_name_snapshot || ev.source_system) && (
                <p className="mt-1 text-[11px] text-[var(--admin-muted)]">
                  {[
                    String(ev.actor_name_snapshot || ev.author_name_snapshot || ''),
                    String(ev.source_system || ''),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
            </li>
          )
        })}
        {items.length === 0 && (
          <li className="py-6 text-center text-sm text-[var(--admin-muted)]">No finance activity yet.</li>
        )}
      </ol>
    </div>
  )
}
