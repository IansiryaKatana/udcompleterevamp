/**
 * Phase 5F — live finance baseline + mismatch pattern probe (read-only).
 * Run: node scripts/phase5f-baseline-probe.mjs
 */
import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const s = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

async function count(table) {
  const { count, error } = await s.from(table).select('*', { count: 'exact', head: true })
  if (error) throw error
  return count
}

async function main() {
  const counts = {
    orders: await count('orders'),
    payment_transactions: await count('payment_transactions'),
    refunds: await count('refunds'),
    refund_line_items: await count('refund_line_items'),
  }

  let tot = 0,
    recv = 0,
    out = 0
  const exceptions = {
    OUTSTANDING_MISMATCH: 0,
    NEGATIVE_OUTSTANDING: 0,
    RECEIVED_EXCEEDS_TOTAL: 0,
    TX_EXCEEDS_TOTAL: 0,
    PAID_ZERO_RECEIVED: 0,
    REFUND_MISMATCH: 0,
    OTHER: 0,
  }
  const patterns = {}
  const byGateway = {}
  let absVar = 0
  let netVar = 0
  let from = 0

  while (true) {
    const { data, error } = await s
      .from('orders')
      .select(
        'id,order_number,total,total_received,total_outstanding,financial_status,source_total,source_total_received,source_total_outstanding,source_financial_status,source_created_at,order_source',
      )
      .range(from, from + 999)
    if (error) throw error
    if (!data?.length) break

    for (const o of data) {
      const t = Number(o.total || 0)
      const r = Number(o.total_received || 0)
      const outstanding = Number(o.total_outstanding || 0)
      tot += t
      recv += r
      out += outstanding
      const exp = Math.max(t - r, 0)
      const isMis = Math.round(outstanding * 100) !== Math.round(exp * 100)
      if (outstanding < 0) exceptions.NEGATIVE_OUTSTANDING++
      if (r > t + 0.009) exceptions.RECEIVED_EXCEEDS_TOTAL++
      const fs = String(o.financial_status || '').toUpperCase()
      if (['PAID', 'PARTIALLY_PAID'].includes(fs) && r === 0 && t > 0) exceptions.PAID_ZERO_RECEIVED++
      if (isMis) {
        exceptions.OUTSTANDING_MISMATCH++
        const v = outstanding - exp
        absVar += Math.abs(v)
        netVar += v
        let pat
        if (outstanding < 0) pat = 'NEG_OUT'
        else if (r > t + 0.009) pat = 'RECV_GT_TOTAL'
        else if (outstanding === 0 && r + 0.009 < t && ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(fs))
          pat = 'PAIDISH_OUT0_RECV_LT_TOTAL'
        else if (outstanding === 0 && r === 0 && t > 0) pat = 'OUT0_RECV0_TOTAL_GT0'
        else if (outstanding > 0 && Math.abs(outstanding - (t - r)) > 0.01) pat = 'OUT_NE_TOTAL_MINUS_RECV'
        else pat = 'OTHER_' + (fs || 'NULL')
        patterns[pat] = (patterns[pat] || 0) + 1
      }
    }
    from += 1000
    if (data.length < 1000) break
  }

  // TX exceeds total: sample via payment_transactions aggregate per order (chunked)
  from = 0
  let txExceed = 0
  while (true) {
    const { data, error } = await s.from('orders').select('id,total').range(from, from + 499)
    if (error) throw error
    if (!data?.length) break
    for (const o of data) {
      const { data: txs } = await s
        .from('payment_transactions')
        .select('amount,gateway,kind,status')
        .eq('order_id', o.id)
      if (!txs?.length) continue
      const cash = txs
        .filter((t) => {
          const k = String(t.kind || '').toUpperCase()
          const st = String(t.status || '').toUpperCase()
          return k === 'SALE' && st === 'SUCCESS'
        })
        .reduce((a, t) => a + Number(t.amount || 0), 0)
      if (cash > Number(o.total || 0) + 0.009) txExceed++
    }
    from += 500
    if (data.length < 500) break
    if (from > 3000) break // partial probe — full count via SQL later
  }

  const { data: mon } = await s.rpc('rpc_phase5d_finance_money_reconciliation')

  // Gateway mix on first 80 mismatch PAIDISH
  const { data: candidates } = await s
    .from('orders')
    .select('id,order_number,total,total_received,total_outstanding,financial_status')
    .eq('financial_status', 'PAID')
    .limit(400)
  let gwChecked = 0
  for (const o of candidates || []) {
    const t = Number(o.total),
      r = Number(o.total_received),
      outstanding = Number(o.total_outstanding)
    if (!(outstanding === 0 && r + 0.009 < t)) continue
    const { data: pt } = await s
      .from('payment_transactions')
      .select('gateway,kind,status,amount')
      .eq('order_id', o.id)
    const key =
      (pt || [])
        .map((p) => `${p.gateway}|${p.kind}|${p.status}`)
        .sort()
        .join(';') || 'NO_TX'
    byGateway[key] = (byGateway[key] || 0) + 1
    gwChecked++
    if (gwChecked >= 80) break
  }

  // PAID zero received detail
  const { data: paidZero } = await s
    .from('orders')
    .select('id,order_number,total,total_received,total_outstanding,financial_status,source_financial_status')
    .in('financial_status', ['PAID', 'PARTIALLY_PAID'])
    .eq('total_received', 0)
    .gt('total', 0)
    .limit(50)

  const paidZeroDetail = []
  for (const o of paidZero || []) {
    const { data: pt } = await s
      .from('payment_transactions')
      .select('gateway,kind,status,amount')
      .eq('order_id', o.id)
    const { data: led } = await s.rpc('finance_calculate_order_ledger', { p_order_id: o.id })
    paidZeroDetail.push({
      order: o.order_number,
      total: o.total,
      fs: o.financial_status,
      txs: pt,
      calc_outstanding: led?.calculated?.outstanding,
      recon: led?.reconciliation_status,
    })
  }

  console.log(
    JSON.stringify(
      {
        counts,
        money: { tot: +tot.toFixed(2), recv: +recv.toFixed(2), out: +out.toFixed(2) },
        exceptions,
        patterns,
        absVar: +absVar.toFixed(2),
        netVar: +netVar.toFixed(2),
        mon,
        txExceedPartialFirst3kOrders: txExceed,
        byGatewaySample80: byGateway,
        paidZeroDetail,
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
