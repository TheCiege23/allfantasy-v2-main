# Supreme bundle correction

Owner decision: retain benefits for existing Supreme subscribers and match new subscriptions to the advertised Pro + Commissioner bundle. Legacy is sold separately.

## Production inventory

On October 25, 2026, a read-only inventory against the known production database found no Supreme subscription rows and no active Supreme admin grants. No paid Supreme account currently requires a benefit migration. Owner/admin bypass accounts are synthetic access grants; they retain explicit Supreme, Legacy and Enterprise plans.

Run `node --env-file=.env scripts/supreme-benefit-inventory.cjs` with the existing verified production environment immediately before merging this correction. It reads aggregate counts, checks the known database identity, prints no account identifiers or credentials, and performs no writes. Exit 0 confirms the empty inventory. Exit 2 means an existing holder was found: stop this rollout and persist that holder's existing Legacy benefit before narrowing access. Exit 1 means the inventory could not be verified.

## Correction

- Central feature access grants the plans in the feature definition after expanding the advertised bundle. Supreme is no longer an automatic yes for every premium feature.
- The four Legacy-only catalog entries require Legacy. Features included through Pro or Commissioner remain available to Supreme.
- Server live flags, client entitlement flags and synchronized profile flags agree: Supreme sets Pro and Commissioner, and Legacy requires an explicit Legacy plan.
- Token subscription eligibility follows the same rule. Prices and discounts do not change.
- An account holding both Supreme and Legacy keeps both. Owner/admin snapshots explicitly include every plan they already accessed through the broad bypass.

No database schema or customer-balance change is included. Tests cover matrix features, catalog-only Legacy features, explicit combined plans, token eligibility, client flags and owner/admin access. Required CI must pass before merge.

If an existing holder is discovered, use a durable benefit flag tied to the eligible subscription, preserved through every webhook and renewal. Do not infer old benefits solely from a mutable SKU, a profile boolean, or account creation time. Verify cancellation and a genuinely new purchase separately before shipping that preservation path.
