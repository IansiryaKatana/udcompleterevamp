/**
 * Phase 3B DPD client / DTO layer.
 *
 * DPD PRODUCT STATUS = UNCONFIRMED at the national API level.
 * Historical path: Shopify "DPD Integration by WSA" (WebShopAssist) → UK DPD Local / DPD UK
 * tracking hosts (www.dpdlocal.co.uk, www.dpd.co.uk). Exact GeoSession/Shipper/etc. API
 * is NOT confirmed. This module must not invent endpoints or call production DPD.
 */

export type DpdProductStatus = 'unconfirmed' | 'confirmed'

export type DpdUkProductCandidate =
  | 'dpd_uk_unconfirmed'
  | 'dpd_local_uk_unconfirmed'
  | 'dpd_uk_geosession_unconfirmed'
  | 'dpd_uk_shipper_unconfirmed'

/** Redacted request shape — never include secrets or PAN. */
export type DpdShipmentRequestDto = {
  fulfillmentId: string
  orderId: string
  consignmentReference?: string
  serviceCode?: string
  parcels: Array<{
    sequence: number
    weightKg?: number
    reference?: string
  }>
  recipient: {
    name: string
    company?: string
    addressLines: string[]
    city?: string
    postalCode?: string
    countryCode?: string
    phone?: string
    email?: string
  }
  environment: 'test' | 'live'
}

export type DpdShipmentResponseDto = {
  ok: boolean
  error?: string
  externalShipmentId?: string
  consignmentReference?: string
  trackingNumbers?: string[]
  trackingUrls?: string[]
  labelFormat?: 'pdf' | 'png' | 'zpl' | 'unknown'
  labelReference?: string
  rawStatus?: string
}

export type DpdTrackingEventDto = {
  externalEventId?: string
  statusRaw: string
  description?: string
  location?: string
  occurredAt?: string
}

/**
 * Transport interface only. Implementations must use official docs for the
 * confirmed product. Current default: refuse all network I/O.
 */
export interface DpdClient {
  readonly productKey: string
  readonly productStatus: DpdProductStatus
  createConsignment(req: DpdShipmentRequestDto): Promise<DpdShipmentResponseDto>
  cancelConsignment(externalId: string, reason?: string): Promise<DpdShipmentResponseDto>
  getLabel(externalId: string): Promise<{ ok: boolean; format?: string; storageRef?: string; error?: string }>
  getTracking(trackingNumber: string): Promise<{ ok: boolean; events?: DpdTrackingEventDto[]; error?: string }>
}

export class UnconfirmedDpdClient implements DpdClient {
  readonly productKey = 'dpd_uk_unconfirmed'
  readonly productStatus: DpdProductStatus = 'unconfirmed'

  async createConsignment(): Promise<DpdShipmentResponseDto> {
    return {
      ok: false,
      error: 'dpd_product_unconfirmed',
    }
  }
  async cancelConsignment(): Promise<DpdShipmentResponseDto> {
    return { ok: false, error: 'dpd_product_unconfirmed' }
  }
  async getLabel() {
    return { ok: false, error: 'dpd_product_unconfirmed' }
  }
  async getTracking() {
    return { ok: false, error: 'dpd_product_unconfirmed' }
  }
}

/** Map Shopify/WSA display_status → Unique delivery status (preserve raw separately). */
export function mapDpdDisplayStatusToDelivery(raw: string | null | undefined): string {
  const s = (raw || '').toUpperCase()
  if (s === 'DELIVERED') return 'DELIVERED'
  if (s === 'OUT_FOR_DELIVERY') return 'OUT_FOR_DELIVERY'
  if (s === 'IN_TRANSIT') return 'IN_TRANSIT'
  if (s === 'NOT_DELIVERED' || s === 'FAILED') return 'FAILED'
  if (s === 'FULFILLED' || s === 'CONFIRMED' || s === 'MARKED_AS_FULFILLED') return 'DISPATCHED'
  if (s === 'CANCELED' || s === 'CANCELLED') return 'UNKNOWN'
  return 'UNKNOWN'
}

export function normalizeCarrierProvider(rawCompany: string | null | undefined): string | null {
  const c = (rawCompany || '').trim().toLowerCase()
  if (!c) return null
  if (c.includes('dpd')) return 'dpd'
  if (c === 'dx') return 'dx'
  if (c.includes('ups')) return 'ups'
  return 'other'
}

/** Canonical provider for historical DPD* labels — does not erase carrier_name_raw. */
export const DPD_RAW_LABELS = ['DPD', 'DPD UK', 'DPD Local'] as const

export const DPD_REQUIREMENTS_FOR_LIVE = [
  'Confirm exact UK DPD product/API family (not only WSA Shopify app)',
  'Merchant entity / account number for DPD UK and/or DPD Local',
  'Official TEST credentials + base URL from DPD docs for that product',
  'Official service-code catalogue for Standard / Saturday / etc.',
  'Label format (PDF/PNG/ZPL) and storage approval',
  'Tracking mechanism (poll vs webhook) + webhook secret if any',
  'Multi-parcel rules for UD consignments',
  'Default/fallback weight policy (business decision — do not invent)',
  'Approval to set carrier_mode=test (still never live in 3B)',
  'Rollback / disable procedure',
] as const
