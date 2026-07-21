# AF_CHECKOUT_SESSIONS_BUILD — Durable Stripe checkout (retire payment-link drift)

_Decision: refactor to Checkout Sessions (Jul 19, 2026). This is the DURABLE follow-up to the P0-A emergency env swap — do the env swap first to stop the bleeding, then this so the drift can't recur._

## Goal
Replace hardcoded `STRIPE_CHECKOUT_LINK_AF_*` payment links with server-created Stripe Checkout Sessions built from catalog price IDs. Single source of truth = `lib/monetization/catalog.ts` + `STRIPE_PRICE_AF_*`. A future reprice can then never silently point checkout at an archived price.

## Current state (verified in repo)
- `lib/monetization/catalog.ts` → `getMonetizationStripePriceIdForSku(sku)` resolves each SKU to its `STRIPE_PRICE_AF_*` price ID.
- `lib/monetization/StripeCheckoutLinkRegistry.ts` builds a payment-link URL from `STRIPE_CHECKOUT_LINK_AF_*` and appends a `client_reference_id` — a base64url payload `{v:1,u:userId,s:sku,p:purchaseType,c:coupon}` via `buildStripeCheckoutClientReferenceId` — plus `prefilled_email`, `af_return_path`, `prefilled_promo_code`.
- The webhook decodes it with `parseStripeCheckoutClientReferenceId`.
- Admin diagnostic `/api/admin/monetization/checkout-link-mapping` reports payment-link health.

## The change
1. **New server route** under a geo-gated paid prefix — `middleware.ts` already lists `/api/subscription/checkout` and `/api/monetization/checkout` in `PAID_GEO_PREFIXES`, so place it there. `POST { sku, returnPath?, couponCode? }`, requires an authenticated user, creates a Checkout Session:
   - `line_items: [{ price: getMonetizationStripePriceIdForSku(sku), quantity: 1 }]`
   - `mode`: `subscription` for plan SKUs, `payment` for token packs (from registry `purchaseType`).
   - `client_reference_id`: **REUSE** `buildStripeCheckoutClientReferenceId(...)` so the existing webhook parsing is unchanged.
   - `customer_email` from the user; `success_url` / `cancel_url` from `returnPath`.
   - Coupon: `allow_promotion_codes: true` and/or `discounts` for `WASSUPFRED`.
   - Return `{ url: session.url }`; client redirects.
2. **Repoint every checkout CTA** (pricing page, `/upgrade`, LandingV3 pricing) at this route instead of the payment-link URL.
3. **Delete old code**: retire `STRIPE_CHECKOUT_LINK_AF_*` resolution + the payment-link builder in the registry (KEEP the `client_reference_id` encode/decode — still used). Remove the dead env vars from Vercel after cutover.
4. **Repurpose the admin diagnostic**: `checkout-link-mapping` should now verify each `STRIPE_PRICE_AF_*` resolves to an **active** Stripe price (catch a future archived-price drift at the source).

## Optional phase 2 (recommended, not required)
Resolve prices by Stripe **`lookup_key`** at runtime instead of hardcoded `STRIPE_PRICE_AF_*` IDs, so a reprice needs zero env change. Assign lookup_keys to the canonical prices (currently null on the `price_1TtYe*` set).

## Build checklist (all 7)
1. **Visuals** — checkout button gets a loading state during session creation; visible error state on failure.
2. **Backend** — the session route; webhook reused unchanged.
3. **UI/UX** — disabled/spinner while redirecting; clear error ("couldn't start checkout — try again"); no "AI" in any copy.
4. **Delete old code** — payment-link env vars + registry link resolution.
5. **Fixes/gaps** — permanently closes the P0-A drift class.
6. **SEO/ASO** — n/a post-click; keep pricing-page metadata intact.
7. **Brand** — real prices from the catalog; never the word "AI"; honest pricing.

## Verification
- Unit: route builds correct `line_items` + `client_reference_id` per SKU; subscription vs payment mode; coupon applied.
- Webhook still resolves user+sku from `client_reference_id` (unchanged path).
- E2E (Stripe test mode): each tier's CTA → Checkout at the correct live price; one subscription + one token pack end-to-end.
- Confirm the repurposed diagnostic flags an intentionally-archived price.
- Rely on CI ts-ratchet (local tsc false-cleans); add the new tests to the CI vitest job once it exists.

## Claude Code prompt
`implement the plan in AF_CHECKOUT_SESSIONS_BUILD.md` — only after the P0-A env swap is live. Ship the session route + CTA rewrites + old-code removal together, Stripe-test-mode verified.
