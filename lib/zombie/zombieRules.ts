import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { getZombieSportConfig } from '@/lib/zombie/sportRulesConfig'
import { readZombieRuleOverrides, type WhispererDefeatRule } from '@/lib/zombie/zombieLeagueRules'

export type ZombieRulesResolved = {
  sport: string
  bashingThreshold: number
  maulingThreshold: number
  weaponShieldThreshold: number
  weaponAmbushThreshold: number
  reviveThreshold: number
  serumMaxHold: number
  lineupLockDesc: string | null
}

const NFL_LOCK = 'Thursday 8:15 PM ET earliest kickoff for NFL scoring week.'

export async function getZombieRulesForSport(sportRaw: string): Promise<ZombieRulesResolved> {
  const sport = normalizeToSupportedSport(sportRaw)
  const row = await prisma.zombieRulesTemplate.findUnique({ where: { sport } })
  /*
   * 🛑 THE FALLBACK WAS 30/50 FOR EVERY SPORT — NFL MARGINS. `zombie_rules_templates` is filled only by
   * `seedZombieRulesTemplates`, which nothing calls, so a missing row is the normal case and an NBA
   * week (team totals in the hundreds) bashed on nearly every win. The fallback is now the sport's
   * own line from `sportRulesConfig`, the same numbers the generated rules page shows the league.
   */
  const sportCfg = getZombieSportConfig(sport)
  return {
    sport,
    bashingThreshold: row?.bashingThreshold ?? sportCfg.bashingThreshold,
    maulingThreshold: row?.maulingThreshold ?? sportCfg.maulingThreshold,
    weaponShieldThreshold: row?.weaponShieldThreshold ?? 100,
    weaponAmbushThreshold: row?.weaponAmbushThreshold ?? 120,
    reviveThreshold: row?.reviveThreshold ?? 3,
    serumMaxHold: row?.serumMaxHold ?? 5,
    lineupLockDesc: row?.lineupLockDesc ?? (sport === 'NFL' ? NFL_LOCK : 'First game of the scoring period.'),
  }
}

export type ZombieLeagueRulesResolved = ZombieRulesResolved & {
  bashDecisionHours: number
  bombEnabled: boolean
  whispererDefeatRule: WhispererDefeatRule
  /** Which keys this league overrides, so an editor can tell "the sport's number" from "set here". */
  overridden: string[]
}

/**
 * The rules a LEAGUE plays by: the sport's rules with the commish's overrides from
 * `League.settings.zombie_rules` on top (lib/zombie/zombieLeagueRules.ts). Every live engine that
 * knows its league should call this rather than `getZombieRulesForSport`, or a commish's change is
 * shown in settings and ignored at resolution.
 */
export async function getZombieRulesForLeague(leagueId: string, sportRaw: string): Promise<ZombieLeagueRulesResolved> {
  const [base, league] = await Promise.all([
    getZombieRulesForSport(sportRaw),
    prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } }),
  ])
  const o = readZombieRuleOverrides(league?.settings)
  return {
    ...base,
    bashingThreshold: o.bashingThreshold ?? base.bashingThreshold,
    maulingThreshold: o.maulingThreshold ?? base.maulingThreshold,
    weaponShieldThreshold: o.weaponShieldThreshold ?? base.weaponShieldThreshold,
    weaponAmbushThreshold: o.weaponAmbushThreshold ?? base.weaponAmbushThreshold,
    reviveThreshold: o.reviveThreshold ?? base.reviveThreshold,
    serumMaxHold: o.serumMaxHold ?? base.serumMaxHold,
    bashDecisionHours: o.bashDecisionHours ?? 48,
    bombEnabled: o.bombEnabled ?? true,
    whispererDefeatRule: o.whispererDefeatRule ?? 'commissioner_decides',
    overridden: Object.keys(o),
  }
}
