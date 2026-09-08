import type { Product } from '@/data/static-cms'
import { RichTextContent } from '@/components/content/RichTextContent'
import { SectionContainer } from '@/components/layout/SectionContainer'
import {
  ProductFeatureBlocks,
  ProductSpecsList,
  productSectionProseClass,
  type ProductSectionBlock,
} from '@/components/product/ProductFeatureBlocks'
import { ProductGallery } from '@/components/product/ProductGallery'
import { ProductReviewSection, ProductRatingStars } from '@/components/product/ProductReviewSection'

function hasOverview(product: Product) {
  return Boolean(product.overview?.trim())
}

function hasFeatures(product: Product) {
  return Boolean(product.specs && product.specs.length > 0)
}

function hasDelivery(product: Product) {
  return Boolean(product.deliveryText?.trim())
}

function hasReviews(product: Product) {
  return Boolean(product.reviews && product.reviews.count > 0)
}

function buildDetailSections(product: Product): ProductSectionBlock[] {
  const sections: ProductSectionBlock[] = []

  if (hasOverview(product)) {
    sections.push({
      label: 'Overview',
      content: (
        <RichTextContent html={product.overview ?? ''} className={productSectionProseClass} />
      ),
    })
  }

  if (hasFeatures(product)) {
    sections.push({
      label: 'Specifications',
      content: <ProductSpecsList specs={product.specs ?? []} />,
    })
  }

  if (product.packQuantity) {
    sections.push({
      label: 'Pack / case information',
      content: <p className="text-sm text-muted">Pack quantity: {product.packQuantity}. Case quantities are shown only when present on the product record.</p>,
    })
  }

  if (hasDelivery(product)) {
    sections.push({
      label: 'Delivery',
      content: (
        <RichTextContent html={product.deliveryText ?? ''} className={productSectionProseClass} />
      ),
    })
  }

  if (hasReviews(product)) {
    const count = product.reviews!.count
    sections.push({
      label: count > 0 ? `Reviews (${count})` : 'Reviews',
      headerAddon: <ProductRatingStars rating={product.reviews!.averageRating} />,
      content: <ProductReviewSection product={product} showApprovedOnly />,
    })
  }

  return sections
}

type ProductDetailSectionsProps = {
  product: Product
  imageUrl: string
  galleryUrls?: string[]
}

export function ProductDetailSections({ product, imageUrl, galleryUrls }: ProductDetailSectionsProps) {
  const sections = buildDetailSections(product)

  if (sections.length === 0) {
    return (
      <SectionContainer className="pb-16 pt-12 md:pt-16">
        <ProductReviewSection product={product} showApprovedOnly={false} />
      </SectionContainer>
    )
  }

  return (
    <SectionContainer className="pb-16 pt-12 md:pt-16">
      <div className="grid items-start gap-10 md:grid-cols-2 md:gap-14">
        <div className="min-w-0">
          <ProductFeatureBlocks sections={sections} />

          <div className="border-t border-dotted border-border/35 pt-8">
            <ProductReviewSection product={product} showApprovedOnly={false} />
          </div>
        </div>

        <div className="hidden md:block">
          <div className="sticky top-6 ml-auto w-fit self-start">
            <ProductGallery
              name={product.name}
              imageUrl={imageUrl}
              galleryUrls={galleryUrls}
              variant="detail"
            />
          </div>
        </div>
      </div>
    </SectionContainer>
  )
}