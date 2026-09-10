/**
 * EFL Promotion/Relegation Dynasty — template definition v1.1.0.
 *
 * 🛑 A NEW VERSION, NOT AN EDIT. v1.0.0 is published and is left byte-identical in its own file.
 * This version changes what the template CLAIMS about its own effects (`backedBy`) and shrinks its
 * deferred-module list, both of which are contract statements a pinned league reads. Editing 1.0.0
 * in place would have changed the rules under any league already pinned to it, with no conflict, no
 * error and nothing to notice — the exact failure the exact-pin rule exists to prevent.
 *
 * 🛑 AND IT IS A STANDALONE LITERAL RATHER THAN A SPREAD OF v1.0.0, DELIBERATELY. `{...V1, ...}`
 * would be shorter and would couple the two: a later edit to 1.0.0 would silently rewrite 1.1.0 as
 * well, which defeats pinning entirely. Published versions must be independent objects even at the
 * cost of repetition.
 *
 * ## What changed from 1.0.0, and why each change needed a version
 *
 *  - `backedBy` on five effects. This is a claim about what actually runs, and it moves in BOTH
 *    directions: `ASSIGN_DRAFT_SLOT` is WIDENED (globally there is no draft-slot engine; EFL now
 *    has one), while `PROMOTE_TEAM` and `RELEGATE_TEAM` are NARROWED from the global `engine` to
 *    `planned`, because `PromotionEngine` applies STANDINGS-ZONE movement and EFL's is
 *    playoff-decided with no applier. Inheriting the global claim would have been the template
 *    asserting an execution path that does not exist for it.
 *  - `governancePolicy.deferredModules` shrinks by three: playoff-decided slots, the Max PF freeze
 *    and the 32-slot order generator are built. Three remain, and two of them are the reason
 *    `executionEnabled` is still false.
 *  - `composedEngines` names the new resolvers.
 *
 * ## Why `executionEnabled` is STILL false
 *
 * ⚠ EVERY RESOLVER IN THIS VERSION IS REAL AND DETERMINISTIC, AND NOTHING PERSISTS OR APPLIES YET.
 * The freeze has no durable home (no migration was taken — see the handoff §4) and no applier
 * consumes the settled `SeasonEndTransition[]`. A template that computed a perfect ladder and
 * claimed to have applied it would be worse than one that admits it only prepared it. Flipping this
 * flag is a deliberate act for the version that ships persistence, not a reward for the resolvers
 * existing.
 *
 * ⚠ CAPABILITIES ARE IDENTICAL TO 1.0.0 ON PURPOSE. A league moving from one pin to the other sees
 * no change in what Commissioner OS believes the league IS — only in what the template says it can
 * do about it.
 */

import type { LeagueTemplateDefinition } from '@/lib/commissioner-os/template/types'

const FREEZE_ENGINE = 'lib/commissioner-os/efl/maxPfFreeze.ts'
const TRANSITION_ENGINE = 'lib/commissioner-os/efl/seasonTransitionResolver.ts'
const DRAFT_ORDER_ENGINE = 'lib/commissioner-os/efl/rookieDraftOrder.ts'

export const EFL_PROMOTION_RELEGATION_DYNASTY_V1_1: LeagueTemplateDefinition = {
  id: 'efl_promotion_relegation_dynasty',
  version: '1.1.0',
  label: 'EFL Promotion/Relegation Dynasty',
  description:
    'A 32-team dynasty league played as four tiers of eight, with promotion and relegation between them each season and a custom 32-slot rookie draft order. Movement and draft order are now computed deterministically; applying them is still a commissioner action.',
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
    /**
     * 🛑 A LEAGUE SETTING, NOT A CONSTANT. The EFL constitution's regular season ends after week 14,
     * and `lib/commissioner-os/efl/maxPfFreeze.ts` never defaults to it — a fifteen-week league or
     * another sport must not inherit this number by accident.
     */
    regularSeasonFinalWeek: 14,
    premierLeagueChampionshipPlayoff: true,
    /**
     * ⚠ NAMES THE METRIC THE FREEZE ACTUALLY SUMS. `WeeklyMatchup.pointsFor` is points SCORED, not
     * optimal-lineup points — see the freeze module header for why that gap matters to a rule whose
     * stated purpose is discouraging tanking.
     */
    reverseMaxPfMetric: 'regular_season_points_for',
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
          'Tier play. Max PF accumulates and is the input to next season rookie order until it freezes at the end of this phase.',
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
      /*
       * ⚠ THE ID IS UNCHANGED FROM 1.0.0 AND THAT IS CORRECT. It is the same logical effect, and
       * the idempotency key already carries the pinned VERSION, so 1.0.0 and 1.1.0 produce
       * different keys for it automatically. The rule that must never be broken is reuse or
       * renumbering INSIDE one published version.
       */
      id: 'efl.freeze_reverse_max_pf',
      effect: 'CREATE_COMMISSIONER_TASK',
      at: { kind: 'phase_exit', phaseId: 'regular_season' },
      params: {
        taskKey: 'freeze_reverse_max_pf',
        title: 'Freeze Reverse Max PF for next season rookie order',
        rationale:
          'Playoff points must not move a non-playoff team rookie slot. The frozen value is the input; the running total is not.',
        metric: 'regular_season_points_for',
      },
      backedBy: {
        engine: FREEZE_ENGINE,
        status: 'planned',
        note: 'The value is computed from WeeklyMatchup rows filtered to the regular season, so it is exact. It is still a task because nothing durable stores it yet — the freeze reports `ready`, never `frozen`.',
      },
      description: 'Snapshot Max PF the moment the regular season ends.',
    },
    {
      id: 'efl.relegation_playoff_setup',
      effect: 'CREATE_COMMISSIONER_TASK',
      at: { kind: 'phase_entry', phaseId: 'tier_playoffs' },
      params: {
        taskKey: 'seed_relegation_and_promotion_playoffs',
        title: 'Seed relegation and promotion playoffs',
        rationale:
          'AllFantasy now names the participants exactly. Running the matchups is still a commissioner action.',
      },
      backedBy: {
        engine: TRANSITION_ENGINE,
        status: 'planned',
        note: 'Participants are derived from tier standings; the resolver reports them as pendingPlayoffs until a result is recorded.',
      },
      description: 'Seed the two-team relegation playoff and the 2nd/3rd promotion playoff in each tier.',
    },
    {
      id: 'efl.apply_relegations',
      effect: 'RELEGATE_TEAM',
      at: { kind: 'phase_entry', phaseId: 'promotion_relegation' },
      params: {
        autoRelegateCount: 1,
        playoffDecidedCount: 1,
        exemptTierLevels: [4],
      },
      backedBy: {
        engine: TRANSITION_ENGINE,
        /*
         * 🛑 NARROWED FROM THE GLOBAL `engine`. `PromotionEngine` really does apply movement — for
         * the STANDINGS-ZONE competition. EFL's relegation is playoff-decided and no applier
         * consumes the settled list, so claiming `engine` here would assert an execution path that
         * exists for a different game.
         */
        status: 'planned',
        note: 'Produces a settled SeasonEndTransition[]. Nothing applies it yet; PromotionEngine computes its own transitions and cannot accept an injected list.',
      },
      description: 'Bottom team auto-relegates; the relegation playoff loser joins them.',
    },
    {
      id: 'efl.apply_promotions',
      effect: 'PROMOTE_TEAM',
      at: { kind: 'phase_entry', phaseId: 'promotion_relegation' },
      params: {
        autoPromoteCount: 1,
        playoffDecidedCount: 1,
        exemptTierLevels: [1],
      },
      backedBy: {
        engine: TRANSITION_ENGINE,
        status: 'planned',
        note: 'Produces a settled SeasonEndTransition[]. Nothing applies it yet.',
      },
      description: 'Division winner auto-promotes; the promotion playoff winner joins them.',
    },
    {
      id: 'efl.publish_rookie_order',
      effect: 'ASSIGN_DRAFT_SLOT',
      at: { kind: 'season_end' },
      params: {
        slots: 32,
        inputs: ['frozen_reverse_max_pf', 'promotion_outcome', 'relegation_outcome', 'playoff_outcome'],
      },
      backedBy: {
        engine: DRAFT_ORDER_ENGINE,
        /*
         * ⚠ WIDENED. `ASSIGN_DRAFT_SLOT` has no generic executor and never will — no engine can
         * compute an arbitrary league's slot rules. EFL's are data, and the resolver produces all
         * thirty-two with provenance. `planned` rather than `engine` only because the destination
         * is Sleeper, which AllFantasy cannot write to.
         */
        status: 'planned',
        note: 'The order is computed exactly, every slot carrying provenance. Entering it in Sleeper is a human action; AllFantasy cannot write there.',
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
      'Playoff-decided movement is resolved by lib/commissioner-os/efl/seasonTransitionResolver.ts BEFORE anything reaches PromotionEngine, which is untouched.',
    ],
  },

  advancementPolicy: {
    canonicalEngine: 'lib/promotion-relegation/PromotionEngine.ts',
    mode: 'tier_playoff',
    notes: [
      'The Premier League championship playoff decides a title only. It does not feed promotion, because there is no tier above it — but its placings 1-5 fill rookie slots 32 down to 28.',
    ],
  },

  draftPolicy: {
    canonicalEngine: DRAFT_ORDER_ENGINE,
    rookieOrder: 'custom',
    frozenInput: { field: 'reverse_max_pf', frozenAt: 'regular_season_complete' },
    configurable: ['rookieOrderInputs', 'reverseMaxPfFreezeAt', 'regularSeasonFinalWeek', 'orderSpec'],
    notes: [
      'A single 32-slot order across all four tiers, mixing frozen Reverse Max PF with promotion, relegation and playoff outcomes.',
      'The order is DATA (EFL_ROOKIE_DRAFT_ORDER_V1), not code. A commissioner changing a slot edits one array entry.',
      'The Reverse Max PF pool is DERIVED from the teams no structural role claimed, so changing a playoff count cannot leave the order the wrong length.',
      'Playoff points must not change a non-playoff team slot. That is the entire reason the input freezes.',
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
    ],
    /**
     * ⚠ THREE FEWER THAN 1.0.0, AND THE THREE THAT REMAIN ARE WHY EXECUTION IS STILL OFF.
     */
    deferredModules: [
      'durable storage for the Max PF freeze — no existing model fits; the smallest additive migration is proposed in the handoff and was NOT taken',
      'an applier that consumes a settled SeasonEndTransition[] (PromotionEngine computes its own and cannot accept an injected list)',
      'optimal-lineup Max PF — the metric the anti-tanking rule actually implies; LeaguePlayerWeeklyScore has the data, slot eligibility is the missing piece',
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

  executionEnabled: false,

  composedEngines: [
    'lib/promotion-relegation/DivisionResolver.ts',
    'lib/promotion-relegation/StandingsEvaluator.ts',
    'lib/promotion-relegation/PromotionEngine.ts',
    'lib/league-rules/resolveLeagueRules.ts',
    TRANSITION_ENGINE,
    FREEZE_ENGINE,
    'lib/commissioner-os/efl/maxPfFreezeReads.ts',
    DRAFT_ORDER_ENGINE,
  ],
}
