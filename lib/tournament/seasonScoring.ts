import 'server-only'
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { seasonResourceId } from '@/lib/domain/seasonTournamentLeague'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { loadHistoricalPeriod, type HistoricalPeriod, type HistoricalPlayerState } from './seasonProviderScores'
import { NON_SCORING_LINEUP_SLOTS } from '@/lib/redraft/nonScoringLineupSlots'
import { seasonScoringId } from './seasonDraftHandoff'
import { loadSeasonDraftContext } from './seasonDraftRuntime'
import { nbaStartCap, type SeasonRules } from './seasonRules'
import { lockAndCheckSeasonRecovery, SCORE_RECOVERED } from './seasonRecoveryState'
import { seasonContractHash } from './seasonCalendarVerification'
import { hasSeasonOpeningScoreEvidence, persistSeasonLiveScore, readReviewedSeasonOpeningScore } from './seasonScoreLedger'

const NFL_KEYS: Record<string, string> = {
  passing_yards: 'pass_yds', passing_td: 'pass_td', interception: 'pass_int',
  rushing_yards: 'rush_yds', rushing_td: 'rush_td', receptions: 'rec',
  receiving_yards: 'rec_yds', receiving_td: 'rec_td', fumble_lost: 'fum_lost', two_pt_conversion: 'two_pt',
  passing_2pt: 'pass_2pt', rushing_2pt: 'rush_2pt', receiving_2pt: 'rec_2pt',
  fg_40_49: 'fgm_40_49', pat_made: 'xp_made', pat_missed: 'xp_miss',
  dst_sack: 'def_sack', dst_interception: 'def_int', dst_fumble_recovery: 'def_fr',
  dst_td: 'def_td', dst_safety: 'def_safety', dst_blocked_kick: 'def_blk_kick',
  dst_return_td: 'def_st_td',
}
const NBA_KEYS: Record<string, string> = {
  points: 'pts', rebounds: 'reb', assists: 'ast', steals: 'stl',
  blocks: 'blk', turnovers: 'to', three_pointers_made: 'threes',
}

function canonicalValue(sport: 'NFL' | 'NBA', key: string, stats: Record<string, number>) {
  if (stats[key] !== undefined) return stats[key]
  if (sport === 'NBA') {
    if (key === 'double_double' || key === 'triple_double') {
      const categories = ['pts', 'reb', 'ast', 'stl', 'blk'].filter(category => (stats[category] ?? 0) >= 10)
      return Number(categories.length >= (key === 'double_double' ? 2 : 3))
    }
    return stats[NBA_KEYS[key]!] ?? 0
  }
  if (key === 'fg_0_39') return (stats.fgm_0_19 ?? 0) + (stats.fgm_20_29 ?? 0) + (stats.fgm_30_39 ?? 0)
  if (key === 'fg_50_plus') return (stats.fgm_50_59 ?? 0) + (stats.fgm_60p ?? 0)
  if (key.startsWith('dst_points_allowed_')) {
    const allowed = stats.def_points_allowed ?? stats.pts_allow
    if (allowed === undefined) return 0
    const band = allowed === 0 ? '0' : allowed <= 6 ? '1_6' : allowed <= 13 ? '7_13'
      : allowed <= 20 ? '14_20' : allowed <= 27 ? '21_27' : allowed <= 34 ? '28_34' : '35_plus'
    return Number(key === 'dst_points_allowed_' + band)
  }
  return stats[NFL_KEYS[key]!] ?? 0
}

export function scoreSeasonContributions(
  sport: 'NFL' | 'NBA', rules: SeasonRules, week: number, rosterIds: string[], period: HistoricalPeriod,
) {
  const totals = new Map(rosterIds.map(id => [id, 0]))
  const seen = new Set<string>(), starts = new Map<string, number>()
  const limit = sport === 'NBA' ? nbaStartCap(rules, week) : null
  const starterCount = rules.starters.reduce((count, slot) => count + slot.count, 0)
  const slotOrder = new Map(rosterIds.flatMap(id => Array.from({ length: starterCount }, (_, index) => [seasonResourceId(id, 'player:' + (index + 1)), index] as const)))
  const ordered = [...period.contributions].sort((a, b) =>
    (a.gameStartsAt ?? 0) - (b.gameStartsAt ?? 0) || (slotOrder.get(a.player.id) ?? 0) - (slotOrder.get(b.player.id) ?? 0) || a.gameId.localeCompare(b.gameId) || a.player.playerId.localeCompare(b.player.playerId))
  for (const { player, stats, gameId, gameStartsAt } of ordered) {
    const key = JSON.stringify([player.rosterId, player.playerId, gameId])
    if (!totals.has(player.rosterId) || seen.has(key) || (sport === 'NBA' && !Number.isFinite(gameStartsAt))) {
      throw new Error('Tournament scoring has a duplicate or unresolved game contribution.')
    }
    seen.add(key)
    const used = starts.get(player.rosterId) ?? 0
    if (limit != null && used >= limit) continue
    starts.set(player.rosterId, used + 1)
    const points = rules.weights.reduce((sum, weight) => sum + canonicalValue(sport, weight.statKey, stats) * weight.points, 0)
    if (!Number.isFinite(points)) throw new Error('Tournament scoring produced a non-finite result.')
    totals.set(player.rosterId, totals.get(player.rosterId)! + points)
  }
  return new Map([...totals].map(([id, points]) => [id, Math.round(points * 10_000) / 10_000]))
}

export type SeasonStatsReader = typeof loadHistoricalPeriod
async function syncNflStats(seasonId: string, week: number) {
  const { syncPlayerWeeklyScoresForRedraftSeason } = await import('@/lib/redraft/playerWeeklyScoreService')
  await syncPlayerWeeklyScoresForRedraftSeason({ seasonId, week, actorId: 'system:season-tournament', refreshNflStats: true })
}

export async function scoreSeasonLeaguePeriod(
  leagueId: string, week: number, now: Date,
  deps: { readStats?: SeasonStatsReader; refreshNfl?: typeof syncNflStats } = {},
) {
  const context = await loadSeasonDraftContext(leagueId)
  const rule = context?.config.rules?.calendar.periods.find(period => period.number === week)
  if (!context || !rule || now.getTime() < Date.parse(rule.startsAt)) return false
  const seasonId = seasonScoringId(leagueId)
  const season = await prisma.redraftSeason.findUnique({
    where: { id: seasonId }, include: { rosters: { include: { players: true } } },
  })
  if (!season || season.status !== 'active' || week < season.currentWeek || week > season.totalWeeks) return false
  const rosters = season.rosters.map(roster => roster.id)
  const players: HistoricalPlayerState[] = season.rosters.flatMap(roster => roster.players
    .filter(player => !player.droppedAt && !NON_SCORING_LINEUP_SLOTS.has(player.slotType.toUpperCase()))
    .map(player => ({ ...player, droppedAt: null })))
  const expectedStarters = context.config.rules!.starters.reduce((sum, slot) => sum + slot.count, 0)
  if (rosters.length !== context.pool.slots || players.length !== rosters.length * expectedStarters) return false
  const startsAt = new Date(rule.startsAt), endsAt = new Date(rule.endsAt)
  const read = deps.readStats ?? loadHistoricalPeriod
  const publication = await prisma.tournamentAuditLog.findFirst({ where: { id: context.publicationId, tournamentId: context.tournamentId, action: 'season_rules_published' } })
  const calendar = (publication?.data as { calendar?: { periods?: { number: number; games: number }[] } } | undefined)?.calendar
  const minimumGames = calendar?.periods?.find(period => period.number === week)?.games ?? 1
  const args = {
    leagueId, seasonId, sport: season.sport, season: season.season, week, settings: null,
    frozenTournament: { players, startsAt, endsAt, now, minimumGames },
  }
  const finalWindow = now.getTime() >= Date.parse(rule.finalizesAt)
  const openingEvidence = context.stage === 1 && await hasSeasonOpeningScoreEvidence(prisma, leagueId, week)
  let measured = openingEvidence ? null : await read(prisma as unknown as PrismaClient, args)
  if (measured && finalWindow && context.config.sport === 'NFL' && (!measured.correctionsReady || measured.missingPlayerIds.length)) {
    await (deps.refreshNfl ?? syncNflStats)(seasonId, week)
    measured = await read(prisma as unknown as PrismaClient, args)
  }
  const providerFinal = finalWindow && !!measured?.slateFinal && measured.correctionsReady && measured.missingPlayerIds.length === 0
  if (!openingEvidence && !providerFinal && !measured?.contributions.length) return false
  const providerPoints = measured && scoreSeasonContributions(context.config.sport, context.config.rules!, week, rosters, measured)
  return prisma.$transaction(async tx => {
    if (await lockAndCheckSeasonRecovery(tx, context.tournamentId)) return false
    await tx.$queryRaw`SELECT id FROM redraft_seasons WHERE id = ${seasonId} FOR UPDATE`
    const current = await tx.redraftSeason.findUnique({ where: { id: seasonId } })
    if (current?.status !== 'active' || current.currentWeek !== week) return false
    const usesOpeningLedger = context.stage === 1 && await hasSeasonOpeningScoreEvidence(tx, leagueId, week)
    const reviewed = usesOpeningLedger && finalWindow ? await readReviewedSeasonOpeningScore(tx, leagueId, week, now) : null
    if (usesOpeningLedger && !reviewed) return false
    const final = reviewed !== null || providerFinal
    const points = reviewed ? new Map(reviewed.scores.map(score => [score.rosterId, score.points])) : providerPoints
    if (!points) return false

    const matches = await tx.redraftMatchup.findMany({ where: { seasonId, week } })
    const assigned = matches.flatMap(match => match.awayRosterId ? [match.homeRosterId, match.awayRosterId] : [match.homeRosterId])
    if (assigned.length !== rosters.length || new Set(assigned).size !== rosters.length || !assigned.every(id => points.has(id))) return false
    if (matches.some(match => match.status === 'final')) return false
    if (reviewed) {
      const outcomes = new Map(reviewed.outcomes.map(outcome => [outcome.rosterId, outcome]))
      for (const match of matches) {
        const home = points.get(match.homeRosterId)!
        const away = match.awayRosterId && points.get(match.awayRosterId)
        const homeOutcome = outcomes.get(match.homeRosterId)
        const awayOutcome = match.awayRosterId && outcomes.get(match.awayRosterId)
        if (!homeOutcome || (typeof away === 'number'
          ? !awayOutcome || homeOutcome.opponentRosterId !== match.awayRosterId || awayOutcome.opponentRosterId !== match.homeRosterId || homeOutcome.wins !== (home === away ? 0.5 : Number(home > away))
            || awayOutcome.wins !== (home === away ? 0.5 : Number(away > home))
          : homeOutcome.wins !== 0 || homeOutcome.losses !== 0 || homeOutcome.ties !== 0)) {
          throw new Error('Reviewed matchup outcomes differ from the live schedule.')
        }
      }
    }
    if (!final && matches.some(match => {
      const prior = (match.lineupSnapshots as { seasonTournament?: { scoredAt?: string } } | null)?.seasonTournament
      return prior?.scoredAt && Date.parse(prior.scoredAt) > now.getTime()
    })) return false
    const official = final ? await persistSeasonLiveScore(tx, {
      tournamentId: context.tournamentId, leagueId, stage: context.stage, period: week, manifestHash: context.manifestHash, now,
      scores: [...points].map(([rosterId, score]) => ({ rosterId, points: score })),
      proof: reviewed ? { source: 'reviewed_opening', evidenceHash: reviewed.evidenceHash }
        : { source: 'verified_provider', evidenceHash: seasonContractHash({
          minimumGames, sport: context.config.sport, contributions: measured!.contributions.map(row => ({
            playerId: row.player.playerId, rosterId: row.player.rosterId, gameId: row.gameId, startsAt: row.gameStartsAt, stats: row.stats,
          })),
        }) },
    }) : null
    for (const match of matches) {
      await tx.redraftMatchup.update({ where: { id: match.id }, data: {
        homeScore: points.get(match.homeRosterId)!, awayScore: points.get(match.awayRosterId ?? '') ?? 0,
        status: final ? 'final' : 'active',
        lineupSnapshots: toPrismaJsonInput({ seasonTournament: {
          manifestHash: context.manifestHash, week, final, scoredAt: now.toISOString(),
          missingPlayerIds: measured?.missingPlayerIds ?? [],
          ...(official ? { revision: official.revision, officialScoreId: official.id } : {}),
        } }),
      } })
    }
    if (!final) return false
    await tx.redraftSeason.update({ where: { id: seasonId }, data: { currentWeek: week + 1 } })
    await rebuildSeasonLeagueStandings(tx, leagueId, seasonId, rosters)
    const incidentId = seasonResourceId(leagueId, 'score-delay:' + week)
    if (await tx.tournamentAuditLog.findUnique({ where: { id: incidentId }, select: { id: true } })) {
      const id = seasonResourceId(incidentId, 'recovered')
      await tx.tournamentAuditLog.upsert({
        where: { id }, update: {},
        create: { id, tournamentId: context.tournamentId, roundNumber: context.stage, actorType: 'system', action: SCORE_RECOVERED,
          targetType: 'scoring-delay', targetId: incidentId, createdAt: now },
      })
    }
    return true
  }, { maxWait: 5_000, timeout: 25_000 })
}

export async function rebuildSeasonLeagueStandings(tx: Prisma.TransactionClient, leagueId: string, seasonId: string, rosters: string[]) {
  const history = await tx.redraftMatchup.findMany({ where: { seasonId, status: 'final' } })
  const standings = rosters.map(id => {
    const record = { id, pointsFor: 0, pointsAgainst: 0, wins: 0, losses: 0, ties: 0 }
    for (const game of history) {
      if (game.homeRosterId !== id && game.awayRosterId !== id) continue
      const home = game.homeRosterId === id
      const score = home ? game.homeScore : game.awayScore, against = home ? game.awayScore : game.homeScore
      record.pointsFor += score
      if (!game.awayRosterId) continue
      record.pointsAgainst += against
      if (score > against) record.wins++
      else if (score < against) record.losses++
      else record.ties++
    }
    return record
  }).sort((a, b) => b.pointsFor - a.pointsFor || b.wins - a.wins || a.id.localeCompare(b.id))
  for (const [index, { id, ...record }] of standings.entries()) {
    await tx.redraftRoster.update({ where: { id }, data: record })
    await tx.tournamentLeagueParticipant.updateMany({
      where: { redraftRosterId: id, league: { leagueId } }, data: { ...record, leagueRank: index + 1 },
    })
  }
}
