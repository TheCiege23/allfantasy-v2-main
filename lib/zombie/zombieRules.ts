import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { DEFAULT_ENGINE_WEAPONS, getZombieSportConfig } from '@/lib/zombie/sportRulesConfig'

export type ZombieRulesResolved = {
  sport: string
  bashingThreshold: number
  maulingThreshold: number
  /** Weekly score that earns a Knife. */
  weaponShieldThreshold: number
  /** Weekly score that earns a Bow. */
  weaponAmbushThreshold: number
  /** Winning margin that earns an Axe. No template column — sport config only. */
  weaponAxeMargin: number
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
  // Same story for weapons: 100/120 and a 20-point Axe were NFL lines applied to every sport. See
  // `EngineWeaponThresholds` in sportRulesConfig for the NBA calibration.
  const weapons = sportCfg.engineWeapons ?? DEFAULT_ENGINE_WEAPONS
  return {
    sport,
    bashingThreshold: row?.bashingThreshold ?? sportCfg.bashingThreshold,
    maulingThreshold: row?.maulingThreshold ?? sportCfg.maulingThreshold,
    weaponShieldThreshold: row?.weaponShieldThreshold ?? weapons.knifeScore,
    weaponAmbushThreshold: row?.weaponAmbushThreshold ?? weapons.bowScore,
    weaponAxeMargin: weapons.axeWinMargin,
    reviveThreshold: row?.reviveThreshold ?? 3,
    serumMaxHold: row?.serumMaxHold ?? 5,
    lineupLockDesc: row?.lineupLockDesc ?? (sport === 'NFL' ? NFL_LOCK : 'First game of the scoring period.'),
  }
}
