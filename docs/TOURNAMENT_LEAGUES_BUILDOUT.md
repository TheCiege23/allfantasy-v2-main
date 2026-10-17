# Tournament leagues: NFL / NBA foundation

Status: local planning implementation, 2026-10-12. Not deployed; live tournament execution is not enabled.

## Confirmed format

Separate final draft leagues feed one cross-league championship bracket. Independent player pools mean both opponents can roster the same athlete. This was explicitly selected by the commissioner.

There are **three playing stages and two mass cuts**, followed by weekly bracket eliminations. The original wording also mentioned a third cut; this foundation interprets that as entry into / elimination within stage three. An additional mass cut would change all finalist counts and needs an explicit rule.

| Field | Opening leagues | Stage 2 entrants / leagues | Finalists / draft leagues | Bracket weeks | Top-seed byes |
|---|---:|---:|---:|---:|---:|
| 64 | 8 | 32 / 4 | 16 / 2 | 4 | 0 |
| 96 | 12 | 48 / 6 | 24 / 3 | 5 | 8 |
| 128 | 16 | 64 / 8 | 32 / 4 | 5 | 0 |
| 160 | 20 | 80 / 10 | 40 / 5 | 6 | 24 |
| 192 | 24 | 96 / 12 | 48 / 6 | 6 | 16 |

Recommended fields use eight-team pools. The planner also accepts multiples of four from 64 to 192 and balances pool sizes within one team. Unequal league sizes affect player scarcity; equal eight-team pools should be the public pilot default. Merely requiring even fields is insufficient: 66 → 33 cannot be halved exactly a second time.

Global stage points determine qualifier seeding. All scores reset on redraft; previous seeds can break ties. Division names are cosmetic in this iteration and do not reserve advancement places. Trading defaults off. No final-stage roster release.

## Implemented

- Authenticated planner at the existing /tournament/create address, linked through Commissioner Hub → Tournament Hub.
- NFL / NBA settings, 64–192 capacity validation, league naming, optional division identity, scoring preset label, total roster slots, trade setting, draft format, ordered tiebreakers and redraft buffer.
- Exact half-field cuts and half-league counts; balanced serpentine assignment utility and seeded bracket utility with top-seed byes.
- Calendar arithmetic requiring exactly enough weekly elimination periods to end with one winner in the configured final period.
- Transactional saved plan: TournamentShell with status blueprint plus validated versioned configuration in the creation audit event. No schema migration.
- Owner-managed staff list, additions, role changes and removals through TournamentShellGrant. Reviewers can read; explicitly granted co-commissioners can edit planning rules. Staff access changes are audited. Only the owner delegates access.
- Setup endpoint blocks league building, registration, participant assignment and launch for blueprint shells.
- Owners and authorized co-commissioners can edit saved rules, cancel changes or explicitly reload a newer plan. Rule revisions reject stale saves. Shell-row compare-and-set locking serializes rule and staff changes; editing permission is checked after locking so revocation cannot race a save. Live operational permissions remain future work.
- Expandable previews show every opening / later league, its planned capacity and serpentine seed slots. All supported field sizes are tested, including nonuniform pools.
- A pure stage scoring ledger computes standings and half-field cut previews from explicit entrant and period snapshots. It handles score revisions, fixed decimal points, weekly seed movement and unresolved advancing ties. This module is groundwork for the live scoring adapter; it is not a scheduled ingest job or a live elimination writer.

The existing retired legacy creation services remain disabled. The new save path creates a planning record only. Existing tournament engines must not be assumed compatible with this format.

## NBA pilot proposal

Start with **64 entrants, eight opening leagues, three drafts and sixteen finalists**. This minimizes concurrent draft operations and avoids bracket byes. Suggested planning periods: opening 1–10, second qualifier 11–20, final bracket 21–24. These are placeholders, not a verified date calendar.

NBA's published regular season ends April 11, 2027: [official schedule](https://www.nba.com/news/2026-27-nba-regular-season-schedule).

NFL's official 2026 calendar spans eighteen weeks: [official schedule](https://www.nfl.com/schedules/2026/by-team). Suggested full-season NFL pilot: qualifier weeks 1–6, second qualifier 7–13, bracket 14–17. A current-season NFL launch needs a shortened, verified calendar; week 1 has already passed.

The NBA calendar adapter must map actual games into scoring periods, define opening / closing short weeks, handle All-Star and postponements, and verify every draft has sufficient time after finalized scores and before the next lineup lock. Do not promise NBA launch from planning math alone.

## Research informing the design

- [Sleeper playoff determination](https://support.sleeper.com/en/articles/2203518-how-do-playoff-teams-get-determined) and [custom seeding](https://support.sleeper.com/en/articles/2528718-can-i-customize-my-league-s-playoff-seeding) show the commissioner need for understandable seeding and manual control. Recommendation: explain every seed and log overrides, rather than requiring commissioners to reconcile spreadsheets.
- [Recent basketball game-cap discussion](https://www.reddit.com/r/fantasybball/comments/1wp70zw/weekly_game_cap_setting/) and [schedule imbalance discussion](https://www.reddit.com/r/fantasybball/comments/1hz3ehe/do_these_game_postponements_underscore_the_need/) identify fairness concerns with unequal game volume. These are anecdotal community reports. Recommendation: decide a consistent counted-starts policy before launching cross-league NBA scoring.
- [Community objection to changing playoffs late](https://www.reddit.com/r/fantasybball/comments/1r60vvy/is_this_cheating/) reinforces publishing the advancement contract before invitations and freezing it at registration.

## Remaining implementation, in order

1. **Verified calendar and full rules contract.** Exact scoring weights; positional starters / bench / IR; daily vs weekly locks; NBA counted-start limits; postponement / stat-correction policy; scheduled draft timestamps and timezone. Publish an immutable rule version before invitations. Highest fairness impact; medium effort.
2. **Registration and provisioning.** One tournament invite, capacity / waitlist, deduplicated membership, full-field check, idempotent batch league and draft creation with retry / reconciliation. Create only stage-one leagues initially. High impact; high effort.
3. **Weekly ingestion and seeds.** Reuse provider adapters after verifying coverage. Store one authoritative result per entrant / stage / period, distinguish missing from zero, support correction versions, snapshot the cut line and weekly seed movement. No cut while required scores are missing or provisional. High impact; high effort.
4. **Guarded stage transitions.** Lock final scores, resolve boundary ties, preview the exact qualifying set, commit once with transactional state checks, provision reseeded pools and new drafts, retain archived rosters. A durable queue handles external side effects and retries. High impact; high effort.
5. **Global bracket execution.** Persist matchups, automatic top-seed byes, exact same scoring windows across pools, explicit tie resolution, locked eliminated rosters, no third-stage redrafts and one champion. High impact; high effort.
6. **Commissioner operations.** Planning staff management, rule editing and their audit trail are implemented. Remaining: configurable live draft / scoring / messaging permissions, failed-job alerts, draft-readiness checks and a stage checklist. Co-commissioners must have explicitly granted operational powers. High impact; medium effort.
7. **Engagement and growth.** Live cut-line watch; seed change cards; redraft reveal; division rivalry boards; opt-in push reminders; champion recap / share card. These extend existing standings / broadcast concepts and keep eliminated fans watching. Medium impact; medium effort.
8. **Organizations.** Reusable tournament templates, organization-owned staff, creator branding and opt-in public event pages. Keep the same engine for B2C and B2B. Medium impact; medium–high effort.

Player-release / guillotine tournaments are a separate later format. They need league-local release events, waiver timing, collusion controls and an explicit final-stage prohibition.

## UX and release criteria

The planner uses stacked mobile panels, desktop two-column previews, labeled fields and 44px controls. Responsive web is the first surface for PC, iOS and Android; native packaging is not part of this change.

Before launch, verify keyboard navigation, screen reader errors, 360px / 390px layouts, Android Chrome and iOS Safari, long names, timezone display and unreliable-network retries. No browser or physical-device certification is implied by component tests.

Run format arithmetic, bracket coverage and API permission tests locally. Exercise score correction, exact boundary ties, missing scores, repeated cut requests, draft failure recovery and concurrent staff actions in staging with isolated fixtures before enabling invitations.


## Scoring integration contract

The new seasonTournamentStandings module accepts an explicit stage identifier, immutable entrants with league identities, elapsed scoring periods and versioned weekly results. The same athlete may exist in independent league pools; totals are keyed by entrant, not athlete, so cross-league matchups do not share rosters.

- A missing result remains missing, even if the provider returned no matchup. A real zero requires an explicit result.
- Only the highest revision for an entrant / period counts. Duplicate delivery is harmless; conflicting payloads with the same revision are rejected.
- A correction that is provisional blocks a cut even if its older version was final.
- Points use fixed units at four decimal places. Negative totals and ordinary floating-point representation are supported.
- Previous-stage seed is a tiebreaker; previous-week rank is only used for seed movement. They are distinct.
- Tied ranks remain tied. Any unresolved tie among advancing seeds blocks the cut preview, including ties above the boundary that would make redraft order ambiguous.
- Results from other stages or periods do not carry across redrafts.
- No score ledger or cut preview mutates leagues, membership, rosters or waivers.

Before wiring production data, persist the result versions and closed-period snapshot, implement audited manual tie resolution and run the cut inside an idempotent transaction. The legacy weekly helper currently infers zero for missing matchups; it must not be used as-is for this format.

## Artwork integration

The user will provide images later. The artwork design should support distinct tournament / commissioner-hub hero artwork, per-league badges or banners, and settings-header artwork. Keep league IDs and names independent of asset filenames. Use approved stored assets and responsive crops, with readable text overlays and meaningful fallback identities. Division and league identity should remain recognizable as a team advances and the layout changes.

Five visual packs were supplied on 2026-10-12. Original SVG artwork is now integrated into tournament settings, hub/entry headers, saved league reveals and native league-home identity. See TOURNAMENT_VISUAL_HANDOFF.md for mappings, preview evidence and deferred specialty/division-format work. No image-upload endpoint is enabled.

## Verification for this change

- 149 tests passed across planner math, UI, transactional persistence, setup endpoint permissions, league previews, versioned score/cut previews, legacy retirement and existing tournament permission rules.
- All 33 accepted field sizes from 64 to 192 are covered by layout checks. Every reseeded entrant fits exactly one planned league capacity.
- Scoped TypeScript check passed for the planner, configuration, real Prisma persistence, league layout and scoring engine using artifacts/tournament-blueprint.tsconfig.json.
- Existing Commissioner Hub / tournament discovery checks from the initial foundation: 16 passed, one existing Commissioner OS link-eligibility failure. The unchanged footer checks runCount, while its test expects ownsAny eligibility.
- Whole-repository TypeScript verification remains unestablished: the initial default-memory attempt exhausted the Node heap; the larger-memory attempt was stopped after several minutes once the focused check passed.
- No production database mutations, migration, deployment, live drafts or physical-device verification were performed.

## Working project tracker

The ordered implementation checklist and current milestone status are maintained in [Tournament project plan](TOURNAMENT_PROJECT_PLAN.md). The planner now supports an optional detailed playing-rules and dated-calendar contract. These settings are saved with the existing revision audit; they do not yet publish rules or enable invitations.

## Calendar verification and publication update

The saved-plan flow now verifies a fresh Rolling Insights regular-season slate, previews game counts and gap exclusions, and publishes an owner-approved immutable rule snapshot. Publication uses a source revision and canonical hash, rechecks provider evidence, records explicit schedule-exception acceptance, freezes rule editing and isolates the shell from legacy writes and automation. Published plans remain visible to authorized staff. Registration is not enabled.

Verification: 251 tests across 15 files and the expanded scoped TypeScript check passed. Real pilot calendar/provider validation and staging database integration remain outstanding. See the project tracker for remaining native-rule details and registration work.

## Registration update

Published season tournaments now have owner registration controls, hashed rotating invites, explicit entrant rule acceptance, bounded capacity/waitlists, atomic queue promotion, withdrawals, audited removal/restoration and private entry views linked from Tournament Hub. Draft/IR/waiver transaction policies are explicit before new publication. Older frozen versions without these policies remain unchanged and cannot open registration. Legacy deletion cannot bypass these controls.

Verification: 286 tests passed across 18 files; expanded scoped TypeScript passed. Real Postgres concurrency/staging and device checks remain outstanding. Registration reserves places only; opening league/draft provisioning is the next implementation package. Co-commissioner operational registration permissions remain separate work from planning edit grants.


### Opening field assignment checkpoint (2026-10-12)

The season registration service now supports owner-only field freezing under the shared shell CAS lock. It verifies exact published capacity and every entrant's latest publication/hash acceptance, shuffles once with cryptographic Fisher–Yates, and saves the complete contract and balanced league/draft-slot/waiver-priority manifest in season_opening_field_frozen. Registration writes are blocked after that event; retries recover it without changing the field. The owner hub renders assignments and entrants see their registration lock. Native league/roster/waiver/draft provisioning and frozen-rule enforcement remain the next implementation package. See TOURNAMENT_PROJECT_PLAN.md for the checklist and release limits.


### Native opening setup adapter (2026-10-12)

The owner hub can now create/resume stage-one native leagues from the frozen field. One short tenant-scoped transaction creates a pool's league, rosters, teams, filled slots, memberships, tournament bindings, scoring overrides, waiver balances/settings/state and blocked live DraftSession, then commits its success checkpoint. Stable IDs and checkpoint reconciliation prevent duplicate setup; failures roll back the pool and expose safe retry progress. Organizer access does not consume a participant slot. Manifest hashes are now canonical across JSON key ordering.

Native league writes use lib/domain/seasonTournamentLeague.ts, server deployment tenant resolution and ActorContext through withTenant. No database schema change was needed. Lifecycle/shared settings guards and direct draft-start protection keep these leagues blocked while runtime contracts are completed. Native rows are implemented; live NFL/NBA draft legality/autodraft/auction policy, player-pool readiness, remaining mutation-boundary audit and scoring integration are still pending. See the project plan for staging and release gates.


### Draft policy and catalog readiness adapters (2026-10-12)

The native draft path now validates tournament picks against frozen assignments and a checked, uniquely identified sport catalog. A maximum matching policy handles NBA multi-position starters and NFL flex slots, preserves space for a legal completed roster and excludes additional IR from draft rounds. Tournament snake timeouts choose the highest-ranked available legal player using the frozen order; personal queues and AI opponent selection are bypassed for this policy. Auction adapters apply accepted budgets, whole-dollar bids, remaining-slot reserves, nomination clocks, legal bidder/winner rosters and non-shortening late-bid extensions.

The owner setup panel can check each opening league's player pool for identities, positions, total slot coverage and ranked coverage. A successful check stores a five-minute, manifest-bound snapshot; runtime reads this snapshot without fetching providers under a draft lock. Missing or expired checks block picks. This command reports remaining gates and never starts drafts or waivers.

Full eight-team snake simulations are pure policy checks; isolated native service tests cover snapshot expiry, invalid player metadata, owner controls, timeout selection and auction clock behavior. Complete auction/timer automation, in-draft catalog refresh, concurrency simulations, native mutation boundaries, live scoring rules and actual Postgres/provider/device verification remain pending. Draft launch stays blocked; this batch does not establish production readiness. The ordered follow-up is in TOURNAMENT_PROJECT_PLAN.md.

Verification for draft policy batch: 386 tests passed across 27 files; expanded scoped TypeScript passed. The focused policy/native run also passed all 37 tests. Real provider, database contention and device verification remain pending.

Additional draft regression verification: 86 tests passed across five existing pick/expired-timeout/overnight/hardening test files. Combined with the tournament run, 472 distinct tests passed across 32 files.


### Supplied visuals and auction expiry hardening (2026-10-12)

The existing points-race planner now stores optional allowlisted identity choices with the frozen contract: twenty division pairs, editable names, palette/emblem selection and a live layered crest preview. Existing contracts without artwork retain their original shape and hash. Hub, entry, setup and native league headers use the same identity helpers. Entrants can reveal only their own checked frozen league/slot/time; the toggle never mutates registration or placement.

Auction automation now opens timeout nominations at the minimum bid, skips full/insolvent nominators, returns no-bid manual nominations to the pool, rejects expired bids and preserves late clock extensions. Native writes use version predicates even when distributed locks pass through; settlement claims the version inside its transaction so failed pick insertion rolls back budgets/state. Complete live draft refresh/control/race verification remains pending, and draft launch stays blocked.

The component browser harness in artifacts/tournament-visual-preview uses the actual shared React components with clearly labeled fixtures. 360px/390px/1440px checks passed without page overflow, missing images or script errors. Authentication, live provider/database behavior and physical iOS/Android devices were not certified. The supplied alternative divisions/wildcards/240-team format is documented separately and does not change the current format.

Verification for visuals/auction batch: the broader run passed 514 of 515 tests across 36 files; the only failure was a 30-second filesystem-scan timeout in the league-creation ratchet. Its isolated rerun passed all three tests in five seconds. Subsequent focused native checks passed all 32 tests, and registration/artwork checks passed 31 tests including the added assignment-privacy/tampering case. Across these runs, all 516 distinct tests passed. Final expanded scoped TypeScript passed. These results do not certify real Postgres contention or physical devices.


### Long-running draft catalog recovery (2026-10-12)

Tournament draft actions now refresh the checked catalog before entering mutation locks when less than a minute remains on its five-minute validity. The refresh uses a separate lease, a 15-second provider wait limit and durable 30-second failure backoff. Timeout results cannot publish later. Failed attempts retain the last successful snapshot without extending its expiry; expired pools block picks and auction operations until recovery succeeds.

The first successful snapshot pins catalog membership and player identity fields. Refreshed rankings are accepted only when those identities match; changed identities require review, with an audited reconciliation workflow still pending. Catalog checks never alter picks, budgets, draft status or launch permissions. Refresh leases and audit writes still require real Postgres/provider staging verification; storage retention/compaction remains a release gate.

The commissioner hub checks one created opening league per request and shows saved verification/retry times. Recovery is request-driven through draft actions or the owner check command, with no new scheduled job. Next implementation batch is timer pause/resume/reset/control races, then native mutation boundary coverage and complete service-path draft simulations before the readiness transition and live scoring work.

Verification for catalog recovery: the broader draft regression run passed all 138 tests across ten files. The final focused policy/native/API/UI run passed all 61 tests across four files, including two additional recovery integration cases. Across these runs, 150 distinct tests passed across eleven files. The scoped TypeScript check passed; no live provider, real Postgres contention or physical-device certification was performed.


### Scoring/roster visuals, extras previews and timer controls

The new label artwork is integrated into the tournament planner/hub and entrant rule review. Scoring plates follow the actual saved weights; customized values show CUSTOM. Roster names are derived only when every starter, bench, injured count and drafted-slot total matches a supplied preset. Explicit roster selection updates counts and draft size together while preserving other rules. Existing defaults and published hashes are unchanged. Unsupported IDP/category formats remain disabled.

Champion and milestone-notification designs appear as clearly marked planning previews with real tournament identity and the configured first-draft date. Finalized scores, public trophy pages, PNG export, channel preferences and delivery are future backend work. No notification is sent by these controls. The alternative divisions/wildcard board does not alter the accepted points race.

Tournament timer controls now preserve the remainder (including zero), reset explicitly to frozen clock lengths and remain paused during paused resets. Auction bid/nomination state and both timer representations stay aligned. Resume requires a usable catalog snapshot; pause remains available during catalog outages. Control mutations and their audit events are atomic, with version/status/deadline predicates. Tournament pick insertion also claims the session version transactionally so a newer pause/reset wins without stale pick writes. Ordinary league update behavior retains its path.

Next are the remaining native write/automated-timer boundaries and complete service-path draft simulations before enabling any readiness transition, then live scoring and stage progression. No live database changes, migration or deployment took place; launch and waiver locks remain in place.

Verification for the visuals/control batch: 137 draft regression tests passed across six files; 58 planner/rules/publication/setup/label tests passed across five files; the initial focused run also passed the eight registration UI tests. The final native run passed all 50 tests including the additional bid-versus-pause case. Across the successful runs, 204 distinct tests passed across twelve files. An earlier run failed to start its Vitest workers (no tests ran); sequential retries passed. The scoped TypeScript check passed, and the actual-component browser harness passed at 360, 390 and 1440 pixels without overflow, missing images or JavaScript errors. These checks do not certify real Postgres contention, actual providers or physical devices.


October 12 mutation audit: generic draft mutation tools and eleven direct draft handlers now refuse native tournament changes; generic overnight automation and post-draft activation are isolated. See TOURNAMENT_NATIVE_MUTATION_AUDIT.md for exact coverage and remaining boundaries. Native board completion and full NFL/NBA service simulations remain pending. Launch and waiver processing stay locked.


October 12 draft completion: native opening drafts now use seasonDraftCompletion.ts and seasonDraftBoard.ts. Complete boards receive a versioned manifest/board-hash audit receipt and completed draft status in one transaction. Validation covers frozen order/clock/rounds, catalog identity, roster ownership and full starter/bench matching; auction charges must reconcile with every team's remaining budget. Completion repair is idempotent and never creates an ordinary RedraftSeason or activates league lifecycle, scoring or waivers. Manual picks reject unsupported force/trade/specialty overrides and use native multiposition matching.

Full opening-league NFL/NBA snake/auction simulations use mocked database/provider fixtures and manually active sessions. They are not multi-league season/cut simulations or launch certification. Owner-facing completion summaries, actual finalized-roster materialization, the remaining auction/league/roster mutation inventory and guarded readiness remain subsequent work.

October 13 roster preparation: verified opening drafts can now materialize legal NFL/NBA starter and bench assignments through an owner-only commissioner-hub action. All teams and the preparation receipt commit atomically, with idempotent hash verification and drift refusal. Native lineup saves, AF trade settlement and late draft-snapshot overwrites remain blocked. Rosters stay locked; scoring projection, game caps/IR, weekly finalization and actual runtime activation are subsequent work.
