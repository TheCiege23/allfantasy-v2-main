/**
 * Survivor All-Stars Guillotine — template definition v1.0.0.
 *
 * 🛑 A NON-EXECUTING PROOF FIXTURE. `executionEnabled: false`. This is the template that proves the
 * C5 contract can express a league which is FOUR THINGS AT ONCE — guillotine elimination, Survivor
 * tribal competition, a scheduled roster mutation series, and a reward/power economy — without
 * flattening it to one `SpecialtyConceptKey`. That is the exact limitation the C0.5/C5 brief was
 * written to remove, and this fixture is the positive control for it.
 *
 * 🛑 IT ALSO DOES NOT REWRITE SURVIVOR, AND MUST NOT. The repo's own audit records generic Survivor
 * as not production-safe — participating-commissioner privacy and blind mode, incomplete exile/jury
 * and finale runtime, unproven power execution, sample UI states, no complete DB-backed runtime.
 * None of that is fixed here and none of it is hidden: `governancePolicy.deferredModules` names it,
 * and `executionEnabled: false` means this template cannot act on any of it.
 *
 * ## One truth source for the dated schedule
 *
 * ⚠ THE LINEUP EXPANSION WEEKS AND IDOL EXPIRIES ARE IMPORTED FROM
 * `lib/trade-intel/survivorGuillotine.ts`, NOT RESTATED. That module already holds the published
 * schedule and is already what the trade/FAAB side prices against. Two copies of "the SUPERFLEX
 * arrives in week 9" is the bug; a copy that drifts by one week reprices every quarterback in the
 * league against a slot that is not there.
 *
 * ## The elimination rule that is easy to state wrong
 *
 * 🛑 IMMUNITY DOES NOT CANCEL AN ELIMINATION, IT PASSES IT DOWN. If the lowest scorer is immune,
 * the NEXT-LOWEST ELIGIBLE scorer goes instead — the week still takes somebody. The same holds
 * during the Gauntlet, where two teams go per week (one per tribe) rather than one. Reading immunity
 * as "nobody leaves" would leave the field one team too large for the rest of the season and the
 * final-three placement would never be reachable.
 *
 * Pure: frozen data. No DB, no I/O, no clock.
 */

import {
  LINEUP_SCHEDULE,
  SUPERFLEX_WEEK,
  STANDARD_IDOL_LAST_WEEK,
  GAUNTLET_IDOL_LAST_WEEK,
} from '@/lib/trade-intel/survivorGuillotine'
import type { LeagueTemplateDefinition, ScheduledRuleEffect } from '@/lib/commissioner-os/template/types'

/**
 * Roster expansions, derived from the published schedule rather than retyped.
 *
 * ⚠ WEEK 1 IS THE OPENING LINEUP, NOT AN EXPANSION, so it is dropped. Deriving rather than listing
 * means adding a sixth expansion to `LINEUP_SCHEDULE` produces the effect here automatically — and
 * means a template test that counts effects fails loudly if the schedule moves, which is the point.
 */
const ROSTER_EXPANSION_EFFECTS: ScheduledRuleEffect[] = LINEUP_SCHEDULE.filter(
  (s) => s.fromWeek > 1,
).map((s) => ({
  id: `sasg.expand_lineup_wk${s.fromWeek}`,
  effect: 'ADD_ROSTER_SLOT' as const,
  at: { kind: 'week' as const, week: s.fromWeek },
  params: {
    starters: s.starters,
    adds: s.added,
    benchAlsoGrows: true,
    isSuperflex: s.fromWeek === SUPERFLEX_WEEK,
  },
  description: `Week ${s.fromWeek}: lineup grows to ${s.starters} starters (${s.added}), bench grows with it.`,
}))

export const SURVIVOR_ALL_STARS_GUILLOTINE_V1: LeagueTemplateDefinition = {
  id: 'survivor_all_stars_guillotine',
  version: '1.0.0',
  label: 'Survivor All-Stars Guillotine',
  description:
    'Twenty-two managers in two tribes of eleven. One team is eliminated per week, two per week during the Gauntlet, and their roster hits waivers. No trades, one $1000 FAAB budget for the whole season, and a starting lineup that grows on a published schedule.',
  /**
   * ⚠ THE BASE FORMAT IS GUILLOTINE AND THAT IS DELIBERATELY NOT THE WHOLE ANSWER. The Survivor
   * half is carried by `capabilityIds`, which is the entire reason capabilities are a set. The
   * existing `resolveSpecialtyConceptKey` would return `guillotine` here and lose the tribes, the
   * match play, the champions, the shuffle, the schoolyard draft and both idols.
   */
  baseFormatId: 'guillotine',
  aliasTags: ['survivor_guillotine', 'survivor_all_stars'],
  compatibleSports: ['NFL'],
  capabilityIds: [
    'elimination.guillotine',
    'elimination.double',
    'elimination.immunity',
    'survivor.tribes',
    'survivor.tribe_shuffle',
    'survivor.match_play',
    'survivor.tribe_champion',
    'survivor.merge',
    'survivor.final_placement',
    'powers.idol',
    'powers.swap_token',
    'rewards.faab',
    'roster.scheduled_expansion',
    'draft.schoolyard',
    'trades.disabled',
    'phase.state_machine',
  ],

  defaultSettings: Object.freeze({
    teamCount: 22,
    tribeCount: 2,
    tribeSize: 11,
    seasonFaabBudget: 1000,
    tradesEnabled: false,
    tribeShuffleWeek: 7,
    gauntletStartWeek: 11,
    mergeWeek: 14,
    finalPlacementWeek: 17,
    standardIdolLastWeek: STANDARD_IDOL_LAST_WEEK,
    gauntletIdolLastWeek: GAUNTLET_IDOL_LAST_WEEK,
    superflexWeek: SUPERFLEX_WEEK,
  }),

  phaseGraph: {
    initialPhaseId: 'tribal_first',
    phases: [
      {
        id: 'tribal_first',
        label: 'Tribal phase I (weeks 1-6)',
        summary:
          'Two tribes of eleven. Weeks alternate between Match Play and Tribe Champion. One team leaves each week — the lowest eligible scorer, never a vote.',
        fromWeek: 1,
        toWeek: 6,
        capabilityIds: [
          'survivor.tribes',
          'survivor.match_play',
          'survivor.tribe_champion',
          'elimination.guillotine',
          'elimination.immunity',
          'powers.idol',
          'powers.swap_token',
        ],
        next: ['tribe_shuffle'],
      },
      {
        id: 'tribe_shuffle',
        label: 'Tribe shuffle (before week 7)',
        summary: 'Tribes are redrawn at random. Nobody picks and nothing is seeded.',
        capabilityIds: ['survivor.tribe_shuffle'],
        next: ['tribal_second'],
      },
      {
        id: 'tribal_second',
        label: 'Tribal phase II (weeks 7-10)',
        summary:
          'New tribes, same alternation of Match Play and Tribe Champion. The lineup grows in weeks 7 and 9, and the standard immunity idol expires at the end of week 10.',
        fromWeek: 7,
        toWeek: 10,
        capabilityIds: [
          'survivor.tribes',
          'survivor.match_play',
          'survivor.tribe_champion',
          'elimination.guillotine',
          'elimination.immunity',
          'powers.idol',
          'roster.scheduled_expansion',
        ],
        next: ['gauntlet_draft'],
      },
      {
        id: 'gauntlet_draft',
        label: 'Gauntlet draft (week 11)',
        summary:
          'New tribes are drafted. Captains are the two highest scorers of week 10 and they pick SCHOOLYARD, not snake — the same captain can pick twice in a row and the order never reverses.',
        capabilityIds: ['draft.schoolyard', 'survivor.tribes'],
        next: ['gauntlet'],
      },
      {
        id: 'gauntlet',
        label: 'Gauntlet (weeks 11-13)',
        summary:
          'Double elimination: the lowest eligible scorer on EACH tribe leaves every week. The Gauntlet idol is live and returns to circulation when spent.',
        fromWeek: 11,
        toWeek: 13,
        capabilityIds: ['elimination.double', 'elimination.immunity', 'powers.idol', 'roster.scheduled_expansion'],
        next: ['merge'],
      },
      {
        id: 'merge',
        label: 'Merge (week 14)',
        summary: 'Tribes dissolve. From here it is one field and one elimination a week.',
        capabilityIds: ['survivor.merge', 'roster.scheduled_expansion'],
        next: ['merged_guillotine'],
      },
      {
        id: 'merged_guillotine',
        label: 'Merged guillotine (weeks 14-16)',
        summary: 'Standard Guillotine. Lowest scorer in the league leaves; their roster hits waivers.',
        fromWeek: 14,
        toWeek: 16,
        capabilityIds: ['elimination.guillotine'],
        next: ['final_three'],
      },
      {
        id: 'final_three',
        label: 'Final three (week 17)',
        summary: 'Three teams remain and week 17 places them 1-2-3. Nobody is eliminated; everybody is ranked.',
        fromWeek: 17,
        toWeek: 17,
        capabilityIds: ['survivor.final_placement'],
        next: [],
        terminal: true,
      },
    ],
  },

  scheduledEffects: [
    ...ROSTER_EXPANSION_EFFECTS,
    {
      id: 'sasg.shuffle_tribes_wk7',
      effect: 'MOVE_TRIBE',
      at: { kind: 'phase_entry', phaseId: 'tribe_shuffle' },
      params: {
        mode: 'random',
        /**
         * ⚠ RANDOM, AND THEREFORE NOT SOMETHING THE PLANNER MAY DECIDE. The planner is required to
         * be deterministic, so it plans the shuffle as an action to be RESOLVED with a seed the
         * commissioner or executor supplies. Rolling dice inside a planner would make the same
         * inputs produce different plans, which breaks idempotency outright.
         */
        seedRequired: true,
      },
      description: 'Redraw both tribes at random before week 7.',
    },
    {
      id: 'sasg.expire_standard_idol',
      effect: 'CONSUME_POWER',
      at: { kind: 'week', week: STANDARD_IDOL_LAST_WEEK + 1 },
      params: { powerId: 'standard_immunity_idol', reason: 'expired' },
      description: `Standard immunity idols expire after week ${STANDARD_IDOL_LAST_WEEK}.`,
    },
    {
      id: 'sasg.expire_swap_token',
      effect: 'CONSUME_POWER',
      at: { kind: 'phase_exit', phaseId: 'tribal_second' },
      params: { powerId: 'swap_token', reason: 'expired' },
      description: 'The swap token expires when the tribal phase ends.',
    },
    {
      id: 'sasg.gauntlet_captains',
      effect: 'CREATE_COMMISSIONER_TASK',
      at: { kind: 'phase_entry', phaseId: 'gauntlet_draft' },
      params: {
        taskKey: 'seed_gauntlet_captains',
        title: 'Confirm Gauntlet captains and run the schoolyard pick',
        rationale: 'Captains are the top two scorers of week 10. The pick order is schoolyard, not snake.',
      },
      description: 'Seed the Gauntlet draft from week 10 scoring.',
    },
    {
      id: 'sasg.gauntlet_double_elimination',
      effect: 'ELIMINATE_ROSTER',
      at: { kind: 'phase_entry', phaseId: 'gauntlet' },
      params: {
        perTribe: 1,
        immunityPassesDown: true,
        weeks: [11, 12, 13],
      },
      description: 'Two teams leave per week during the Gauntlet — the lowest eligible scorer on each tribe.',
    },
    {
      id: 'sasg.expire_gauntlet_idol',
      effect: 'CONSUME_POWER',
      at: { kind: 'week', week: GAUNTLET_IDOL_LAST_WEEK + 1 },
      params: { powerId: 'gauntlet_idol', reason: 'expired' },
      description: `Gauntlet idols expire after week ${GAUNTLET_IDOL_LAST_WEEK}.`,
    },
    {
      id: 'sasg.merge_tribes',
      effect: 'MOVE_TRIBE',
      at: { kind: 'phase_entry', phaseId: 'merge' },
      params: { mode: 'merge', targetTribeId: 'merged' },
      description: 'Dissolve both tribes into one field at week 14.',
    },
    {
      id: 'sasg.release_eliminated_rosters',
      effect: 'RELEASE_ROSTER',
      at: { kind: 'phase_entry', phaseId: 'merged_guillotine' },
      params: { destination: 'waiver_pool' },
      description: 'Eliminated rosters return to the waiver pool, as in standard Guillotine.',
    },
    {
      id: 'sasg.announce_final_three',
      effect: 'GENERATE_ANNOUNCEMENT',
      at: { kind: 'phase_entry', phaseId: 'final_three' },
      params: { topic: 'final_three_placement' },
      description: 'Announce the final three and how week 17 places them.',
    },
  ],

  eliminationPolicy: {
    canonicalEngine: 'lib/guillotine/GuillotineEliminationEngine.ts',
    mode: 'lowest_score',
    perPeriodByPhase: {
      tribal_first: 1,
      tribal_second: 1,
      /** Two, because it is one per tribe and there are two tribes. */
      gauntlet: 2,
      merged_guillotine: 1,
      final_three: 0,
    },
    immunityPassesDown: true,
    configurable: ['perPeriodByPhase', 'immunityPassesDown'],
    notes: [
      'Elimination is never by vote in this format, at any phase.',
      'An immune lowest scorer does not save the week — the next eligible scorer goes instead.',
    ],
  },

  rewardPolicy: {
    canonicalEngine: null,
    seasonFaabBudget: 1000,
    rewardFaabEnabled: true,
    configurable: ['seasonFaabBudget', 'rewardFaabEnabled'],
    notes: [
      '$1000 for the entire season, not per week. With no trades, FAAB is the only way to acquire anybody, which is why bid timing carries the whole game.',
    ],
  },

  powerPolicy: {
    canonicalEngine: 'lib/survivor/',
    powers: [
      {
        id: 'standard_immunity_idol',
        label: 'Immunity idol',
        expiresAfterWeek: STANDARD_IDOL_LAST_WEEK,
        summary: 'Passes this week elimination to the next eligible scorer. It does not cancel it.',
      },
      {
        id: 'gauntlet_idol',
        label: 'Gauntlet idol',
        expiresAfterWeek: GAUNTLET_IDOL_LAST_WEEK,
        summary:
          'Tied to a designated rostered retired player, so ownership is detectable from imported roster data. Returns to circulation when spent, for a later Gauntlet week.',
      },
      {
        id: 'swap_token',
        label: 'Swap token',
        expiresAfterWeek: 10,
        summary:
          'Swap one member of each tribe. The holder may include themselves. Expires when the tribal phase ends.',
      },
    ],
    configurable: ['powers'],
  },

  draftPolicy: {
    canonicalEngine: null,
    rookieOrder: 'not_applicable',
    configurable: ['gauntletCaptainRule'],
    notes: [
      'The only draft in this format is the week 11 Gauntlet tribe draft.',
      '🛑 SCHOOLYARD, NOT SNAKE. Captains are the top two scorers of week 10 and the order does not reverse.',
    ],
  },

  advancementPolicy: {
    canonicalEngine: null,
    mode: 'placement',
    notes: ['Week 17 places the final three 1-2-3. There is no bracket.'],
  },

  governancePolicy: {
    canonicalEngine: null,
    commissionerConfigurable: [
      'tribeCount',
      'tribeSize',
      'tribeShuffleWeek',
      'gauntletStartWeek',
      'mergeWeek',
      'seasonFaabBudget',
      'powers',
      'perPeriodByPhase',
    ],
    /**
     * 🛑 THE HONEST LIST. Everything here is required by the format above and absent from the repo.
     * Reading the phase graph as a working state machine without reading this list is how a fixture
     * gets cited as a shipped feature.
     */
    deferredModules: [
      'Match Play pairing (commissioner does it by hand today; a guided mini-snake matchup draft is wanted)',
      'Tribe Champion selection, both consensus and in-app voting, with the no-repeat-until-everyone-has-served rule',
      'seeded random tribe shuffle',
      'schoolyard Gauntlet draft',
      'swap token execution',
      'Gauntlet idol ownership detection from imported roster data',
      'reward FAAB grants',
      'scheduled roster-slot and bench executors (rosterExpansionEngine is not wired to a schedule)',
      'Survivor privacy / blind mode for a participating commissioner — a known unsafe area, not fixed here',
    ],
  },

  commissionerAutomationDefaults: 'ask_first',

  externalPlatformBehavior: {
    /**
     * ⚠ THE ROSTER EFFECTS ARE PREPARABLE BUT NOT EXECUTABLE ON A READ-ONLY LEAGUE, AND THE
     * DIFFERENCE IS THE PRODUCT. AllFantasy can compute exactly who is eliminated and exactly which
     * slots open in week 9; on Sleeper a human has to apply it. Saying "eliminated" without saying
     * "in AllFantasy only" is the failure `lib/league/write-authority.ts` exists to prevent.
     */
    preparableEffects: [
      'ADD_ROSTER_SLOT',
      'SET_BENCH_SIZE',
      'ELIMINATE_ROSTER',
      'RELEASE_ROSTER',
      'MOVE_TRIBE',
      'CONSUME_POWER',
      'ASSIGN_POWER',
      'CREATE_COMMISSIONER_TASK',
      'GENERATE_ANNOUNCEMENT',
    ],
    /**
     * Reward FAAB cannot even be usefully prepared against a read-only league: AllFantasy does not
     * hold the authoritative balance, so a computed grant would be arithmetic on a number it cannot
     * see.
     */
    unsupportedEffects: ['AWARD_FAAB', 'TRANSFER_PLAYER'],
    deepLinkable: true,
    notes: [
      'Tribes, powers and phases are AllFantasy constructs with no counterpart on any host platform, so AF owns them outright even for an imported league.',
      'Roster slots, bench size and actual roster releases belong to the host platform when the league is imported.',
    ],
  },

  executionEnabled: false,

  composedEngines: [
    'lib/guillotine/GuillotineEliminationEngine.ts',
    'lib/guillotine/GuillotineRosterReleaseEngine.ts',
    'lib/guillotine/rosterExpansionEngine.ts',
    'lib/survivor/gameStateMachine.ts',
    'lib/trade-intel/survivorGuillotine.ts',
    'lib/specialty-automation/handlers/guillotineHandler.ts',
    'lib/specialty-automation/handlers/survivorHandler.ts',
  ],
}
