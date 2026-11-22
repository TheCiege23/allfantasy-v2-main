/**
 * Specialty League Registry — maps league variant and wizard type to specs.
 * Add new league types here after implementing their spec (config, engine, UI, AI).
 *
 * PROMPT 336 — AllFantasy Specialty League Factory Template.
 */

import type { SpecialtyLeagueId, SpecialtyLeagueSpec } from './types'
import {
  isGuillotineLeague,
  getGuillotineConfig,
  upsertGuillotineConfig,
} from '@/lib/guillotine/GuillotineLeagueConfig'
import {
  GUILLOTINE_LEAGUE_IMAGE,
  GUILLOTINE_FIRST_ENTRY_VIDEO,
  GUILLOTINE_INTRO_VIDEO,
} from '@/lib/guillotine/constants'
import { isRosterChopped, getChoppedRosterIds } from '@/lib/guillotine/guillotineGuard'
import {
  isSurvivorLeague,
  getSurvivorConfig,
  upsertSurvivorConfig,
} from '@/lib/survivor/SurvivorLeagueConfig'
import { SURVIVOR_LEAGUE_INTRO_VIDEO } from '@/lib/survivor/constants'
import { getExcludedRosterIdsForSurvivor, isRosterCurrentlyEliminated } from '@/lib/survivor/SurvivorRosterState'
import {
  isZombieLeague,
  getZombieLeagueConfig,
  upsertZombieLeagueConfig,
} from '@/lib/zombie/ZombieLeagueConfig'
import {
  isDevyLeague,
  getDevyConfig,
  upsertDevyConfig,
} from '@/lib/devy/DevyLeagueConfig'
import {
  isC2CLeague,
  getC2CConfig,
  upsertC2CConfig,
} from '@/lib/merged-devy-c2c/C2CLeagueConfig'
import {
  isTournamentLeague,
  getTournamentConfigForLeague,
  upsertTournamentConfig,
} from '@/lib/tournament-mode/TournamentConfigService'
import {
  isBigBrotherLeague,
  getBigBrotherConfig,
  upsertBigBrotherConfig,
} from '@/lib/big-brother/BigBrotherLeagueConfig'
import { isEliminated, getExcludedRosterIds } from '@/lib/big-brother/bigBrotherGuard'
import {
  isIdpLeague,
  getIdpLeagueConfig,
  upsertIdpLeagueConfig,
} from '@/lib/idp'

const registry = new Map<SpecialtyLeagueId, SpecialtyLeagueSpec>()

/** Register a specialty league spec. Call from module side-effect or from a central bootstrap. */
export function registerSpecialtyLeague(spec: SpecialtyLeagueSpec): void {
  registry.set(spec.id, spec)
}

/** Get spec by specialty id. */
export function getSpecialtySpec(id: SpecialtyLeagueId): SpecialtyLeagueSpec | undefined {
  return registry.get(id)
}

/** Get spec by League.leagueVariant (e.g. "guillotine"). IDP and DYNASTY_IDP both map to idp spec. */
export function getSpecialtySpecByVariant(variant: string | null): SpecialtyLeagueSpec | undefined {
  if (!variant) return undefined
  let v = variant.toLowerCase().trim()
  if (v === 'dynasty_idp') v = 'idp'
  for (const spec of registry.values()) {
    if (spec.leagueVariant.toLowerCase() === v) return spec
  }
  return undefined
}

/** Get spec by wizard league type id (e.g. "guillotine" from LeagueTypeId). */
export function getSpecialtySpecByWizardType(wizardLeagueTypeId: string): SpecialtyLeagueSpec | undefined {
  const id = wizardLeagueTypeId.toLowerCase().trim()
  for (const spec of registry.values()) {
    if (spec.wizardLeagueTypeId.toLowerCase() === id) return spec
  }
  return undefined
}

/** All registered specialty league ids. */
export function listSpecialtyLeagueIds(): SpecialtyLeagueId[] {
  return Array.from(registry.keys())
}

/** All registered specs (for admin or docs). */
export function listSpecialtySpecs(): SpecialtyLeagueSpec[] {
  return Array.from(registry.values())
}

// --- Guillotine registration (reference implementation) ---

function registerGuillotine(): void {
  registerSpecialtyLeague({
    id: 'guillotine',
    leagueVariant: 'guillotine',
    label: 'Guilly',
    wizardLeagueTypeId: 'guillotine',

    detect: isGuillotineLeague,
    getConfig: getGuillotineConfig,
    upsertConfig: upsertGuillotineConfig,

    assets: () => ({
      leagueImage: GUILLOTINE_LEAGUE_IMAGE,
      firstEntryVideo: GUILLOTINE_FIRST_ENTRY_VIDEO,
      introVideo: GUILLOTINE_INTRO_VIDEO,
    }),

    firstEntryModal: '@/components/guillotine/GuillotineFirstEntryModal',
    homeComponent: '@/components/guillotine/GuillotineHome',

    summaryRoutePath: '/api/leagues/[leagueId]/guillotine/summary',
    aiRoutePath: '/api/leagues/[leagueId]/guillotine/ai',

    rosterGuard: async (leagueId, rosterId) => !(await isRosterChopped(leagueId, rosterId)),
    getExcludedRosterIds: getChoppedRosterIds,

    // AI: implemented in lib/guillotine/ai and route /api/leagues/[leagueId]/guillotine/ai; entitlement guillotine_ai.
    // Automation/event log: invoked by cron or manual triggers (see lib/guillotine).
    // Commissioner override: in guillotine engine; can be wired to commissionerActions if desired.
  })
}

function registerSurvivor(): void {
  registerSpecialtyLeague({
    id: 'survivor',
    leagueVariant: 'survivor',
    label: 'Survivor',
    wizardLeagueTypeId: 'survivor',

    detect: isSurvivorLeague,
    getConfig: getSurvivorConfig,
    upsertConfig: upsertSurvivorConfig,

    assets: () => ({
      leagueImage: '/league-type-survivor.png',
      firstEntryVideo: SURVIVOR_LEAGUE_INTRO_VIDEO,
      introVideo: SURVIVOR_LEAGUE_INTRO_VIDEO,
    }),

    firstEntryModal: '@/components/survivor/SurvivorFirstEntryModal',
    homeComponent: '@/components/survivor/SurvivorHome',

    summaryRoutePath: '/api/leagues/[leagueId]/survivor/summary',
    aiRoutePath: '/api/leagues/[leagueId]/survivor/ai',

    capabilities: {
      tribeOrchestration: true,
      hiddenPowerSystem: true,
      privateVoting: true,
      eliminationPipeline: true,
      sidecarLeague: true,
      tokenizedReturn: true,
      miniGameRegistry: true,
      mergeJuryPhases: true,
      officialCommandParsing: true,
      aiHostHooks: true,
    },
    rosterGuard: async (leagueId, rosterId) => !(await isRosterCurrentlyEliminated(leagueId, rosterId)),
    getExcludedRosterIds: getExcludedRosterIdsForSurvivor,

    // AI: lib/survivor/ai; entitlement survivor_ai. Automation: council close, token award, jury enrollment in engine.
  })
}

function registerZombie(): void {
  registerSpecialtyLeague({
    id: 'zombie',
    leagueVariant: 'zombie',
    label: 'Zombie',
    wizardLeagueTypeId: 'zombie',

    detect: isZombieLeague,
    getConfig: getZombieLeagueConfig,
    upsertConfig: upsertZombieLeagueConfig,

    assets: () => ({
      leagueImage: '/league-type-zombie.png',
      firstEntryVideo: '/league-type-zombie-intro.mp4',
      introVideo: '/league-type-zombie.mp4',
    }),

    firstEntryModal: undefined,
    homeComponent: '@/components/zombie/ZombieHome',

    summaryRoutePath: '/api/leagues/[leagueId]/zombie/summary',
    aiRoutePath: '/api/leagues/[leagueId]/zombie/ai',

    /*
     * 🛑 NO `rosterGuard`, ON PURPOSE. A roster guard answers "may this roster act AT ALL" — it gates
     * lineup saves, lineup locks and waiver claims, which is right for a chopped or voted-out team. A
     * Zombie is not out: it keeps setting lineups and claiming players. The guard that sat here checked
     * `zombieTradeBlocked`, so the moment a league carried `leagueVariant: 'zombie'` every Zombie would
     * have been locked out of its own lineup, while trades — which never consult this guard — stayed
     * open. The trade rule is enforced where trades are: `assertRosterTransactionsAllowed`.
     */

    capabilities: {
      statusTransformation: true,
      resourceInventoryLedger: true,
      oneToManyUniverse: true,
      crossLeagueStandings: true,
      promotionRelegationEngine: true,
      weeklyBoardGeneration: true,
      antiCollusionFlagRegistry: true,
      antiNeglectReplacementWorkflow: true,
      aiRecapHooks: true,
    },

    // AI: lib/zombie/ai; entitlement zombie_ai. Universe AI: /api/zombie-universe/[universeId]/ai.
    // Automation: finalize route → ZombieResultFinalizationService (infection, serum, weapon, winnings).
  })
}

function registerDevy(): void {
  registerSpecialtyLeague({
    id: 'devy',
    leagueVariant: 'devy_dynasty',
    label: 'Devy Dynasty',
    wizardLeagueTypeId: 'devy',

    detect: isDevyLeague,
    getConfig: getDevyConfig,
    upsertConfig: upsertDevyConfig,

    assets: () => ({
      leagueImage: '/league-type-devy.png',
      firstEntryVideo: '/league-type-devy-intro.mp4',
      introVideo: '/league-type-devy.mp4',
    }),

    firstEntryModal: '@/components/devy/DevyFirstEntryModal',
    homeComponent: '@/components/devy/DevyHome',

    summaryRoutePath: '/api/leagues/[leagueId]/devy/summary',
    aiRoutePath: '/api/leagues/[leagueId]/devy/ai',

    // No rosterGuard / getExcludedRosterIds for devy; all rosters can act. Optional: exclude if league phase locks.
  })
}

function registerC2C(): void {
  registerSpecialtyLeague({
    id: 'merged_devy_c2c',
    leagueVariant: 'merged_devy_c2c',
    label: 'Merged Devy / C2C',
    wizardLeagueTypeId: 'c2c',

    detect: isC2CLeague,
    getConfig: getC2CConfig,
    upsertConfig: upsertC2CConfig,

    assets: () => ({
      leagueImage: '/league-type-c2c.png',
      firstEntryVideo: '/league-type-c2c-intro.mp4',
      introVideo: '/league-type-c2c.mp4',
    }),

    firstEntryModal: '@/components/devy/DevyFirstEntryModal',
    homeComponent: '@/components/merged-devy-c2c/MergedDevyC2CHome',

    summaryRoutePath: '/api/leagues/[leagueId]/merged-devy-c2c/summary',
    aiRoutePath: '/api/leagues/[leagueId]/merged-devy-c2c/ai',
  })
}

function registerTournament(): void {
  registerSpecialtyLeague({
    id: 'tournament',
    leagueVariant: 'tournament_mode',
    label: 'Tournament Mode',
    wizardLeagueTypeId: 'tournament',

    detect: isTournamentLeague,
    getConfig: getTournamentConfigForLeague,
    upsertConfig: upsertTournamentConfig,

    assets: () => ({
      leagueImage: '/league-type-tournament.png',
      firstEntryVideo: '/league-type-tournament.mp4',
      introVideo: '/league-type-tournament.mp4',
    }),

    firstEntryModal: undefined,
    homeComponent: '@/components/tournament/TournamentLeagueHome',

    summaryRoutePath: '/api/tournament/[tournamentId]',
    aiRoutePath: '/api/tournament/[tournamentId]/ai',

    capabilities: {
      crossLeagueStandings: true,
    },
  })
}

function registerBigBrother(): void {
  registerSpecialtyLeague({
    id: 'big_brother',
    leagueVariant: 'big_brother',
    label: 'Big Brother',
    wizardLeagueTypeId: 'big_brother',

    detect: isBigBrotherLeague,
    getConfig: getBigBrotherConfig,
    upsertConfig: upsertBigBrotherConfig,

    assets: () => ({
      leagueImage: '/league-type-big-brother.png',
      firstEntryVideo: '/league-type-big-brother-intro.mp4',
      introVideo: '/league-type-big-brother.mp4',
    }),

    firstEntryModal: '@/components/big-brother/BigBrotherFirstEntryModal',
    homeComponent: '@/components/big-brother/BigBrotherHome',

    summaryRoutePath: '/api/leagues/[leagueId]/big-brother/summary',
    aiRoutePath: '/api/leagues/[leagueId]/big-brother/ai',

    rosterGuard: async (leagueId, rosterId) => !(await isEliminated(leagueId, rosterId)),
    getExcludedRosterIds,

    capabilities: {
      privateVoting: true,
      eliminationPipeline: true,
      mergeJuryPhases: true,
      aiHostHooks: true,
    },
  })
}

function registerIdp(): void {
  registerSpecialtyLeague({
    id: 'idp',
    leagueVariant: 'idp',
    label: 'IDP',
    wizardLeagueTypeId: 'idp',

    detect: isIdpLeague,
    getConfig: getIdpLeagueConfig,
    upsertConfig: upsertIdpLeagueConfig,

    assets: () => ({
      leagueImage: '/league-type-idp.png',
      firstEntryVideo: '/league-type-idp-intro.mp4',
      introVideo: '/league-type-idp.mp4',
    }),

    firstEntryModal: '@/components/idp/IDPFirstEntryModal',
    homeComponent: '@/components/idp/IDPHome',

    summaryRoutePath: '/api/leagues/[leagueId]/idp/config',
    aiRoutePath: null,

    capabilities: {
      // IDP: offense + defensive roster/scoring; no rosterGuard; draft/waiver/trade/rankings reuse standard flow.
    },
  })
}

registerGuillotine()
registerSurvivor()
registerZombie()
registerBigBrother()
registerIdp()
registerDevy()
registerC2C()
registerTournament()
