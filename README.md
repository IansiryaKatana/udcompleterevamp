# Unique Distribution — TanStack Start + Supabase

Premium electronics eCommerce storefront with embedded CMS admin at `/admin`.

## Features

- Storefront: home, collections, product detail, cart, checkout (Stripe or quote request)
- Admin CMS: products, categories (with hierarchy), collections, orders, checkout settings
- Supabase: Postgres, Auth, Storage, Edge Functions

## Checkout modes

- **Request a quote** (default): cart emailed to admin-configured address via Resend
- **Stripe**: hosted checkout when enabled under Admin → Integrations

Configure at `/admin/checkout`.

## Setup

1. Copy `.env.example` to `.env` and set the publishable key from [The UD Revamp](https://supabase.com/dashboard/project/oelolusdbaoyiqkgukib)
2. This repo is linked to project `oelolusdbaoyiqkgukib` (`eu-west-2`). Run migrations with `supabase db push`
3. Deploy edge functions: `request-quote`, `create-checkout-session`, `verify-checkout-session`, `stripe-webhook`, `admin-stripe-config`
4. Set `RESEND_API_KEY` (and optional `RESEND_FROM_EMAIL`) in Supabase secrets for quote emails
5. `npm install && npm run dev`

## Admin

- `/admin/login` — email/password auth
