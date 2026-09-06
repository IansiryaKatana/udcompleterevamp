-- Unique child GIDs for additive nested pagination backfill
create unique index if not exists fulfillment_line_items_external_gid_uidx
  on public.fulfillment_line_items (external_gid)
  where external_gid is not null;

create unique index if not exists refund_line_items_external_gid_uidx
  on public.refund_line_items (external_gid)
  where external_gid is not null;
