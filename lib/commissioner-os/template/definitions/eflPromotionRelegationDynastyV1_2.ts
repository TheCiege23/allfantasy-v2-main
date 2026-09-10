/**
 * EFL Promotion/Relegation Dynasty — template definition v1.2.0.
 *
 * 🛑 THE FIRST EFL VERSION THAT MAY EXECUTE, AND ONLY BECAUSE THE EXECUTION PATHS NOW EXIST.
 * 1.0.0 and 1.1.0 are published and are left byte-identical in their own files. This version claims
 * more, so it is a new version — the exact-pin rule exists precisely so a league pinned to 1.1.0
 * keeps the contract it was pinned to.
 *
 * What became true since 1.1.0, and nothing else did:
 *
 *  - **TRUE Max PF exists.** `lib/commissioner-os/efl/maxPfEngine.ts` over
 *    `lib/lineup-optimizer/optimalLineup.ts` computes the maximum a roster COULD legally have
 *    scored. 1.1.0 froze `actual_points_for` — points the manager actually scored — which a manager
 *    LOWERS by benching a good player, rewarding the very tanking the rule exists to discourage.
 *    That is the substantive correctness change in this version.
 *  - **The freeze is durable.** `lib/commissioner-os/efl/freezeStore.ts` writes it once and never
 *    updates it, with an append-only correction log beside it.
 *  - **The ladder can be applied.** `runPromotionRelegation` now accepts an already-resolved
 *    `SeasonEndTransition[]`, so `applyEflSeasonTransitions` hands it the settled plan. No EFL rule
 *    moved into that engine.
 *
 * ⚠ ONE CAPABILITY IS ADDED — `standings.frozen_input` was already here, but the metric it refers to
 * changed meaning. `defaultSettings.reverseMaxPfMetric` is `optimal_lineup_max_pf` in this version
 * and was `regular_season_points_for` in 1.1.0. A league moving pins is changing what its draft
 * order is computed from, which is a commissioner decision and not a silent upgrade.
 *
 * 🛑 THE FREEZE STILL DEPENDS ON A MIGRATION THAT HAS NOT BEEN APPLIED.
 * `prisma/migrations-pending/20260910120000_league_max_pf_freeze/` is parked, because applying a
 * migration is a deploy decision belonging to the user. Until it lands, `freezeMaxPf` returns
 * `not_persistable` with that path in the message and the status reads `ready`, never `frozen`.
 * That is a RUNTIME state with a clear signal, not a false contract claim — which is why
 * `executionEnabled` is true here and the dependency is named in `governancePolicy`.
 *
 * ⚠ AND NOTHING HERE CAN WRITE TO SLEEPER. Every EFL effect is `internal` scope; the source league
 * is one flat 32-team Sleeper league that has never heard of the Premier League. The rookie order is
 * computed exactly and PRESENTED — a human types it into Sleeper — and this template must never say
 * otherwise.
 */

import type { LeagueTemplateDefinition } from '@/lib/commissioner-os/template/types'

const MAX_PF_ENGINE = 'lib/commissioner-os/efl/maxPfEngine.ts'
const FREEZE_STORE = 'lib/commissioner-os/efl/freezeStore.ts'
const TRANSITION_ENGINE = 'lib/commissioner-os/efl/seasonTransitionResolver.ts'
const APPLIER = 'lib/commissioner-os/efl/applyEflSeasonTransitions.ts'
const DRAFT_ORDER_ENGINE = 'lib/commissioner-os/efl/rookieDraftOrder.ts'

export const EFL_PROMOTION_RELEGATION_DYNASTY_V1_2: LeagueTemplateDefinition = {
  id: 'efl_promotion_relegation_dynasty',
  version: '1.2.0',
  label: 'EFL Promotion/Relegation Dynasty',
  description:
    'A 32-team dynasty league played as four tiers of eight, with promotion and relegation between them each season and a custom 32-slot rookie draft order built on a frozen TRUE Max PF — the maximum each roster could legally have scored, so benching a good player cannot lower it.',
  baseFormatId: 'dynasty',
  aliasTags: ['efl_promotion_relegation'],
  compatibleSports: ['NFL'],
  capabilityIds: [
    'roster.dynasty_carryover',
    'standings.promotion_relegation',
    'standings.tier_playoffs',
    'standings.frozen_input',
    'draft.custom_rookie_order',
    'governance.configurable_rules',
    'phase.state_machine',
  ],

  defaultSettings: Object.freeze({
    teamCount: 32,
    tierCount: 4,
    teamsPerTier: 8,
    rookieDraftSlots: 32,
    autoRelegateCount: 1,
    relegationPlayoffCount: 2,
    autoPromoteCount: 1,
    promotionPlayoffCount: 2,
    reverseMaxPfFreezeAt: 'regular_season_complete',
    regularSeasonFinalWeek: 14,
    premierLeagueChampionshipPlayoff: true,
    /**
     * 🛑 CHANGED FROM 1.1.0, AND THIS IS THE REASON THIS VERSION EXISTS.
     * 1.1.0 froze `regular_season_points_for` — points actually scored. This freezes the maximum the
     * roster COULD have scored. A manager cannot lower it by sitting his best players, which is the
     * anti-tanking property the constitution asks for.
     */
    reverseMaxPfMetric: 'optimal_lineup_max_pf',
  }),

  phaseGraph: {
    initialPhaseId: 'offseason',
    phases: [
      {
        id: 'offseason',
        label: 'Offseason',
        summary:
          'Tiers are settled from last season. Rosters carry. Rookie draft order from the frozen Reverse Max PF plus the previous season promotion, relegation and playoff outcomes.',
        capabilityIds: ['roster.dynasty_carryover', 'draft.custom_rookie_order'],
        next: ['rookie_draft'],
      },
      {
        id: 'rookie_draft',
        label: 'Rookie draft',
        summary: 'A single 32-slot rookie draft spanning all four tiers.',
        capabilityIds: ['draft.custom_rookie_order'],
        next: ['regular_season'],
      },
      {
        id: 'regular_season',
        label: 'Regular season',
        summary:
          'Tier play. Max PF accumulates from each week optimal lineup and freezes at the end of this phase.',
        next: ['tier_playoffs'],
      },
      {
        id: 'tier_playoffs',
        label: 'Tier playoffs',
        summary:
          'Premier League championship playoff, promotion playoffs in tiers 2-4 and relegation playoffs in tiers 1-3, run in parallel. Points scored here do NOT move a non-playoff team rookie slot.',
        capabilityIds: ['standings.tier_playoffs', 'standings.frozen_input'],
        next: ['promotion_relegation'],
      },
      {
        id: 'promotion_relegation',
        label: 'Promotion and relegation',
        summary:
          'Season-end tier movement applied once every playoff has resolved. No relegation out of League 2, no promotion out of the Premier League.',
        capabilityIds: ['standings.promotion_relegation'],
        next: ['season_complete'],
      },
      {
        id: 'season_complete',
        label: 'Season complete',
        summary: 'Tiers settled for next season. The league re-enters Offseason on renewal.',
        next: [],
        terminal: true,
      },
    ],
  },

  scheduledEffects: [
    {
      id: 'efl.freeze_reverse_max_pf',
      effect: 'CREATE_COMMISSIONER_TASK',
      at: { kind: 'phase_exit', phaseId: 'regular_season' },
      params: {
        taskKey: 'freeze_reverse_max_pf',
        title: 'Freeze Reverse Max PF for next season rookie order',
        rationale:
          'Playoff points must not move a non-playoff team rookie slot. The frozen value is the input; the running total is not.',
        metric: 'optimal_lineup_max_pf',
      },
      backedBy: {
        engine: `${MAX_PF_ENGINE} + ${FREEZE_STORE}`,
        status: 'engine',
        note: 'Computed from per-week optimal lineups and written once. ⚠ Returns not_persistable until prisma/migrations-pending/20260910120000_league_max_pf_freeze/ is applied — a runtime state with a clear message, reported as `ready` rather than `frozen`.',
      },
      description: 'Freeze the TRUE Max PF the moment the regular season ends.',
    },
    {
      id: 'efl.relegation_playoff_setup',
      effect: 'CREATE_COMMISSIONER_TASK',
      at: { kind: 'phase_entry', phaseId: 'tier_playoffs' },
      params: {
        taskKey: 'seed_relegation_and_promotion_playoffs',
        title: 'Seed relegation and promotion playoffs',
        rationale:
          'AllFantasy names the participants exactly. Running the matchups is still a commissioner action.',
      },
      backedBy: {
        engine: TRANSITION_ENGINE,
        status: 'planned',
        note: 'Participants are derived from tier standings and reported as pendingPlayoffs until a result is recorded. Playing the games is not something software does.',
      },
      description: 'Seed the two-team relegation playoff and the 2nd/3rd promotion playoff in each tier.',
    },
    {
      id: 'efl.apply_relegations',
      effect: 'RELEGATE_TEAM',
      at: { kind: 'phase_entry', phaseId: 'promotion_relegation' },
      params: { autoRelegateCount: 1, playoffDecidedCount: 1, exemptTierLevels: [4] },
      backedBy: {
        engine: `${APPLIER} -> lib/promotion-relegation/PromotionEngine.ts`,
        /**
         * ⚠ RESTORED TO `engine` FROM 1.1.0's `planned`. 1.1.0 narrowed it truthfully — nothing
         * applied a playoff-decided plan then. `runPromotionRelegation` now accepts one, validates
         * every id and direction, and applies it in a transaction.
         */
        status: 'engine',
        note: 'Applied only when the plan is SETTLED. A pending playoff or a contradiction suppresses finalTransitions and the applier refuses.',
      },
      description: 'Bottom team auto-relegates; the relegation playoff loser joins them.',
    },
    {
      id: 'efl.apply_promotions',
      effect: 'PROMOTE_TEAM',
      at: { kind: 'phase_entry', phaseId: 'promotion_relegation' },
      params: { autoPromoteCount: 1, playoffDecidedCount: 1, exemptTierLevels: [1] },
      backedBy: {
        engine: `${APPLIER} -> lib/promotion-relegation/PromotionEngine.ts`,
        status: 'engine',
        note: 'Same settled-plan requirement as relegation; the two are applied together in one transaction.',
      },
      description: 'Division winner auto-promotes; the promotion playoff winner joins them.',
    },
    {
      id: 'efl.publish_rookie_order',
      effect: 'ASSIGN_DRAFT_SLOT',
      at: { kind: 'season_end' },
      params: {
        slots: 32,
        inputs: ['frozen_optimal_lineup_max_pf', 'promotion_outcome', 'relegation_outcome', 'playoff_outcome'],
      },
      backedBy: {
        engine: DRAFT_ORDER_ENGINE,
        /**
         * 🛑 STAYS `planned`, AND NOT BECAUSE THE COMPUTATION IS INCOMPLETE. All thirty-two slots
         * are resolved exactly, each with provenance. The destination is Sleeper, which AllFantasy
         * cannot write to — so this is prepared for a human, and calling it `engine` would be the
         * template claiming a write it cannot perform.
         */
        status: 'planned',
        note: 'Computed exactly, every slot carrying provenance. Entering it in Sleeper is a human action.',
      },
      description: 'Publish the 32-slot rookie order once tiers are settled.',
    },
    {
      id: 'efl.announce_final_tiers',
      effect: 'GENERATE_ANNOUNCEMENT',
      at: { kind: 'season_end' },
      params: { topic: 'final_tiers' },
      description: 'Announce who went up, who went down, and next season tiers.',
    },
  ],

  standingsPolicy: {
    canonicalEngine: 'lib/promotion-relegation/StandingsEvaluator.ts',
    tiers: [
      { level: 1, label: 'Premier League' },
      { level: 2, label: 'Championship' },
      { level: 3, label: 'League 1' },
      { level: 4, label: 'League 2' },
    ],
    promotionRelegation: {
      autoRelegateCount: 1,
      relegationPlayoffCount: 2,
      autoPromoteCount: 1,
      promotionPlayoffCount: 2,
      noRelegationFromTierLevels: [4],
      noPromotionFromTierLevels: [1],
    },
    configurable: [
      'autoRelegateCount',
      'relegationPlayoffCount',
      'autoPromoteCount',
      'promotionPlayoffCount',
      'tierCount',
      'teamsPerTier',
    ],
    notes: [
      'Tier 1 is the highest. LeagueDivision.tierLevel ascends downward and PromotionEngine reads fromTierLevel as the division being relegated FROM.',
      'Playoff-decided movement is resolved BEFORE anything reaches PromotionEngine, which learned no EFL rules.',
    ],
  },

  advancementPolicy: {
    canonicalEngine: 'lib/promotion-relegation/PromotionEngine.ts',
    mode: 'tier_playoff',
    notes: [
      'The Premier League championship playoff decides a title only — but its placings 1-5 fill rookie slots 32 down to 28.',
    ],
  },

  draftPolicy: {
    canonicalEngine: DRAFT_ORDER_ENGINE,
    rookieOrder: 'custom',
    frozenInput: { field: 'optimal_lineup_max_pf', frozenAt: 'regular_season_complete' },
    configurable: ['rookieOrderInputs', 'reverseMaxPfFreezeAt', 'regularSeasonFinalWeek', 'orderSpec'],
    notes: [
      'A single 32-slot order across all four tiers, mixing frozen TRUE Max PF with promotion, relegation and playoff outcomes.',
      'The order is DATA (EFL_ROOKIE_DRAFT_ORDER_V1), not code.',
      'The Reverse Max PF pool is DERIVED from the teams no structural role claimed, so changing a playoff count cannot leave the order the wrong length.',
      '🛑 Max PF is the OPTIMAL lineup, not the submitted one. Benching a good player cannot lower it — that is the anti-tanking property, and it is what 1.1.0 did not have.',
    ],
  },

  eliminationPolicy: {
    canonicalEngine: null,
    mode: 'none',
    immunityPassesDown: false,
    notes: ['Nobody leaves this league. Tiers move; rosters carry.'],
  },

  governancePolicy: {
    canonicalEngine: null,
    commissionerConfigurable: [
      'tierCount',
      'teamsPerTier',
      'autoRelegateCount',
      'relegationPlayoffCount',
      'autoPromoteCount',
      'promotionPlayoffCount',
      'noRelegationFromTierLevels',
      'noPromotionFromTierLevels',
      'rookieOrderInputs',
      'reverseMaxPfFreezeAt',
      'regularSeasonFinalWeek',
      'premierLeagueChampionshipPlayoff',
      'reverseMaxPfMetric',
    ],
    deferredModules: [
      '🛑 DEPLOY DEPENDENCY, NOT MISSING CODE: prisma/migrations-pending/20260910120000_league_max_pf_freeze/ is parked. Until it is applied the freeze reports `ready`, never `frozen`.',
      'per-week historical lineup configuration — the repo stores only the CURRENT roster template, so Max PF applies one configuration to every week (harmless for EFL, which does not change mid-season; NOT harmless for Survivor All-Stars)',
      'governance module (rule proposals and votes)',
      'financial obligations module (dues)',
      'conditional asset obligations module (conditional picks)',
    ],
  },

  commissionerAutomationDefaults: 'ask_first',

  externalPlatformBehavior: {
    preparableEffects: ['PROMOTE_TEAM', 'RELEGATE_TEAM', 'ASSIGN_DRAFT_SLOT', 'CREATE_COMMISSIONER_TASK', 'GENERATE_ANNOUNCEMENT'],
    unsupportedEffects: [],
    deepLinkable: true,
    notes: [
      'The source Sleeper league is one flat 32-team league. The tier structure exists only in AllFantasy, so promotion and relegation never need a write to Sleeper.',
      'Rookie draft order does have to be entered in Sleeper by a human. AllFantasy computes it exactly and presents it; it cannot set it, and must never say it did.',
    ],
  },

  /**
   * 🛑 TRUE FOR THE FIRST TIME, AND EVERY EFFECT STILL STATES ITS OWN BACKING. The planner requires
   * template permission AND a real engine AND platform authority, so flipping this does not make
   * the rookie-order effect executable — that one is `planned` because Sleeper is read-only.
   */
  executionEnabled: true,

  composedEngines: [
    'lib/lineup-optimizer/optimalLineup.ts',
    MAX_PF_ENGINE,
    'lib/commissioner-os/efl/maxPfReads.ts',
    FREEZE_STORE,
    TRANSITION_ENGINE,
    APPLIER,
    DRAFT_ORDER_ENGINE,
    'lib/promotion-relegation/PromotionEngine.ts',
    'lib/promotion-relegation/StandingsEvaluator.ts',
    'lib/promotion-relegation/DivisionResolver.ts',
    'lib/league-rules/resolveLeagueRules.ts',
  ],
}
