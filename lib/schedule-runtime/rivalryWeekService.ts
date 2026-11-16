/**
 * Rivalry week, preview and apply (lib/schedule-runtime/rivalryWeek.ts, 2026-11-15).
 *
 * Preview shows the pairings and the facts behind each rivalry; apply rewrites that week's regular matchups. Only a
 * regular-season week that has not started can change (the rule schedule regeneration and the team swap use), and the
 * change is written to the league log. A league with no rivalry history is told so rather than handed a random week.
 */
import { prisma } from '@/lib/prisma'
import { logAction } from '@/server/services/auditService'
import { getRivalryBoard } from '@/lib/rivalry-engine/rivalryBoard'
import { pairRivalryWeek, type RivalryPairScore } from './rivalryWeek'
import { weekHasStarted } from './scheduleRegeneration'

export type RivalryWeekPreviewPair = {
  homeRosterId: string
  awayRosterId: string | null
  homeName: string
  awayName: string | null
  rivalry: boolean
  /** The facts the rivalry engine recorded for this pair ("5 H2H MEETINGS", "2 CLOSE GAMES", …). */
  reasons: string[]
  context: string | null
}

type Failure = { ok: false; status: number; code: string; message: string }
type Prepared = {
  ok: true
  seasonId: string
  leagueId: string
  week: number
  pairs: RivalryWeekPreviewPair[]
}

async function prepare(seasonId: string, week: number, now: Date): Promise<Prepared | Failure> {
  const season = await prisma.redraftSeason.findUnique({
    where: { id: seasonId },
    select: {
      id: true, leagueId: true, sport: true, season: true, currentWeek: true, playoffStartWeek: true,
      schedule: { select: { week: true, status: true, homeScore: true, awayScore: true } },
      rosters: { select: { id: true, teamName: true, ownerName: true }, orderBy: { id: 'asc' } },
    },
  })
  if (!season) return { ok: false, status: 404, code: 'SEASON_NOT_FOUND', message: 'Season not found.' }
  const wk = Math.floor(week)
  if (!Number.isFinite(wk) || wk < 1 || wk >= season.playoffStartWeek) {
    return { ok: false, status: 400, code: 'NOT_REGULAR_SEASON', message: 'Rivalry week has to be a regular-season week.' }
  }
  if (weekHasStarted(wk, { currentWeek: season.currentWeek, sport: season.sport, seasonYear: season.season, now, persisted: season.schedule })) {
    return { ok: false, status: 409, code: 'WEEK_STARTED', message: `Week ${wk} has already started, so it can no longer become rivalry week.` }
  }
  if (season.rosters.length < 2) return { ok: false, status: 409, code: 'NOT_ENOUGH_TEAMS', message: 'Rivalry week needs at least two teams.' }

  // Rivalries are recorded on the league's rosters (LeagueTeam.externalId = Roster.id); matchups use the season's
  // RedraftRoster, linked from the roster.
  const [records, links, board] = await Promise.all([
    prisma.rivalryRecord.findMany({
      where: { leagueId: season.leagueId },
      select: { id: true, managerAId: true, managerBId: true, rivalryScore: true },
    }),
    prisma.roster.findMany({ where: { leagueId: season.leagueId }, select: { id: true, redraftRosterId: true } }),
    getRivalryBoard(season.leagueId, 200).catch(() => ({ rows: [] as Array<{ id: string; chips: Array<{ label: string }>; context: string | null }> })),
  ])
  const seasonRosterIds = new Set(season.rosters.map((r) => r.id))
  const redraftByRoster = new Map(
    links.filter((l) => l.redraftRosterId && seasonRosterIds.has(l.redraftRosterId)).map((l) => [l.id, l.redraftRosterId!]),
  )
  const recordByPair = new Map<string, string>()
  const scores: RivalryPairScore[] = []
  for (const r of records) {
    const a = redraftByRoster.get(r.managerAId)
    const b = redraftByRoster.get(r.managerBId)
    if (!a || !b) continue
    scores.push({ a, b, score: r.rivalryScore })
    recordByPair.set([a, b].sort().join('|'), r.id)
  }
  if (!scores.some((s) => s.score > 0)) {
    return {
      ok: false,
      status: 409,
      code: 'NO_RIVALRIES',
      message: 'This league has no rivalry history yet. Rivalries come from past head-to-head games, so try again once some have been played.',
    }
  }

  const nameOf = new Map(season.rosters.map((r) => [r.id, r.teamName?.trim() || r.ownerName?.trim() || 'Team']))
  const boardById = new Map(board.rows.map((row) => [row.id, row]))
  const pairs = pairRivalryWeek(season.rosters.map((r) => r.id), scores).map((p): RivalryWeekPreviewPair => {
    const recordId = p.away ? recordByPair.get([p.home, p.away].sort().join('|')) : undefined
    const row = recordId ? boardById.get(recordId) : undefined
    return {
      homeRosterId: p.home,
      awayRosterId: p.away,
      homeName: nameOf.get(p.home) ?? 'Team',
      awayName: p.away ? nameOf.get(p.away) ?? 'Team' : null,
      rivalry: p.rivalry,
      reasons: p.rivalry && row ? row.chips.map((c) => c.label) : [],
      context: p.rivalry && row ? row.context : null,
    }
  })
  return { ok: true, seasonId: season.id, leagueId: season.leagueId, week: wk, pairs }
}

export async function previewRivalryWeek(input: { seasonId: string; week: number; now?: Date }) {
  const prepared = await prepare(input.seasonId, input.week, input.now ?? new Date())
  if (!prepared.ok) return prepared
  return { ok: true as const, week: prepared.week, pairs: prepared.pairs }
}

export async function applyRivalryWeek(input: { seasonId: string; week: number; actorUserId: string; now?: Date }) {
  const prepared = await prepare(input.seasonId, input.week, input.now ?? new Date())
  if (!prepared.ok) return prepared
  const { seasonId, leagueId, week, pairs } = prepared
  await prisma.$transaction(async (tx) => {
    await tx.redraftMatchup.deleteMany({ where: { seasonId, week, type: 'regular', isMedianMatchup: false } })
    await tx.redraftMatchup.createMany({
      data: pairs.map((p) => ({
        seasonId,
        leagueId,
        week,
        type: 'regular',
        homeRosterId: p.homeRosterId,
        awayRosterId: p.awayRosterId,
        status: 'scheduled',
      })),
    })
  })
  await logAction({
    leagueId,
    userId: input.actorUserId,
    actionType: 'schedule_rivalry_week',
    entityType: 'schedule',
    entityId: seasonId,
    afterState: { pairs: pairs.map((p) => ({ home: p.homeRosterId, away: p.awayRosterId, rivalry: p.rivalry })) },
    metadata: { week, rivalryGames: pairs.filter((p) => p.rivalry).length },
  }).catch(() => {})
  return { ok: true as const, week, pairs }
}
