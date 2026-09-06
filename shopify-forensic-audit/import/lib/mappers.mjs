/**
 * Map Shopify forensic records → UD table row shapes (no DB I/O).
 */
import {
  SYSTEM,
  money,
  moneyOrNull,
  firstMoney,
  moneyCurrency,
  mfNodes,
  mfValue,
  tagList,
  normalizeStaffName,
  mapLegacyOrderStatus,
  mapLegacyFulfillmentStatus,
  shopifyOrderNumber,
  addressJson,
  nowIso,
  newId,
} from "./helpers.mjs";

export function collectStaffNamesFromCustomer(rec, into) {
  const sp = normalizeStaffName(mfValue(rec.metafields, "custom", "salesperson_assigned"));
  const ref = normalizeStaffName(mfValue(rec.metafields, "custom", "referredby"));
  if (sp) into.add(sp);
  if (ref) into.add(ref);
  for (const t of tagList(rec.tags)) {
    if (t.startsWith("SP_")) {
      const n = normalizeStaffName(t.slice(3).replace(/([a-z])([A-Z])/g, "$1 $2"));
      // Prefer metafield names; SP_* tags are often concatenated — keep raw as tag only.
      void n;
    }
  }
}

export function collectStaffNamesFromCompany(rec, into) {
  const sp = normalizeStaffName(mfValue(rec.metafields, "custom", "salesperson_assigned"));
  if (sp) into.add(sp);
}

export function collectStaffNamesFromOrder(rec, into) {
  const sp = normalizeStaffName(mfValue(rec.metafields, "custom", "salesperson"));
  const ref = normalizeStaffName(mfValue(rec.metafields, "custom", "referrer"));
  const cg = normalizeStaffName(mfValue(rec.metafields, "custom", "cg_assigned"));
  if (sp) into.add(sp);
  if (ref) into.add(ref);
  if (cg) into.add(cg);
}

export function mapCustomer(rec, staffByName) {
  const id = newId();
  const importedAt = nowIso();
  const spName = normalizeStaffName(mfValue(rec.metafields, "custom", "salesperson_assigned"));
  const refName = normalizeStaffName(mfValue(rec.metafields, "custom", "referredby"));
  const trading =
    mfValue(rec.metafields, "store_name", "trading_as") ||
    mfValue(rec.metafields, "storename", "tradingname") ||
    rec.defaultAddress?.company ||
    null;
  const channel = mfValue(rec.metafields, "registration", "channel");
  const legacy =
    mfValue(rec.metafields, "udcustom", "customer_id") || rec.legacyResourceId || null;

  const row = {
    id,
    email: rec.email || null,
    phone: rec.phone || null,
    first_name: rec.firstName || null,
    last_name: rec.lastName || null,
    display_name: rec.displayName || null,
    company_name_snapshot: rec.defaultAddress?.company || null,
    trading_name: trading,
    notes: rec.note || null,
    tax_exempt: Boolean(rec.taxExempt),
    tax_exemption_details: { exemptions: rec.taxExemptions || [] },
    status: String(rec.state || "active").toLowerCase() === "disabled" ? "disabled" : "active",
    approval_status: "imported",
    registration_channel: channel,
    customer_type: null,
    salesperson_id: spName ? staffByName.get(spName.toLowerCase())?.id ?? null : null,
    referrer_id: refName ? staffByName.get(refName.toLowerCase())?.id ?? null : null,
    cg_assigned_id: null,
    legacy_customer_id: legacy ? String(legacy) : null,
    source_system: SYSTEM,
    shopify_created_at: rec.createdAt || null,
    shopify_updated_at: rec.updatedAt || null,
    imported_at: importedAt,
  };

  const addresses = (rec.addresses || []).map((a, idx) => ({
    id: newId(),
    customer_id: id,
    address_type: idx === 0 ? "default" : "other",
    is_default: rec.defaultAddress?.id === a.id || (idx === 0 && !rec.defaultAddress),
    first_name: a.firstName ?? null,
    last_name: a.lastName ?? null,
    company: a.company ?? null,
    address1: a.address1 ?? null,
    address2: a.address2 ?? null,
    city: a.city ?? null,
    province: a.province ?? null,
    province_code: a.provinceCode ?? null,
    postal_code: a.zip ?? null,
    country: a.country ?? null,
    country_code: a.countryCodeV2 ?? null,
    phone: a.phone ?? null,
    source_system: SYSTEM,
  }));

  const ref = {
    id: newId(),
    entity_type: "customer",
    entity_id: id,
    system: SYSTEM,
    external_gid: rec.id,
    external_legacy_id: rec.legacyResourceId ? String(rec.legacyResourceId) : String(rec.id).split("/").pop(),
    first_seen_at: rec.createdAt || importedAt,
    last_seen_at: rec.updatedAt || importedAt,
    imported_at: importedAt,
  };

  return {
    customer: row,
    addresses,
    ref,
    tags: tagList(rec.tags),
    metafields: mfNodes(rec.metafields),
  };
}

export function mapCompany(rec, staffByName, customerIdByGid) {
  const id = newId();
  const importedAt = nowIso();
  const spName = normalizeStaffName(mfValue(rec.metafields, "custom", "salesperson_assigned"));
  const row = {
    id,
    name: rec.name,
    trading_name: null,
    legal_name: null,
    company_number: null,
    vat_number: null,
    status: "active",
    customer_type: null,
    salesperson_id: spName ? staffByName.get(spName.toLowerCase())?.id ?? null : null,
    referrer_id: null,
    cg_assigned_id: null,
    notes: rec.note || null,
    source_system: SYSTEM,
    shopify_created_at: rec.createdAt || null,
    shopify_updated_at: rec.updatedAt || null,
    imported_at: importedAt,
  };

  const locations = (rec.locations?.nodes || []).map((loc, idx) => {
    const locId = newId();
    return {
      location: {
        id: locId,
        company_id: id,
        name: loc.name || null,
        phone: null,
        email: null,
        tax_exempt: false,
        tax_exemptions: [],
        payment_terms_template: loc.buyerExperienceConfiguration?.paymentTermsTemplate ?? null,
        billing_address: {},
        shipping_address: {},
        is_primary: idx === 0,
        source_system: SYSTEM,
      },
      ref: {
        id: newId(),
        entity_type: "company_location",
        entity_id: locId,
        system: SYSTEM,
        external_gid: loc.id,
        first_seen_at: loc.createdAt || importedAt,
        last_seen_at: loc.createdAt || importedAt,
        imported_at: importedAt,
      },
      metafields: mfNodes(loc.metafields),
      shopifyGid: loc.id,
    };
  });

  const contacts = [];
  for (const c of rec.contacts?.nodes || []) {
    const custGid = c.customer?.id;
    const customerId = custGid ? customerIdByGid.get(custGid) : null;
    if (!customerId) continue;
    contacts.push({
      id: newId(),
      company_id: id,
      customer_id: customerId,
      title: null,
      role: null,
      is_primary: false,
      receives_orders: true,
      receives_invoices: true,
      source_system: SYSTEM,
      shopify_contact_gid: c.id,
    });
  }

  return {
    company: row,
    locations,
    contacts,
    ref: {
      id: newId(),
      entity_type: "company",
      entity_id: id,
      system: SYSTEM,
      external_gid: rec.id,
      first_seen_at: rec.createdAt || importedAt,
      last_seen_at: rec.updatedAt || importedAt,
      imported_at: importedAt,
    },
    tags: tagList(rec.tags),
    metafields: mfNodes(rec.metafields),
  };
}

export function mapOrder(rec, ctx) {
  const {
    staffByName,
    customerIdByGid,
    companyIdByGid,
    locationIdByGid,
  } = ctx;
  const id = newId();
  const importedAt = nowIso();
  const spName = normalizeStaffName(mfValue(rec.metafields, "custom", "salesperson"));
  const refName = normalizeStaffName(mfValue(rec.metafields, "custom", "referrer"));
  const cgName = normalizeStaffName(mfValue(rec.metafields, "custom", "cg_assigned"));
  const trading =
    mfValue(rec.metafields, "storename", "tradingname") ||
    mfValue(rec.metafields, "store_name", "trading_as") ||
    null;

  const pe = rec.purchasingEntity;
  let companyGid = null;
  let locationGid = null;
  if (pe?.__typename === "PurchasingCompany") {
    companyGid = pe.company?.id || null;
    locationGid = pe.location?.id || null;
  }

  const customerGid = rec.customer?.id || null;
  const financial = rec.displayFinancialStatus || null;
  const fulfillDisp = rec.displayFulfillmentStatus || null;
  const email = rec.email || rec.customer?.email || "unknown@import.local";

  const subtotal = money(rec.subtotalPriceSet);
  const total = money(rec.totalPriceSet);
  const shipping = money(rec.totalShippingPriceSet);
  const tax = money(rec.totalTaxSet);
  // Forensic extract uses currentTotalDiscountsSet (totalDiscountsSet absent).
  const discount = firstMoney(rec.currentTotalDiscountsSet, rec.totalDiscountsSet);
  const received = money(rec.totalReceivedSet);
  const outstanding = money(rec.totalOutstandingSet);

  const paymentDueRaw =
    mfValue(rec.metafields, "order", "payment_due_date") ||
    mfValue(rec.metafields, "custom", "payment_due");
  let paymentDueOn = null;
  if (paymentDueRaw) {
    const d = new Date(paymentDueRaw);
    if (!Number.isNaN(d.getTime())) paymentDueOn = d.toISOString().slice(0, 10);
    else if (/^\d{4}-\d{2}-\d{2}/.test(String(paymentDueRaw))) {
      paymentDueOn = String(paymentDueRaw).slice(0, 10);
    }
  }

  const order = {
    id,
    order_number: shopifyOrderNumber(rec),
    email,
    status: mapLegacyOrderStatus(financial, rec.cancelledAt),
    fulfillment_status: mapLegacyFulfillmentStatus(fulfillDisp),
    currency: rec.currencyCode || moneyCurrency(rec.totalPriceSet) || "GBP",
    subtotal,
    shipping_total: shipping,
    tax_total: tax,
    discount_total: discount,
    total,
    shipping_address: addressJson(rec.shippingAddress),
    metadata: {
      shopify_name: rec.name,
      payment_gateway_names: rec.paymentGatewayNames || [],
      confirmation_number: rec.confirmationNumber || null,
      test: Boolean(rec.test),
      source_name: rec.sourceName || null,
    },
    customer_id: customerGid ? customerIdByGid.get(customerGid) ?? null : null,
    company_id: companyGid ? companyIdByGid.get(companyGid) ?? null : null,
    company_location_id: locationGid ? locationIdByGid.get(locationGid) ?? null : null,
    financial_status: financial,
    commerce_fulfillment_status: fulfillDisp,
    order_source: rec.sourceName || null,
    purchase_order_number: rec.poNumber || null,
    trading_name_snapshot: trading,
    salesperson_id: spName ? staffByName.get(spName.toLowerCase())?.id ?? null : null,
    referrer_id: refName ? staffByName.get(refName.toLowerCase())?.id ?? null : null,
    cg_assigned_id: cgName ? staffByName.get(cgName.toLowerCase())?.id ?? null : null,
    total_received: received,
    total_outstanding: outstanding,
    taxes_included: Boolean(rec.taxesIncluded),
    source_created_at: rec.createdAt || null,
    source_updated_at: rec.updatedAt || null,
    processed_at: rec.processedAt || null,
    closed_at: rec.closedAt || null,
    cancelled_at: rec.cancelledAt || null,
    cancel_reason: rec.cancelReason || null,
    shopify_order_gid: rec.id,
    shopify_legacy_id: rec.legacyResourceId ? String(rec.legacyResourceId) : null,
    source_order_number: rec.name || null,
    imported_at: importedAt,
    note: rec.note || null,
    payment_gateway_names: rec.paymentGatewayNames || [],
    payment_due_on: paymentDueOn,
  };

  const items = (rec.lineItems?.nodes || []).map((li) => {
    const originalUnit = moneyOrNull(li.originalUnitPriceSet);
    const discountedUnit = moneyOrNull(li.discountedUnitPriceSet);
    // Prefer original when present (including £0); else discounted unit.
    const unit = originalUnit != null ? originalUnit : discountedUnit != null ? discountedUnit : 0;
    const discountedTotal = moneyOrNull(li.discountedTotalSet);
    const originalTotal = moneyOrNull(li.originalTotalSet);
    const lineTotal =
      discountedTotal != null
        ? discountedTotal
        : originalTotal != null
          ? originalTotal
          : unit * (li.quantity || 0);
    const deleted = !li.product || !li.variant;
    return {
      id: newId(),
      order_id: id,
      product_id: null, // never auto-link catalog during import
      product_name: li.name || li.title || "Line item",
      product_slug: null,
      image_url: li.image?.url || null,
      unit_price: unit,
      quantity: li.quantity || 0,
      line_total: lineTotal,
      sku_snapshot: li.sku || null,
      variant_title_snapshot: li.variantTitle || li.variant?.title || null,
      vendor_snapshot: li.vendor || li.product?.vendor || null,
      product_type_snapshot: li.product?.productType || null,
      barcode_snapshot: li.variant?.barcode || null,
      original_unit_price: originalUnit,
      discount_total: Math.max(0, (originalTotal ?? lineTotal) - (discountedTotal ?? lineTotal)),
      tax_total: money(li.totalTaxSet),
      taxable: li.taxable !== false,
      product_shopify_gid: li.product?.id || null,
      variant_shopify_gid: li.variant?.id || null,
      source_line_item_gid: li.id || null,
      deleted_product: deleted,
      properties: li.customAttributes || [],
      metadata: {},
    };
  });

  const transactions = (rec.transactions || []).map((tx) => ({
    id: newId(),
    order_id: id,
    kind: tx.kind || "SALE",
    status: tx.status || "SUCCESS",
    gateway: tx.gateway || null,
    formatted_gateway: tx.formattedGateway || null,
    amount: (() => {
      const fromSet = moneyOrNull(tx.amountSet);
      if (fromSet != null) return fromSet;
      const n = Number(tx.amount);
      return Number.isFinite(n) ? n : 0;
    })(),
    currency: moneyCurrency(tx.amountSet, rec.currencyCode || "GBP"),
    payment_id: tx.paymentId || null,
    authorization_code: tx.authorizationCode || null,
    error_code: tx.errorCode || null,
    account_number_masked: tx.accountNumber || null,
    test: Boolean(tx.test),
    manually_capturable: Boolean(tx.manuallyCapturable),
    processed_at: tx.processedAt || tx.createdAt || null,
    source_created_at: tx.createdAt || null,
    source_system: SYSTEM,
    external_gid: tx.id || null,
    imported_at: importedAt,
    metadata: {},
  }));

  const refunds = (rec.refunds || []).map((rf) => ({
    id: newId(),
    order_id: id,
    note: rf.note || null,
    total_refunded: money(rf.totalRefundedSet),
    currency: moneyCurrency(rf.totalRefundedSet, rec.currencyCode || "GBP"),
    source_created_at: rf.createdAt || null,
    source_system: SYSTEM,
    external_gid: rf.id || null,
    imported_at: importedAt,
    metadata: {},
  }));

  const fulfillments = (rec.fulfillments || []).map((f) => {
    const tracking = f.trackingInfo || [];
    const first = Array.isArray(tracking) ? tracking[0] : null;
    return {
      fulfillment: {
        id: newId(),
        order_id: id,
        status: f.status || null,
        display_status: f.displayStatus || null,
        name: f.name || null,
        service_handle: f.service?.serviceName || f.service?.handle || null,
        service_name: f.service?.serviceName || null,
        tracking_company: first?.company || f.trackingCompany || null,
        tracking_number: first?.number || f.trackingNumber || null,
        tracking_url: first?.url || f.trackingUrl || null,
        tracking_info: tracking,
        carrier_status: null,
        carrier_status_raw: {},
        source_created_at: f.createdAt || null,
        source_updated_at: f.updatedAt || null,
        source_system: SYSTEM,
        external_gid: f.id || null,
        imported_at: importedAt,
        metadata: {},
      },
      lines: (f.fulfillmentLineItems?.nodes || []).map((fl) => ({
        id: newId(),
        quantity: fl.quantity || 0,
        sku_snapshot: fl.lineItem?.sku || null,
        name_snapshot: fl.lineItem?.name || null,
        source_system: SYSTEM,
        external_gid: fl.id || null,
        line_item_gid: fl.lineItem?.id || null,
      })),
    };
  });

  const shippingLines = (rec.shippingLines?.nodes || []).map((sl) => ({
    id: newId(),
    order_id: id,
    title: sl.title || null,
    code: sl.code || null,
    source: sl.source || null,
    carrier_identifier: sl.carrierIdentifier || null,
    original_price: money(sl.originalPriceSet),
    currency: moneyCurrency(sl.originalPriceSet, rec.currencyCode || "GBP"),
    source_system: SYSTEM,
    external_gid: sl.id || null,
  }));

  const taxLines = (rec.taxLines || []).map((tl) => ({
    id: newId(),
    order_id: id,
    title: tl.title || "Tax",
    rate: tl.rate ?? null,
    rate_percentage: tl.ratePercentage ?? null,
    price: money(tl.priceSet) || Number(tl.price) || 0,
    currency: moneyCurrency(tl.priceSet, rec.currencyCode || "GBP"),
    channel_liable: tl.channelLiable ?? null,
    source_system: SYSTEM,
  }));

  const events = [];
  const comments = [];
  for (const ev of rec.events?.nodes || []) {
    const base = {
      id: newId(),
      order_id: id,
      occurred_at: ev.createdAt || importedAt,
      source_system: SYSTEM,
      external_event_id: ev.id || null,
      message: ev.message || null,
      imported_at: importedAt,
    };
    if (ev.__typename === "CommentEvent" || (ev.message && String(ev.message).startsWith("Comment:"))) {
      comments.push({
        id: base.id,
        order_id: id,
        body: ev.message || "",
        author_name_snapshot: null,
        source_system: SYSTEM,
        external_event_id: ev.id || null,
        occurred_at: ev.createdAt || importedAt,
      });
    } else {
      events.push({
        ...base,
        event_type: ev.__typename || "Event",
        category: "system",
        metadata: { attributeTo: ev.attributeToApp || ev.attributeToUser || null },
      });
    }
  }

  return {
    order,
    items,
    transactions,
    refunds,
    fulfillments,
    shippingLines,
    taxLines,
    events,
    comments,
    tags: tagList(rec.tags),
    metafields: mfNodes(rec.metafields),
    ref: {
      id: newId(),
      entity_type: "order",
      entity_id: id,
      system: SYSTEM,
      external_gid: rec.id,
      external_legacy_id: rec.legacyResourceId ? String(rec.legacyResourceId) : null,
      external_number: rec.name || null,
      first_seen_at: rec.createdAt || importedAt,
      last_seen_at: rec.updatedAt || importedAt,
      imported_at: importedAt,
    },
  };
}

export function mapDraft(rec, ctx) {
  const { staffByName, customerIdByGid, companyIdByGid, locationIdByGid, orderIdByGid } = ctx;
  const id = newId();
  const importedAt = nowIso();
  const pe = rec.purchasingEntity;
  let customerGid = rec.customer?.id || null;
  let companyGid = null;
  let locationGid = null;
  let peType = null;
  if (pe?.__typename === "PurchasingCompany") {
    peType = "PurchasingCompany";
    companyGid = pe.company?.id || null;
    locationGid = pe.location?.id || null;
    customerGid = pe.contact?.customer?.id || customerGid;
  } else if (pe?.__typename === "Customer" || pe?.id?.includes("Customer")) {
    peType = "Customer";
    customerGid = pe.id || customerGid;
  }

  const spName = normalizeStaffName(mfValue(rec.metafields, "custom", "salesperson"));
  const refName = normalizeStaffName(mfValue(rec.metafields, "custom", "referrer"));

  const draft = {
    id,
    name: rec.name || null,
    status: String(rec.status || "open").toLowerCase(),
    email: rec.email || rec.customer?.email || null,
    phone: rec.phone || null,
    note: rec.note2 || rec.note || null,
    po_number: rec.poNumber || null,
    tax_exempt: Boolean(rec.taxExempt),
    taxes_included: Boolean(rec.taxesIncluded),
    currency: rec.currencyCode || "GBP",
    ready: Boolean(rec.ready),
    reserve_inventory_until: rec.reserveInventoryUntil || null,
    subtotal: money(rec.subtotalPriceSet),
    total_tax: money(rec.totalTaxSet),
    total_shipping: money(rec.totalShippingPriceSet),
    total_discounts: firstMoney(rec.currentTotalDiscountsSet, rec.totalDiscountsSet),
    total_price: money(rec.totalPriceSet),
    invoice_url: rec.invoiceUrl || null,
    invoice_sent_at: rec.invoiceSentAt || null,
    completed_at: rec.completedAt || null,
    purchasing_entity_type: peType,
    customer_id: customerGid ? customerIdByGid.get(customerGid) ?? null : null,
    company_id: companyGid ? companyIdByGid.get(companyGid) ?? null : null,
    company_location_id: locationGid ? locationIdByGid.get(locationGid) ?? null : null,
    salesperson_id: spName ? staffByName.get(spName.toLowerCase())?.id ?? null : null,
    referrer_id: refName ? staffByName.get(refName.toLowerCase())?.id ?? null : null,
    trading_name_snapshot: mfValue(rec.metafields, "storename", "tradingname"),
    billing_address: addressJson(rec.billingAddress),
    shipping_address: addressJson(rec.shippingAddress),
    custom_attributes: rec.customAttributes || [],
    shipping_line: rec.shippingLine || null,
    converted_order_id: rec.order?.id ? orderIdByGid.get(rec.order.id) ?? null : null,
    source_system: SYSTEM,
    shopify_draft_gid: rec.id,
    shopify_legacy_id: rec.legacyResourceId ? String(rec.legacyResourceId) : null,
    source_created_at: rec.createdAt || null,
    source_updated_at: rec.updatedAt || null,
    imported_at: importedAt,
  };

  const lines = (rec.lineItems?.nodes || []).map((li, idx) => {
    const unit = moneyOrNull(li.originalUnitPriceSet) ?? 0;
    const qty = li.quantity || 0;
    const discountedTotal = moneyOrNull(li.discountedTotalSet);
    return {
      id: newId(),
      draft_order_id: id,
      title: li.title || li.name || "Line",
      variant_title: li.variantTitle || li.variant?.title || null,
      sku_snapshot: li.sku || null,
      vendor_snapshot: li.product?.vendor || null,
      quantity: qty,
      original_unit_price: unit,
      discounted_unit_price: qty > 0 && discountedTotal != null ? discountedTotal / qty : null,
      original_total: unit * qty,
      discounted_total: discountedTotal,
      taxable: true,
      requires_shipping: true,
      custom_attributes: li.customAttributes || [],
      product_shopify_gid: li.product?.id || null,
      variant_shopify_gid: li.variant?.id || null,
      source_line_item_gid: li.id || null,
      deleted_product: !li.product || !li.variant,
      sort_order: idx,
    };
  });

  return {
    draft,
    lines,
    tags: tagList(rec.tags),
    metafields: mfNodes(rec.metafields),
  };
}

export function mapAbandoned(rec, customerIdByGid) {
  const id = newId();
  const importedAt = nowIso();
  return {
    id,
    customer_id: rec.customer?.id ? customerIdByGid.get(rec.customer.id) ?? null : null,
    email: rec.customer?.email || null,
    completed_at: rec.completedAt || null,
    abandoned_checkout_url: rec.abandonedCheckoutUrl || null,
    subtotal: money(rec.subtotalPriceSet),
    total_tax: money(rec.totalTaxSet),
    total_discount: money(rec.totalDiscountSet),
    total_price: money(rec.totalPriceSet),
    currency: moneyCurrency(rec.totalPriceSet, "GBP"),
    billing_address: addressJson(rec.billingAddress),
    shipping_address: addressJson(rec.shippingAddress),
    line_items: (rec.lineItems?.nodes || []).map((li) => ({
      id: li.id,
      title: li.title,
      quantity: li.quantity,
      sku: li.sku,
      variant_title: li.variantTitle,
    })),
    source_system: SYSTEM,
    shopify_checkout_gid: rec.id,
    source_created_at: rec.createdAt || null,
    source_updated_at: rec.updatedAt || null,
    imported_at: importedAt,
  };
}

export function mapMetafieldRows(ownerType, ownerId, nodes) {
  const importedAt = nowIso();
  return (nodes || []).map((mf) => ({
    id: newId(),
    owner_type: ownerType,
    owner_id: ownerId,
    namespace: mf.namespace,
    key: mf.key,
    value_type: mf.type || null,
    value_text: mf.value != null ? String(mf.value) : null,
    value_json: mf.jsonValue !== undefined ? mf.jsonValue : null,
    source_system: SYSTEM,
    external_gid: mf.id || null,
    imported_at: importedAt,
  }));
}
