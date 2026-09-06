import { Link, useRouterState } from '@tanstack/react-router'
import {
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Package,
  Settings,
  ShoppingBag,
  Sparkles,
  X,
} from 'lucide-react'
import { useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useAdminAuth } from '@/contexts/AdminAuthContext'
import { adminNavLink, adminNavLinkActive, adminSidebarSignOut } from '@/admin/adminClassNames'

const NAV_ITEMS: { label: string; to: string; icon: LucideIcon; exact?: boolean }[] = [
  { label: 'Dashboard', to: '/backend', icon: LayoutDashboard, exact: true },
  { label: 'Orders', to: '/backend/orders', icon: ClipboardList },
  { label: 'Catalog', to: '/backend/catalog', icon: Package },
  { label: 'Homepage', to: '/backend/homepage', icon: Sparkles },
  { label: 'Site Content', to: '/backend/content', icon: FileText },
  { label: 'Commerce', to: '/backend/commerce', icon: ShoppingBag },
  { label: 'Communications', to: '/backend/communications', icon: MessageSquare },
  { label: 'Settings', to: '/backend/settings', icon: Settings },
]

function isPathActive(pathname: string, to: string, exact?: boolean) {
  if (exact) return pathname === to || pathname === `${to}/`
  return pathname === to || pathname.startsWith(`${to}/`)
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <nav className="admin-sidebar-nav flex flex-1 flex-col gap-0.5 p-3">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon
        const active = isPathActive(pathname, item.to, item.exact)
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={active ? adminNavLinkActive : adminNavLink}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

function SidebarFooter({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="shrink-0 border-t border-white/10 p-3">
      <button type="button" className={adminSidebarSignOut} onClick={onSignOut}>
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </div>
  )
}

function SidebarBrand() {
  return (
    <div className="shrink-0 border-b border-white/10 px-4 py-5">
      <p className="text-xs font-medium uppercase tracking-widest text-[var(--admin-sidebar-muted)]">Unique CMS</p>
      <p className="text-lg font-semibold">Admin</p>
    </div>
  )
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { signOut } = useAdminAuth()
  const [mobileOpen, setMobileOpen] = useState(false)

  function handleSignOut() {
    void signOut()
  }

  return (
    <div className="admin-root flex h-screen overflow-hidden">
      <aside className="admin-sidebar hidden w-64 shrink-0 flex-col bg-[var(--admin-sidebar)] text-[var(--admin-sidebar-text)] lg:flex">
        <SidebarBrand />
        <SidebarNav />
        <SidebarFooter onSignOut={handleSignOut} />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative flex h-full w-72 max-w-[85vw] flex-col bg-[var(--admin-sidebar)] text-[var(--admin-sidebar-text)]">
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-4">
              <p className="font-semibold">Menu</p>
              <button type="button" className="rounded p-2 hover:bg-white/10" onClick={() => setMobileOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
            <SidebarFooter onSignOut={handleSignOut} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:pl-64">
        <header className="flex shrink-0 items-center justify-between border-b border-[var(--admin-border)] bg-[var(--admin-surface-elevated)] px-4 py-3 lg:hidden">
          <button
            type="button"
            className="rounded-[var(--admin-radius)] p-2 hover:bg-[var(--admin-primary-muted)]"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <p className="text-sm font-semibold">Unique Admin</p>
          <div className="w-9" />
        </header>
        <main className="admin-main flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  )
}
