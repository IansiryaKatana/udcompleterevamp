import { Link } from '@tanstack/react-router'
import type { ProductBundle, ProductVariant } from '@/data/static-cms'
import type { BundleSelection } from '@/lib/stores/cart-store'
import { bundleItemRequiresSelection, bundleItemVariants } from '@/lib/bundles/mapBundle'
import { BrandedSelect } from '@/components/ui/BrandedSelect'

type BundleIncludedItemsProps = {
  bundle: ProductBundle
  selections: BundleSelection[]
  onSelectionChange: (bundleItemId: string, variant: ProductVariant | null) => void
}

export function BundleIncludedItems({ bundle, selections, onSelectionChange }: BundleIncludedItemsProps) {
  return (
    <div className="rounded-xl border border-brand-border p-4 md:p-6">
      <h2 className="font-display text-lg font-extrabold text-text-brown">What&apos;s included</h2>
      <ul className="mt-4 space-y-4">
        {bundle.items.map((item) => {
          const requiresSelection = bundleItemRequiresSelection(item)
          const variants = bundleItemVariants(item)
          const selectedVariantId = item.variantId
            ?? selections.find((s) => s.bundleItemId === item.id)?.variantId
            ?? ''

          return (
            <li key={item.id} className="flex flex-col gap-3 border-b border-brand-border pb-4 last:border-b-0 last:pb-0 sm:flex-row sm:items-start">
              <img
                src={item.product.imageUrl}
                alt=""
                className="h-16 w-16 shrink-0 rounded-lg bg-[#f3f1ec] object-cover object-center"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-bold text-text-brown">
                    {item.label ?? item.product.name}
                    {item.quantity > 1 ? ` × ${item.quantity}` : ''}
                  </p>
                  <Link
                    to="/product/$slug"
                    params={{ slug: item.product.slug }}
                    className="text-xs font-semibold text-muted underline-offset-2 hover:underline"
                  >
                    View product
                  </Link>
                </div>
                <p className="mt-1 text-xs text-muted">{item.product.name}</p>
                {requiresSelection && variants.length > 0 ? (
                  <div className="mt-3 max-w-xs">
                    <label className="mb-1 block text-xs font-semibold text-text-brown">Choose option</label>
                    <BrandedSelect
                      value={selectedVariantId}
                      onValueChange={(value) => {
                        const variant = variants.find((v) => v.id === value) ?? null
                        onSelectionChange(item.id, variant)
                      }}
                      placeholder="Select variant"
                      variant="storefront"
                      options={variants.map((variant) => ({
                        value: variant.id,
                        label: `${variant.name}${variant.inventoryCount <= 0 ? ' (out of stock)' : ''}`,
                      }))}
                    />
                  </div>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
