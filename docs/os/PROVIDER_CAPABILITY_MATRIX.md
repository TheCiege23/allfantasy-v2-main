# Provider Capability Matrix (Parts 6, 7)

Date: 2026-07-12. Truthful, derived-only badges — zero independent opinion
about provider trust. `deriveProviderCapabilities` and `deriveImportType`
(`lib/shared-services/league-hub/providerCapabilities.ts`) import the real
classification arrays from `commissionerGate.ts`
(`OPEN_READ_PROVIDERS`, `MEMBERSHIP_VERIFIED_UNDETERMINED_COMMISSIONER` —
both exported this phase, previously module-private) instead of
re-deriving which providers can prove what. This file only labels what the
Import Security Closure phase's authorization layer already established.

## Capability badges by provider

Badge label text (`CAPABILITY_LABEL` in `UniversalLeagueCard.tsx`) was made
precise this phase (Commissioner Import Attestation UI phase, Part 7)
following the required distinctions: `native` reads "Native AllFantasy
League" (never "...Commissioner" — this badge shows for every member of a
native league, not just its commissioner; the separate, real
`isCommissioner`-gated pill carries that claim), `commissioner_verified`
reads "Provider-Verified Commissioner," and `user_attested` reads
"Commissioner Authority User-Attested" — never "Commissioner Verified."
Confirmed by grep (before and after this phase's edits) that no surface
anywhere displays "Commissioner verified by ESPN/Yahoo/MFL."

| Provider | Import type | Badges | Why |
|---|---|---|---|
| **AllFantasy (native)** | `native` | `Native AllFantasy League` | No external source at all. |
| **Sleeper** | `live_sync` | `Live Sync`, `Manual Refresh`, **`Provider-Verified Commissioner`** or `Membership Verified` | Only provider with a real API `true`/`false` commissioner signal — badge reflects the real value, never assumed. |
| **ESPN** | `live_sync` | `Live Sync`, `Manual Refresh`, `Membership Verified`, + `Commissioner Authority User-Attested` once a real attestation is recorded (UI now exists — Commissioner Import Attestation UI phase) | Real membership proven; commissioner status cannot be determined by the API (Import Security Closure phase finding). |
| **Yahoo** | `live_sync` | Same as ESPN | Same real gap, same fix. |
| **MFL** | `live_sync` | Same as ESPN | Real `TYPE=myleagues` membership check (this program's own MFL fix); no commissioner field exists in MFL's API at all. |
| **Fantrax** | `csv_snapshot` | `CSV Snapshot`, `Manual Refresh`, + `Commissioner Authority User-Attested` once a real attestation is recorded | Never a live API — confirmed by grep, zero `fetch(` calls in the fetch service. Ownership (not commissioner authority) is the real, enforced boundary (real `AppUser.id` FK, Import Security Closure phase). |
| **Fleaflicker** | `read_only` | `Read-Only Synchronization`, `Manual Refresh` | Open-read, never membership-verified — unchanged behavior, no attestation applies (per `IMPORT_AUTHORIZATION_CONTRACT.md`, forcing the three-outcome contract onto a provider that never attempts verification would misrepresent what was checked). |
| **Unrecognized/legacy string** (e.g. `'cbs'`) | `read_only` | `Read-Only Synchronization`, `Manual Refresh` | Never a certified import path in this program — most conservative honest label, never fabricated as native or live-synced. |

## `manual_refresh` — every non-native provider, always

Checked `app/api/cron/*` directly (this phase): no cron job re-syncs an
individual imported league's roster/standings data for any provider — only
score/player/schedule/news feeds are cron-driven. League resync is a real,
user-triggered action (`app/api/leagues/import/resync/route.ts`). So every
non-native provider honestly carries `Manual Refresh` — never claim
automatic background sync that doesn't exist.

## Sync freshness states (`syncFreshness.ts`)

| State | Trigger | Real source |
|---|---|---|
| `not_applicable` | `provider === 'allfantasy'`, or `syncStatus === 'manual'` | Native leagues have nothing external to sync. |
| `fresh` | `lastSyncedAt` within 24h | `League.lastSyncedAt` |
| `stale` | `lastSyncedAt` older than 24h | `League.lastSyncedAt` |
| `syncing` | `syncStatus === 'syncing'` | Accommodated in the type; **never actually written today** — confirmed by grep across the whole repo. Disclosed, not fabricated: this state will not appear in real data until a future resync flow sets it. |
| `failed` | `syncStatus === 'error'` | Real value, written by the sync services on a real failure. |
| `never_synced` | No `lastSyncedAt` at all | Real absence of data, not an invented default. |

24-hour staleness threshold is a product choice made this phase (no
existing precedent found in the codebase for this specific threshold) —
flagged for product review, not asserted as validated UX.

## What this matrix intentionally does not claim

- It does not attempt to verify commissioner *authority* for any provider
  beyond what `commissionerGate.ts` already proved — this file is a labeling
  layer, not a second authorization system.
- It does not distinguish "attestation recorded but user later revoked
  access" — no revocation mechanism exists anywhere in this program yet;
  a real, disclosed gap, not unique to this phase.
- Two of Part 7's required distinctions — "Verification pending" and
  "Import blocked" — are deliberately **not** badges in this table. They
  are transient states during the import flow itself (before a
  League Hub entry exists at all), not attributes of an already-committed
  league: "Verification pending" is the loading state while
  `assertImportCommissioner` runs; "Import blocked" is the
  `ATTESTATION_REQUIRED`/`NOT_COMMISSIONER` 403 surfaced by
  `LeagueImportFlow.tsx`. See `COMMISSIONER_ATTESTATION_PRODUCT_SPEC.md`
  for the full error-state copy.
