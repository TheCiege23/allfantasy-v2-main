# AF Tier Entitlement + Billing Build Brief

**Status:** ready to build · **Prepared:** Jul 15, 2026
**For:** Claude Code, running in `F:\allfantasy-v2-main`
**Goal:** Turn the locked tier matrix into a working paywall — a real entitlement engine, live Stripe checkout, and a token ledger — so users can subscribe to AF Pro / Commissioner / Supreme / War Room or buy token packs, and every gated surface unlocks correctly.

**Read alongside:**
- The free-vs-paid tier matrix (v1, locked Jul 15) — the source of truth for what each tier includes.
- `AF_GATE0_TRIAL_BUILD.md` — this brief replaces that brief's `canAccess()` stub and plan/token seams with the real engine.
- `AF_POSITIONING_AND_LANDING_COPY.md` — voice rules (never "AI" customer-facing).

**Prices are already set** in the Stripe Dashboard; the Price IDs live in the env (see §2). This brief wires them in — it does not set prices.

---

## STRIPE RECONCILIATION — DONE Jul 15 (read this first)

The Stripe account (`Henson Family`, live mode) was cleaned up directly. Final state:

**Products renamed** — "AI" removed from all AllFantasy product names; "War Room" → **Legacy**. Note: each subscription tier's monthly and yearly prices live on **two separate products** sharing the tier name (a pre-existing quirk; both are canonical, both kept active). Token products renamed: Starter (250) / Plus (600) / Pro Token Pack (1,500).

**Final pricing ladder (live):** Pro $9.99/$99.99 · Commissioner $14.99/$149.99 · Supreme $19.99/$199.99 · Legacy $29.99/$299.99. `All-Access` retired (no Stripe product existed; removed from catalog).

**New price IDs created (Commissioner + Legacy repriced):**
| Env var | NEW price ID | Amount |
|---|---|---|
| `STRIPE_PRICE_AF_COMMISSIONER_MONTHLY` | `price_1TtYe0Ht5tjM1ovRdD9gSZSZ` | $14.99 |
| `STRIPE_PRICE_AF_COMMISSIONER_YEARLY`  | `price_1TtYe2Ht5tjM1ovRaMhpRTGc` | $149.99 |
| `STRIPE_PRICE_AF_WAR_ROOM_MONTHLY` (Legacy) | `price_1TtYe3Ht5tjM1ovR386bp0Px` | $29.99 |
| `STRIPE_PRICE_AF_WAR_ROOM_YEARLY` (Legacy)  | `price_1TtYe4Ht5tjM1ovRltdgtAkc` | $299.99 |

Pro, Supreme, and all token price IDs are **unchanged**. `catalog.ts` has been updated to these amounts + clean (no-"AI") titles/descriptions and the `af_all_access` family removed. Env var **keys** are unchanged (only the Commissioner/Legacy **values** change).

**REMAINING deploy steps (must happen in this order):**
1. Update `.env` / `.env.local` **and the production env (Vercel/Railway)** — set the 4 Commissioner/Legacy price vars above to their NEW IDs.
2. Redeploy; verify Commissioner + Legacy checkout uses the new prices.
3. **Only then** archive the 4 old prices (still active now to avoid breaking live checkout): Commissioner `price_1T3k8bHt5tjM1ovRUrYRVdQF` ($4.99) + `price_1TBysHHt5tjM1ovRIZQ8fq7z` ($49.99); Legacy `price_1TByvrHt5tjM1ovRhwy07w5M` ($9.99) + `price_1TBz5xHt5tjM1ovRCMdQs2GI` ($99.99).
4. Regenerate the `STRIPE_CHECKOUT_LINK_AF_*` payment links (they point at old prices) OR move to server-side Checkout Sessions per §5 and drop the links.

Existing subscribers stay on their old price until they change plans (Stripe prices are immutable) — expected.

---

---

## 0. Build-checklist (apply all seven — definition of done)
Every item below must be satisfied before push-to-prod:
1. **Visual changes** — pricing page, upgrade prompts, token-balance UI, manage-subscription surface.
2. **Backend coding** — entitlement engine, Stripe checkout + webhooks, token ledger.
3. **UI/UX** — clear plan comparison, honest loading/empty/error states, smooth upgrade → unlock.
4. **Delete old/unneeded code** — reconcile and remove any superseded/placeholder monetization code (audit first, protect proven-live paths).
5. **Fixes & gaps** — close the naming/flow inconsistencies flagged in §7; no half-wired tiers.
6. **SEO + ASO** — pricing page fully optimized (title, meta, OG, structured data/Product+Offer JSON-LD, clean URL).
7. **On-brand** — no "AI" on any customer-facing billing surface; 5-second clarity; navy/cyan; honesty ("real numbers or nothing" carries into "no surprise charges").

---

## 1. Audit first — build on what exists, don't duplicate
The repo already has Stripe scaffolding. **Start by auditing it and reconciling before writing new code:**
- `stripe` SDK **v20.3.1** (package.json).
- Env keys: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
- `lib/monetization/catalog.ts` — existing subscription + token catalog keyed to Stripe Price IDs.
- `lib/dev-admin/access.ts` — `isSubscriptionEntitlementBypassUserId` (dev/admin entitlement bypass — **preserve this**).
- Stripe **Price IDs** and **Payment Links** already enumerated in env (§2).

Deliverable of this step: a short note on what's already wired vs missing, so the rest of the build extends the catalog rather than forking it.

---

## 2. The catalog (already in env — wire, don't invent)
Subscription Price IDs (monthly + yearly each): `AF_PRO`, `AF_COMMISSIONER`, `AF_SUPREME`, `AF_WAR_ROOM`.
Token Price IDs: `AF_TOKENS_5`, `AF_TOKENS_10`, `AF_TOKENS_25`.
Payment Links (`buy.stripe.com`, client-reference-id flow) exist for every tier + token pack, plus an `AF_ALL_ACCESS` link — **see §7, reconcile the naming.**

`lib/monetization/catalog.ts` must be the single source mapping: tier → { priceIds, entitlements } and token pack → { priceId, tokenCount }.

---

## 3. Data model (Prisma)
Extend `prisma/schema.prisma` (additive; migration required):
- **On the user (or a `Billing`/`Subscription` record):** `stripeCustomerId`, `plan` (free|pro|commissioner|supreme|war_room), `planStatus` (active|past_due|canceled|trialing), `currentPeriodEnd`, `billingInterval` (month|year).
- **`TokenBalance`** — current balance per user (or derived from the ledger).
- **`TokenLedger`** — append-only: `userId`, `delta` (+credit / −spend), `reason` (purchase | trade_analysis | mock_draft | season_sim | chimmy_burst | waiver_deep_dive), `stripeEventId?`, `createdAt`. Balance = sum(delta). **No double-spend, no double-credit.**
- **`StripeWebhookEvent`** — dedupe table: `eventId` unique, processed-at. Idempotency backbone.

---

## 4. Entitlement engine (replaces the Gate 0 stub)
- Implement the real `canAccess(feature, userContext)` mapping **plan → features per the tier matrix**. One module, every gated surface calls it (Gate 0 already routed locked previews through this seam).
- **Token fallback:** if a feature is a one-off unlock (deep trade analysis, mock draft sim, season sim, Chimmy burst, waiver deep-dive) and the user's plan doesn't include it, `canAccess` returns "unlock with N tokens" — spending debits the ledger atomically, then grants the action.
- **Preserve** `isSubscriptionEntitlementBypassUserId` for dev/admin.
- Feature → tier mapping must match the matrix exactly: Free = breadth (all platforms, all leagues on board, basic attention/search/legacy); Pro = player depth; Commissioner = Pro tools + League OS; Supreme = + projections/portfolio; War Room = everything + live draft War Room + dynasty deep + early access.

---

## 5. Checkout + portal
- **Purchase requires an account** (entitlements tie to the user's email + username). No anonymous purchase.
- Use the existing **Payment Link + `client_reference_id = userId`** flow (env is already set up for it), OR create Stripe Checkout Sessions server-side — pick one, remove the other's dead scaffolding (§0.4). Recommend Checkout Sessions if you need richer control; keep Payment Links only if already proven live.
- **Billing Portal:** wire Stripe Customer Portal for manage/cancel/update-card so you don't build subscription management by hand.

---

## 6. Webhooks (the source of truth for entitlement state)
Single handler, signature-verified with `STRIPE_WEBHOOK_SECRET`, **idempotent** via `StripeWebhookEvent`:
- `checkout.session.completed` — subscription → set plan/status/customer; token pack → credit `TokenLedger` (keyed to `stripeEventId`, once).
- `customer.subscription.created|updated|deleted` — sync `plan`, `planStatus`, `currentPeriodEnd`.
- `invoice.paid` / `invoice.payment_failed` — keep status current (past_due handling).
Entitlements derive from the DB state the webhooks maintain — never trust the client.

---

## 7. Reconcile before shipping (known gaps)
- **Naming:** env has both `AF_WAR_ROOM` / `AF_SUPREME` price IDs and an `AF_ALL_ACCESS` payment link. Confirm mapping — is "All Access" a synonym for War Room (top tier), or a stale artifact? Align catalog + Stripe products + UI to the locked 4-tier matrix; delete stragglers.
- **Payment Links vs Checkout Sessions:** both are scaffolded — choose one, delete the other (§0.4).
- Confirm the four tiers in Stripe match the matrix (War Room = top all-access; Commissioner includes Pro tools).

---

## 8. Billing UI
- **Pricing page** built from the tier matrix (this is the customer-facing render of it) — full SEO/ASO + on-brand, no "AI." Product/Offer JSON-LD.
- **Upgrade prompts** on every Gate 0 locked preview → deep-link to the right plan/checkout.
- **Token balance** visible in the app; **buy-tokens** surface; spend confirmation before debiting.
- **Manage subscription** entry → Stripe Billing Portal.

---

## 9. Acceptance criteria
- [ ] A user can subscribe to each tier (monthly + yearly) via checkout; on success their plan + entitlements flip live and gated features unlock per the matrix.
- [ ] A user can buy a token pack (5/10/25); balance credits **exactly once** even if the webhook is redelivered.
- [ ] Spending tokens on a one-off unlock debits atomically — no double-spend under concurrent requests; balance can't go negative.
- [ ] Webhooks are signature-verified and idempotent (replay a Stripe event → no duplicate state change).
- [ ] Entitlement state is server-derived; a client cannot self-grant a paid feature.
- [ ] Cancel/downgrade via Billing Portal correctly removes entitlements at period end.
- [ ] Dev/admin bypass still works.
- [ ] Pricing page passes SEO checks and carries no "AI" copy; on-brand.
- [ ] Old/duplicate monetization scaffolding removed (Payment-Links-vs-Sessions, ALL_ACCESS naming).

---

## 10. Verification
- `npm run build` + `npm run typecheck` clean.
- Stripe **test mode** + Stripe CLI (`stripe listen` / `stripe trigger`) for the full webhook set; assert idempotency by redelivering events.
- Tests: entitlement matrix (each plan → allowed/denied features), token credit-once, token spend atomicity/no-negative, webhook signature rejection, subscription lifecycle (create→update→cancel).
- Manual: subscribe as a fresh account, confirm a locked Gate 0 preview unlocks; buy tokens, spend on a deep action, confirm balance + gating.

---

*Sequence: audit existing scaffolding → data model + migration → entitlement engine → checkout + webhooks → token ledger → billing UI → reconcile §7 → verify → build → push to prod.*
