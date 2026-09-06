import { useEffect } from 'react'
import { stripHtml } from '@/lib/stripHtml'

export type PageMeta = {
  title: string
  description?: string
  image?: string
  path?: string
}

function upsertMeta(name: string, content: string, attr: 'name' | 'property' = 'name') {
  if (!content) return
  let el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, name)
    document.head.appendChild(el)
  }
  el.content = content
}

export function applyPageMeta({ title, description, image, path }: PageMeta) {
  document.title = title
  if (description) upsertMeta('description', description)
  upsertMeta('og:title', title, 'property')
  if (description) upsertMeta('og:description', description, 'property')
  if (image) upsertMeta('og:image', image, 'property')
  if (path && typeof window !== 'undefined') {
    upsertMeta('og:url', `${window.location.origin}${path}`, 'property')
  }
}

export function usePageMeta(meta: PageMeta | null) {
  useEffect(() => {
    if (!meta) return
    applyPageMeta(meta)
  }, [meta?.title, meta?.description, meta?.image, meta?.path])
}

export function buildProductMeta(product: { name: string; description: string; imageUrl: string; slug: string }, siteName = 'Unique Distribution'): PageMeta {
  return {
    title: `${product.name} | ${siteName}`,
    description: stripHtml(product.description).slice(0, 160) || `Shop ${product.name} at ${siteName}.`,
    image: product.imageUrl || undefined,
    path: `/product/${product.slug}`,
  }
}

export function buildCollectionMeta(title: string, description: string | undefined, slug: string, siteName = 'Unique Distribution'): PageMeta {
  return {
    title: `${title} | ${siteName}`,
    description: stripHtml(description ?? '').slice(0, 160) || `Browse ${title} at ${siteName}.`,
    path: `/collection/${slug}`,
  }
}

export function buildMarketingPageMeta(page: { title: string; metaDescription?: string; slug: string }, siteName = 'Unique Distribution'): PageMeta {
  return {
    title: `${page.title} | ${siteName}`,
    description: page.metaDescription?.slice(0, 160) || `${page.title} — ${siteName}`,
    path: `/pages/${page.slug}`,
  }
}
