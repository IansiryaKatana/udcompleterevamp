import { Link } from '@tanstack/react-router'
import type { CSSProperties, MouseEventHandler, ReactNode } from 'react'
import { isExternalHref, normalizeCmsHref, resolveStorefrontLink } from '@/lib/cmsLink'

type CmsLinkProps = {
  href: string | null | undefined
  children?: ReactNode
  className?: string
  style?: CSSProperties
  target?: string
  rel?: string
  onClick?: MouseEventHandler<HTMLAnchorElement>
}

export function CmsLink({ href, children, className, style, target, rel, onClick }: CmsLinkProps) {
  const normalized = normalizeCmsHref(href)

  if (isExternalHref(normalized)) {
    return (
      <a
        href={normalized}
        className={className}
        style={style}
        target={target ?? '_blank'}
        rel={rel ?? 'noopener noreferrer'}
        onClick={onClick}
      >
        {children}
      </a>
    )
  }

  const resolved = resolveStorefrontLink(normalized)

  if ('external' in resolved) {
    return null
  }

  return (
    <Link
      to={resolved.to as never}
      params={resolved.params as never}
      hash={resolved.hash as never}
      className={className}
      style={style}
      onClick={onClick}
    >
      {children}
    </Link>
  )
}
