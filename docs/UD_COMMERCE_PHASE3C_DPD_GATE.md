# Phase 3C — DPD product confirmation gate

**Status:** STOPPED — product/API still UNCONFIRMED  
**carrier_mode:** disabled  
**TEST client:** not implemented (would invent endpoints)  
**Live DPD:** blocked  

## Evidence re-check

| Source | Result |
|---|---|
| Shopify / forensic | WSA DPD Integration + UK tracking hosts CONFIRMED |
| `.env` | no DPD keys |
| `private_settings` | no DPD keys |
| Supabase secrets | no DPD-named secrets |
| Repo business docs | none |

## Required from business / DPD / WSA

Exact product name, official API family + TEST URL, TEST credentials, account IDs, service-code catalogue, label/tracking/weight rules, approval for `carrier_mode=test` (never live in 3C).

## Migration

`072_phase3c_dpd_confirmation_gate.sql` — forces disabled/unconfirmed; selftest A–F.
