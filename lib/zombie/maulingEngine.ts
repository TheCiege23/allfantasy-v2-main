import { prisma } from '@/lib/prisma'
import { getZombieRulesForSport } from '@/lib/zombie/zombieRules'
import { notifyCommissioner, notifyZombiePlayer } from '@/lib/zombie/commissionerNotificationService'
import { queueAnimation } from '@/lib/zombie/animationEngine'
import { handleWhispererDefeat } from '@/lib/zombie/whispererEngine'

async function statusForRedraftOwner(leagueId: string, ownerId: string): Promise<string> {
  const roster = await prisma.roster.findFirst({ where: { leagueId, platformUserId: ownerId } })
  if (!roster) return 'Survivor'
  const row = await prisma.zombieLeagueTeam.findUnique({
    where: { leagueId_rosterId: { leagueId, rosterId: roster.id } },
  })
  return row?.status ?? 'Survivor'
}

function maulType(mauler: string, victim: string): string {
  const M = mauler.toLowerCase()
  const V = victim.toLowerCase()
  const horde = M.includes('zombie') || M.includes('whisperer')
  if (!horde) return 'zombie_mauls_survivor'
  if (M.includes('zombie') && V.includes('survivor')) return 'zombie_mauls_survivor'
  if (M.includes('zombie') && V.includes('zombie')) return 'zombie_mauls_zombie'
  if (M.includes('zombie') && V.includes('whisperer')) return 'zombie_mauls_whisperer'
  if (M.includes('whisperer') && V.includes('survivor')) return 'zombie_mauls_survivor'
  if (M.includes('whisperer') && V.includes('zombie')) return 'zombie_mauls_zombie'
  if (M.includes('whisperer') && V.includes('whisperer')) return 'zombie_mauls_zombie'
  return 'zombie_mauls_survivor'
}

export async function detectAndProcessMaulings(
  leagueId: string,
  week: number,
  zombieLeagueId: string,
): Promise<unknown[]> {
  const z = await prisma.zombieLeague.findUnique({ where: { id: zombieLeagueId } })
  if (!z) return []

  const rules = await getZombieRulesForSport(z.sport)
  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId, season: z.season },
  })
  if (!season) return []

  const matchups = await prisma.redraftMatchup.findMany({
    where: { seasonId: season.id, week },
  })

  const out: unknown[] = []
  for (const m of matchups) {
    if (!m.awayRosterId) continue
    const hs = m.homeScore ?? 0
    const as = m.awayScore ?? 0
    const margin = Math.abs(hs - as)
    if (margin < rules.maulingThreshold) continue

    const homeR = await prisma.redraftRoster.findUnique({
      where: { id: m.homeRosterId },
      select: { ownerId: true },
    })
    const awayR = await prisma.redraftRoster.findUnique({
      where: { id: m.awayRosterId },
      select: { ownerId: true },
    })
    if (!homeR || !awayR) continue

    const homeWon = hs >= as
    const winOwner = homeWon ? homeR.ownerId : awayR.ownerId
    const loseOwner = homeWon ? awayR.ownerId : homeR.ownerId

    const ws = await statusForRedraftOwner(leagueId, winOwner)
    const ls = await statusForRedraftOwner(leagueId, loseOwner)
    const wsl = ws.toLowerCase()
    if (!wsl.includes('zombie') && !wsl.includes('whisperer')) continue

    const mt = maulType(ws, ls)
    const row = await prisma.zombieMaulingEvent.create({
      data: {
        leagueId,
        week,
        maulerUserId: winOwner,
        maulerStatus: ws,
        victimUserId: loseOwner,
        victimStatus: ls,
        maulerScore: homeWon ? hs : as,
        victimScore: homeWon ? as : hs,
        margin,
        maulingType: mt,
        lootMultiplier: 2,
      },
    })

    await queueAnimation(leagueId, week, 'mauling', winOwner, { margin, maulingType: mt }, undefined, loseOwner, 5000)

    await notifyCommissioner(
      leagueId,
      'mauling_occurred',
      `Mauling (week ${week})`,
      mt,
      { urgency: 'high', week, relatedEventId: row.id, relatedEventType: 'ZombieMaulingEvent' },
    )

    await notifyZombiePlayer(winOwner, 'mauling_win', 'Mauling result', {
      severity: 'medium',
      body: `💀 You mauled your opponent in Week ${week}.`,
      meta: { week, leagueId, maulingEventId: row.id },
    }).catch(() => {})

    if (mt === 'zombie_mauls_whisperer') {
      await handleWhispererDefeat(zombieLeagueId, winOwner, week, loseOwner)
      await prisma.zombieMaulingEvent.update({
        where: { id: row.id },
        data: { newWhispererTriggered: true },
      })
      await notifyCommissioner(leagueId, 'whisperer_overthrown', 'Whisperer mauled', 'Critical horde event.', {
        urgency: 'critical',
        week,
      })
    }

    out.push(row)
  }
  return out
}
