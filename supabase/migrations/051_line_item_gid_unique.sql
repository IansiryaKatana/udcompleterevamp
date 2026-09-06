-- unique line GIDs for safe additive backfill
create unique index if not exists order_items_source_line_item_gid_uidx
  on public.order_items (source_line_item_gid)
  where source_line_item_gid is not null;

create unique index if not exists draft_order_line_items_source_line_gid_uidx
  on public.draft_order_line_items (source_line_item_gid)
  where source_line_item_gid is not null;
