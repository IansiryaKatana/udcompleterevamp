import { Link } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useStorefrontAuth } from '@/contexts/StorefrontAuthContext'
import { PageHero } from '@/components/layout/PageHero'
import { StorefrontLayout } from '@/components/layout/StorefrontLayout'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { Button } from '@/components/ui/button'
import { AccountSubNav } from '@/components/account/AccountSubNav'

export function AccountSignInGate({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  const { user, loading } = useStorefrontAuth()

  if (loading) {
    return (
      <StorefrontLayout>
        <SectionContainer className="flex justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted" />
        </SectionContainer>
      </StorefrontLayout>
    )
  }

  if (!user) {
    return (
      <StorefrontLayout>
        <PageHero title={title} subtitle="Sign in to view this page" backLabel="Back to Account" backTo="/account" />
        <SectionContainer className="py-10 text-center">
          <Button asChild>
            <Link to="/account">Sign in</Link>
          </Button>
        </SectionContainer>
      </StorefrontLayout>
    )
  }

  return (
    <StorefrontLayout>
      <PageHero title={title} subtitle={user.email ?? ''} backLabel="Account overview" backTo="/account" />
      <SectionContainer className="py-10">
        <AccountSubNav />
        {children}
      </SectionContainer>
    </StorefrontLayout>
  )
}
