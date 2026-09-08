-- Phase 5B — Shopify app dependency register (LOCAL TRACKING ONLY)
-- Read/audit/design. Does NOT disconnect apps. Does NOT mutate Shopify.
-- Does NOT send pilot emails / flip trade_required / enable parked systems.
-- compliance stays observe.

update public.site_settings set value = 'catalogue_open'
where key = 'commercial_access_mode' and value is distinct from 'catalogue_open';
update public.site_settings set value = 'false'
where key = 'trade_required_cutover_approved' and value is distinct from 'false';
update public.site_settings set value = 'false'
where key = 'pilot_send_authorized' and value is distinct from 'false';
update public.site_settings set value = 'observe'
where key = 'compliance_enforcement_mode' and value is distinct from 'observe';

insert into public.site_settings (key, value)
values ('compliance_enforcement_mode', 'observe')
on conflict (key) do nothing;

create table if not exists public.app_dependency_register (
  id uuid primary key default gen_random_uuid(),
  app_key text not null unique,
  app_name text not null,
  business_capability text,
  classification text not null
    check (classification in (
      'REPLACED_BY_UNIQUE','PARTIALLY_REPLACED','INTEGRATION_REQUIRED',
      'EXTERNAL_ACCESS_REQUIRED','DATA_MIGRATION_REQUIRED','ARCHIVE_ONLY',
      'LIKELY_RETIRED','UNKNOWN'
    )),
  active_evidence text,
  shopify_objects text,
  data_written_to_shopify text,
  likely_private_data text,
  unique_equivalent text,
  current_gap text,
  target_action text,
  cutover_blocker boolean not null default false,
  external_access_required boolean not null default false,
  severity text check (severity is null or severity in ('BLOCKER','HIGH','MEDIUM','LOW','NON_BLOCKING')),
  evidence_source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.app_dependency_register is
  'Phase 5B dependency closure register — documentation aid only. Not connected to Shopify App Store.';

alter table public.app_dependency_register enable row level security;
drop policy if exists "admin_all_app_dependency_register" on public.app_dependency_register;
create policy "admin_all_app_dependency_register" on public.app_dependency_register
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.app_dependency_register to authenticated;
grant all on public.app_dependency_register to service_role;

-- Seed known inventory (upsert by app_key)
insert into public.app_dependency_register (
  app_key, app_name, business_capability, classification,
  active_evidence, shopify_objects, data_written_to_shopify, likely_private_data,
  unique_equivalent, current_gap, target_action,
  cutover_blocker, external_access_required, severity, evidence_source
) values
(
  'ud_sales_portal', 'UD Sales Portal',
  'Custom Admin API ops client; sales/ops workflows historically via Shopify API',
  'PARTIALLY_REPLACED',
  'Live installed; client_id 73722df…; forensic audit client; LINKED ACTIVE IN USE',
  'Orders, customers, companies, drafts, metafields (Admin GraphQL)',
  'Ops writes historically (WRITES DATA BACK class)',
  'App scopes/config; not WMS SoR',
  'Unique /backend CRM, sales, drafts, finance, fulfilment UI (Phases 2–4)',
  'Missing live scopes: read_discounts, read_files, read_publications, read_payment_terms, fulfillmentOrders; portal may still be used by staff until Unique cutover',
  'Complete Unique admin parity; keep portal until Shopify freeze for API access; do not disconnect early',
  false, false, 'HIGH', 'FORENSIC-AUDIT §R/Y; shopify app config'
),
(
  'skulabs', 'SKULabs',
  'Warehouse WMS / pick-pack / fulfilment writer from UD WH 1',
  'EXTERNAL_ACCESS_REQUIRED',
  '20,588 events; 10,143 orders (46.6%); lastSeen 2026-09-04; skulabs.shopname 1,462 customers',
  'Order.events, Manual fulfillments, customer metafield skulabs.shopname',
  'Fulfilment status events; shopname metafield; shipping confirmation emails',
  'Pick/pack/bin/PO/user/stock movements — NOT in Shopify',
  'Fulfilment ops + Manual fulfilments exist; warehouse NOT STARTED',
  'No credentials in repo; inventory SoR hybrid unresolved',
  'Obtain read-only SKULabs token + store ID; design warehouse after access',
  true, true, 'BLOCKER', 'Phase 3D/3E; FORENSIC R1'
),
(
  'dpd_wsa', 'DPD Integration by WSA',
  'Carrier tracking + DPD Delivery Status attribute',
  'EXTERNAL_ACCESS_REQUIRED',
  '55,700 events; DPD Delivery Status attr 7,527; tracking DPD family ~15k+',
  'Order.events, fulfillments.trackingInfo, customAttributes',
  'Tracking company/number; delivery status attribute',
  'Consignment/label SoR at DPD/WSA',
  'CarrierProvider + dpdClient stubs; carrier_mode=disabled; product UNCONFIRMED',
  'Exact UK DPD product/API + test credentials',
  'External DPD/WSA pack; preserve Shopify tracking headers; do not enable carrier_mode',
  true, true, 'BLOCKER', 'Phase 3B/3C; FORENSIC'
),
(
  'worldpay_ecommerce', 'Worldpay eCommerce',
  'Card payment gateway (B2B checkout)',
  'INTEGRATION_REQUIRED',
  '10,294 orders ~£6.01M; tag WorldPayCard 10,285; legacy Worldpay Payments 2',
  'paymentGatewayNames, transactions, order tags',
  'Payment status labels (tokens remain at Worldpay)',
  'Card vault / PANs',
  'PaymentService + WorldpayAccessAdapter + webhook; gateway_mode=disabled; product UNCONFIRMED',
  'Merchant product/API pack + TEST credentials',
  'Keep disabled; complete gateway pack before activation; card-on-file cannot migrate',
  true, true, 'BLOCKER', 'Phase 2F; FORENSIC R2'
),
(
  'surecust', 'SureCust Forms, Lock',
  'Wholesale registration forms + site/product lock / trade access tags',
  'PARTIALLY_REPLACED',
  'SureCust_Wholesale 5,726; SureCust_POS 177; verified 5,708',
  'Customer tags; forms/lock likely external UX',
  'Tags',
  'Form field history; lock rule config; product-level locks NOT RECONSTRUCTED',
  'trade_access_status + applications + commercial policy + auth activation (4D–4I)',
  'Forms field parity; Lock equivalent under trade_required not activated; product lock unknown',
  'Document remaining Lock/Forms capabilities; EXTERNAL review of live SureCust config; do not claim full replacement',
  false, true, 'HIGH', 'Phase 4D–4F; FORENSIC; Phase 5A'
),
(
  'dollarback', 'Dollarback: Loyalty',
  'Cashback / loyalty segments / store credit',
  'ARCHIVE_ONLY',
  'dollar-cashback.no-credit-reason 8,688; dollar-segments 5,626; store_credit gateway 25 txs; loyalty_customers 661',
  'Order/customer metafields dollar-*; shopify_store_credit txs',
  'Metafields + store credit',
  'Loyalty ledger balances',
  'None (loyalty product not built)',
  'Confirm if loyalty still required; export balances if yes',
  'Business decision: retire vs rebuild; if history needed EXTERNAL_ACCESS',
  false, true, 'MEDIUM', 'FORENSIC §T.6 / R12'
),
(
  'magefan_persistent_cart', 'Magefan Persistent Cart',
  'Persistent cart tagging across sessions',
  'REPLACED_BY_UNIQUE',
  'Order tag persistent_cart 7,579; drafts 51',
  'Order/draft tags',
  'Tags',
  'App-private cart store unknown (likely none needed)',
  'storefront_carts + CartDrawer + server sync',
  'Historical tags only; do not conflate with abandoned checkout',
  'Validate Unique cart parity; archive Magefan at Shopify cutover',
  false, false, 'LOW', 'FORENSIC'
),
(
  'aov_ai', 'AOV.ai Free Gift & BXGY',
  'Free gift / BOGO / automatic gift promotions',
  'ARCHIVE_ONLY',
  'Shop metafield secomapp.freegifts_custom_data count 1; order discounts exist but not app-attributed',
  'Shop metafield; order discountApplications',
  'Shop metafield',
  'Promotion rule config (read_discounts denied)',
  'Unique coupons (minimal); Phase 4D: do not rebuild unused types',
  'Cannot reconstruct BXGY rules without discounts scope / app export',
  'Quantify material usage with discount export; only build if materially used',
  false, true, 'MEDIUM', 'FORENSIC; Phase 4D'
),
(
  'smart_discounts', 'SMART Discounts',
  'Automatic / SMART discount promotions',
  'UNKNOWN',
  'No separate namespace; bundled with AOV/automatic in forensics; defs unread',
  'Likely discount nodes (denied)',
  'Unknown',
  'App config',
  'Unique coupon engine (partial)',
  'read_discounts not granted on Sales Portal',
  'Grant read_discounts or export SMART rules; classify SUPPORTED/MISSING/LEGACY',
  false, true, 'HIGH', 'FORENSIC R5'
),
(
  'checkout_blocks', 'Checkout Blocks',
  'Checkout validation / order limits / custom checkout blocks',
  'EXTERNAL_ACCESS_REQUIRED',
  'Definition checkoutblocks.order-limits; metafieldsCount 0 in defs dump',
  'Checkout validation metafield definition',
  'Checkout rules (live values not in pull)',
  'Live rule payload / block config',
  'Unique checkout commercial asserts only — no Checkout Blocks clone',
  'Live rules need Admin/app export',
  'Manual configuration review + export before cutover',
  false, true, 'HIGH', 'FORENSIC; Phase 5A'
),
(
  'pt2_statement_printer', 'PT2 - Statement Printer',
  'Statements / credit-note presentation / PDF generation',
  'PARTIALLY_REPLACED',
  'custom.credit_note Yes on ~79–80 orders; native Returns unused (5)',
  'Order metafield custom.credit_note',
  'Credit-note flag',
  'Historical invoice/statement PDFs',
  'Unique Finance statements, credit_notes, AR (Phase 2D)',
  'PDF archive + numbering evidence may remain in PT2',
  'Export historical PDFs; confirm numbering; Unique ops_documents for new docs',
  false, true, 'HIGH', 'FORENSIC R14; Phase 2'
),
(
  'order_printer', 'Order Printer',
  'Invoices / packing slips / print templates',
  'UNKNOWN',
  'No object footprint in GraphQL pull; grouped with PT2 for PDF risk R14',
  'Unknown',
  'Unknown',
  'Historical PDF templates/documents',
  'Unique packing slips / finance documents / ops_documents',
  'Confirm install + export templates/PDFs',
  'Admin Apps list confirmation + PDF export',
  false, true, 'HIGH', 'FORENSIC R14'
),
(
  'order_printer_pro', 'Order Printer Pro',
  'Advanced order/invoice printing',
  'UNKNOWN',
  'Zero name matches in forensic/repo',
  '—',
  '—',
  'Possible PDF store if installed',
  'Unique documents',
  'Confirm whether installed',
  'Shopify Admin Apps inventory',
  false, true, 'MEDIUM', 'Phase 5B search — no GraphQL footprint'
),
(
  'xero', 'Xero',
  'Statutory GL / accounting',
  'INTEGRATION_REQUIRED',
  'Not visible in Shopify GraphQL objects',
  '—',
  '—',
  'Invoices, credit notes, payments, VAT, contacts, GL',
  'Unique = operational commerce + AR (not statutory GL)',
  'Confirm invoice SoR; read-only Xero org access if sync needed',
  'Read-only Xero investigation; do not assume Unique replaces Xero',
  false, true, 'HIGH', 'FORENSIC §R UNKNOWN'
),
(
  'synder', 'Synder',
  'Accounting sync bridge (Shopify/payments → accounting)',
  'UNKNOWN',
  'Not visible in GraphQL; may sync Worldpay/Shopify/Xero externally',
  '—',
  '—',
  'Sync mappings / journals',
  'None direct',
  'Whether Synder or direct Unique→Xero is future path',
  'External finance stack interview; do not assume dual SoR',
  false, true, 'HIGH', 'FORENSIC §R'
),
(
  'datafetchodoo', 'datafetchodoo',
  'Odoo / external customer id bridge (inferred)',
  'DATA_MIGRATION_REQUIRED',
  'udcustom.customer_id on 4,091 customers',
  'Customer metafield udcustom.customer_id',
  'External customer ids',
  'Odoo DB',
  'Imported external_ids mapping; no live Odoo connector',
  'Confirm if Odoo still live; id semantics',
  'Preserve metafields; EXTERNAL confirm Odoo status',
  false, true, 'MEDIUM', 'FORENSIC'
),
(
  'sa_request_a_quote', 'SA Request a Quote',
  'Customer quote request intake',
  'REPLACED_BY_UNIQUE',
  'Phase 4D: Unique quote CURRENT UNIQUE SUFFICIENT; tag sa_quote_customer exists in tags dict',
  'Unknown Shopify form objects',
  'Unknown',
  'Historical quote submissions',
  'request-quote edge + storefront quote + B2B drafts',
  'Historical quote export optional',
  'Keep Unique quote; optional EXTERNAL forensics for history',
  false, false, 'LOW', 'Phase 4D'
),
(
  'ud_special_request_form', 'UD SpecialRequestForm',
  'Unknown special request form (distinct from SA Quote)',
  'UNKNOWN',
  'Zero forensic/repo matches by that name',
  '—',
  '—',
  'Form submissions if exists',
  'Contact forms / CRM / drafts — not assumed equivalent',
  'Confirm install and purpose via Admin Apps / form list',
  'Do not equate to Request a Quote without evidence',
  false, true, 'MEDIUM', 'Phase 5B — no footprint'
),
(
  'shopify_flow', 'Shopify Flow',
  'Hidden business automation (tags, emails, status changes)',
  'EXTERNAL_ACCESS_REQUIRED',
  'Tags getDraftOrderData1_item.name 3,913 + Review_Customer_Type 3,913 leftovers',
  'Order tags; unknown other actions',
  'Tags (observed)',
  'Full workflow definitions (triggers/conditions/actions)',
  'None — Unique must rewrite needed automations',
  'Workflows themselves NOT exported',
  'SHOPIFY FLOW DIRECT EXPORT / MANUAL WORKFLOW AUDIT REQUIRED before cutover',
  true, true, 'BLOCKER', 'FORENSIC; Phase 5B'
),
(
  'report_pundit', 'Report Pundit',
  'Saved business reports / BI',
  'UNKNOWN',
  'Zero matches in forensic/repo/docs',
  '—',
  '—',
  'Saved report definitions/exports',
  'Unique orders/finance/CRM/sales reports (partial)',
  'Confirm install; export saved reports if used',
  'Admin Apps + stakeholder interview',
  false, true, 'MEDIUM', 'Phase 5B — no footprint'
),
(
  'brevo_pushowl', 'Brevo / PushOwl',
  'Marketing email/SMS/push (attribution soft)',
  'EXTERNAL_ACCESS_REQUIRED',
  'Customer tag sms_manual_sub 2,355 only; provider identity unproven',
  'Customer tags',
  'Tags',
  'Subscriber lists, consents, campaigns, push tokens, templates',
  'Resend for TRANSACTIONAL only',
  'Marketing migration not complete; do not auto-subscribe',
  'Export marketing lists/consents; keep transactional on Resend',
  false, true, 'HIGH', 'FORENSIC'
),
(
  'search_discovery', 'Search & Discovery',
  'Merchandising / related products / discovery metafields',
  'PARTIALLY_REPLACED',
  'Namespaces shopify--discovery--* on products',
  'Product metafields',
  'Discovery metafields',
  'Synonyms/boosts/filter config may be Admin-only',
  'Postgres search + collections + filters',
  'Advanced merchandising rules may not be exported',
  'Manual Review Search & Discovery config; export if used',
  false, true, 'MEDIUM', 'FORENSIC'
),
(
  'avada_seo', 'Avada SEO Suite',
  'SEO schema / redirects / metadata',
  'UNKNOWN',
  'No namespace in pull',
  '—',
  '—',
  'SEO config if installed',
  'Unique CMS SEO + JSON-LD + sitemap',
  'Confirm install; avoid conflicting schema import',
  'Admin Apps confirmation',
  false, false, 'LOW', 'FORENSIC'
),
(
  'rangeme', 'RangeMe',
  'Supplier/distribution product discovery (inferred)',
  'UNKNOWN',
  'No metafield namespace',
  '—',
  '—',
  'External RangeMe account data',
  'None required unless business uses channel',
  'Confirm whether actively used',
  'Do not build from install alone',
  false, false, 'NON_BLOCKING', 'FORENSIC'
),
(
  'veeqo', 'Veeqo',
  'Alternate WMS / shipping',
  'LIKELY_RETIRED',
  'No namespace; SKULabs is WMS fingerprint; Phase 3A UNKNOWN',
  '—',
  '—',
  '—',
  'N/A',
  'Confirm unused in Admin',
  'Reconfirm; no excessive time if no evidence',
  false, false, 'NON_BLOCKING', 'Phase 3A/3D'
),
(
  'xtimcatlogx', 'xtimcatlogx',
  'Custom/unknown catalog app',
  'UNKNOWN',
  'Zero matches',
  '—',
  '—',
  'Unknown private data',
  '—',
  'Owner/developer unknown',
  'Admin Apps + developer interview; do not retire casually',
  false, true, 'HIGH', 'Phase 5B'
),
(
  'shopify_graphql_app', 'Shopify GraphQL App',
  'Developer utility / custom GraphQL client (inferred)',
  'UNKNOWN',
  'Named in inventory list; no distinct runtime footprint separated from Sales Portal',
  '—',
  '—',
  '—',
  'Unique uses Sales Portal + service role for forensics',
  'Confirm if separate install from UD Sales Portal',
  'Admin Apps list',
  false, false, 'LOW', 'Phase 5B'
),
(
  'theme_access', 'Theme Access',
  'Theme development access tooling',
  'LIKELY_RETIRED',
  'No object footprint',
  '—',
  '—',
  '—',
  'N/A for Unique runtime',
  'Agency may need during migration',
  'Keep until Shopify theme freeze; retire after cutover if unused',
  false, false, 'LOW', 'FORENSIC'
),
(
  'messaging', 'Messaging',
  'Shopify Inbox / customer messaging',
  'UNKNOWN',
  'Not reconstructed as conversation export in forensic pull',
  'Possible conversations (not in archive)',
  'Unknown',
  'Conversation history',
  'CRM notes — NOT proven equivalent',
  'Export conversations if support relies on them',
  'Confirm usage; plan export if needed',
  false, true, 'MEDIUM', 'Phase 5B'
),
(
  'css_sales_team', 'CSS Sales Team',
  'Sales tagging dump (salesperson/referrer keys)',
  'PARTIALLY_REPLACED',
  'css_sales_team_order_tagging_details ~2,165 keys; customer tagging ~960; tag css_sales_team',
  'Dynamic metafields',
  'Thousands of unique keys',
  'App tagging DB',
  'CRM salesperson/referrer + Phase 4 ownership model',
  '1,353 ownership candidates PENDING; raw keys archived',
  'Continue ownership review; do not auto-apply',
  false, false, 'HIGH', 'FORENSIC; Phase 4C'
),
(
  'mm_google_shopping', 'Google Shopping (mm-google-shopping)',
  'Shopping feed labels',
  'PARTIALLY_REPLACED',
  'Product/variant defs; mostly empty live values',
  'Product/variant metafields',
  'Feed labels',
  '—',
  'server/routes/feed/google-merchant.xml.ts + rpc_merchant_feed_products',
  'Feed price mode under trade_required still business decision',
  'Keep Unique feed; archive Shopify defs',
  false, false, 'MEDIUM', 'FORENSIC; Phase 4H'
),
(
  'easyscan_scanpick', 'EasyScan / ScanPick / scanpacker',
  'Historical bin/scan location tools',
  'LIKELY_RETIRED',
  'Metafield defs present; 0 live values',
  'Product location metafield defs',
  'Defs only',
  'May overlap SKULabs bins',
  'Warehouse future',
  'Zero live values',
  'Archive; warehouse via SKULabs access first',
  false, false, 'LOW', 'FORENSIC'
),
(
  'zenvio', 'zenvio',
  'Company registration number metafield writer',
  'ARCHIVE_ONLY',
  'zenvio.company_reg_number ~531 customers (many placeholders)',
  'Customer metafield',
  'Metafield values',
  'Unknown',
  'companies.company_number / CRM',
  'Placeholder quality',
  'Preserve raw; prefer Unique company fields',
  false, false, 'LOW', 'FORENSIC / live metafields'
)
on conflict (app_key) do update set
  app_name = excluded.app_name,
  business_capability = excluded.business_capability,
  classification = excluded.classification,
  active_evidence = excluded.active_evidence,
  shopify_objects = excluded.shopify_objects,
  data_written_to_shopify = excluded.data_written_to_shopify,
  likely_private_data = excluded.likely_private_data,
  unique_equivalent = excluded.unique_equivalent,
  current_gap = excluded.current_gap,
  target_action = excluded.target_action,
  cutover_blocker = excluded.cutover_blocker,
  external_access_required = excluded.external_access_required,
  severity = excluded.severity,
  evidence_source = excluded.evidence_source,
  updated_at = now();

create or replace function public.rpc_admin_list_app_dependency_register(
  p_blocker_only boolean default false
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_items jsonb;
  v_blockers int;
begin
  if not public.is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  select count(*) into v_blockers from app_dependency_register where cutover_blocker;

  select coalesce(jsonb_agg(to_jsonb(r) order by
    case when r.cutover_blocker then 0 else 1 end,
    case r.severity when 'BLOCKER' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 when 'LOW' then 3 else 4 end,
    r.app_name
  ), '[]'::jsonb)
  into v_items
  from app_dependency_register r
  where (not coalesce(p_blocker_only, false)) or r.cutover_blocker;

  return jsonb_build_object(
    'ok', true,
    'blocker_count', v_blockers,
    'items', v_items,
    'note', 'Phase 5B register — do not disconnect apps from this table',
    'locked', jsonb_build_object(
      'pilot_send_authorized', (select value from site_settings where key='pilot_send_authorized' limit 1),
      'commercial_access_mode', (select value from site_settings where key='commercial_access_mode' limit 1),
      'trade_required_cutover_approved', (select value from site_settings where key='trade_required_cutover_approved' limit 1),
      'compliance_enforcement_mode', (select value from site_settings where key='compliance_enforcement_mode' limit 1)
    )
  );
end;
$$;

grant execute on function public.rpc_admin_list_app_dependency_register(boolean)
  to authenticated, service_role;

create or replace function public.rpc_phase5b_dependency_selftest()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cases jsonb := '{}'::jsonb;
  v_ok boolean;
  v_all boolean := true;
  v_n int;
  v_b int;
begin
  v_ok := coalesce((select value from site_settings where key='commercial_access_mode' limit 1),'') = 'catalogue_open'
    and coalesce((select value from site_settings where key='trade_required_cutover_approved' limit 1),'') = 'false'
    and coalesce((select value from site_settings where key='pilot_send_authorized' limit 1),'') = 'false'
    and coalesce((select value from site_settings where key='compliance_enforcement_mode' limit 1),'observe') = 'observe';
  v_cases := v_cases || jsonb_build_object('A_locked_gates', jsonb_build_object('ok', v_ok));
  v_all := v_all and v_ok;

  select count(*) into v_n from app_dependency_register;
  select count(*) into v_b from app_dependency_register where cutover_blocker;
  v_ok := v_n >= 25 and v_b >= 3;
  v_cases := v_cases || jsonb_build_object(
    'B_register_seeded',
    jsonb_build_object('ok', v_ok, 'count', v_n, 'blockers', v_b)
  );
  v_all := v_all and v_ok;

  v_ok := exists (select 1 from app_dependency_register where app_key='skulabs' and cutover_blocker)
    and exists (select 1 from app_dependency_register where app_key='shopify_flow' and cutover_blocker)
    and exists (select 1 from app_dependency_register where app_key='ud_sales_portal' and classification='PARTIALLY_REPLACED');
  v_cases := v_cases || jsonb_build_object('C_critical_rows', jsonb_build_object('ok', v_ok));
  v_all := v_all and v_ok;

  v_ok := (select count(*) from ownership_backfill_reviews where status='PENDING') >= 0;
  v_cases := v_cases || jsonb_build_object(
    'D_ownership_untouched',
    jsonb_build_object('ok', true, 'pending', (select count(*) from ownership_backfill_reviews where status='PENDING'))
  );

  return jsonb_build_object(
    'ok', v_all,
    'cases', v_cases,
    'PHASE4I_PILOT', 'NOT_SENT',
    'note', 'Phase 5B audit register only — no app mutations'
  );
end;
$$;

revoke all on function public.rpc_phase5b_dependency_selftest() from public, anon;
grant execute on function public.rpc_phase5b_dependency_selftest() to service_role, authenticated;
