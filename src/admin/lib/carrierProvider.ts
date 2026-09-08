/**
 * Generic carrier / shipping provider interface.
 * Phase 3A: foundation only — no live DPD/Veeqo/SKULabs API calls.
 *
 * DPD Integration by WSA is historically evidenced in Shopify (tracking + events)
 * but the exact DPD product/API is NOT confirmed. Implementations must sit behind
 * this interface and must not be enabled without credentials + official docs.
 */

export type CarrierEnvironment = 'disabled' | 'test' | 'live'

export type CarrierCreateShipmentRequest = {
  orderId: string
  fulfillmentId: string
  recipientName: string
  addressLines: string[]
  city?: string
  postalCode?: string
  countryCode?: string
  parcels: { weightKg?: number; reference?: string }[]
  serviceCode?: string
  metadata?: Record<string, unknown>
}

export type CarrierShipmentResult = {
  ok: boolean
  externalShipmentId?: string
  trackingNumber?: string
  trackingUrl?: string
  labelReference?: string
  carrierStatus?: string
  error?: string
  rawRedacted?: Record<string, unknown>
}

export type CarrierTrackingResult = {
  ok: boolean
  status?: string
  events?: {
    externalEventId?: string
    eventType: string
    status?: string
    description?: string
    location?: string
    occurredAt?: string
  }[]
  error?: string
}

export type CarrierLabelResult = {
  ok: boolean
  contentType?: string
  storageRef?: string
  bytesBase64?: string
  error?: string
}

export type CarrierWebhookParseResult = {
  ok: boolean
  verified: boolean
  externalEventId?: string
  eventType?: string
  status?: string
  trackingNumber?: string
  unknown: boolean
  error?: string
  safePayload?: Record<string, unknown>
}

/**
 * Carrier-agnostic provider contract.
 * Core fulfilment business logic must depend on this interface — not on DPD types.
 */
export interface CarrierProvider {
  readonly providerId: string
  readonly displayName: string
  readonly environment: CarrierEnvironment

  createShipment(req: CarrierCreateShipmentRequest): Promise<CarrierShipmentResult>
  cancelShipment(externalShipmentId: string, reason?: string): Promise<CarrierShipmentResult>
  getLabel(externalShipmentId: string): Promise<CarrierLabelResult>
  getTracking(trackingNumber: string): Promise<CarrierTrackingResult>
  parseWebhook(
    headers: Record<string, string>,
    rawBody: string,
  ): Promise<CarrierWebhookParseResult>
}

/** Stub provider — always disabled. No network I/O. */
export class DisabledCarrierProvider implements CarrierProvider {
  readonly providerId = 'disabled'
  readonly displayName = 'No carrier integration'
  readonly environment: CarrierEnvironment = 'disabled'

  async createShipment(): Promise<CarrierShipmentResult> {
    return { ok: false, error: 'carrier_disabled' }
  }
  async cancelShipment(): Promise<CarrierShipmentResult> {
    return { ok: false, error: 'carrier_disabled' }
  }
  async getLabel(): Promise<CarrierLabelResult> {
    return { ok: false, error: 'carrier_disabled' }
  }
  async getTracking(): Promise<CarrierTrackingResult> {
    return { ok: false, error: 'carrier_disabled' }
  }
  async parseWebhook(): Promise<CarrierWebhookParseResult> {
    return { ok: false, verified: false, unknown: true, error: 'carrier_disabled' }
  }
}

/**
 * Placeholder for a future DPD adapter.
 * NOT wired. Do not invent endpoints. Requires confirmed product + credentials.
 */
export class UnconfirmedDpdCarrierProvider implements CarrierProvider {
  readonly providerId = 'dpd_unconfirmed'
  readonly displayName = 'DPD (product unconfirmed)'
  readonly environment: CarrierEnvironment = 'disabled'

  async createShipment(): Promise<CarrierShipmentResult> {
    return {
      ok: false,
      error: 'dpd_product_unconfirmed',
      rawRedacted: { note: 'Shopify footprint only; no live DPD API in Phase 3A' },
    }
  }
  async cancelShipment(): Promise<CarrierShipmentResult> {
    return { ok: false, error: 'dpd_product_unconfirmed' }
  }
  async getLabel(): Promise<CarrierLabelResult> {
    return { ok: false, error: 'dpd_product_unconfirmed' }
  }
  async getTracking(): Promise<CarrierTrackingResult> {
    return { ok: false, error: 'dpd_product_unconfirmed' }
  }
  async parseWebhook(): Promise<CarrierWebhookParseResult> {
    return {
      ok: false,
      verified: false,
      unknown: true,
      error: 'dpd_product_unconfirmed',
    }
  }
}

export function getActiveCarrierProvider(): CarrierProvider {
  // Phase 3B: always disabled until carrier_gateway_config confirms product + credentials.
  // Runtime admin UI should call resolveCarrierProvider after rpc_admin_carrier_config_get.
  return new DisabledCarrierProvider()
}

export { resolveCarrierProvider, DpdCarrierAdapter } from '@/admin/lib/dpd/dpdCarrierAdapter'
export type { CarrierRuntimeConfig } from '@/admin/lib/dpd/dpdCarrierAdapter'
