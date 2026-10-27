import type { ZombieWeeklyResolution } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { loadNativeWeekResults } from '@/lib/zombie/ZombieInfectionEngine'
import { computeWeeklyWinnings } from '@/lib/zombie/weeklyWinningsEngine'
import { getZombieRulesForSport, type ZombieRulesResolved } from '@/lib/zombie/zombieRules'

type ScoreRow = { homeUserId: string; awayUserId: string; homeScore: number; awayScore: number }
type CurrentRow = { id: string; homeRosterId: string; awayRosterId: string | null; homeScore: number; awayScore: number }

const key = (home: string, away: string | null) => `${home}:${away ?? ''}`
const winner = (home: number, away: number) => Math.sign(home - away)
const crossed = (before: number, after: number, threshold: number) =>
  (before >= threshold) !== (after >= threshold)

function highScorers(rows: ReadonlyArray<ScoreRow>): string {
  const high = Math.max(...rows.flatMap(row => [row.homeScore, row.awayScore]))
  return rows.flatMap(row => [
    ...(row.homeScore === high ? [row.homeUserId] : []),
    ...(row.awayScore === high ? [row.awayUserId] : []),
  ]).sort().join('|')
}

/**
 * A score-only correction may update the winnings ledger without replaying role or item engines.
 * The gate is intentionally strict: any change in an award, combat threshold, or winner must be
 * reconciled from a full pre-week snapshot instead.
 */
export function scoreOnlyCorrectionIsSafe(oldRows: ReadonlyArray<ScoreRow>, current: ReadonlyArray<CurrentRow>, rules: ZombieRulesResolved): boolean {
  if (!oldRows.length || oldRows.length !== current.length) return false
  const byPair = new Map(oldRows.map(row => [key(row.homeUserId, row.awayUserId), row]))
  if (byPair.size !== oldRows.length) return false
  const newRows: ScoreRow[] = []
  for (const row of current) {
    if (!row.awayRosterId || !Number.isFinite(row.homeScore) || !Number.isFinite(row.awayScore)) return false
    const old = byPair.get(key(row.homeRosterId, row.awayRosterId))
    if (!old) return false
    const oldMargin = Math.abs(old.homeScore - old.awayScore)
    const newMargin = Math.abs(row.homeScore - row.awayScore)
    if (winner(old.homeScore, old.awayScore) !== winner(row.homeScore, row.awayScore)) return false
    for (const threshold of [rules.bashingThreshold, rules.maulingThreshold, rules.weaponAxeMargin]) {
      if (crossed(oldMargin, newMargin, threshold)) return false
    }
    for (const threshold of [rules.weaponShieldThreshold, rules.weaponAmbushThreshold]) {
      if (crossed(old.homeScore, row.homeScore, threshold) || crossed(old.awayScore, row.awayScore, threshold)) return false
    }
    newRows.push({ homeUserId: row.homeRosterId, awayUserId: row.awayRosterId, homeScore: row.homeScore, awayScore: row.awayScore })
  }
  return highScorers(oldRows) === highScorers(newRows)
}

function oldScoreRows(resolution: ZombieWeeklyResolution): ScoreRow[] {
  if (!Array.isArray(resolution.matchupResults)) return []
  const rows: ScoreRow[] = []
  for (const raw of resolution.matchupResults) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    const row = raw as Record<string, unknown>
    if (typeof row.homeUserId !== 'string' || typeof row.awayUserId !== 'string' ||
        typeof row.homeScore !== 'number' || typeof row.awayScore !== 'number') return []
    rows.push({ homeUserId: row.homeUserId, awayUserId: row.awayUserId, homeScore: row.homeScore, awayScore: row.awayScore })
  }
  return rows
}

/** Returns null when the changed week needs full role/item reconciliation. */
export async function reconcileScoreOnlyCorrection(input: {
  zombieLeagueId: string
  leagueId: string
  seasonId: string
  sport: string
  week: number
  ownerUserId: string
  previous: ZombieWeeklyResolution
}): Promise<ZombieWeeklyResolution | null> {
  const { zombieLeagueId, leagueId, seasonId, sport, week, ownerUserId, previous } = input
  const [matchups, native, rules, newer] = await Promise.all([
    prisma.redraftMatchup.findMany({ where: { seasonId, week }, select: { id: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true } }),
    loadNativeWeekResults(leagueId, week, Number.NaN),
    getZombieRulesForSport(sport),
    prisma.zombieWeeklyResolution.findFirst({ where: { zombieLeagueId, week: { gt: week }, status: 'complete' }, select: { id: true } }),
  ])
  // loadNativeWeekResults needs the season year. The caller supplies the season id, so read the year
  // from the persisted season rather than estimating it from the wall clock.
  const season = await prisma.redraftSeason.findUnique({ where: { id: seasonId }, select: { season: true } })
  const weekResults = season ? await loadNativeWeekResults(leagueId, week, season.season) : null
  void native
  if (newer || !weekResults || weekResults.length !== matchups.length || weekResults.some(row => !row.final)) return null
  const oldRows = oldScoreRows(previous)
  if (!scoreOnlyCorrectionIsSafe(oldRows, matchups, rules)) return null

  const snapshot = matchups.map(row => ({ id: row.id, homeScore: row.homeScore, awayScore: row.awayScore }))
  try {
    return await prisma.$transaction(async tx => {
      const live = await tx.zombieWeeklyResolution.findUnique({ where: { zombieLeagueId_week: { zombieLeagueId, week } } })
      if (!live || live.status !== 'complete' || live.resolvedAt?.getTime() !== previous.resolvedAt?.getTime()) return null
      const nowRows = await tx.redraftMatchup.findMany({ where: { seasonId, week }, select: { id: true, homeScore: true, awayScore: true } })
      if (nowRows.length !== snapshot.length || nowRows.some(row => {
        const seen = snapshot.find(item => item.id === row.id)
        return !seen || seen.homeScore !== row.homeScore || seen.awayScore !== row.awayScore
      })) return null

      const rosters = await tx.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } })
      const byUser = new Map(rosters.filter(row => row.platformUserId).map(row => [row.platformUserId!, row.id]))
      const infectionEvents = await tx.zombieInfectionEvent.findMany({ where: { zombieLeagueId, week } })
      const infected = infectionEvents.flatMap(event => {
        const victimRosterId = byUser.get(event.victimUserId)
        const infectorRosterId = byUser.get(event.infectorUserId)
        return victimRosterId && infectorRosterId ? [{ victimRosterId, infectorRosterId }] : []
      })
      if (infected.length !== infectionEvents.length) return null
      const { netByRoster, transfers } = computeWeeklyWinnings(weekResults, infected, rules)
      for (const [rosterId, amount] of netByRoster) {
        await tx.zombieWeeklyWinnings.upsert({
          where: { leagueId_rosterId_week: { leagueId, rosterId, week } },
          create: { leagueId, zombieLeagueId, rosterId, week, amount, source: 'weekly_settlement' },
          update: { amount, source: 'weekly_settlement' },
        })
      }
      const ledger = await tx.zombieWeeklyWinnings.findMany({ where: { leagueId }, select: { rosterId: true, amount: true } })
      const totals = new Map<string, number>()
      for (const row of ledger) totals.set(row.rosterId, (totals.get(row.rosterId) ?? 0) + row.amount)
      for (const [rosterId, weeklyWinnings] of netByRoster) {
        await tx.zombieLeagueTeam.updateMany({
          where: { leagueId, rosterId },
          data: { weeklyWinnings, totalWinnings: Math.round((totals.get(rosterId) ?? 0) * 100) / 100 },
        })
      }
      const transferByPair = new Map(transfers.filter(row => row.kind === 'infection').map(row => [key(row.fromRosterId, row.toRosterId), row]))
      for (const event of infectionEvents) {
        const victim = byUser.get(event.victimUserId)!
        const infector = byUser.get(event.infectorUserId)!
        const transfer = transferByPair.get(key(victim, infector))
        const result = weekResults.find(row => [row.homeRosterId, row.awayRosterId].includes(victim) && [row.homeRosterId, row.awayRosterId].includes(infector))
        const infectorScore = result?.homeRosterId === infector ? result.homeScore : result?.awayScore ?? 0
        const victimScore = result?.homeRosterId === victim ? result.homeScore : result?.awayScore ?? 0
        await tx.zombieInfectionEvent.update({
          where: { id: event.id },
          data: { winningsTransferred: transfer?.amount ?? 0, infectorScore, victimScore,
            scoreDifference: Math.round((infectorScore - victimScore) * 100) / 100, isStatCorrected: true, correctedAt: new Date() },
        })
      }
      const oldJson = previous.matchupResults as Array<Record<string, unknown>>
      const byMatchup = new Map(matchups.map(row => [key(row.homeRosterId, row.awayRosterId), row]))
      const corrected = oldJson.map(row => {
        const current = byMatchup.get(key(String(row.homeUserId), String(row.awayUserId)))
        if (!current) return row
        const homeWon = current.homeScore > current.awayScore
        const awayWon = current.awayScore > current.homeScore
        return { ...row, homeScore: current.homeScore, awayScore: current.awayScore,
          winnerScore: homeWon ? current.homeScore : awayWon ? current.awayScore : null,
          loserScore: homeWon ? current.awayScore : awayWon ? current.homeScore : null }
      })
      const resolution = await tx.zombieWeeklyResolution.update({
        where: { zombieLeagueId_week: { zombieLeagueId, week } },
        data: { matchupResults: toPrismaJsonInput(corrected), requiresStatCorrection: false,
          winningsDistribution: toPrismaJsonInput(Object.fromEntries(netByRoster)) },
      })
      const body = `Week ${week} scores were corrected. Winners, roles, item awards, and combat outcomes did not change. Weekly winnings and infection transfers were recalculated from the final scores.`
      const ann = await tx.zombieAnnouncement.upsert({
        where: { idempotencyKey: `zombie-score-correction:${zombieLeagueId}:${week}` },
        create: { zombieLeagueId, week, type: 'stat_correction', title: `Week ${week} score correction`, content: body,
          isPublic: true, isPosted: true, postedAt: new Date(), idempotencyKey: `zombie-score-correction:${zombieLeagueId}:${week}` },
        update: { content: body },
      })
      await tx.leagueChatMessage.upsert({
        where: { zombieWeeklyAnnouncementId: ann.id },
        create: { leagueId, userId: ownerUserId, message: body, type: 'host_announcement',
          zombieWeeklyAnnouncementId: ann.id, metadata: toPrismaJsonInput({ senderIsHost: true, contentType: 'host_announcement', zombieScoreCorrection: true, week }) },
        update: { message: body },
      })
      return resolution
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch {
    // A concurrent score ingest or settlement can make the snapshot stale. The ordinary
    // reconciliation case remains available on the next attempt.
    return null
  }
}
