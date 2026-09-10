/**
 * EFL Promotion/Relegation Dynasty — template definition v1.0.0.
 *
 * 🛑 A NON-EXECUTING PROOF FIXTURE. `executionEnabled: false`. This exists to prove the C5 contract
 * can carry a real, specific, commissioner-authored league without inventing a parallel engine —
 * not to run one. `runCommissionerTemplatePlan` refuses to mark any action executable for a
 * template with this flag off, so the fixture cannot quietly become a runtime.
 *
 * ## What this league is
 *
 * One 32-team Sleeper dynasty league, internally split into four tiers of eight. Tier 1 is the
 * Premier League, tier 4 is League 2 — matching `LeagueDivision.tierLevel`, where a LOWER number is
 * a HIGHER tier (`PromotionEngine` reads `fromTierLevel` as the division being relegated FROM).
 * Getting that orientation backwards would relegate the champions, which is why it is stated here
 * rather than assumed.
 *
 * ## What already exists, and what does not
 *
 * `lib/promotion-relegation/` is canonical and this template composes it: `DivisionResolver`,
 * `StandingsEvaluator`, `PromotionEngine`, plus the `PromotionRule` / `LeagueDivision` /
 * `LeagueTeam.divisionId` models and the dry-run/apply route.
 *
 * ⚠ BUT `PromotionEngine` DECIDES BY STANDINGS ZONE ALONE — IT HAS NO CONCEPT OF A PLAYOFF-DECIDED
 * SLOT. EFL's rules are two-part: the bottom team auto-relegates, and the next two play a
 * relegation playoff whose LOSER goes down. The engine as written would take the bottom three by
 * record. That is a genuine gap, recorded in `governancePolicy.deferredModules` rather than papered
 * over by pretending the existing engine covers it — building it is the next phase's work.
 *
 * ## The rookie draft order, and the one rule that is easy to get wrong
 *
 * 🛑 REVERSE MAX PF FREEZES AT REGULAR-SEASON COMPLETION, AND PLAYOFF POINTS MUST NOT MOVE A
 * NON-PLAYOFF TEAM'S SLOT. This is not a nicety. A team that misses the playoffs has finished
 * accumulating the number their draft position depends on; if the order is recomputed after the
 * postseason from a running total, every non-playoff team's slot shifts because OTHER teams kept
 * scoring. The freeze is what makes a non-playoff team's position final the moment their season
 * ends, and `standings.frozen_input` is the capability that says so.
 *
 * Pure: frozen data. No DB, no I/O, no clock.
 */

import type { LeagueTemplateDefinition } from '@/lib/commissioner-os/template/types'

export const EFL_PROMOTION_RELEGATION_DYNASTY_V1: LeagueTemplateDefinition = {
  id: 'efl_promotion_relegation_dynasty',
  version: '1.0.0',
  label: 'EFL Promotion/Relegation Dynasty',
  description:
    'A 32-team dynasty league played as four tiers of eight, with promotion and relegation between them each season and a custom 32-slot rookie draft order.',
  baseFormatId: 'dynasty',
  /**
   * ⚠ THE BASE FORMAT IS NOT THE WHOLE TRUTH AND THE ALIAS IS WHAT KEEPS THE REST. A reader that
   * stops at `dynasty` has a correct pricing base and has lost the entire product — the same
   * flattening `readFormatRules` documents for Royal and King of the Hill.
   */
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
    /**
     * ⚠ A DEFAULT, NOT A LAW. Every one of these is listed in `governancePolicy.commissionerConfigurable`
     * because the brief is explicit that EFL's rules are commissioner-configurable rather than
     * globally hardcoded. Hardcoding them would make the second EFL-shaped league unbuildable.
     */
    autoRelegateCount: 1,
    relegationPlayoffCount: 2,
    autoPromoteCount: 1,
    promotionPlayoffCount: 2,
    reverseMaxPfFreezeAt: 'regular_season_complete',
    premierLeagueChampionshipPlayoff: true,
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
      id: 'efl.freeze_reverse_max_pf',
      effect: 'CREATE_COMMISSIONER_TASK',
      at: { kind: 'phase_exit', phaseId: 'regular_season' },
      params: {
        taskKey: 'freeze_reverse_max_pf',
        title: 'Freeze Reverse Max PF for next season rookie order',
        /**
         * ⚠ MODELLED AS A COMMISSIONER TASK, NOT AS A COMPUTED FIELD, ON PURPOSE. Nothing in this
         * repo snapshots Max PF at regular-season completion today. Emitting a fake
         * `ASSIGN_DRAFT_SLOT` here would produce a number that looks authoritative and is not.
         */
        rationale:
          'Playoff points must not move a non-playoff team rookie slot. The frozen value is the input; the running total is not.',
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
          'PromotionEngine decides by standings zone and has no playoff-decided slot. Until that exists, seeding is a commissioner action.',
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
    ],
  },

  advancementPolicy: {
    canonicalEngine: 'lib/promotion-relegation/PromotionEngine.ts',
    mode: 'tier_playoff',
    notes: [
      'The Premier League championship playoff decides a title only. It does not feed promotion, because there is no tier above it.',
    ],
  },

  draftPolicy: {
    canonicalEngine: null,
    rookieOrder: 'custom',
    frozenInput: { field: 'reverse_max_pf', frozenAt: 'regular_season_complete' },
    configurable: ['rookieOrderInputs', 'reverseMaxPfFreezeAt'],
    notes: [
      'A single 32-slot order across all four tiers, mixing frozen Reverse Max PF with promotion, relegation and playoff outcomes.',
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
      'premierLeagueChampionshipPlayoff',
    ],
    /**
     * ⚠ NAMED, NOT IMPLIED. Each of these is a module the template will need and which does not
     * exist. Listing them is what stops the fixture reading as a working feature.
     */
    deferredModules: [
      'playoff-decided promotion/relegation slots (PromotionEngine decides by standings zone only)',
      'Max PF freeze snapshot at regular-season completion',
      'custom 32-slot rookie order generator',
      'governance module (rule proposals and votes)',
      'financial obligations module (dues)',
      'conditional asset obligations module (conditional picks)',
    ],
  },

  /**
   * ⚠ `ask_first` IS THE DEFAULT FOR EVERY TEMPLATE IN THIS PHASE. Relegating a team is not a
   * reversible convenience, and the full automation policy system is explicitly not built yet.
   */
  commissionerAutomationDefaults: 'ask_first',

  externalPlatformBehavior: {
    /**
     * ⚠ EVERY EFL EFFECT IS PREPARABLE ON A READ-ONLY LEAGUE, AND THAT IS NOT A COINCIDENCE. Tiers,
     * divisions and rookie order are AllFantasy constructs — Sleeper has never heard of them — so
     * they are `internal` scope and AF executes them for real even on an imported league.
     */
    preparableEffects: ['PROMOTE_TEAM', 'RELEGATE_TEAM', 'ASSIGN_DRAFT_SLOT', 'CREATE_COMMISSIONER_TASK', 'GENERATE_ANNOUNCEMENT'],
    unsupportedEffects: [],
    deepLinkable: true,
    notes: [
      'The source Sleeper league is one flat 32-team league. The tier structure exists only in AllFantasy, so promotion and relegation never need a write to Sleeper.',
      'Rookie draft order does have to be entered in Sleeper by a human. AllFantasy computes and presents it; it cannot set it.',
    ],
  },

  executionEnabled: false,

  composedEngines: [
    'lib/promotion-relegation/DivisionResolver.ts',
    'lib/promotion-relegation/StandingsEvaluator.ts',
    'lib/promotion-relegation/PromotionEngine.ts',
    'lib/league-rules/resolveLeagueRules.ts',
  ],
}
