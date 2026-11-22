import type { PrismaClient } from '@prisma/client'

const ALIASES: Record<string, Record<string, string>> = {
  NBA: { GS: 'GSW', NY: 'NYK', NO: 'NOP', SA: 'SAS', UTAH: 'UTA', BRK: 'BKN', PHO: 'PHX' },
  NHL: { NJ: 'NJD', LA: 'LAK', SJ: 'SJS', TB: 'TBL', MON: 'MTL', WAS: 'WSH', UTAH: 'UTA' },
  MLB: { CHW: 'CWS', KCR: 'KC', TBR: 'TB', SDP: 'SD', SFG: 'SF', WAS: 'WSH', OAK: 'ATH' },
}
export function dailyTeamCode(sport: string, team: string | null | undefined, names?: ReadonlyMap<string, string>) {
  const token = String(team ?? '').trim().toUpperCase()
  const code = names?.get(token) ?? token
  return ALIASES[sport.toUpperCase()]?.[code] ?? code
}

/** Use committed, sport-scoped team identities; never derive initials from a
 * display name (New York's two baseball teams must remain distinct). */
export async function readDailyTeamNames(db: PrismaClient, sport: string) {
  const names = new Map<string, string>()
  const conflicts = new Set<string>()
  const rows = await db.sportsTeam.findMany({ where: { sport }, select: { name: true, shortName: true } })
  for (const row of rows) {
    if (!row.shortName) continue
    const name = row.name.trim().toUpperCase()
    const code = dailyTeamCode(sport, row.shortName)
    if (names.has(name) && names.get(name) !== code) conflicts.add(name)
    else names.set(name, code)
  }
  for (const name of conflicts) names.delete(name)
  return names
}
