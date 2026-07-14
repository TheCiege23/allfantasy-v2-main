# NFL Invited MVP RC1 — Internal Release Notes

## Candidate identity

- Package prepared: 2026-07-12
- Observed branch at preparation: `feat/fantasy-os-intelligence-coach-certified-wiring`
- Observed base commit: `3a61caf6ef7f37967d46bf7378bf3389224b342a`
- Candidate state: **working-tree package, not yet a reproducible frozen commit**

The repository contains extensive mixed uncommitted work from multiple phases. RC1 must not be tagged, merged, deployed, or described as immutable until the release-owned changes are isolated, reviewed, committed, and the checks below rerun on that exact SHA.

## Completed work, G46–G60

- G46 established canonical schedule navigation.
- G47 delivered the commissioner operations workspace.
- G48/G48A correctly preserved authenticated full-season validation as blocked when a trusted browser was unavailable.
- G49–G52A audited and canonicalized provider-backed score, injury and valuation paths and defined live-provider evidence requirements.
- G53/G53B hardened the draft room and preserved multiplayer certification as blocked without three trusted sessions.
- G54/G55 aligned league creation/import with canonical validation and customer-safe states.
- G56/G57 improved the draft and league customer experience across core surfaces.
- G58 hardened lineup recovery, standings truth, player/waiver copy and source guardrails; it froze NFL/NCAAF invited-MVP scope.
- G59 created the reusable end-to-end, provider and multiplayer certification framework.
- G60 produced the RC inventory, risk register and checklist and corrected release-copy inconsistencies without changing domain architecture.

## Major customer improvements

- One canonical create/import journey with preview, ownership checks, warning preservation and duplicate protection.
- Supported snake/linear mock and live draft preparation with Draft Assist, queues, timers, chat and commissioner controls.
- Canonical league navigation for team, matchups, players, waivers, trades, schedule and standings.
- Authoritative lineup failure reconciliation and standings/stat-correction messaging.
- Sport-neutral commissioner operations and NCAAF-safe shared surfaces.
- Customer-safe intelligence terminology: Draft Assist, Coach, Smart Queue, Decision Support and League Insights.

## Known limitations

- Auction draft is outside NFL invited-MVP certification despite source components existing.
- Other-provider import adapters are exposed only through their supported configuration and remain runtime uncertified.
- Draft-pick trading is limited; on-clock propagation is uncertified and Trade P0 reversal is excluded.
- Mention delivery is not advertised; identity/order/persistence require runtime proof.
- Provider-backed stats, projections, injuries and valuations have not been live-freshness certified.
- Full-season lifecycle, playoffs and season completion have not been authenticated DB-backed certified.
- Mobile source responsiveness exists, but 390×844 runtime certification is pending.

## Certification still required

1. Full configured TypeScript check on the frozen SHA.
2. Authenticated create/import/invite/join and season lifecycle against a certified non-production database.
3. Three-client NFL multiplayer draft certification.
4. Live score, injury and valuation provider certification, including cache/fallback/failure behavior.
5. Desktop and 390×844 mobile runtime validation.
6. Exact-SHA release review and explicit owner approval.

## Deferred after MVP

- Auction certification and any unsupported draft/league variants.
- Trade reversal physical certification and Renewal Gate C.
- Unsupported NCAAF imports and provider expansions.
- Broader automation/observability enhancements not required to execute the supervised certification packet.

## Release truth

These notes describe source and deterministic-test progress. They do not claim authenticated, browser, database-backed, multiplayer, provider, production, deployment, or launch approval evidence.
