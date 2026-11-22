# Separate daily Chimmy answers

Each signed-in account without a Chimmy subscription receives two included answers per UTC day, regardless of purchased AF Token balance. AF Pro and AF Supreme keep their existing 100-answer daily allowance. App Review accounts keep their existing 25-answer exception. Unused answers do not accumulate.

The daily counter uses the existing `api_rate_limits` table with a distinct `chimmy_free` endpoint. Successful answers consume one allowance; concurrent requests cannot exceed the limit. Missing-data answers and failed model calls return a reserved answer. The counter remains separate from the AF Token wallet, and paid-token pricing and balances are unchanged. Previously granted wallet credits are retained; this rollout does not attempt to reclaim them or infer which past answers used purchased versus free tokens.

The main chat route, legacy JSON route, and private `@Chimmy` model replies share this policy. Stored-data answers remain free. Chat clients send the initial request without token consent so the server can apply an included answer. When the allowance is exhausted, the existing exact-price confirmation flow is used before spending tokens. Private `@Chimmy` replies cannot show that confirmation, so they direct the sender to the Chimmy panel after the included answers are used.

No new database table or migration is required. Existing durable request receipts are retained. Focused verification covers free and subscription counters, concurrent requests, refund ownership, App Review allowances, client consent, draft restoration after cancellation, and the free-versus-paid allowance display.

## Remaining launch decisions

- Supreme: preserve Legacy benefits on existing Supreme subscriptions before replacing the broad access shortcut. New subscriptions should match the advertised Pro + Commissioner bundle. A persistent benefit flag and migration are needed so webhook renewals cannot erase the grandfathered benefit. Entitlement resolution, profile flags, feature catalogs, and account benefit displays must agree before that change ships.
- Deep Analysis: the current Fast/Deep selector changes response length. A paid preview must have a server-owned response contract: useful free facts or a preview summary, explicit locked sections, and paid analysis withheld until access is established. Keep the two included daily answers useful for evaluating Chimmy. Reuse the existing action prices unless a separately reviewed pricing change is adopted.
- Retry protection: production already has durable receipts, saved responses, and client request recovery. Verify the legacy JSON provider path and cached clients before describing retry protection as universal.
- Android purchases: the TWA currently blocks checkout. Play Billing or the applicable enrolled billing program must be configured and tested before paid conversion inside the Play app is promoted.
