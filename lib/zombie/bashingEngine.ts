import { prisma } from '@/lib/prisma'
import { getZombieRulesForSport } from '@/lib/zombie/zombieRules'
import { notifyCommissioner, notifyZombiePlayer } from '@/lib/zombie/commissionerNotificationService'
import { queueAnimation } from '@/lib/zombie/animationEngine'
import { setZombie } from '@/lib/zombie/ZombieOwnerStatusService'
import { appendZombieAudit } from '@/lib/zombie/ZombieAuditLog'

async function statusForRedraftOwner(leagueId: string, ownerId: string): Promise<string> {
  const roster = await prisma.roster.findFirst({ where: { leagueId, platformUserId: ownerId } })
  if (!roster) return 'Survivor'
  const row = await prisma.zombieLeagueTeam.findUnique({
    where: { leagueId_rosterId: { leagueId, rosterId: roster.id } },
  })
  return row?.status ?? 'Survivor'
}

async function displayNameForPlatformUser(leagueId: string, platformUserId: string): Promise<string> {
  const roster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId },
    select: { id: true },
  })
  if (!roster) return platformUserId
  const zt = await prisma.zombieLeagueTeam.findUnique({
    where: { leagueId_rosterId: { leagueId, rosterId: roster.id } },
    select: { fantasyTeamName: true, displayName: true },
  })
  return zt?.fantasyTeamName || zt?.displayName || platformUserId
}

function bashType(w: string, l: string): string {
  const W = w.toLowerCase()
  const L = l.toLowerCase()
  if (W.includes('survivor') && L.includes('survivor')) return 'survivor_bashes_survivor'
  if (W.includes('survivor') && L.includes('zombie')) return 'survivor_bashes_zombie'
  if (W.includes('survivor') && L.includes('whisperer')) return 'survivor_bashes_whisperer'
  if (W.includes('zombie') && L.includes('survivor')) return 'zombie_bashes_survivor'
  if (W.includes('zombie') && L.includes('zombie')) return 'zombie_bashes_zombie'
  if (W.includes('zombie') && L.includes('whisperer')) return 'zombie_bashes_whisperer'
  return 'survivor_bashes_survivor'
}

export async function detectAndProcessBashings(
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

  const created: unknown[] = []
  for (const m of matchups) {
    if (!m.awayRosterId) continue
    const hs = m.homeScore ?? 0
    const as = m.awayScore ?? 0
    const margin = Math.abs(hs - as)
    if (margin < rules.bashingThreshold) continue

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
    const bt = bashType(ws, ls)

    const row = await prisma.zombieBashingEvent.create({
      data: {
        leagueId,
        week,
        winnerUserId: winOwner,
        loserUserId: loseOwner,
        winnerStatus: ws,
        loserStatus: ls,
        winnerScore: homeWon ? hs : as,
        loserScore: homeWon ? as : hs,
        margin,
        bashingType: bt,
        requiresDecision: bt === 'survivor_bashes_survivor',
        decisionDeadline: bt === 'survivor_bashes_survivor' ? new Date(Date.now() + 48 * 3600 * 1000) : null,
        serumAwarded: bt === 'survivor_bashes_zombie',
      },
    })

    await queueAnimation(leagueId, week, 'bashing', winOwner, { margin, bashingType: bt }, undefined, loseOwner)
    await notifyCommissioner(
      leagueId,
      'bashing_occurred',
      `Bashing detected (week ${week})`,
      `${bt} — margin ${margin.toFixed(1)}`,
      { week, relatedEventId: row.id, relatedEventType: 'ZombieBashingEvent' },
    )

    if (bt === 'survivor_bashes_survivor' && row.requiresDecision && row.decisionDeadline) {
      const loserNm = await displayNameForPlatformUser(leagueId, loseOwner)
      await notifyZombiePlayer(winOwner, 'bashing_decision', 'Bashing decision needed', {
        severity: 'high',
        body: `🔥 You bashed ${loserNm} by ${margin.toFixed(1)} pts. Spare or infect? Decide before the deadline.`,
        meta: { bashingEventId: row.id, week, leagueId },
      }).catch(() => {})
    }

    if (bt === 'survivor_bashes_whisperer') {
      const wr = await prisma.whispererRecord.findUnique({ where: { zombieLeagueId } })
      if (wr?.userId === loseOwner) {
        await prisma.whispererRecord.update({
          where: { id: wr.id },
          data: { ambushesRemaining: Math.max(0, wr.ambushesRemaining - 1) },
        })
      } else {
        const co = await prisma.zombieCoWhisperer.findUnique({
          where: { zombieLeagueId_userId: { zombieLeagueId, userId: loseOwner } },
        })
        if (co) await prisma.zombieCoWhisperer.update({
          where: { id: co.id },
          data: { ambushesRemaining: Math.max(0, co.ambushesRemaining - 1) },
        })
      }
      await notifyCommissioner(leagueId, 'bashing_occurred', 'Survivor bashed Whisperer', 'High-impact bash', {
        urgency: 'high',
        week,
      })
    }

    created.push(row)
  }
  return created
}

export async function resolveBashingDecision(
  bashingEventId: string,
  decision: 'spare' | 'infect',
  decidingUserId: string,
): Promise<void> {
  const ev = await prisma.zombieBashingEvent.findUnique({ where: { id: bashingEventId } })
  if (!ev) throw new Error('Event not found')
  if (ev.winnerUserId !== decidingUserId) throw new Error('Only winner decides')
  if (ev.decisionMade) throw new Error('Already decided')
  if (ev.decisionDeadline && ev.decisionDeadline < new Date()) throw new Error('Decision window closed')

  const z = await prisma.zombieLeague.findUnique({ where: { leagueId: ev.leagueId } })

  if (decision === 'infect' && z) {
    const loserRoster = await prisma.roster.findFirst({
      where: { leagueId: ev.leagueId, platformUserId: ev.loserUserId },
    })
    const winRoster = await prisma.roster.findFirst({
      where: { leagueId: ev.leagueId, platformUserId: ev.winnerUserId },
    })
    if (loserRoster && winRoster) {
      await setZombie(ev.leagueId, loserRoster.id, ev.week, winRoster.id, z.id)
    }
    await appendZombieAudit({
      leagueId: ev.leagueId,
      zombieLeagueId: z?.id ?? null,
      eventType: 'infection',
      metadata: { from: 'bashing_decision', bashingEventId },
    })
  }

  await prisma.zombieBashingEvent.update({
    where: { id: bashingEventId },
    data: {
      decisionMade: decision,
      decisionMadeAt: new Date(),
      resolvedAt: new Date(),
    },
  })
}

export async function processExpiredBashingDecisions(leagueId: string): Promise<void> {
  const now = new Date()
  const open = await prisma.zombieBashingEvent.findMany({
    where: {
      leagueId,
      requiresDecision: true,
      decisionMade: null,
      decisionDeadline: { lt: now },
    },
  })
  for (const ev of open) {
    await prisma.zombieBashingEvent.update({
      where: { id: ev.id },
      data: {
        decisionMade: 'spare',
        decisionMadeAt: now,
        defaultedToRule: true,
        resolvedAt: now,
      },
    })
    await notifyCommissioner(leagueId, 'decision_defaulted', 'Bashing decision defaulted', 'Window expired — spared.', {
      relatedEventId: ev.id,
      relatedEventType: 'ZombieBashingEvent',
    })
    await notifyZombiePlayer(ev.winnerUserId, 'bashing_defaulted', 'Bashing decision', {
      severity: 'low',
      body: 'Decision window expired. Default applied (spare).',
      meta: { bashingEventId: ev.id, leagueId },
    }).catch(() => {})
  }
}

export async function processExpiredBashingDecisionsForAll(): Promise<void> {
  const leagues = await prisma.zombieLeague.findMany({
    where: { status: { in: ['active', 'registering'] } },
    select: { leagueId: true },
  })
  for (const z of leagues) {
    await processExpiredBashingDecisions(z.leagueId)
  }
}
