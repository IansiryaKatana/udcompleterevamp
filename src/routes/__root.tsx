import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useRouterState,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppToaster } from '@/components/ui/AppToaster'
import type { ReactNode } from 'react'
import { useState } from 'react'
import '@/styles.css'
import { CmsProvider } from '@/contexts/CmsContext'
import { AdminAuthProvider } from '@/contexts/AdminAuthContext'
import { CartDrawer } from '@/components/ecommerce/CartDrawer'
import { SiteScrollProgress } from '@/components/layout/SiteScrollProgress'
import { FloatingContactActions } from '@/components/layout/FloatingContactActions'
import { NotFoundPage } from '@/components/layout/NotFoundPage'
import { CookieConsentBanner } from '@/components/legal/CookieConsentBanner'
import { CookieConsentProvider } from '@/contexts/CookieConsentContext'
import { AgeGateDisplayNotice } from '@/components/legal/AgeGateDisplayNotice'
import { StorefrontAuthProvider } from '@/contexts/StorefrontAuthContext'
import { GoogleTagManager } from '@/components/analytics/GoogleTagManager'
import { DEFAULT_FAVICON_URL, SiteBrandTheme, SiteFavicon } from '@/lib/siteBrand'

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Unique Distribution' },
    ],
    links: [
      { rel: 'icon', href: DEFAULT_FAVICON_URL, type: 'image/png' },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,800&family=Inter+Tight:wght@400;500;600;700&display=swap',
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isAdmin = pathname.startsWith('/backend')
  const [queryClient] = useState(() => new QueryClient())

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <AdminAuthProvider>
            <StorefrontAuthProvider>
              <CookieConsentProvider>
                <CmsProvider skipFetch={isAdmin}>
                  <SiteBrandTheme />
                  {!isAdmin ? <GoogleTagManager /> : null}
                  {!isAdmin ? <SiteFavicon /> : null}
                  {children}
                  {!isAdmin ? <SiteScrollProgress /> : null}
                  {!isAdmin ? <FloatingContactActions /> : null}
                  {!isAdmin ? <CookieConsentBanner /> : null}
                  {!isAdmin ? <AgeGateDisplayNotice /> : null}
                  <CartDrawer />
                  <AppToaster />
                </CmsProvider>
              </CookieConsentProvider>
            </StorefrontAuthProvider>
          </AdminAuthProvider>
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  )
}

function RootLayout() {
  return <Outlet />
}
