import { isNcaafSport } from '@/lib/scoring-runtime/ncaafStatNormalization'
import { prisma } from '@/lib/prisma'
import { normalizeFantraxTeamName } from '@/lib/league-import/fantrax/fantraxTeamIds'
import { resolveFantraxSeasonPosition, type FantraxLeagueInfo, type FantraxScheduleRow } from '@/lib/league-import/fantrax/fantraxApi'

const record = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {}
const stableJson = (v: any): string => JSON.stringify(v, (_, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b))) : value)
export function projectFantraxHistory(input: { seasonId: string; leagueId: string; info: Pick<FantraxLeagueInfo, 'scoringPeriods' | 'playoffs'>; rows: FantraxScheduleRow[]; teamIds: Record<string, string>; rosters: any[]; sourceActualTeamPeriods?: Set<string>; now?: Date }) {
  const position = resolveFantraxSeasonPosition(input.info as FantraxLeagueInfo, input.now ?? new Date())
  const periods = input.info.scoringPeriods ?? []
  const matchups = input.rows.flatMap(row => {
    const home = input.rosters.find(r => r.id === input.teamIds[row.homeTeamId]), away = input.rosters.find(r => r.id === input.teamIds[row.awayTeamId])
    if (!home || !away || home.id === away.id) return []
    const period = periods.find(p => p.number === row.week)
    const complete = Boolean(period?.endDate && new Date(period.endDate).getTime() < (input.now ?? new Date()).getTime())
    const scored = row.played && row.homeScore != null && row.awayScore != null
    const actualsAvailable = input.sourceActualTeamPeriods?.has(`${row.week}:${row.homeTeamId}`) && input.sourceActualTeamPeriods?.has(`${row.week}:${row.awayTeamId}`)
    return [{ id: `fantrax:${input.seasonId}:${row.week}:${row.homeTeamId}`, seasonId: input.seasonId, leagueId: input.leagueId, week: row.week, type: row.isPlayoff ? 'playoff' : 'regular', homeRosterId: home.id, awayRosterId: away.id, homeRoster: home, awayRoster: away, homeScore: scored ? row.homeScore : null, awayScore: scored ? row.awayScore : null, status: scored ? complete ? 'final' : 'live' : 'scheduled', isMedianMatchup: false, source: 'fantrax', readOnly: true, scoringEvidence: { teamScores: 'fantrax', individualSourceScores: actualsAvailable ? 'available' : 'unavailable', message: actualsAvailable ? 'Verified Fantrax individual actual points are imported for both teams in this period.' : 'Fantrax provides team totals for this period; individual source scores are unavailable.' }, periodStart: period?.startDate ?? null, periodEnd: period?.endDate ?? null }]
  })
  const firstPlayoffPeriod = input.info.playoffs?.used ? Number(input.info.playoffs.firstPlayoffPeriod) : null
  const playoffStartWeek = firstPlayoffPeriod && Number.isInteger(firstPlayoffPeriod) && firstPlayoffPeriod > 1 ? firstPlayoffPeriod : null
  return { currentWeek: position?.period ?? null, playoffStartWeek, regularSeasonWeeks: playoffStartWeek ? playoffStartWeek - 1 : undefined, matchups, source: 'fantrax' as const, readOnly: true as const, incompleteMatchups: input.rows.length - matchups.length }
}

/** Source metadata only. No scores, standings, lineups or native matchups are written. */
export async function syncFantraxNativePresentation(leagueId: string, info: FantraxLeagueInfo, rows: FantraxScheduleRow[], now = new Date()) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fantrax-presentation:${leagueId}`}))`
    const league = await tx.league.findUnique({ where: { id: leagueId }, select: { platform: true, platformLeagueId: true, userId: true, sport: true, season: true, settings: true } })
    if (league?.platform?.toLowerCase() !== 'fantrax' || !isNcaafSport(String(league.sport)) || !league.platformLeagueId || league.season !== Number(info.seasonYear)) return { changed: false }
    const snapshot = await tx.fantraxLeague.findUnique({ where: { id: league.platformLeagueId }, select: { appUserId: true } })
    if (!snapshot?.appUserId || snapshot.appUserId !== league.userId) throw new Error('Fantrax presentation ownership proof missing')
    const seasons = await tx.redraftSeason.findMany({ where: { leagueId, season: league.season }, include: { rosters: true } })
    if (!seasons.length) return { changed: false }
    const rosters = seasons.flatMap(s => s.rosters)
    const settings = record(league.settings), previousIds = record(settings.fantrax_native_team_ids), teamIds: Record<string, string> = {}
    for (const team of Object.values(info.teamInfo)) {
      const prior = previousIds[team.id]
      const candidates = prior ? rosters.filter(r => r.id === prior) : rosters.filter(r => normalizeFantraxTeamName(r.teamName ?? r.ownerName) === normalizeFantraxTeamName(team.name))
      if (candidates.length !== 1 || Object.values(teamIds).includes(candidates[0]!.id)) throw new Error('Fantrax native roster mapping is ambiguous')
      teamIds[team.id] = candidates[0]!.id
    }
    const position = resolveFantraxSeasonPosition(info, now)
    if (!position) throw new Error('Fantrax scoring calendar unavailable')
    const metadataChanged = settings.current_week !== position.period || stableJson(previousIds) !== stableJson(teamIds) || stableJson(settings.fantrax_schedule) !== stableJson(rows) || stableJson(settings.fantrax_scoring_periods) !== stableJson(info.scoringPeriods ?? []) || stableJson(settings.fantrax_playoffs) !== stableJson(info.playoffs ?? null)
    // Merge metadata atomically without replacing unrelated settings.
    const patch = JSON.stringify({ current_week: position.period, fantrax_native_team_ids: teamIds, fantrax_schedule: rows, fantrax_scoring_periods: info.scoringPeriods ?? [], fantrax_playoffs: info.playoffs ?? null, fantrax_presentation_synced_at: now.toISOString() })
    const calendar = JSON.stringify({ scoringPeriods: info.scoringPeriods ?? [], seasonState: position.state })
    if (metadataChanged) await tx.$executeRaw`UPDATE leagues SET settings = COALESCE(settings, '{}'::jsonb) || ${patch}::jsonb || jsonb_build_object('fantrax_settings', COALESCE(settings->'fantrax_settings', '{}'::jsonb) || ${calendar}::jsonb) WHERE id = ${leagueId}`
    const result = await tx.redraftSeason.updateMany({ where: { leagueId, season: league.season, currentWeek: { not: position.period } }, data: { currentWeek: position.period } })
    return { changed: metadataChanged || result.count > 0, currentWeek: position.period, matchups: rows.length }
  }, { timeout: 60000 })
}

export async function loadFantraxNativePresentation(season: { id: string; leagueId: string; season: number }, now = new Date()) {
  const league = await prisma.league.findUnique({ where: { id: season.leagueId }, select: { platform: true, platformLeagueId: true, sport: true, settings: true, season: true } })
  if (league?.platform?.toLowerCase() !== 'fantrax' || !isNcaafSport(String(league.sport)) || league.season !== season.season) return null
  const s = record(league.settings), rosters = await prisma.redraftRoster.findMany({ where: { seasonId: season.id } })
  const scoringPeriods = s.fantrax_scoring_periods ?? s.fantrax_settings?.scoringPeriods
  if (!Array.isArray(s.fantrax_schedule) || !Array.isArray(scoringPeriods)) return null
  const sourceActualTeamPeriods = new Set<string>()
  if (league.platformLeagueId) {
    const keys: string[] = s.fantrax_schedule.flatMap((row: FantraxScheduleRow) => [row.homeTeamId, row.awayTeamId].map(id => `fantrax-actuals-receipt:${league.platformLeagueId}:${season.season}:${row.week}:${id}`))
    const scoreCoverage = await prisma.leaguePlayerWeeklyScore.groupBy({by:['week','rosterId','isStarter'],where:{leagueId:league.platformLeagueId,seasonYear:season.season,source:'fantrax'},_count:{_all:true},_sum:{points:true}})
    const receipts = await prisma.sportsDataCache.findMany({where:{cacheKey:{in:keys}},select:{data:true}})
    for (const receipt of receipts) {
      const data = record(receipt.data)
      const coverage = scoreCoverage.filter(c => c.week === data.period && c.rosterId === data.rosterId)
      const rowCount = coverage.reduce((sum,c) => sum + c._count._all,0)
      const starterPoints = coverage.filter(c=>c.isStarter).reduce((sum,c)=>sum+(c._sum.points??0),0)
      const fixture = (s.fantrax_schedule as FantraxScheduleRow[]).find(row=>row.week===data.period && (row.homeTeamId===data.sourceTeamId || row.awayTeamId===data.sourceTeamId))
      const total = fixture?.homeTeamId===data.sourceTeamId ? fixture.homeScore : fixture?.awayScore
      if (data.verified === true && Number.isInteger(data.period) && Number.isInteger(data.rosterId) && typeof data.sourceTeamId === 'string' && data.rows > 0 && rowCount===data.rows && total!=null && Math.abs(starterPoints-total)<0.001) sourceActualTeamPeriods.add(`${data.period}:${data.sourceTeamId}`)
    }
  }
  return projectFantraxHistory({ seasonId: season.id, leagueId: season.leagueId, info: { scoringPeriods, playoffs: s.fantrax_playoffs }, rows: s.fantrax_schedule, teamIds: record(s.fantrax_native_team_ids), rosters, sourceActualTeamPeriods, now })
}

/** Standard head-to-head standings from finalized source results, never persisted as native actuals. */
export function projectFantraxStandings(rosters: any[], matchups: ReturnType<typeof projectFantraxHistory>['matchups']) {
  const totals = new Map(rosters.map(r => [r.id, { ...r, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, playoffSeed: null }]))
  for (const m of matchups) {
    if (m.status !== 'final' || m.type === 'playoff' || m.homeScore == null || m.awayScore == null) continue
    for (const [id, points, against] of [[m.homeRosterId,m.homeScore,m.awayScore],[m.awayRosterId,m.awayScore,m.homeScore]] as Array<[string,number,number]>) {
      const t = totals.get(id); if (!t) continue
      t.pointsFor += points; t.pointsAgainst += against
      if (points > against) t.wins++; else if (points < against) t.losses++; else t.ties++
    }
  }
  return [...totals.values()].sort((a,b) => b.wins-a.wins || a.losses-b.losses || b.pointsFor-a.pointsFor)
}
