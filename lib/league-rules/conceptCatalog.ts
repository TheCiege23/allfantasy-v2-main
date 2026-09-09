/**
 * The versioned league-concept catalog.
 *
 * 🛑 EVERY LINE HERE IS AN EXPLANATION OF A RULE THAT LIVES SOMEWHERE ELSE.
 * `runtimeAuthority` on each entry names where. When a number is configurable —
 * Zombie's infection thresholds, Guillotine's elimination weeks — this file
 * says the field EXISTS and does not say what it equals, because a per-league
 * or per-sport row owns that and a copy here would be a second engine drifting
 * from the first. The resolver reads real values; this file names them.
 *
 * ⚠ WHAT THIS FILE MAY ASSERT: structure that is version-controlled — a
 * concept's identity, its aliases, which base format it is flattened onto,
 * whether the format permits trades at all, its lifecycle phases. Those are
 * properties of the FORMAT and change only when someone edits code.
 *
 * ⚠ WHAT IT MAY NOT ASSERT: anything a commissioner sets. Those reach a caller
 * as `league_setting` or as `unknown`, never as prose from here.
 */

import type { LeagueConcept } from '@/lib/trade-intel/leagueFormatRules'
import type { ConceptCatalogEntry } from './types'

/**
 * Bumped when any entry's documented rules change. Surfaced to callers so an
 * explanation can be traced to the catalog that produced it.
 */
export const CATALOG_VERSION = '2026-09-09.1'

const ENTRIES: ConceptCatalogEntry[] = [
  {
    id: 'guillotine',
    label: 'Guillotine',
    ruleVersion: '1.0.0',
    formatRulesConcept: 'guillotine',
    aliasTags: [],
    flattenedOnto: null,
    supportedSports: ['NFL', 'NBA', 'NHL', 'MLB'],
    summary:
      'One team is eliminated each scoring period and their entire roster is released to the waiver pool. Survive to the end rather than win a matchup.',
    elimination:
      'The lowest-scoring team in each scoring period is chopped, between the configured elimination start and end weeks. Their roster is released to waivers.',
    tiebreak: null,
    playoffs: null,
    phases: [
      { id: 'preseason', label: 'Pre-season', summary: 'Draft and roster set. No eliminations yet.' },
      {
        id: 'elimination',
        label: 'Elimination window',
        summary:
          'Between the configured start and end weeks, the low scorer is chopped each period and their players hit waivers. The waiver pool improves every week as rosters are released.',
      },
      { id: 'final', label: 'Final', summary: 'The last surviving team wins.' },
    ],
    actions: [
      { id: 'trade', label: 'Trade', legalInFormat: true },
      {
        id: 'waiver_claim',
        label: 'Waiver claim',
        legalInFormat: true,
        note: 'The pool grows every time a roster is released, so waiver priority is worth more later than earlier.',
      },
      { id: 'set_lineup', label: 'Set lineup', legalInFormat: true },
    ],
    configurableFields: ['eliminationStartWeek', 'eliminationEndWeek'],
    runtimeAuthority: [
      'lib/guillotine/GuillotineLeagueConfig.ts',
      'lib/guillotine/guillotineGuard.ts',
      'lib/specialty-automation/handlers/guillotineHandler.ts',
    ],
  },
  {
    id: 'survivor',
    label: 'Survivor',
    ruleVersion: '1.0.0',
    formatRulesConcept: 'survivor',
    aliasTags: [],
    flattenedOnto: null,
    supportedSports: ['NFL'],
    summary:
      'Managers are split into tribes. The lowest-scoring tribe attends tribal council and votes a manager out. Idols, exile and a merge follow the Survivor structure.',
    elimination:
      'By tribal council vote, not by score alone: score decides WHICH tribe attends, the tribe decides who leaves. After the merge the whole league votes.',
    tiebreak: null,
    playoffs: 'Jury phase after the merge, at the configured merge trigger.',
    phases: [
      {
        id: 'tribal',
        label: 'Pre-merge (tribes)',
        summary:
          'Tribes compete; the lowest-scoring tribe attends tribal council. Your tribe only attends if it scores lowest, which is why a tribemate is worth protecting.',
      },
      { id: 'merge', label: 'Merge', summary: 'Tribes dissolve at the configured merge trigger. Every manager is now individually exposed.' },
      { id: 'jury', label: 'Jury', summary: 'Evicted managers form the jury that decides the winner.' },
    ],
    actions: [
      {
        id: 'trade',
        label: 'Trade',
        legalInFormat: true,
        note: 'A deal with a TRIBEMATE can be worth making at a loss before the merge, because a stronger tribe is a tribe that does not attend tribal council.',
      },
      { id: 'waiver_claim', label: 'Waiver claim', legalInFormat: true },
      { id: 'set_lineup', label: 'Set lineup', legalInFormat: true },
      {
        id: 'vote',
        label: 'Tribal council vote',
        legalInFormat: true,
        note: 'Ballots are private. Never disclose or infer another manager’s vote.',
      },
    ],
    configurableFields: ['mode', 'tribeFormation', 'mergeTrigger'],
    runtimeAuthority: [
      'lib/survivor/SurvivorLeagueConfig.ts',
      'lib/survivor/SurvivorRosterState.ts',
      'lib/specialty-automation/handlers/survivorHandler.ts',
    ],
  },
  {
    /*
     * 🛑 TRACED TO MECHANICS, NOT TO ITS NAME. The brief is explicit that this
     * concept must not be inferred from "Survivor" or from "Guillotine" alone,
     * and the mechanics say why: it takes tribes from Survivor but elimination
     * from Guillotine (lowest score, NEVER a vote), and then does something
     * neither parent does — the starting lineup GROWS on a published schedule.
     * Source: lib/trade-intel/survivorGuillotine.ts, which holds that schedule.
     *
     * ⚠ CATALOG-ONLY. No classifier emits this concept, so `formatRulesConcept`
     * is null and it is reachable by explicit id only. Recording null is the
     * honest state; giving it a concept id it never receives would make
     * `resolveLeagueRules` claim leagues that are not this format.
     */
    id: 'survivor_guillotine',
    label: 'Survivor All-Stars Guillotine',
    ruleVersion: '1.0.0',
    formatRulesConcept: null,
    aliasTags: [],
    flattenedOnto: null,
    supportedSports: ['NFL'],
    summary:
      '22 managers in two tribes of 11. One team is eliminated per week — two during the Gauntlet — and their roster hits waivers. $1000 FAAB for the whole season, and no trades at all.',
    elimination:
      'Never by vote. A manager goes out by being the lowest scorer on their tribe, or in the league once merged.',
    tiebreak: null,
    playoffs: 'Gauntlet, during which two teams are eliminated per week.',
    phases: [
      {
        id: 'wk1',
        label: 'Weeks 1–6 (8 starters)',
        summary:
          'Lineup is QB/2RB/2WR/TE/2WRT. A second quarterback is an unstartable bench body. Depth you cannot start yet still appreciates, because the slots that will use it are on a published schedule.',
      },
      { id: 'wk7', label: 'Week 7 (9 starters)', summary: 'A WRT flex opens.' },
      {
        id: 'wk9',
        label: 'Week 9 (10 starters, SUPERFLEX)',
        summary:
          'The SUPERFLEX arrives on a known date and reprices every quarterback. Everyone can see it coming, so the bidding moves before the slot does.',
      },
      { id: 'wk11', label: 'Week 11 (11 starters)', summary: 'Another WRT flex opens.' },
      { id: 'wk14', label: 'Week 14+ (12 starters)', summary: 'Final WRT flex. A week-1 bench body is a starter by now.' },
    ],
    actions: [
      {
        id: 'trade',
        label: 'Trade',
        legalInFormat: false,
        note: 'This format has no trades. FAAB is the only way to acquire a player, which is why bid timing carries the whole game.',
      },
      { id: 'faab_bid', label: 'FAAB bid', legalInFormat: true, note: '$1000 for the entire season, not per week.' },
      { id: 'set_lineup', label: 'Set lineup', legalInFormat: true },
      {
        id: 'play_idol',
        label: 'Play idol',
        legalInFormat: true,
        note: 'Standard idols cannot be played after week 10; Gauntlet idols after week 13.',
      },
    ],
    configurableFields: [],
    runtimeAuthority: ['lib/trade-intel/survivorGuillotine.ts'],
  },
  {
    id: 'zombie',
    label: 'Zombie',
    ruleVersion: '1.0.0',
    formatRulesConcept: 'zombie',
    aliasTags: [],
    flattenedOnto: null,
    supportedSports: ['NFL', 'NBA', 'NHL', 'MLB'],
    summary:
      'Managers hold a status — Survivor, Zombie or Whisperer — that changes with weekly scoring. Resources (serum, weapon, ambush) are spent to defend or attack.',
    elimination:
      'Status transformation rather than removal: falling below the bashing or mauling threshold turns a Survivor into a Zombie. A revive returns them.',
    tiebreak: null,
    playoffs: null,
    phases: [
      {
        id: 'weekly',
        label: 'Weekly cycle',
        summary: 'Scores resolve, statuses transform, the resource ledger settles, and the weekly board is published.',
      },
    ],
    actions: [
      { id: 'trade', label: 'Trade', legalInFormat: true, note: 'The trade window narrows as survivors are lost.' },
      { id: 'waiver_claim', label: 'Waiver claim', legalInFormat: true },
      { id: 'set_lineup', label: 'Set lineup', legalInFormat: true },
      { id: 'spend_resource', label: 'Spend serum / weapon / ambush', legalInFormat: true },
    ],
    configurableFields: [
      'bashingThreshold',
      'maulingThreshold',
      'weaponShieldThreshold',
      'weaponAmbushThreshold',
      'reviveThreshold',
      'serumMaxHold',
      'lineupLockDesc',
    ],
    runtimeAuthority: [
      'lib/zombie/zombieRules.ts (ZombieRulesTemplate, per sport)',
      'lib/zombie/ZombieLeagueConfig.ts',
      'lib/zombie/ZombieOwnerStatusService.ts',
    ],
  },
  {
    id: 'big_brother',
    label: 'Big Brother',
    ruleVersion: '1.0.0',
    formatRulesConcept: null,
    aliasTags: [],
    flattenedOnto: null,
    supportedSports: ['NFL'],
    summary:
      'A weekly HOH competition, nominations, a veto draw and decision, then an eviction vote — each on a configured weekly deadline.',
    elimination: 'By eviction vote, following nominations and the veto decision.',
    tiebreak: null,
    playoffs: null,
    phases: [
      { id: 'hoh', label: 'HOH challenge', summary: 'The Head of Household is decided.' },
      { id: 'nominations', label: 'Nominations', summary: 'The HOH nominates, before the nomination deadline.' },
      { id: 'veto', label: 'Veto draw and decision', summary: 'The veto is drawn and then used or not.' },
      { id: 'eviction', label: 'Eviction vote', summary: 'The house votes. Ballots are private.' },
    ],
    actions: [
      { id: 'nominate', label: 'Nominate', legalInFormat: true, note: 'HOH only, before the nomination deadline.' },
      { id: 'use_veto', label: 'Use veto', legalInFormat: true },
      {
        id: 'vote',
        label: 'Eviction vote',
        legalInFormat: true,
        note: 'Ballots are private. Never disclose another manager’s vote or an unrevealed nomination.',
      },
      { id: 'set_lineup', label: 'Set lineup', legalInFormat: true },
    ],
    configurableFields: [
      'hohChallengeDayOfWeek',
      'nominationDeadlineDayOfWeek',
      'vetoDrawDayOfWeek',
      'vetoDecisionDeadlineDayOfWeek',
      'evictionVoteOpenDayOfWeek',
    ],
    runtimeAuthority: [
      'lib/big-brother/BigBrotherLeagueConfig.ts',
      'lib/big-brother/bigBrotherGuard.ts',
      'lib/specialty-automation/handlers/bigBrotherHandler.ts',
    ],
  },
  {
    id: 'tournament',
    label: 'Tournament Mode',
    ruleVersion: '1.0.0',
    formatRulesConcept: 'tournament',
    aliasTags: [],
    flattenedOnto: null,
    supportedSports: ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'],
    summary: 'Bracket or multi-stage tournament play rather than a season-long head-to-head schedule.',
    elimination: 'By bracket progression.',
    tiebreak: null,
    playoffs: 'The bracket itself.',
    phases: [{ id: 'bracket', label: 'Bracket play', summary: 'Advance or be eliminated, per round.' }],
    actions: [
      { id: 'set_lineup', label: 'Set lineup', legalInFormat: true },
      {
        id: 'trade',
        label: 'Trade',
        legalInFormat: false,
        note: 'Tournament entries are not rosters that trade with one another.',
      },
    ],
    configurableFields: [],
    runtimeAuthority: [
      'lib/tournament-mode/TournamentConfigService.ts',
      'lib/specialty-automation/handlers/tournamentHandler.ts',
    ],
  },
  {
    id: 'devy',
    label: 'Devy Dynasty',
    ruleVersion: '1.0.0',
    formatRulesConcept: 'devy',
    aliasTags: [],
    flattenedOnto: null,
    supportedSports: ['NFL'],
    summary: 'A dynasty league whose rosters also hold college (developmental) players alongside NFL ones.',
    elimination: null,
    tiebreak: null,
    playoffs: null,
    phases: [
      { id: 'offseason', label: 'Off-season', summary: 'Devy and rookie drafts; college players are stashed for future NFL value.' },
      { id: 'regular', label: 'Regular season', summary: 'NFL scoring; devy assets sit behind the active roster.' },
    ],
    actions: [
      {
        id: 'trade',
        label: 'Trade',
        legalInFormat: true,
        note: 'Devy assets are priced on their own scale. A deal spanning college and NFL assets is refused rather than blended — see lib/trade-intel/devyOutlook.ts.',
      },
      { id: 'waiver_claim', label: 'Waiver claim', legalInFormat: true },
      { id: 'set_lineup', label: 'Set lineup', legalInFormat: true },
    ],
    configurableFields: [],
    runtimeAuthority: ['lib/devy/DevyLeagueConfig.ts', 'lib/trade-intel/devyOutlook.ts'],
  },
  {
    id: 'c2c',
    label: 'Merged Devy / Campus to Canton',
    ruleVersion: '1.0.0',
    formatRulesConcept: 'c2c',
    aliasTags: [],
    flattenedOnto: null,
    supportedSports: ['NFL'],
    summary: 'College and NFL rosters merged into one continuous asset pool.',
    elimination: null,
    tiebreak: null,
    playoffs: null,
    phases: [{ id: 'regular', label: 'Season', summary: 'College and pro assets are held together on one roster.' }],
    actions: [
      { id: 'trade', label: 'Trade', legalInFormat: true, note: 'Same college/NFL pricing separation as devy.' },
      { id: 'set_lineup', label: 'Set lineup', legalInFormat: true },
    ],
    configurableFields: [],
    runtimeAuthority: ['lib/merged-devy-c2c/C2CLeagueConfig.ts'],
  },
  {
    /*
     * 🛑 THE ACCEPTANCE SCENARIO LIVES HERE: "King of the Hill retains its
     * concept when its base format is redraft." `normalizeConcept.ts:38` stores
     * it as redraft + ['king_of_the_hill']. A reader that stops at the base
     * format sees a plain redraft league and every crown mechanic disappears.
     * `flattenedOnto` records the flattening so the resolver reports BOTH.
     */
    id: 'king_of_the_hill',
    label: 'King of the Hill',
    ruleVersion: '1.0.0',
    formatRulesConcept: 'king_of_the_hill',
    aliasTags: ['king_of_the_hill', 'koth'],
    flattenedOnto: 'redraft',
    supportedSports: ['NFL'],
    summary:
      'A redraft-shelled format where one manager holds the crown and everyone else plays to take it. The crown, not the standings, is the object.',
    elimination: null,
    tiebreak: null,
    playoffs: null,
    phases: [{ id: 'regular', label: 'Season', summary: 'The crown changes hands as challengers dethrone the holder.' }],
    actions: [
      {
        id: 'trade',
        label: 'Trade',
        legalInFormat: true,
        note: 'Crown position changes what a deal is worth. Pricing is in lib/trade-intel/kingOfTheHill.ts.',
      },
      { id: 'waiver_claim', label: 'Waiver claim', legalInFormat: true },
      { id: 'set_lineup', label: 'Set lineup', legalInFormat: true },
    ],
    configurableFields: [],
    runtimeAuthority: [
      'lib/trade-intel/kingOfTheHill.ts',
      'lib/specialty-automation/handlers/kingOfTheHillHandler.ts',
      'lib/league-creation/canonical/normalizeConcept.ts',
    ],
  },
  {
    id: 'pirate_vampire',
    label: 'Pirate / Vampire',
    ruleVersion: '1.0.0',
    formatRulesConcept: 'pirate',
    aliasTags: ['pirate_vampire', 'pirate'],
    flattenedOnto: 'dynasty',
    supportedSports: ['NFL'],
    summary: 'A dynasty-shelled format where rosters can be raided rather than only traded with.',
    elimination: null,
    tiebreak: null,
    playoffs: null,
    phases: [{ id: 'regular', label: 'Season', summary: 'Raiding mechanics sit on top of a dynasty roster.' }],
    actions: [
      { id: 'trade', label: 'Trade', legalInFormat: true },
      { id: 'set_lineup', label: 'Set lineup', legalInFormat: true },
    ],
    configurableFields: [],
    runtimeAuthority: [
      'lib/specialty-automation/handlers/pirateVampireHandler.ts',
      'lib/league-creation/canonical/normalizeConcept.ts',
    ],
  },
  {
    id: 'royal',
    label: 'Royal',
    ruleVersion: '1.0.0',
    formatRulesConcept: null,
    aliasTags: ['royal'],
    flattenedOnto: 'dynasty',
    supportedSports: ['NFL'],
    summary: 'A dynasty-shelled format variant, registered in specialty automation.',
    elimination: null,
    tiebreak: null,
    playoffs: null,
    phases: [{ id: 'regular', label: 'Season', summary: 'Dynasty roster rules with the Royal variant applied.' }],
    actions: [
      { id: 'trade', label: 'Trade', legalInFormat: true },
      { id: 'set_lineup', label: 'Set lineup', legalInFormat: true },
    ],
    configurableFields: [],
    runtimeAuthority: [
      'lib/specialty-automation/handlers/royalHandler.ts',
      'lib/league-creation/canonical/normalizeConcept.ts',
    ],
  },
  {
    /*
     * 🛑 A MODIFIER, NOT A FORMAT, AND THE CATALOG SAYS SO IN A FIELD RATHER
     * THAN IN PROSE. `MODIFIER_ALIASES` in leagueFormatRules.ts is the
     * authority, and the measurement recorded there is that treating this as a
     * format demotes 97 production dynasty leagues to redraft. The acceptance
     * scenario "IDP does not erase dynasty" is this entry's reason to exist:
     * `formatRulesConcept: null` and `flattenedOnto: null` mean it never
     * replaces a base format, it accompanies one.
     */
    id: 'idp',
    label: 'IDP (individual defensive players)',
    ruleVersion: '1.0.0',
    formatRulesConcept: null,
    aliasTags: ['idp'],
    flattenedOnto: null,
    supportedSports: ['NFL'],
    summary:
      'A scoring configuration that adds individual defensive players. It sits on ANY base format and replaces none of them — a dynasty IDP league is still a dynasty league.',
    elimination: null,
    tiebreak: null,
    playoffs: null,
    phases: [],
    actions: [],
    configurableFields: ['IDP scoring weights', 'IDP roster slots'],
    runtimeAuthority: ['lib/idp/', 'lib/trade-intel/leagueFormatRules.ts (MODIFIER_ALIASES)'],
  },
  {
    id: 'salary_cap',
    label: 'Salary Cap',
    ruleVersion: '1.0.0',
    formatRulesConcept: null,
    aliasTags: [],
    flattenedOnto: null,
    supportedSports: ['NFL'],
    summary: 'Rosters are bound by a salary cap with contracts, and players are acquired at auction.',
    elimination: null,
    tiebreak: null,
    playoffs: null,
    phases: [
      { id: 'auction', label: 'Auction', summary: 'Players are bid on against the cap.' },
      { id: 'regular', label: 'Season', summary: 'Cap compliance is continuous; contracts carry.' },
    ],
    actions: [
      { id: 'trade', label: 'Trade', legalInFormat: true, note: 'A trade must leave both rosters cap-compliant.' },
      { id: 'auction_bid', label: 'Auction bid', legalInFormat: true },
      { id: 'set_lineup', label: 'Set lineup', legalInFormat: true },
    ],
    configurableFields: ['cap amount', 'contract lengths'],
    runtimeAuthority: ['lib/salary-cap/'],
  },
  {
    id: 'keeper',
    label: 'Keeper',
    ruleVersion: '1.0.0',
    formatRulesConcept: 'keeper',
    aliasTags: [],
    flattenedOnto: null,
    supportedSports: ['NFL'],
    summary:
      'A redraft league where a limited number of players carry over, at a cost that usually escalates each year they are held.',
    elimination: null,
    tiebreak: null,
    playoffs: null,
    phases: [
      { id: 'keeper_decision', label: 'Keeper decisions', summary: 'Which players to retain, and at what cost.' },
      { id: 'draft', label: 'Draft', summary: 'Kept players consume their cost; the rest of the roster is drafted.' },
      { id: 'regular', label: 'Season', summary: 'Standard weekly play.' },
    ],
    actions: [
      {
        id: 'trade',
        label: 'Trade',
        legalInFormat: true,
        note: 'A player’s market value is NOT his trade value here — what you acquire is the player MINUS what he costs to keep. Whether future picks are tradeable differs by league and is frequently unknown.',
      },
      { id: 'waiver_claim', label: 'Waiver claim', legalInFormat: true },
      { id: 'set_lineup', label: 'Set lineup', legalInFormat: true },
    ],
    configurableFields: ['maxKeepers', 'keeperCostSystem', 'keeperRoundPenalty', 'futurePicksTradeable'],
    runtimeAuthority: ['lib/trade-intel/leagueFormatRules.ts (keeperSurplus, keeperDriftNote)'],
  },
  {
    id: 'dynasty',
    label: 'Dynasty',
    ruleVersion: '1.0.0',
    formatRulesConcept: 'dynasty',
    aliasTags: [],
    flattenedOnto: null,
    supportedSports: ['NFL'],
    summary: 'Full rosters carry over every year, and future rookie picks are real tradeable assets.',
    elimination: null,
    tiebreak: null,
    playoffs: null,
    phases: [
      { id: 'offseason', label: 'Off-season', summary: 'Rookie draft, and the deepest part of the trade market.' },
      { id: 'regular', label: 'Regular season', summary: 'Weekly play against a long-horizon roster.' },
    ],
    actions: [
      { id: 'trade', label: 'Trade', legalInFormat: true, note: 'Future picks are real, tradeable assets.' },
      { id: 'waiver_claim', label: 'Waiver claim', legalInFormat: true },
      { id: 'set_lineup', label: 'Set lineup', legalInFormat: true },
    ],
    configurableFields: [],
    runtimeAuthority: ['lib/trade-intel/leagueFormatRules.ts', 'lib/dynasty-core/'],
  },
  {
    id: 'redraft',
    label: 'Redraft',
    ruleVersion: '1.0.0',
    formatRulesConcept: 'redraft',
    aliasTags: [],
    flattenedOnto: null,
    supportedSports: ['NFL', 'NBA', 'NHL', 'MLB'],
    summary: 'Rosters reset every year. The season is the whole horizon.',
    elimination: null,
    tiebreak: null,
    playoffs: null,
    phases: [
      { id: 'draft', label: 'Draft', summary: 'The full roster is drafted fresh.' },
      { id: 'regular', label: 'Regular season', summary: 'Weekly head-to-head play.' },
      { id: 'playoffs', label: 'Playoffs', summary: 'League-configured playoff bracket.' },
    ],
    actions: [
      {
        id: 'trade',
        label: 'Trade',
        legalInFormat: true,
        note: 'FUTURE ROOKIE PICKS DO NOT EXIST in a redraft league. A deal containing one is not cheap, it is impossible.',
      },
      { id: 'waiver_claim', label: 'Waiver claim', legalInFormat: true },
      { id: 'set_lineup', label: 'Set lineup', legalInFormat: true },
    ],
    configurableFields: [],
    runtimeAuthority: ['lib/trade-intel/leagueFormatRules.ts'],
  },
  {
    id: 'best_ball',
    label: 'Best Ball',
    ruleVersion: '1.0.0',
    formatRulesConcept: null,
    aliasTags: [],
    flattenedOnto: null,
    supportedSports: ['NFL'],
    summary: 'Optimal lineups are scored automatically. There is no weekly lineup decision.',
    elimination: null,
    tiebreak: null,
    playoffs: null,
    phases: [
      { id: 'draft', label: 'Draft', summary: 'The draft is the entire game — there are no in-season lineup calls.' },
      { id: 'regular', label: 'Season', summary: 'Your best lineup is scored for you each week.' },
    ],
    actions: [
      {
        id: 'set_lineup',
        label: 'Set lineup',
        legalInFormat: false,
        note: 'Lineups are scored optimally and automatically. There is nothing to set.',
      },
      { id: 'trade', label: 'Trade', legalInFormat: false, note: 'Best ball leagues are typically draft-and-hold.' },
    ],
    configurableFields: [],
    runtimeAuthority: ['lib/best-ball-war-room/'],
  },
]

const BY_ID: ReadonlyMap<string, ConceptCatalogEntry> = new Map(ENTRIES.map((e) => [e.id, e]))

export function listConcepts(): readonly ConceptCatalogEntry[] {
  return ENTRIES
}

export function getConceptById(id: string | null | undefined): ConceptCatalogEntry | null {
  return BY_ID.get(String(id ?? '').trim().toLowerCase()) ?? null
}

/**
 * The catalog entry for a `LeagueConcept` returned by `readFormatRules`.
 *
 * ⚠ RETURNS NULL RATHER THAN A FALLBACK. `readFormatRules` can return `other`,
 * and there is no honest catalog entry for "we could not tell". Null means the
 * caller explains nothing, which is correct; falling back to `redraft` would
 * state redraft rules about a league we failed to classify.
 */
export function getConceptForFormat(concept: LeagueConcept | string | null | undefined): ConceptCatalogEntry | null {
  if (!concept) return null
  return ENTRIES.find((e) => e.formatRulesConcept === concept) ?? null
}

/**
 * Catalog entries indicated by a league's alias tags.
 *
 * ⚠ RETURNS ALL MATCHES, INCLUDING MODIFIERS. A dynasty IDP league yields the
 * `idp` entry here; deciding that `idp` does not REPLACE dynasty is
 * `readFormatRules`' job, not this function's. Callers get the full list and
 * the resolver separates format from modifier.
 */
export function getConceptsForAliasTags(tags: readonly string[]): ConceptCatalogEntry[] {
  const wanted = new Set(tags.map((t) => String(t ?? '').trim().toLowerCase()).filter(Boolean))
  if (wanted.size === 0) return []
  return ENTRIES.filter((e) => e.aliasTags.some((a) => wanted.has(a)))
}
