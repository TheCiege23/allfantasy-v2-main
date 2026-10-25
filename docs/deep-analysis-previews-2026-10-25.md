# Chimmy Deep Analysis previews

## User experience

- Free summaries and existing free factual lookups spend no tokens and preserve the detailed-answer allowance.
- Default Deep answers still use the daily allowance first: two for ordinary accounts and the existing allowance for eligible plans.
- After that allowance, Chimmy returns a useful free summary and an exact server-calculated token price. The user explicitly chooses whether to unlock the detail.
- The preview describes the complete reasoning, relevant alternatives, and next steps. Its blurred bars are decorative placeholders. No locked report is delivered to the browser.
- If the engine has only a short complete answer, it stays free rather than selling a duplicate expansion.
- Summaries use verified engine sentences when available. Otherwise they provide bounded practical guidance, without inventing a player verdict or claiming unavailable data. Screenshot previews say when the image has not yet been interpreted.

## Authorization and billing

Versioned drawer and JSON chat requests use the canonical multipart handler and durable request receipts. A ten-minute HMAC quote binds the authenticated account, request ID, original question/context/attachment fingerprint, access type and exact effective token cost. Confirmation fields are excluded from the fingerprint; content and attachments are included. Existing authentication signing configuration supplies the HMAC key; missing configuration fails closed.

An unlock preserves the original form or JSON snapshot in memory. A changed quote, price, request or allowance state leads to a fresh preview. The wallet transaction checks the quoted price after resolving its actual effective price and before writing the balance. Both a higher and a lower price require new consent. Existing receipt and ledger idempotency prevent a second debit on retries.

A reloaded multipart preview starts a fresh unconfirmed preview if the original form context is unavailable. Approved in-memory retries keep the same receipt. Ambiguous debit failures are terminal for their receipt and are reconciled through the existing refund mechanism; no locked search result is returned on debit failure.

## Compatibility and remaining scope

The version flag keeps cached older clients compatible with their existing consent contract. This release covers the current Chimmy drawer/page and the legacy chat UI adapters. It does not change token prices or packs, subscriptions, Google Play Billing, or other paid tools. Their remaining confirmation/retry/refund audit is the next recommended work.

No database migration or new environment variable is required. Both production deployment triggers remain enabled.

## Security reference

Response fields are selected explicitly and authorization runs before releasing extra detail. This follows the property-level authorization guidance in [OWASP API3:2023](https://api-security.owasp.org/editions/2023/en/0xa3-broken-object-property-level-authorization/). A CSS blur alone is not an authorization boundary.

## Verification and release

Focused checks cover quote tampering/expiry, account and question binding, both price-change directions, free allowance preservation, exact three-token debit and replay, public response field privacy, explicit unlock UI, and stable request identity. The focused verification has 106 passing checks. Required CI gates and production verification are tracked in [release PR #2721](https://github.com/TheCiege23/allfantasy-v2-main/pull/2721).

Rollback: revert the release commit through the protected main workflow if previews expose extra detail, unlocks charge the wrong amount, or included answers stop working. No migration rollback is needed.
