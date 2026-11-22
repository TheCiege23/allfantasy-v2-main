/**
 * ESM rebuild of `lib/roster-engine/RosterEngineRegistry.ts` for vitest.
 *
 * The production registry loads each sport's roster module with a CommonJS `require('../nfl-roster')`.
 * Next.js bundles that; under vitest a bare `require` cannot load a `.ts` file, so the post-create roster
 * bootstrap died with "Cannot find module '../nfl-roster'" and every simulated league silently fell back to
 * the generic redraft roster template. Existing tests mock the registry away entirely; the dynasty sim needs
 * the REAL roster services, so this builds the same registry from the same seven modules via `import()` and
 * calls the same exported functions by the same names. No roster logic lives here.
 */
import type { IRosterSportService, RosterSlotDefinition, RosterTemplateDefinition, SupportedRosterSport } from '@/lib/roster-engine/RosterEngineTypes'

type RosterModule = Record<string, any>

const SPORTS: Array<{ sport: SupportedRosterSport; token: string; load: () => Promise<RosterModule> }> = [
  { sport: 'NFL', token: 'Nfl', load: () => import('@/lib/nfl-roster') },
  { sport: 'NCAAF', token: 'Ncaaf', load: () => import('@/lib/ncaaf-roster') },
  { sport: 'NBA', token: 'Nba', load: () => import('@/lib/nba-roster') },
  { sport: 'NCAAB', token: 'Ncaab', load: () => import('@/lib/ncaab-roster') },
  { sport: 'MLB', token: 'Mlb', load: () => import('@/lib/mlb-roster') },
  { sport: 'NHL', token: 'Nhl', load: () => import('@/lib/nhl-roster') },
  { sport: 'SOCCER', token: 'Soccer', load: () => import('@/lib/soccer-roster') },
]

function serviceFor(sport: SupportedRosterSport, token: string, roster: RosterModule): IRosterSportService {
  const fn = (name: string) => {
    const f = roster[name]
    if (typeof f !== 'function') throw new Error(`roster registry (esm): ${sport} module has no ${name}`)
    return f
  }
  return {
    sport,
    async getConfig(leagueId: string) {
      const c = await fn(`getLeague${token}RosterConfig`)(leagueId)
      return { templateKey: c.templateKey, slots: c.slots, isCustom: c.isCustom, lastUpdatedAt: c.lastUpdatedAt, lastUpdatedBy: c.lastUpdatedBy }
    },
    async saveConfig(leagueId: string, payload: unknown) {
      await fn(`saveLeague${token}RosterConfig`)(leagueId, payload)
    },
    async applyDefaultOnCreate(leagueId: string, leagueType: unknown) {
      await fn(`applyDefault${token}RosterOnCreate`)(leagueId, leagueType)
    },
    getSlots: () => fn(`getAll${token}Slots`)() as RosterSlotDefinition[],
    getTemplates: () => roster[`${token.toUpperCase()}_ROSTER_TEMPLATES`] as RosterTemplateDefinition[],
    resolveDefaultTemplate: (leagueType: unknown) => fn(`resolve${token}RosterTemplate`)(leagueType) as RosterTemplateDefinition,
  } as IRosterSportService
}

export async function buildEsmRosterRegistryModule() {
  const services = new Map<SupportedRosterSport, IRosterSportService>()
  for (const { sport, token, load } of SPORTS) services.set(sport, serviceFor(sport, token, await load()))
  const registry = {
    getService(sport: string): IRosterSportService {
      const service = services.get(sport.toUpperCase() as SupportedRosterSport)
      if (!service) throw new Error(`Unsupported roster sport: ${sport}`)
      return service
    },
    isSupported(sport: string): boolean {
      return services.has(sport.toUpperCase() as SupportedRosterSport)
    },
  }
  return { getRosterEngineRegistry: () => registry }
}
