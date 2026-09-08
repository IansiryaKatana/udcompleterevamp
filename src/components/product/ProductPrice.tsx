import { useFormatPrice } from '@/lib/currency'
import { cn } from '@/lib/utils'

type ProductPriceProps = {
  price: number
  compareAtPrice?: number | null
  priceRestricted?: boolean
  restrictedLabel?: string
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

export function ProductPrice({
  price,
  compareAtPrice,
  priceRestricted,
  restrictedLabel,
  className,
  size = 'md',
}: ProductPriceProps) {
  const formatPrice = useFormatPrice()
  const sizeClass = size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-lg' : 'text-lg'

  if (priceRestricted) {
    return (
      <div className={cn('flex flex-wrap items-baseline gap-2', className)}>
        <span className={cn('font-semibold text-muted', size === 'lg' ? 'text-base' : 'text-sm')}>
          {restrictedLabel || 'Trade pricing available after approval'}
        </span>
      </div>
    )
  }

  const onSale = compareAtPrice != null && compareAtPrice > price

  return (
    <div className={cn('flex flex-wrap items-baseline gap-2', className)}>
      <span className={cn('font-extrabold text-[#1d1813]', sizeClass)}>{formatPrice(price)}</span>
      {onSale ? (
        <span className="text-sm font-medium text-muted line-through">{formatPrice(compareAtPrice)}</span>
      ) : null}
    </div>
  )
}
