import { useQuery } from '@tanstack/react-query'
import { useStorefrontAuth } from '@/contexts/StorefrontAuthContext'
import { fetchStorefrontCommercialSession } from '@/lib/storefront/commercialSession'

export function useCommercialSession() {
  const { user } = useStorefrontAuth()
  return useQuery({
    queryKey: ['storefront', 'commercial-session', user?.id ?? 'anon'],
    queryFn: fetchStorefrontCommercialSession,
    staleTime: 30_000,
  })
}
