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
import { loadSeasonRosterDivisions } from '@/lib/league/divisions/loadLeagueDivisions'
import { pairRivalryWeek, type RivalryPairScore } from './rivalryWeek'
import { weekHasStarted } from './scheduleRegeneration'
import { readGamesPerWeek } from './gamesPerWeek'
import { fillerRounds, scoreNativeRivalries, type NativeRivalryGame } from './nativeRivalries'

const FINAL_STATUSES = new Set(['final', 'completed', 'complete'])

/** Open seats carry placeholder owner ids, which are not a person and do not carry history. */
function managerKey(roster: { id: string; ownerId: string }): string {
  return /^(open-slot|orphan|roster:|local-)/.test(roster.ownerId) ? `roster:${roster.id}` : `owner:${roster.ownerId}`
}

/**
 * The league's own results, as games between this season's teams. A team is followed across seasons by
 * its owner, so an earlier season's games count for the team that owner runs now.
 */
async function loadNativeRivalryGames(
  leagueId: string,
  seasonRosters: ReadonlyArray<{ id: string; ownerId: string }>,
): Promise<NativeRivalryGame[]> {
  const [allRosters, matchups, playoffRows] = await Promise.all([
    prisma.redraftRoster.findMany({ where: { leagueId }, select: { id: true, ownerId: true } }),
    prisma.redraftMatchup.findMany({
      where: { leagueId, isMedianMatchup: false, awayRosterId: { not: null } },
      select: { homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true, status: true },
    }),
    prisma.redraftPlayoffMatchup.findMany({
      where: { season: { leagueId }, winnerRosterId: { not: null } },
      select: { homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true },
    }),
  ])
  const currentByManager = new Map(seasonRosters.map((r) => [managerKey(r), r.id]))
  const currentOf = new Map(allRosters.map((r) => [r.id, currentByManager.get(managerKey(r)) ?? null]))
  const games: NativeRivalryGame[] = []
  const add = (home: string | null, away: string | null, homeScore: number | null, awayScore: number | null, playoff: boolean) => {
    const a = home ? currentOf.get(home) : null
    const b = away ? currentOf.get(away) : null
    if (!a || !b || a === b || homeScore == null || awayScore == null) return
    games.push({ a, b, aScore: homeScore, bScore: awayScore, playoff })
  }
  for (const m of matchups) {
    if (FINAL_STATUSES.has(String(m.status ?? '').toLowerCase())) add(m.homeRosterId, m.awayRosterId, m.homeScore, m.awayScore, false)
  }
  for (const m of playoffRows) add(m.homeRosterId, m.awayRosterId, m.homeScore, m.awayScore, true)
  return games
}

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
  /** The week's other games, in a league that plays several a week. */
  otherGames: Array<{ homeRosterId: string; awayRosterId: string }>
  gamesPerWeek: number
}

async function prepare(seasonId: string, week: number, now: Date): Promise<Prepared | Failure> {
  const season = await prisma.redraftSeason.findUnique({
    where: { id: seasonId },
    select: {
      id: true, leagueId: true, sport: true, season: true, currentWeek: true, playoffStartWeek: true,
      schedule: { select: { week: true, status: true, homeScore: true, awayScore: true } },
      rosters: { select: { id: true, ownerId: true, teamName: true, ownerName: true }, orderBy: { id: 'asc' } },
      league: { select: { settings: true } },
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
  // A league that plays here has no engine records: its rivalries come from its own games and divisions.
  const [nativeGames, divisions] = await Promise.all([
    loadNativeRivalryGames(season.leagueId, season.rosters),
    loadSeasonRosterDivisions(season.leagueId, season.rosters),
  ])
  const nativeReasons = new Map<string, string[]>()
  const fromEngine = new Set(scores.map((s) => [s.a, s.b].sort().join('|')))
  for (const rivalry of scoreNativeRivalries({
    teams: season.rosters.map((r) => r.id),
    games: nativeGames,
    divisionOf: divisions ? new Map([...divisions.byRoster].map(([rosterId, division]) => [rosterId, division.key])) : null,
  })) {
    const key = [rivalry.a, rivalry.b].sort().join('|')
    if (fromEngine.has(key)) continue
    scores.push({ a: rivalry.a, b: rivalry.b, score: rivalry.score })
    nativeReasons.set(key, rivalry.reasons)
  }
  if (!scores.some((s) => s.score > 0)) {
    return {
      ok: false,
      status: 409,
      code: 'NO_RIVALRIES',
      message: 'This league has no rivalries yet. They come from head-to-head games and from divisions, so set up divisions or try again once some games have been played.',
    }
  }

  const nameOf = new Map(season.rosters.map((r) => [r.id, r.teamName?.trim() || r.ownerName?.trim() || 'Team']))
  const boardById = new Map(board.rows.map((row) => [row.id, row]))
  const pairs = pairRivalryWeek(season.rosters.map((r) => r.id), scores).map((p): RivalryWeekPreviewPair => {
    const pairKey = p.away ? [p.home, p.away].sort().join('|') : null
    const recordId = pairKey ? recordByPair.get(pairKey) : undefined
    const row = recordId ? boardById.get(recordId) : undefined
    const native = pairKey ? nativeReasons.get(pairKey) : undefined
    return {
      homeRosterId: p.home,
      awayRosterId: p.away,
      homeName: nameOf.get(p.home) ?? 'Team',
      awayName: p.away ? nameOf.get(p.away) ?? 'Team' : null,
      rivalry: p.rivalry,
      reasons: p.rivalry && row ? row.chips.map((c) => c.label) : p.rivalry && native ? native : [],
      context: p.rivalry && row ? row.context : null,
    }
  })
  // Several games a week: the rivalry game is one of them, and the rest are fresh pairings that do not
  // repeat it. An odd team out simply plays one fewer, as on its ordinary weeks.
  const gamesPerWeek = readGamesPerWeek(season.league?.settings)
  const rivalryGames = pairs.flatMap((p) => (p.awayRosterId ? [[p.homeRosterId, p.awayRosterId] as const] : []))
  const otherGames = gamesPerWeek > 1
    ? fillerRounds(season.rosters.map((r) => r.id), rivalryGames, gamesPerWeek - 1).flat().map(([homeRosterId, awayRosterId]) => ({ homeRosterId, awayRosterId }))
    : []
  return { ok: true, seasonId: season.id, leagueId: season.leagueId, week: wk, pairs, otherGames, gamesPerWeek }
}

export async function previewRivalryWeek(input: { seasonId: string; week: number; now?: Date }) {
  const prepared = await prepare(input.seasonId, input.week, input.now ?? new Date())
  if (!prepared.ok) return prepared
  return { ok: true as const, week: prepared.week, pairs: prepared.pairs }
}

export async function applyRivalryWeek(input: { seasonId: string; week: number; actorUserId: string; now?: Date }) {
  const prepared = await prepare(input.seasonId, input.week, input.now ?? new Date())
  if (!prepared.ok) return prepared
  const { seasonId, leagueId, week, pairs, otherGames, gamesPerWeek } = prepared
  await prisma.$transaction(async (tx) => {
    await tx.redraftMatchup.deleteMany({ where: { seasonId, week, type: 'regular', isMedianMatchup: false } })
    await tx.redraftMatchup.createMany({
      data: [
        // With several games a week there is no bye row: the odd team out just has one fewer game.
        ...pairs.filter((p) => gamesPerWeek === 1 || p.awayRosterId).map((p) => ({ homeRosterId: p.homeRosterId, awayRosterId: p.awayRosterId })),
        ...otherGames,
      ].map((game) => ({
        seasonId,
        leagueId,
        week,
        type: 'regular',
        homeRosterId: game.homeRosterId,
        awayRosterId: game.awayRosterId,
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
