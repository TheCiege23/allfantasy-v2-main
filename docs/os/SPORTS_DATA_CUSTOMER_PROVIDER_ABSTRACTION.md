# Customer-Facing Provider Abstraction & Data-Usage Boundary (Phase 5H)

## Principle
AllFantasy operates and presents a **unified sports-data layer**. External providers are infrastructure, never the customer-facing product. **Customers never supply their own sports-data API credentials** (Rolling Insights, API-Sports, ClearSports, CFBD, TheSportsDB, FantasyCalc, ESPN, etc. are AllFantasy-operated). Customers connect a supported **fantasy account** only to bring authorized league context.

## Three data categories — kept strictly separate
| Category | Contents | Ownership / handling |
|---|---|---|
| **AllFantasy Sports Data** | players, teams, games, schedules, statistics, values, projections, injuries, imagery | AllFantasy-operated infrastructure; "powered by verified sports-data sources" — AllFantasy does **not** claim to own every upstream fact |
| **Customer-authorized league data** | league settings, rosters, transactions, commissioner actions, membership, imported history | supplied by the customer's connected fantasy account, under their authorization, for league operation |
| **Internal product analytics** | feature usage, sync health, support diagnostics, aggregate performance | internal, permissioned, privacy-aware; **separated** from sports-data architecture |

These three must **never** be combined ambiguously in code, storage, or copy.

## Approved customer-facing language (draft — pending legal/privacy/brand review)
> **AllFantasy Sports Data** — Powered by verified sports-data sources.
>
> AllFantasy maintains the sports-data infrastructure so your league doesn't need separate sports-data API subscriptions. Connect your supported fantasy account to synchronize your league, rosters, settings, history, and commissioner workflow.

Purpose of connecting an account is described as: **league synchronization · roster & transaction continuity · personalized league experiences · commissioner operations · account support · product improvement (where legally permitted and disclosed)**.

## Prohibited copy
- ❌ "We collect your data for retention." (retention analysis stays internal/permissioned and is **never** the stated reason to the customer)
- ❌ "AllFantasy owns all sports data / every stat." (prefer "powered by verified sources")
- ❌ Presenting a **configured-but-unverified** provider as "connected."

## Credential & privacy boundary
- Customers provide **only** fantasy-account authorization (OAuth/import) for their **own** league context.
- No customer sports-data provider credentials are requested or required.
- Provider credentials for AllFantasy's sports-data infrastructure are server-side, never customer-visible, never in copy, never in observability output (counts/provenance only).
- Customer-facing disclosures must match the **actual** privacy, consent, and retention policies — this doc is an architecture statement, not final approved copy.

## Image + value abstraction (Phase 5H-c)
Client platforms receive governed **images** (via `canonicalImage.ts`: a `source` label + `fallbackRank` +
`validationStatus`, never a raw broken provider URL, never a cross-sport image) and governed **values** (via
`canonicalValue.ts`: a `valueType` + `source` + `leagueFormat`/`scoringFormat` + `freshnessStatus` + `coverageStatus` +
`provenance`, never an ambiguous merged number, with FantasyCalc disclosed as a **provider valuation source** — not
official sports truth). Provider-specific fields never leak past these contracts. An image shown as "official" must have
a verified-official source; missing imagery is disclosed honestly (placeholder), not faked.

## Provider-connection honesty (Phase 5H-d)
A provider may be described to a client as "connected/available" ONLY when it has real-request evidence (CERTIFIED or VERIFIED in `providers/certificationStatus.ts`). As of 2026-07-13: ESPN/Sleeper/FantasyCalc (certified), TheSportsDB/CFBD/API-Sports (verified) are connectable; ClearSports (blocked) and Rolling Insights (requires wiring) are **not** and must not be advertised as connected. This is test-enforced.

## Status
- **Architecture stance:** DOCUMENTED. The provider abstraction is real for the certified plane (ESPN/Sleeper/FantasyCalc are AllFantasy-operated; no customer keys). Image + value governance contracts exist (5H-c); consumer adoption is a reviewed migration. Provider connection claims are evidence-gated (5H-d).
- **Final customer copy:** REQUIRES legal + privacy + provider-branding review before use (part of the RC1 privacy/customer-language review).
