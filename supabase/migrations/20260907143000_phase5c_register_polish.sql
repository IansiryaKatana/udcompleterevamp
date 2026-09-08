-- Phase 5C polish — remaining register classifications + messaging boundary note
-- No gate flips. No customer contact.

update public.site_settings set value = 'catalogue_open'
where key = 'commercial_access_mode' and value is distinct from 'catalogue_open';
update public.site_settings set value = 'false'
where key = 'trade_required_cutover_approved' and value is distinct from 'false';
update public.site_settings set value = 'false'
where key = 'pilot_send_authorized' and value is distinct from 'false';
update public.site_settings set value = 'observe'
where key = 'compliance_enforcement_mode' and value is distinct from 'observe';
update public.site_settings set value = 'false'
where key = 'automation_engine_enabled' and value is distinct from 'false';
update public.site_settings set value = 'false'
where key = 'wms_enabled' and value is distinct from 'false';

update public.app_dependency_register set
  classification = 'PARTIALLY_REPLACED',
  unique_equivalent = 'communication_threads + communication_messages (ledger; no live chat)',
  current_gap = 'Historical Shopify Messaging export optional',
  target_action = 'Use communication ledger for ops notes; do not clone chat',
  confidence_note = 'WEAKLY_INFERRED — Messaging app purpose from name + B2B ops need',
  updated_at = now()
where app_key = 'messaging';

update public.app_dependency_register set
  classification = 'PARTIALLY_REPLACED',
  unique_equivalent = 'marketing_segments + consent fields + Resend transactional; Brevo remains external campaign tool',
  current_gap = 'List/consent export from Brevo still useful; Unique does not send campaigns',
  target_action = 'Own consent + segment definitions; export connector later',
  updated_at = now()
where app_key = 'brevo_pushowl';

update public.app_dependency_register set
  classification = 'INTEGRATION_REQUIRED',
  unique_equivalent = 'integration_connections (odoo) — disabled; generic sync_runs boundary',
  current_gap = 'No Odoo credentials; no live sync',
  target_action = 'Wire connector when credentials approved',
  confidence_note = 'STRONGLY_INFERRED ERP sync from app name + DATA_MIGRATION history',
  updated_at = now()
where app_key = 'datafetchodoo';

update public.app_dependency_register set
  classification = 'UNKNOWN',
  unique_equivalent = 'Native catalogue + metafields; no specialized subsystem',
  current_gap = 'Cannot determine operational purpose without developer interview',
  target_action = 'Preserve observed metafield/source evidence; UNKNOWN_CAPABILITY',
  confidence_note = 'UNKNOWN — custom app footprint insufficient for rebuild',
  updated_at = now()
where app_key = 'xtimcatlogx';

update public.app_dependency_register set
  unique_equivalent = coalesce(unique_equivalent, '') || ' | integration_connections xero disabled',
  current_gap = 'Statutory GL remains external; Unique owns ops AR',
  updated_at = now()
where app_key = 'xero';

-- Document template seed (inactive)
insert into public.document_templates (template_type, name, version, body_html, active)
select * from (values
  ('invoice', 'Unique Invoice (foundation)', '5c.1',
   '<html><body><h1>Invoice {{invoice_number}}</h1><p>{{company_name}}</p><p>Reconstructed/historical docs remain labelled.</p></body></html>',
   false),
  ('packing_slip', 'Unique Packing Slip (foundation)', '5c.1',
   '<html><body><h1>Packing Slip</h1><p>Order {{order_number}}</p></body></html>',
   false),
  ('delivery_note', 'Unique Delivery Note (foundation)', '5c.1',
   '<html><body><h1>Delivery Note</h1><p>Order {{order_number}}</p></body></html>',
   false),
  ('order_printout', 'Unique Order Printout (foundation)', '5c.1',
   '<html><body><h1>Order {{order_number}}</h1></body></html>',
   false)
) as v(template_type, name, version, body_html, active)
where not exists (
  select 1 from public.document_templates d
  where d.template_type = v.template_type and d.version = v.version
);
