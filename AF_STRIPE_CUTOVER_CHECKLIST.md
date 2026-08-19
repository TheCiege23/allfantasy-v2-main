# AF Stripe Cutover Checklist — new pricing go-live

**Prepared:** Jul 15, 2026 · **Do these IN ORDER.** Steps 1–3 are safe now; step 4 (archiving) must come only after prod is verified on the new prices, or you'll break live checkout.

Stripe account: **Henson Family** (live mode). Products already renamed (no "AI"; War Room → Legacy) and new prices created. What remains is switching prod to the new price IDs and cleaning up the old ones.

---

## The 4 env values to change (keys stay the same, only values change)

| Env var (unchanged key) | OLD value | NEW value |
|---|---|---|
| `STRIPE_PRICE_AF_COMMISSIONER_MONTHLY` | `price_1T3k8bHt5tjM1ovRUrYRVdQF` ($4.99) | `price_1TtYe0Ht5tjM1ovRdD9gSZSZ` ($14.99) |
| `STRIPE_PRICE_AF_COMMISSIONER_YEARLY`  | `price_1TBysHHt5tjM1ovRIZQ8fq7z` ($49.99) | `price_1TtYe2Ht5tjM1ovRaMhpRTGc` ($149.99) |
| `STRIPE_PRICE_AF_WAR_ROOM_MONTHLY` (Legacy) | `price_1TByvrHt5tjM1ovRhwy07w5M` ($9.99) | `price_1TtYe3Ht5tjM1ovR386bp0Px` ($29.99) |
| `STRIPE_PRICE_AF_WAR_ROOM_YEARLY` (Legacy)  | `price_1TBz5xHt5tjM1ovRCMdQs2GI` ($99.99) | `price_1TtYe4Ht5tjM1ovRltdgtAkc` ($299.99) |

Pro, Supreme, and all token price IDs are unchanged — do not touch them.

---

## Step 1 — Update env everywhere
- [ ] Local `.env` and `.env.local` — set the 4 values above to the NEW IDs.
- [ ] **Production** — set the same 4 in the host dashboard (Vercel and/or Railway env vars). This is the one that actually changes what customers pay; local `.env` alone does nothing for prod.
- [ ] Keep the OLD price IDs written down (they're in the table above) — needed for step 4.

## Step 2 — Redeploy
- [ ] Trigger a prod redeploy so the new env is picked up.
- [ ] Confirm the deploy is live and healthy.

## Step 3 — Verify on the new prices (before archiving anything)
- [ ] Pricing page shows $14.99 Commissioner, $29.99 Legacy (and $9.99 Pro, $19.99 Supreme unchanged).
- [ ] Start a test checkout for Commissioner and for Legacy — confirm the amount charged is the new one and the correct price ID is used.
- [ ] Confirm no "AI" text appears on the checkout page, receipt, or invoice (product names are already clean).
- [ ] `catalog.ts` amounts match ($14.99 / $149.99 / $29.99 / $299.99) — already updated in repo.

## Step 4 — Archive the old prices (ONLY after step 3 passes)
Set `active: false` on each (Stripe: Product → the old price → Archive). Existing subscribers on these keep their price; archiving only stops NEW purchases at the old amount.
- [ ] Commissioner monthly `price_1T3k8bHt5tjM1ovRUrYRVdQF` ($4.99)
- [ ] Commissioner yearly `price_1TBysHHt5tjM1ovRIZQ8fq7z` ($49.99)
- [ ] Legacy monthly `price_1TByvrHt5tjM1ovRhwy07w5M` ($9.99)
- [ ] Legacy yearly `price_1TBz5xHt5tjM1ovRCMdQs2GI` ($99.99)

*(I can do this archiving for you from here via Stripe once you confirm step 3 passed — just say the word.)*

## Step 5 — Fix the payment links
The `STRIPE_CHECKOUT_LINK_AF_*` env values are `buy.stripe.com` links that still point at OLD prices.
- [ ] Either regenerate the Commissioner + Legacy payment links against the new prices and update those env vars,
- [ ] **or** move checkout to server-side Stripe Checkout Sessions (recommended — see `AF_TIER_BILLING_BUILD.md` §5) and retire the payment links entirely.

---

## Rollback (if something's wrong after step 2)
Revert the 4 prod env values to the OLD IDs and redeploy. Because you haven't archived the old prices until step 4, rollback is clean.

*Related: `AF_TIER_BILLING_BUILD.md` (entitlement engine, webhooks, token ledger) is the larger billing build this pricing sits inside.*
