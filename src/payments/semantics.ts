/**
 * Payment transaction semantic classification — mirrors SQL `payment_tx_semantic_classify`.
 * PENDING ≠ RECEIVED universally (Bank Deposit PENDING, PAY LATER PENDING, etc.).
 */

export type PaymentSemanticMeaning =
  | 'MANUAL_PAYMENT_RECORDED'
  | 'SETTLED_SALE'
  | 'PENDING_EXTERNAL_PAYMENT'
  | 'AUTHORIZED'
  | 'CAPTURED'
  | 'REFUNDED'
  | 'REFUND_PENDING'
  | 'VOIDED'
  | 'REVERSAL'
  | 'FAILED'
  | 'UNKNOWN'

export type TerminalOrTransient = 'terminal' | 'transient' | 'unknown'
export type SemanticConfidence = 'high' | 'medium' | 'low'

export type PaymentSemanticResult = {
  meaning: PaymentSemanticMeaning
  affects_received: boolean
  affects_outstanding: boolean
  affects_available_to_capture: boolean
  affects_refunded: boolean
  terminal_or_transient: TerminalOrTransient
  confidence: SemanticConfidence
  evidence: string
  gateway: string | null
  kind: string
  status: string
}

export type ClassifyPaymentTransactionInput = {
  gateway?: string | null
  kind?: string | null
  status?: string | null
  sourceSystem?: string | null
}

function buildResult(
  partial: Omit<PaymentSemanticResult, 'gateway' | 'kind' | 'status'>,
  gateway: string | null,
  kind: string,
  status: string,
): PaymentSemanticResult {
  return { ...partial, gateway, kind, status }
}

/** Mirrors `public.payment_tx_semantic_classify` in migration 061. */
export function classifyPaymentTransaction(input: ClassifyPaymentTransactionInput): PaymentSemanticResult {
  const g = (input.gateway ?? '').trim().toLowerCase()
  const k = (input.kind ?? '').trim().toUpperCase()
  const s = (input.status ?? '').trim().toUpperCase()
  const src = (input.sourceSystem ?? '').trim().toLowerCase()
  const rawGateway = input.gateway ?? null

  // Unique-native manual posts
  if (src === 'unique' && ['SALE', 'PAYMENT', 'CAPTURE'].includes(k) && s === 'SUCCESS') {
    return buildResult(
      {
        meaning: 'MANUAL_PAYMENT_RECORDED',
        affects_received: true,
        affects_outstanding: true,
        affects_available_to_capture: false,
        affects_refunded: false,
        terminal_or_transient: 'terminal',
        confidence: 'high',
        evidence: 'Unique-native successful money post',
      },
      rawGateway,
      k,
      s,
    )
  }
  if (src === 'unique' && ['REFUND', 'REVERSAL'].includes(k) && s === 'SUCCESS') {
    return buildResult(
      {
        meaning: k === 'REVERSAL' ? 'REVERSAL' : 'REFUNDED',
        affects_received: false,
        affects_outstanding: true,
        affects_available_to_capture: false,
        affects_refunded: true,
        terminal_or_transient: 'terminal',
        confidence: 'high',
        evidence: 'Unique-native refund/reversal',
      },
      rawGateway,
      k,
      s,
    )
  }

  let meaning: PaymentSemanticMeaning = 'UNKNOWN'
  let affects_received = false
  let affects_outstanding = false
  let affects_available_to_capture = false
  let affects_refunded = false
  let terminal_or_transient: TerminalOrTransient = 'unknown'
  let confidence: SemanticConfidence = 'low'
  let evidence = 'unclassified combination'

  if (g.includes('worldpay')) {
    if (k === 'SALE' && s === 'SUCCESS') {
      meaning = 'SETTLED_SALE'
      affects_received = true
      affects_outstanding = true
      terminal_or_transient = 'terminal'
      confidence = 'high'
      evidence = 'n=10173 Worldpay SALE SUCCESS historically'
    } else if (k === 'SALE' && (s === 'FAILURE' || s === 'ERROR')) {
      meaning = 'FAILED'
      terminal_or_transient = 'terminal'
      confidence = 'high'
      evidence = 'Worldpay SALE FAILURE/ERROR — not cash'
    } else if (k === 'REFUND' && s === 'SUCCESS') {
      meaning = 'REFUNDED'
      affects_refunded = true
      affects_outstanding = true
      terminal_or_transient = 'terminal'
      confidence = 'high'
      evidence = 'Worldpay REFUND SUCCESS'
    } else if (k === 'REFUND' && s === 'PENDING') {
      meaning = 'REFUND_PENDING'
      terminal_or_transient = 'transient'
      confidence = 'medium'
      evidence = 'Rare Worldpay REFUND PENDING'
    } else if (k === 'REFUND' && s === 'FAILURE') {
      meaning = 'FAILED'
      terminal_or_transient = 'terminal'
      confidence = 'high'
      evidence = 'Worldpay REFUND FAILURE'
    } else if (k === 'AUTHORIZATION' && s === 'SUCCESS') {
      meaning = 'AUTHORIZED'
      affects_available_to_capture = true
      terminal_or_transient = 'transient'
      confidence = 'medium'
      evidence = 'Auth present in model; rare in UD Worldpay history'
    } else if (k === 'CAPTURE' && s === 'SUCCESS') {
      meaning = 'CAPTURED'
      affects_received = true
      affects_outstanding = true
      terminal_or_transient = 'terminal'
      confidence = 'medium'
      evidence = 'Capture kind supported; sparse historically for Worldpay label'
    } else if (k === 'VOID' && s === 'SUCCESS') {
      meaning = 'VOIDED'
      terminal_or_transient = 'terminal'
      confidence = 'medium'
      evidence = 'Void cancels auth/pending — not a refund'
    } else {
      meaning = 'UNKNOWN'
      confidence = 'low'
      evidence = `Unmapped Worldpay ${k}/${s}`
    }
  } else if (g === 'bank deposit') {
    if (k === 'SALE' && s === 'SUCCESS') {
      meaning = 'MANUAL_PAYMENT_RECORDED'
      affects_received = true
      affects_outstanding = true
      terminal_or_transient = 'terminal'
      confidence = 'high'
      evidence = 'n=9749 Bank Deposit SALE SUCCESS'
    } else if (k === 'SALE' && s === 'PENDING') {
      meaning = 'PENDING_EXTERNAL_PAYMENT'
      affects_received = false
      affects_outstanding = false
      terminal_or_transient = 'transient'
      confidence = 'high'
      evidence = 'n=6772 Bank Deposit PENDING — awaiting remittance, NOT received'
    } else if (k === 'VOID' && s === 'SUCCESS') {
      meaning = 'VOIDED'
      terminal_or_transient = 'terminal'
      confidence = 'high'
      evidence = 'Bank Deposit VOID cancels pending intent'
    } else if (k === 'REFUND' && s === 'SUCCESS') {
      meaning = 'REFUNDED'
      affects_refunded = true
      affects_outstanding = true
      terminal_or_transient = 'terminal'
      confidence = 'high'
      evidence = 'Bank Deposit REFUND SUCCESS (rare)'
    } else {
      meaning = 'UNKNOWN'
      confidence = 'low'
      evidence = `Unmapped Bank Deposit ${k}/${s}`
    }
  } else if (g === 'manual') {
    if (k === 'SALE' && s === 'SUCCESS') {
      meaning = 'MANUAL_PAYMENT_RECORDED'
      affects_received = true
      affects_outstanding = true
      terminal_or_transient = 'terminal'
      confidence = 'high'
      evidence = 'n=3049 manual SALE SUCCESS'
    } else if (k === 'REFUND' && s === 'SUCCESS') {
      meaning = 'REFUNDED'
      affects_refunded = true
      affects_outstanding = true
      terminal_or_transient = 'terminal'
      confidence = 'high'
      evidence = 'manual REFUND SUCCESS'
    } else {
      meaning = 'UNKNOWN'
      confidence = 'low'
      evidence = `Unmapped manual ${k}/${s}`
    }
  } else if (g === 'pay by cash') {
    if (k === 'SALE' && s === 'SUCCESS') {
      meaning = 'MANUAL_PAYMENT_RECORDED'
      affects_received = true
      affects_outstanding = true
      terminal_or_transient = 'terminal'
      confidence = 'high'
      evidence = 'Pay By Cash SALE SUCCESS'
    } else if (k === 'SALE' && s === 'PENDING') {
      meaning = 'PENDING_EXTERNAL_PAYMENT'
      affects_received = false
      terminal_or_transient = 'transient'
      confidence = 'high'
      evidence = 'Pay By Cash PENDING is not cash received'
    } else if (k === 'REFUND' && s === 'SUCCESS') {
      meaning = 'REFUNDED'
      affects_refunded = true
      affects_outstanding = true
      terminal_or_transient = 'terminal'
      confidence = 'high'
      evidence = 'Pay By Cash REFUND'
    } else {
      meaning = 'UNKNOWN'
      confidence = 'low'
      evidence = `Unmapped cash ${k}/${s}`
    }
  } else if (g === 'pay later' || g === 'order now, pay later') {
    if (k === 'SALE' && s === 'PENDING') {
      meaning = 'PENDING_EXTERNAL_PAYMENT'
      affects_received = false
      terminal_or_transient = 'transient'
      confidence = 'high'
      evidence = 'PAY LATER PENDING is credit commitment, not received cash'
    } else if (k === 'SALE' && s === 'SUCCESS') {
      meaning = 'SETTLED_SALE'
      affects_received = true
      affects_outstanding = true
      terminal_or_transient = 'terminal'
      confidence = 'medium'
      evidence = 'Rare PAY LATER SALE SUCCESS (n=10) — treated as settled when SUCCESS'
    } else if (k === 'VOID' && s === 'SUCCESS') {
      meaning = 'VOIDED'
      terminal_or_transient = 'terminal'
      confidence = 'high'
      evidence = 'PAY LATER VOID clears commitment'
    } else {
      meaning = 'UNKNOWN'
      confidence = 'low'
      evidence = `Unmapped PAY LATER ${k}/${s}`
    }
  } else if (g === 'shopify_store_credit') {
    if (k === 'AUTHORIZATION' && s === 'SUCCESS') {
      meaning = 'AUTHORIZED'
      affects_available_to_capture = true
      terminal_or_transient = 'transient'
      confidence = 'high'
      evidence = 'store_credit AUTHORIZATION'
    } else if (k === 'CAPTURE' && s === 'SUCCESS') {
      meaning = 'CAPTURED'
      affects_received = true
      affects_outstanding = true
      terminal_or_transient = 'terminal'
      confidence = 'high'
      evidence = 'store_credit CAPTURE'
    } else if (k === 'SALE' && s === 'SUCCESS') {
      meaning = 'SETTLED_SALE'
      affects_received = true
      affects_outstanding = true
      terminal_or_transient = 'terminal'
      confidence = 'high'
      evidence = 'store_credit SALE'
    } else if (k === 'REFUND' && s === 'SUCCESS') {
      meaning = 'REFUNDED'
      affects_refunded = true
      affects_outstanding = true
      terminal_or_transient = 'terminal'
      confidence = 'high'
      evidence = 'store_credit REFUND'
    } else {
      meaning = 'UNKNOWN'
      confidence = 'low'
      evidence = `Unmapped store_credit ${k}/${s}`
    }
  } else if (g === 'shopify_payments') {
    if (k === 'SALE' && s === 'SUCCESS') {
      meaning = 'SETTLED_SALE'
      affects_received = true
      affects_outstanding = true
      terminal_or_transient = 'terminal'
      confidence = 'high'
      evidence = 'shopify_payments SALE SUCCESS (rare)'
    } else {
      meaning = 'UNKNOWN'
      confidence = 'low'
      evidence = `Unmapped shopify_payments ${k}/${s}`
    }
  } else {
    if (k === 'SALE' && s === 'SUCCESS') {
      meaning = 'SETTLED_SALE'
      affects_received = true
      affects_outstanding = true
      terminal_or_transient = 'terminal'
      confidence = 'low'
      evidence = 'Generic SUCCESS SALE fallback — low confidence'
    } else if (k === 'SALE' && s === 'PENDING') {
      meaning = 'PENDING_EXTERNAL_PAYMENT'
      affects_received = false
      terminal_or_transient = 'transient'
      confidence = 'medium'
      evidence = 'Generic PENDING SALE — not received'
    } else if (k === 'REFUND' && s === 'SUCCESS') {
      meaning = 'REFUNDED'
      affects_refunded = true
      affects_outstanding = true
      terminal_or_transient = 'terminal'
      confidence = 'medium'
      evidence = 'Generic REFUND SUCCESS'
    } else if (k === 'VOID' && s === 'SUCCESS') {
      meaning = 'VOIDED'
      terminal_or_transient = 'terminal'
      confidence = 'medium'
      evidence = 'Generic VOID'
    } else {
      meaning = 'UNKNOWN'
      confidence = 'low'
      evidence = `Unmapped gateway=${input.gateway ?? ''} kind=${k} status=${s}`
    }
  }

  return buildResult(
    {
      meaning,
      affects_received,
      affects_outstanding,
      affects_available_to_capture,
      affects_refunded,
      terminal_or_transient,
      confidence,
      evidence,
    },
    rawGateway,
    k,
    s,
  )
}

/** Documented rows for major historical gateway × kind × status combinations. */
export const PAYMENT_SEMANTIC_MATRIX: Array<
  ClassifyPaymentTransactionInput & { label: string; observedNote?: string }
> = [
  {
    label: 'Worldpay settled sale',
    gateway: 'Worldpay eCommerce',
    kind: 'SALE',
    status: 'SUCCESS',
    sourceSystem: 'shopify',
    observedNote: 'n≈10173 — counts as received',
  },
  {
    label: 'Bank Deposit pending remittance',
    gateway: 'Bank Deposit',
    kind: 'SALE',
    status: 'PENDING',
    sourceSystem: 'shopify',
    observedNote: 'n≈6772 — NOT received until SUCCESS',
  },
  {
    label: 'Bank Deposit settled',
    gateway: 'Bank Deposit',
    kind: 'SALE',
    status: 'SUCCESS',
    sourceSystem: 'shopify',
    observedNote: 'n≈9749 — received when SUCCESS',
  },
  {
    label: 'PAY LATER commitment',
    gateway: 'PAY LATER',
    kind: 'SALE',
    status: 'PENDING',
    sourceSystem: 'shopify',
    observedNote: 'Credit commitment — not cash',
  },
  {
    label: 'Manual Unique post',
    gateway: 'Bank transfer',
    kind: 'SALE',
    status: 'SUCCESS',
    sourceSystem: 'unique',
    observedNote: 'Unique-native manual payment',
  },
  {
    label: 'Worldpay void',
    gateway: 'Worldpay eCommerce',
    kind: 'VOID',
    status: 'SUCCESS',
    sourceSystem: 'shopify',
    observedNote: 'Void ≠ refund',
  },
  {
    label: 'Bank Deposit void',
    gateway: 'Bank Deposit',
    kind: 'VOID',
    status: 'SUCCESS',
    sourceSystem: 'shopify',
    observedNote: 'Cancels pending intent — not refund',
  },
]

/** Assert PENDING external payments never count as received. */
export function pendingDoesNotEqualReceived(result: PaymentSemanticResult): boolean {
  if (result.meaning === 'PENDING_EXTERNAL_PAYMENT') {
    return result.affects_received === false
  }
  return true
}

/** Assert a classification that should affect received does so. */
export function assertAffectsReceived(result: PaymentSemanticResult, expected: boolean): boolean {
  return result.affects_received === expected
}

/** Assert void semantics are distinct from refund. */
export function assertVoidNotRefund(result: PaymentSemanticResult): boolean {
  if (result.meaning === 'VOIDED') {
    return result.affects_refunded === false && result.affects_received === false
  }
  return true
}
