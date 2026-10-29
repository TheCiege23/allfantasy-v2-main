# ADR: remaining paid tool billing

**Status:** Accepted for implementation under the paid-tool audit request.

**Date:** 2026-10-25

## Findings

Shared feature fallbacks used timestamp source IDs without durable request identity. Some clients sent `confirmed=true` before seeing a price. Subscriber-metered Survivor/Big Brother paths bypassed the shared consent flow. World Cup keys mixed permanent feature keys and random charge keys rather than one approved attempt. Several AI failures silently returned basic templates after a token debit. Refund lookups recognized only one source label, while callers used many labels and idempotency keys, allowing duplicate refunds across failure handlers. Direct spend accepted an arbitrary client key and returned existing ledgers without binding the account and operation. Previews included balance already held by reservations.

## Decision

Use one signed quote and durable request boundary for every remaining live JSON token-paid route: trade review, waiver engine, draft explanations, comparisons, simulations, rankings commentary, commissioner run/chat, stories, Survivor, Big Brother, World Cup private chat/explanation/matchup/commissioner/edge reports, legacy JSON Chimmy adapters and standalone token spend. Subscription-only gates retain their existing access policy. Main multipart Chimmy retains its deployed quote/receipt protocol independently of the preview UI version; zero-cost actions remain free, and older cached pages must refresh before spending tokens. Their free included answers remain available. Basic waiver calculations skip the AI gate; unavailable AI detail returns its charge before a basic fallback is delivered. Token prices, packs and included benefits are unchanged.

The server HMAC quote binds the authenticated account, request, route/query, full semantic JSON input, spend rule and exact effective price for ten minutes. Literal explicit confirmation plus the matching quote is required. Both price increases and decreases require fresh consent. The wallet transaction verifies the quote price again before writing. The client stores only the hashed request identity and quote in per-tab storage; no question or report is persisted there. Ambiguous retries and reloads reuse the approved identity. Concurrent calls each use current HTTP authentication and share only the server receipt identity, never a response promise. New offers clear old authorization.

Reuse the existing private request receipt table and recovery cron with a domain-separated route/request namespace and fingerprint. No schema migration is required. Authorization stays in each route before its billing/replay gate. The Chimmy status endpoint rejects the paid-tool fingerprint namespace. Receipts fence concurrent executions; the ledger uses a stable receipt key. The response is saved before delivery, so lost responses replay without generating or charging twice. Failed work is sealed after refund. If reconciliation is unavailable, detail is withheld and scheduled recovery retries the durable refund. World Cup still debits only after valid generative output, and cached Daily Edge coaching remains free with an empty wallet.

Refunds lock the original spend and use one canonical refund key/source per spend, retaining the requesting failure surface as metadata. Historical refunds with custom source labels are recognized. Spend-key replays must match the account, rule and source, and cannot reuse a refunded charge. A transaction advisory lock serializes identical debit keys. These rules also protect existing Chimmy refunds. Gross spent and refunded lifetime counters remain separate.

## Options and tradeoffs

- **Selected: existing receipts plus one request-scoped billing boundary.** Uses the deployed recovery job and database schema, and covers errors outside individual route catches. The historical table name still mentions Chimmy; route/fingerprint namespaces isolate tool receipts.
- **Separate receipt table per tool.** More migrations and recovery jobs with duplicated financial behavior.
- **Ledger-only idempotency.** Prevents a duplicate debit but cannot recover a lost response, prevent duplicate provider execution, or fence a retry against a refunded operation.

The dormant Decision OS reservation adapter was also reviewed: it uses canonical run keys, atomic holds, finalize-after-success and expiry/release. No current HTTP route calls that orchestration service. This release does not enable that path or alter its policy.

## Verification and rollout

Regression cases exercise exact three-token debits/refunds, cross-handler refunds, cross-account key misuse, tampered/expired/changed quotes, simultaneous approved requests, failed providers, pending refund recovery, useful free fallbacks, reload/network retry identity and current resource access. Required CI and production build/health checks gate rollout. Both existing production deployment triggers stay enabled. No production wallet rows are edited by the audit.

Rollback: revert this change through protected main. Preserve private receipts/ledger rows for reconciliation; do not delete billing records. Reverting quote enforcement must be assessed before allowing old confirmed-only requests to charge again.

## References

- [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html): row locks serialize competing refunds; transaction advisory locks serialize debit identity checks.
- [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests): retain the original response and reject changed parameters for the same key. This is an engineering reference; the internal token audit does not change Stripe integration or SDK versions.
