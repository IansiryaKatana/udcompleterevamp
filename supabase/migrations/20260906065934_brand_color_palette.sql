-- Unique Distribution green palette (#66a441) as editable site_settings.

insert into public.site_settings (key, value) values
  ('brand_primary', '#66a441'),
  ('brand_primary_hover', '#548835'),
  ('brand_primary_dark', '#426b29'),
  ('brand_primary_muted', '#e8f3e2'),
  ('brand_page_bg', '#f3f5f2'),
  ('brand_content_bg', '#fafbf9'),
  ('brand_text', '#1d2518'),
  ('brand_muted', '#6b7665'),
  ('brand_soft', '#e8f3e2'),
  ('brand_footer', '#14220b'),
  ('brand_on_dark', '#f7faf4'),
  ('brand_hero', '#426b29'),
  ('brand_border', '#d4decf'),
  ('email_brand_color', '#66a441')
on conflict (key) do update
set
  value = excluded.value,
  updated_at = now();
