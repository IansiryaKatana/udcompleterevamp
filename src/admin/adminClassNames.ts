import { cn } from '@/lib/utils'

export const adminBtnPrimary = cn(
  'inline-flex items-center justify-center gap-2 rounded-[var(--admin-radius)] px-4 py-2 text-sm font-medium',
  'bg-[var(--admin-primary)] text-white transition-colors hover:bg-[var(--admin-primary-hover)]',
  'disabled:pointer-events-none disabled:opacity-50',
)

export const adminBtnSecondary = cn(
  'inline-flex items-center justify-center gap-2 rounded-[var(--admin-radius)] px-4 py-2 text-sm font-medium',
  'border border-[var(--admin-border)] bg-[var(--admin-surface-elevated)] text-[var(--admin-text)]',
  'transition-colors hover:bg-[var(--admin-primary-muted)]',
  'disabled:pointer-events-none disabled:opacity-50',
)

export const adminBtnDanger = cn(
  'inline-flex items-center justify-center gap-2 rounded-[var(--admin-radius)] px-4 py-2 text-sm font-medium',
  'border border-transparent bg-[var(--admin-danger-muted)] text-[var(--admin-danger)]',
  'transition-colors hover:bg-[var(--admin-danger)] hover:text-white',
  'disabled:pointer-events-none disabled:opacity-50',
)

export const adminBtnGhost = cn(
  'inline-flex items-center justify-center gap-2 rounded-[var(--admin-radius)] px-3 py-2 text-sm font-medium',
  'text-[var(--admin-muted)] transition-colors hover:bg-[var(--admin-primary-muted)] hover:text-[var(--admin-text)]',
)

/** Workspace jump next to a primary CTA — white so it does not compete with green actions. */
export const adminBtnRelated = cn(
  'inline-flex items-center justify-center gap-1.5 rounded-[var(--admin-radius)] px-3 py-2 text-sm font-medium',
  'border border-[var(--admin-border)] bg-white text-[var(--admin-text)]',
  'transition-colors hover:border-[var(--admin-primary)] hover:bg-[var(--admin-primary-muted)] hover:text-[var(--admin-primary)]',
)

export const adminNavLink = cn(
  'flex items-center gap-3 rounded-[var(--admin-radius)] px-3 py-2.5 text-sm font-medium transition-colors',
  'text-[var(--admin-sidebar-muted)] hover:bg-white/5 hover:text-[var(--admin-sidebar-text)]',
)

export const adminNavLinkActive = cn(
  adminNavLink,
  'bg-[var(--admin-sidebar-active)] text-white hover:bg-[var(--admin-sidebar-active)] hover:text-white',
)

export const adminSidebarSignOut = cn(
  'flex items-center gap-3 rounded-[var(--admin-radius)] px-3 py-2.5 text-sm font-medium transition-colors w-full',
  'bg-[var(--admin-danger)] text-white hover:bg-[#9a1f15]',
)

export const adminInput = cn(
  'flex h-10 w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-white px-3 py-2 text-sm',
  'text-[var(--admin-text)] placeholder:text-[var(--admin-muted)]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-primary)]',
)

export const adminSelect = cn(adminInput, 'admin-select cursor-pointer pr-10')

export const adminSelectTrigger = cn(
  adminInput,
  'inline-flex w-full items-center justify-between gap-2 text-left',
)

/** Shared right-panel sheet shell — full viewport height on desktop. */
export const adminSheetPanel = cn(
  'fixed z-50 flex w-full flex-col bg-[var(--admin-surface-elevated)] shadow-xl',
  'data-[state=open]:animate-in data-[state=closed]:animate-out',
  'max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:mb-0 max-sm:max-h-[92vh] max-sm:rounded-t-2xl max-sm:rounded-b-none max-sm:border max-sm:border-[var(--admin-border)]',
  'sm:inset-y-0 sm:right-0 sm:h-screen sm:max-h-screen sm:rounded-none sm:border-l sm:border-[var(--admin-border)]',
)

export const adminLabel = cn('text-sm font-medium text-[var(--admin-text)]')

export const adminBadge = cn(
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
  'bg-[var(--admin-primary-muted)] text-[var(--admin-primary)]',
)
