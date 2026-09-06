# Astor Sneakers — Production Implementation Plan

## User journeys (mobile-first)

| Journey | Steps | Dynamic source |
|---------|-------|----------------|
| Discovery | Home → hero / features / grids / lifestyle | hero_slides, feature_cards, homepage_sections, lifestyle_cards |
| Browse | Header nav → collection page → product card | nav_links, collections, products |
| Product detail | PDP → add to cart / buy now | products, site_settings (currency) |
| Cart | Drawer / cart page → qty adjust → checkout | Zustand + rpc_get_cart_totals |
| Checkout | Stripe Checkout Session → success page | Edge fn + orders table |
| Newsletter | Footer form | rpc_subscribe_newsletter |
| Legal/help | Footer links → CMS page | marketing_pages |
| Admin | Login → CRUD all entities → go live | All tables + integrations |

---

## Phase 1 — Commerce foundation (DB + currency)

- [x] Migration `003_production_commerce.sql`: orders, order_items, marketing_pages, private_settings
- [x] RPCs: `rpc_get_cart_totals`, `rpc_create_checkout_session` (via edge function)
- [x] `currency_code` + `currency_locale` in site_settings
- [x] `formatPrice()` reads live currency from CMS context
- [ ] Inventory decrement on paid order (webhook handler)

## Phase 2 — Checkout & Stripe

- [x] `/checkout` route with cart summary + Stripe redirect
- [x] `/checkout/success` confirmation page
- [x] Edge function `create-checkout-session` (Checkout Sessions API)
- [x] Edge function `admin-stripe-config` (save secret server-side only)
- [x] Admin **Integrations** module: publishable key, mode, enabled toggle, secret key (server-only)
- [ ] Stripe webhook edge function for `checkout.session.completed`
- [ ] Admin **Orders** module: read orders, status, line items

## Phase 3 — Admin UX overhaul

- [x] `AdminSheet`: mobile bottom sheet, desktop right panel (no center dialogs)
- [x] `useBulkSelection` + `AdminBulkToolbar` on all catalog modules
- [x] Bulk delete + bulk publish/unpublish where applicable
- [ ] Drag-reorder for sort_order fields
- [ ] CSV export on newsletter + orders

## Phase 4 — Complete CMS coverage (nothing static)

| Module | Route | CRUD | Bulk |
|--------|-------|------|------|
| Products | /admin/products | ✓ | ✓ |
| Collections | /admin/collections | ✓ | ✓ |
| Categories | /admin/categories | ✓ | ✓ |
| Hero Slides | /admin/hero-slides | ✓ | ✓ |
| Feature Cards | /admin/feature-cards | ✓ | ✓ |
| Lifestyle Cards | /admin/lifestyle-cards | ✓ | ✓ |
| Homepage Sections | /admin/homepage-sections | ✓ | ✓ |
| Nav Links | /admin/nav-links | ✓ | ✓ |
| Marketing Pages | /admin/pages | ✓ | ✓ |
| Media | /admin/media | upload/delete | bulk delete |
| Newsletter | /admin/newsletter | read/delete | bulk delete |
| Form Submissions | /admin/submissions | read/delete | bulk delete |
| Site Settings | /admin/site-settings | typed keys | — |
| Integrations | /admin/integrations | Stripe | — |
| Orders | /admin/orders | read/update status | — |
| Users | /admin/users | ✓ | — |

## Phase 5 — Storefront production polish

- [x] Dynamic pages `/pages/$slug` for legal/help content
- [x] Motion scroll reveals + micro-interactions (motion/react)
- [x] Mobile-first: hamburger, stacked grids, bottom cart drawer
- [ ] Search (products by name)
- [ ] Inventory guard on add-to-cart
- [ ] SEO meta from marketing_pages + product slugs

## Phase 6 — Go-live checklist

1. Apply all Supabase migrations
2. Create `cms-media` storage bucket (public read)
3. Set `VITE_SUPABASE_URL=https://oelolusdbaoyiqkgukib.supabase.co` + `VITE_SUPABASE_ANON_KEY` from The UD Revamp
4. Admin → Integrations: enter Stripe publishable key + secret (test mode)
5. Deploy edge functions; set `STRIPE_WEBHOOK_SECRET` in Supabase secrets
6. Admin → Site Settings: currency, brand copy
7. Seed or CRUD all homepage content
8. `npm run build` → deploy `.output`

---

## Architecture decisions

- **Payments**: Stripe Checkout Sessions (hosted, PCI-safe, mobile-optimized)
- **Secrets**: Publishable key in `site_settings`; secret in `private_settings` via edge function only
- **Admin forms**: Sheets only — bottom on `<md`, right panel on `≥md`
- **Currency**: `Intl.NumberFormat` with admin-configured `currency_code` / `currency_locale`
- **Cart totals**: Server RPC — frontend never computes tax/shipping/discounts
