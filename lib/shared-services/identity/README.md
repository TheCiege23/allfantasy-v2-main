# Identity Service

Implements Milestone 1 ("Shared Services") of [`docs/os/ALLFANTASY_FANTASY_OS_MIGRATION_PLAN.md`](../../../docs/os/ALLFANTASY_FANTASY_OS_MIGRATION_PLAN.md), scoped to Identity only, per that document's own "First Recommended Implementation Task."

This module owns identity resolution per the Shared Fantasy Data Model spec's "Identity & Access" object group: `FantasyUser`, `PlatformIdentity`, and (via a separate but related contract) cross-provider `Player` identity. Full design context lives in the four locked planning documents in `docs/os/`:

1. `ALLFANTASY_FANTASY_OS_ARCHITECTURE_SPEC.md`
2. `ALLFANTASY_FANTASY_KNOWLEDGE_GRAPH_SPEC.md`
3. `ALLFANTASY_SHARED_FANTASY_DATA_MODEL_SPEC.md`
4. `ALLFANTASY_FANTASY_OS_MIGRATION_PLAN.md`

## What this is

A read-mostly facade over **three existing, real storage mechanisms** — it does not introduce a new table, and it does not change the behavior of anything that already reads or writes those mechanisms today:

| Platform | Storage | Resolution |
|---|---|---|
| Sleeper | `UserProfile.sleeperUserId` / `sleeperUsername` / `sleeperLinkedAt` / `sleeperVerifiedAt` | `stored` — a durable provider-user-id |
| ESPN | `LeagueAuth.espnSwid` (encrypted at rest) | `stored` — SWID is ESPN's own stable per-user identifier |
| Yahoo, MFL | `LeagueAuth.oauthToken` / `apiKey` | `transient_credential_only` — only a credential is stored; the actual provider-user-id (e.g. Yahoo's manager GUID) is resolved live, per request, from the provider's own API, exactly as `lib/league-import/commissionerGate.ts`'s `checkYahoo` already does |
| Fantrax | `FantraxUser.fantraxUsername` | `not_available` — `FantraxUser` has **no relation back to `AppUser`** (`FantraxLeague.userId` references `FantraxUser.id`, not `AppUser.id`). There is no query path from a `FantasyUserId` to a `FantraxUser` row today. |
| Fleaflicker | none | `not_available` — no per-user credential or identity is stored at all (it's one of `commissionerGate.ts`'s `OPEN_READ_PROVIDERS`) |

Player identity wraps the existing `lib/league-import/playerIdResolver.ts`, which already resolves provider player ids against the real, global `PlayerIdentityMap` table (used today by scoring lookups). `PlayerIdentityMap` has dedicated columns for `sleeperId` / `espnId` / `mflId` / `fleaflickerId` but **not for `yahoo` or `fantrax`** — those two fall back to normalized-name matching only, same as the resolver they wrap.

## Why some things return `not_available` instead of a value

The Identity Service never fabricates an identity it can't actually back with a real, verified source. Where a durable identity genuinely isn't stored anywhere (Fantrax, Fleaflicker) or is only ever resolved transiently (Yahoo, MFL), the service says so explicitly via `resolutionMethod`, rather than inventing a placeholder. This mirrors the same honesty principle the Fantasy OS specs require of delivery adapters ("never fabricate `delivered: true`") and of the Knowledge Graph's confidence envelope.

These gaps are real product/engineering blockers, tracked in the Migration Plan (Part 9) — not something this module is expected to silently fix. Closing them (a `PlayerIdentityMap.yahooId` column, a `FantraxUser -> AppUser` relation) requires a schema migration, which is explicitly out of scope for this additive phase.

## Explicit provider-link workflow

`linkPlatformIdentity` only supports **Sleeper** in this phase. ESPN/Yahoo/MFL identity is credential-based and already has an existing connect flow (`lib/league-sync-core.ts`) that this service deliberately does not duplicate or take over — calling it for those platforms throws `IdentityValidationError`. Fantrax and Fleaflicker have no per-user identity target to write to at all yet.

Linking a Sleeper identity requires a `verifiedProviderUserId` the caller has already confirmed against Sleeper's own API (e.g. the same username → `user_id` lookup `commissionerGate.ts`'s `resolveSleeperUserId` already performs). This module performs **no network calls and no fuzzy or inferred matching** — see "Important Rules" in the phase brief. A link attempt that would associate a Sleeper `user_id` already linked to a *different* `FantasyUser` throws `DuplicateIdentityLinkError` before any write happens.

## What this phase deliberately does NOT do

- **No consumer migrations.** Nothing in the existing codebase calls into `lib/shared-services/identity/` yet. `commissionerGate.ts`, `league-sync-core.ts`, `playerIdResolver.ts`, and every other existing identity-adjacent file are untouched.
- **No schema changes.** Every read/write goes through existing Prisma models (`AppUser`, `UserProfile`, `LeagueAuth`, `FantraxUser`, `PlayerIdentityMap`). No migration was written or run.
- **No `Manager` or `CommissionerRole` objects.** The broader Shared Fantasy Data Model spec's "Identity & Access" group includes these, but they're league-scoped concerns that belong with the League/Commissioner Service work in later milestones — building them here would be scope creep beyond what this phase asked for.
- **No behavior change to any existing feature.** This is additive infrastructure only.

## Remaining migration work before any consumer moves

Per the Migration Plan's Milestone 1 scope, before any real consumer (Trade, Waiver, Legacy, Game Day, or Commissioner Service) is migrated onto this module:

1. Contract tests need to run green against real historical import data for all six providers (this phase ships them against mocked Prisma fixtures modeled on real schema shapes, since no live test database is available in this environment — see `__tests__/shared-services/identity/`).
2. The Migration Plan's Milestone 2 (Sleeper import hardening) should land first, since it touches the same `commissionerGate.ts` area this module reads from.
3. The two documented schema gaps (Yahoo/Fantrax player-ID columns, Fantrax's missing `AppUser` relation) need a product/schema-approval decision before Player/Fantrax resolution can move past `not_available` — not something a future consumer migration can work around.
4. `lib/unified-player-service.ts` was observed during this phase to implement direct+name-match player resolution logic that looks similar in shape to `playerIdResolver.ts` — worth a follow-up look during a later consolidation pass to confirm whether it's a genuine duplicate, but that check was out of scope here and was not modified.
