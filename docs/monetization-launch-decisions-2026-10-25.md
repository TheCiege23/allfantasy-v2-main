# Launch monetization decisions

Status: owner approved preserving existing Supreme benefits, correcting new subscription scope, and keeping two useful daily Chimmy answers followed by optional paid analysis. The Supreme and paid-analysis implementations have not shipped.

## Keep the everyday product free

Dashboard, ordinary notifications, member-to-member chat, league participation, and stored-data lookups should stay useful without a purchase. Do not put a subscription interstitial in these paths. Charge for additional computation and advanced commissioner workflows, with the price shown at the action.

This recommendation fits the owner's no-advertising goal and the expectation set by Sleeper's free dynasty product, which includes league chat and advertises no ads or paywalls. Source checked October 25, 2026: [Sleeper dynasty overview](https://support.sleeper.com/en/articles/1960098-introduction-to-dynasty-leagues).

## Decisions and implementation gates

| Priority | Decision | Recommended policy | Required implementation before promotion |
| --- | --- | --- | --- |
| 1 | Daily Chimmy access | Keep two useful answers per UTC day for every account without a Chimmy subscription. Keep 100 for Pro/Supreme. Purchased tokens remain separate. | Shared atomic daily counter, zero-wallet access, failed-answer release, clear reset and remaining count. Prepared in the allowance follow-up. |
| 2 | Supreme scope | Preserve benefits already received by existing subscribers. New subscriptions receive the explicitly advertised Pro + Commissioner bundle. | Persist grandfathered benefits before removing blanket Supreme access. Verify renewal, cancellation, resubscription, account displays, and every entitlement gate. Owner approved. |
| 3 | Free summary and paid analysis | Keep the two daily trial answers useful, including detailed answers. Elsewhere offer a useful free summary with an optional, explicitly priced deeper report. | A server response must omit locked analysis. Define each paid report's extra scenarios, evidence, comparisons and recommendations. Owner approved. |
| 4 | Android purchases | Support purchases through a verified Play Billing integration or an applicable enrolled alternative program. | Product IDs, purchase verification, account attribution, duplicate delivery protection, restore/renewal/cancellation and refund handling, and a real-device purchase test. Current TWA checkout is blocked. |
| 5 | Price consent and retry claims | Charge exactly once for the delivered action at the agreed price. | Current central-rule debit is atomic; main Chimmy already has durable receipts. Audit legacy JSON and other paid actions before claiming universal retry protection. Bind consent to the quoted cost/version or request fresh consent when pricing changes. |

The token debit transaction currently reads the active spend rule again. A boolean confirmation is not a universal price-quote guarantee if the rule changes between preview and spend. Keep action prices stable during this launch and complete quote binding before marketing an immutable quoted-price guarantee. Do not change token-pack prices or action costs as part of these fixes.

## What a locked analysis should show

- Show a useful summary from information the user can access, the report's name, the specific additional sections, and its server-provided token price or subscription inclusion.
- Render a short placeholder preview for locked sections. Visual blur can decorate that placeholder; it must not cover real paid text in the DOM, page source, accessibility tree, network response, or hydration payload.
- The unlock request must check identity, entitlement or token consent, ownership and an idempotent request ID on the server. A client `unlocked` flag grants nothing.
- After success, deliver the report and its charge receipt. A retry returns the same result. Missing data or a failed provider must not leave a completed charge for an undelivered report.
- Keep normal chat and navigation available when an allowance runs out. Offer the next UTC reset, optional tokens, and the relevant plan with a clear dismiss action.

## Subscription and Android disclosure

Benefit lists, billing frequency, renewal terms and prices must match the access the customer actually receives. Google Play requires accurate subscription disclosures and clear availability of content without a subscription. See [Google Play subscriptions policy](https://support.google.com/googleplay/android-developer/answer/9900533).

Google Play generally requires its billing system for digital goods and services sold in Play-distributed apps, subject to the applicable policy exceptions and programs. A successful web Stripe purchase does not verify the Android purchase path. See [Google Play payments policy](https://support.google.com/googleplay/android-developer/answer/10281818). Sources checked October 25, 2026.

## Release order

1. Merge the token-preview failure guard and its corrected request-contract test after required CI.
2. Verify the served commit and database health on the live domain.
3. Merge the separate daily-answer counter after its own required CI. Preserve existing wallet credits.
4. Apply the owner's Supreme and analysis choices, then complete the associated implementation gates.
5. Verify Android billing before promoting in-app paid conversion.
