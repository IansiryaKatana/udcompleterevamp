import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { adminBtnPrimary, adminBtnSecondary, adminSheetPanel } from '@/admin/adminClassNames'

export type AdminSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  onSave?: () => void
  saveLabel?: string
  saving?: boolean
  size?: 'md' | 'lg' | 'xl'
  footer?: 'save' | 'filters' | 'none'
  onReset?: () => void
}

const widthClasses = {
  md: 'sm:max-w-md',
  lg: 'sm:max-w-xl',
  xl: 'sm:max-w-2xl',
}

/** Admin create/edit sheet — bottom on mobile, right panel on desktop. */
export function AdminSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSave,
  saveLabel = 'Save',
  saving = false,
  size = 'lg',
  footer = 'save',
  onReset,
}: AdminSheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            adminSheetPanel,
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'max-sm:data-[state=closed]:slide-out-to-bottom max-sm:data-[state=open]:slide-in-from-bottom',
            'sm:data-[state=closed]:slide-out-to-right sm:data-[state=open]:slide-in-from-right',
            widthClasses[size],
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-[var(--admin-border)] p-4">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-lg font-semibold text-[var(--admin-text)]">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-sm text-[var(--admin-muted)]">{description}</Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" className="shrink-0 rounded-[var(--admin-radius)] p-2 text-[var(--admin-muted)] hover:bg-[var(--admin-primary-muted)]">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto p-4">{children}</div>

          {footer !== 'none' ? (
            <div className="flex flex-col-reverse gap-2 border-t border-[var(--admin-border)] p-4 sm:flex-row sm:justify-end">
              {footer === 'filters' ? (
                <>
                  {onReset ? (
                    <button type="button" className={adminBtnSecondary} onClick={onReset}>
                      Reset
                    </button>
                  ) : null}
                  <Dialog.Close asChild>
                    <button type="button" className={adminBtnPrimary}>
                      Done
                    </button>
                  </Dialog.Close>
                </>
              ) : (
                <>
                  <Dialog.Close asChild>
                    <button type="button" className={adminBtnSecondary}>
                      Cancel
                    </button>
                  </Dialog.Close>
                  {onSave ? (
                    <button type="button" className={adminBtnPrimary} disabled={saving} onClick={onSave}>
                      {saving ? 'Saving…' : saveLabel}
                    </button>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// Back-compat alias — admin modules import AdminModal
export { AdminSheet as AdminModal }
