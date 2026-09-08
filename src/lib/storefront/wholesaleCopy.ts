const CONSUMER_PHRASES =
  /your next favourite|next favorite vape|favourite vape|vaping journey|perfect vape|personal vaping|dream setup|tech that powers|latest tech|top gear|vaping experience|every vaper|on-the-go vaping|elevate your vaping/i

export function firstPlainParagraph(htmlOrText?: string | null): string {
  if (!htmlOrText?.trim()) return ''
  const text = htmlOrText
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const sentence = text.split(/(?<=\.)\s/)[0] ?? text
  return sentence.trim()
}

export function wholesaleCollectionIntro(title: string, description?: string | null): { intro: string; seoBody?: string } {
  const full = firstPlainParagraph(description)
  const isConsumer = CONSUMER_PHRASES.test(full) || CONSUMER_PHRASES.test(description ?? '')
  const intro =
    full && !isConsumer
      ? full.length > 180
        ? `${full.slice(0, 177).trim()}…`
        : full
      : `Browse ${title} available for wholesale ordering from Unique Distribution.`
  const seoBody = description && full.length > 180 ? description : undefined
  return { intro, seoBody }
}

export function productMetaChips(product: {
  vendor?: string | null
  productType?: string | null
  nicotineStrength?: string | null
  packQuantity?: string | null
}): Array<{ label: string; value: string }> {
  const chips: Array<{ label: string; value: string }> = []
  if (product.vendor) chips.push({ label: 'Brand', value: product.vendor })
  if (product.productType) chips.push({ label: 'Type', value: product.productType })
  if (product.nicotineStrength) chips.push({ label: 'Strength', value: product.nicotineStrength })
  if (product.packQuantity) chips.push({ label: 'Pack', value: product.packQuantity })
  return chips
}
