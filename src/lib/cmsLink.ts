import type { LinkProps } from '@tanstack/react-router'

type InternalLinkProps = Pick<LinkProps, 'to' | 'params' | 'search' | 'hash'>

export function normalizeCmsHref(href: string | null | undefined): string {
  const trimmed = (href ?? '').trim()
  if (!trimmed) return '/'
  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return trimmed
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

export function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:|tel:)/i.test(href)
}

function splitHash(href: string): { path: string; hash?: string } {
  const hashIndex = href.indexOf('#')
  if (hashIndex === -1) return { path: href }
  return {
    path: href.slice(0, hashIndex) || '/',
    hash: href.slice(hashIndex + 1) || undefined,
  }
}

/** Map CMS href strings to typed TanStack Router link targets. */
export function resolveStorefrontLink(href: string | null | undefined): InternalLinkProps | { external: true; href: string } {
  const normalized = normalizeCmsHref(href)

  if (isExternalHref(normalized)) {
    return { external: true, href: normalized }
  }

  const { path, hash } = splitHash(normalized)

  const productMatch = path.match(/^\/product\/([^/?]+)/)
  if (productMatch) {
    return { to: '/product/$slug', params: { slug: decodeURIComponent(productMatch[1]) }, hash }
  }

  const collectionMatch = path.match(/^\/collection\/([^/?]+)/)
  if (collectionMatch) {
    return { to: '/collection/$slug', params: { slug: decodeURIComponent(collectionMatch[1]) }, hash }
  }

  const pageMatch = path.match(/^\/pages\/([^/?]+)/)
  if (pageMatch) {
    return { to: '/pages/$slug', params: { slug: decodeURIComponent(pageMatch[1]) }, hash }
  }

  return { to: (path || '/') as InternalLinkProps['to'], hash }
}
