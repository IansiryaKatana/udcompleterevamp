/**
 * CarrierProvider adapter wrapping DPD client.
 * Never enables live network calls while product is unconfirmed / mode disabled.
 */
import type {
  CarrierCreateShipmentRequest,
  CarrierEnvironment,
  CarrierLabelResult,
  CarrierProvider,
  CarrierShipmentResult,
  CarrierTrackingResult,
  CarrierWebhookParseResult,
} from '@/admin/lib/carrierProvider'
import { DisabledCarrierProvider } from '@/admin/lib/carrierProvider'
import { UnconfirmedDpdClient, type DpdClient } from '@/admin/lib/dpd/dpdClient'

export type CarrierRuntimeConfig = {
  mode: CarrierEnvironment
  productStatus: 'unconfirmed' | 'confirmed'
  liveBlocked: boolean
  testCredentialsPresent: boolean
}

export class DpdCarrierAdapter implements CarrierProvider {
  readonly providerId = 'dpd'
  readonly displayName = 'DPD (UK)'
  readonly environment: CarrierEnvironment
  private readonly client: DpdClient
  private readonly config: CarrierRuntimeConfig

  constructor(config: CarrierRuntimeConfig, client?: DpdClient) {
    this.config = config
    this.environment = config.mode
    this.client = client ?? new UnconfirmedDpdClient()
  }

  private gate(): CarrierShipmentResult | null {
    if (this.config.mode === 'disabled') {
      return { ok: false, error: 'carrier_disabled' }
    }
    if (this.config.mode === 'live' && this.config.liveBlocked) {
      return { ok: false, error: 'carrier_live_blocked' }
    }
    if (this.config.productStatus !== 'confirmed' || this.client.productStatus !== 'confirmed') {
      return { ok: false, error: 'dpd_product_unconfirmed' }
    }
    if (this.config.mode === 'test' && !this.config.testCredentialsPresent) {
      return { ok: false, error: 'dpd_test_credentials_missing' }
    }
    return null
  }

  async createShipment(req: CarrierCreateShipmentRequest): Promise<CarrierShipmentResult> {
    const blocked = this.gate()
    if (blocked) return blocked
    if (!req.parcels?.length) return { ok: false, error: 'parcels_required' }
    const res = await this.client.createConsignment({
      fulfillmentId: req.fulfillmentId,
      orderId: req.orderId,
      serviceCode: req.serviceCode,
      parcels: req.parcels.map((p, i) => ({
        sequence: i + 1,
        weightKg: p.weightKg,
        reference: p.reference,
      })),
      recipient: {
        name: req.recipientName,
        addressLines: req.addressLines,
        city: req.city,
        postalCode: req.postalCode,
        countryCode: req.countryCode,
      },
      environment: this.config.mode === 'live' ? 'live' : 'test',
    })
    return {
      ok: res.ok,
      error: res.error,
      externalShipmentId: res.externalShipmentId,
      trackingNumber: res.trackingNumbers?.[0],
      trackingUrl: res.trackingUrls?.[0],
      labelReference: res.labelReference,
      carrierStatus: res.rawStatus,
    }
  }

  async cancelShipment(externalShipmentId: string, reason?: string): Promise<CarrierShipmentResult> {
    const blocked = this.gate()
    if (blocked) return blocked
    const res = await this.client.cancelConsignment(externalShipmentId, reason)
    return { ok: res.ok, error: res.error, externalShipmentId }
  }

  async getLabel(externalShipmentId: string): Promise<CarrierLabelResult> {
    const blocked = this.gate()
    if (blocked) return { ok: false, error: blocked.error }
    const res = await this.client.getLabel(externalShipmentId)
    return { ok: res.ok, error: res.error, storageRef: res.storageRef, contentType: res.format }
  }

  async getTracking(trackingNumber: string): Promise<CarrierTrackingResult> {
    const blocked = this.gate()
    if (blocked) return { ok: false, error: blocked.error }
    const res = await this.client.getTracking(trackingNumber)
    return {
      ok: res.ok,
      error: res.error,
      events: res.events?.map((e) => ({
        externalEventId: e.externalEventId,
        eventType: e.statusRaw,
        status: e.statusRaw,
        description: e.description,
        location: e.location,
        occurredAt: e.occurredAt,
      })),
    }
  }

  async parseWebhook(): Promise<CarrierWebhookParseResult> {
    // WSA historically polled; Unique webhook support requires confirmed DPD product docs.
    return {
      ok: false,
      verified: false,
      unknown: true,
      error: 'dpd_webhook_unsupported_until_product_confirmed',
    }
  }
}

export function resolveCarrierProvider(config?: Partial<CarrierRuntimeConfig>): CarrierProvider {
  const resolved: CarrierRuntimeConfig = {
    mode: config?.mode ?? 'disabled',
    productStatus: config?.productStatus ?? 'unconfirmed',
    liveBlocked: config?.liveBlocked ?? true,
    testCredentialsPresent: config?.testCredentialsPresent ?? false,
  }
  if (resolved.mode === 'disabled') return new DisabledCarrierProvider()
  return new DpdCarrierAdapter(resolved)
}
