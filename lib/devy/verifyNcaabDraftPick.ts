import type { PrismaClient } from '@prisma/client'
import { currentNcaabRosterEvidence } from './ncaabRosterPool'
import { ESPN_NCAAB_DEVY_ID_PREFIX } from './ncaabRosterEvidence'

type Db = Pick<PrismaClient, 'devyPlayer' | 'sportsDataCache'>

/** Check a specific basketball college draft pick against both its stored player and current roster evidence. */
export async function verifyNcaabCollegeDraftPick(db: Db, input: { playerId: string | null | undefined; playerName: string; position: string; now: Date }): Promise<boolean> {
  const id = input.playerId ?? ''
  if (!id.startsWith(ESPN_NCAAB_DEVY_ID_PREFIX) || !/^\d+$/.test(id.slice(ESPN_NCAAB_DEVY_ID_PREFIX.length))) return false
  const [row, evidence] = await Promise.all([
    db.devyPlayer.findUnique({ where: { id }, select: { id: true, name: true, position: true, school: true, sport: true, source: true, devyEligible: true, graduatedToNFL: true } }),
    currentNcaabRosterEvidence(db, input.now),
  ])
  const athlete = evidence.athletes.find((item) => item.id === id)
  const key = (value: string) => value.trim().toLocaleLowerCase('en-US')
  return Boolean(row && athlete && row.sport === 'NCAAB' && row.source === 'espn_ncaab_roster' && row.devyEligible && !row.graduatedToNFL &&
    key(row.name) === key(athlete.name) && key(input.playerName) === key(row.name) &&
    key(row.position) === key(athlete.position) && key(input.position) === key(row.position) && key(row.school) === key(athlete.school))
}
