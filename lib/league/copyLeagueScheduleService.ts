/**
 * Copy leagues, part 2 — the database half of ./copyLeagueSchedule.ts.
 *
 * - `previewRealSchedule`: which of the season's unstarted regular-season weeks the stored NFL games cover, and
 *   how many matchups in each would be real games. Writes nothing.
 * - `applyRealSchedule`: write every covered week as a CUSTOM week (lib/schedule-runtime/customWeeks.ts), so a
 *   later rebuild or randomize keeps it. Also records which pairs are real games, for the "Real game" tag.
 *
 * Reads `SportsGame` only — the cron keeps it; nothing here calls a provider. A week that has started is never
 * touched (the same rule swaps and regeneration use), and a week the games do not cover is left as it is.
 */
import { prisma } from '@/lib/prisma'
import { logAction } from '@/server/services/auditService'
import { weekHasStarted } from '@/lib/schedule-runtime/scheduleRegeneration'
import { withCustomWeek, type CustomPair } from '@/lib/schedule-runtime/customWeeks'
import { copyLeagueHasRealSchedule, readCopyLeague, COPY_LEAGUE_SETTINGS_KEY } from './copyLeague'
import { planRealSchedule, realWeeksFromGames, type CopyTeam, type RealSchedulePlan } from './copyLeagueSchedule'

type Refusal = { ok: false; status: number; code: string; message: string }

export type RealScheduleWeek = { week: number; loaded: boolean; real: number; total: number }

type Loaded = {
  season: { id: string; leagueId: string; season: number }
  plan: RealSchedulePlan
  settings: unknown
}

async function load(seasonId: string, now: Date): Promise<Loaded | Refusal> {
  const season = await prisma.redraftSeason.findUnique({
    where: { id: seasonId },
    select: {
      id: true, leagueId: true, sport: true, season: true, currentWeek: true, playoffStartWeek: true,
      rosters: { select: { id: true } },
      schedule: { select: { week: true, status: true, homeScore: true, awayScore: true } },
      league: { select: { settings: true, sport: true } },
    },
  })
  if (!season) return { ok: false, status: 404, code: 'SEASON_NOT_FOUND', message: 'Season not found.' }
  const copy = readCopyLeague(season.league.settings, season.league.sport)
  if (!copy.enabled) {
    return { ok: false, status: 409, code: 'NOT_A_COPY_LEAGUE', message: 'Turn on copy league first (AllFantasy options).' }
  }
  if (!copyLeagueHasRealSchedule(copy.sport)) {
    return { ok: false, status: 409, code: 'NO_REAL_SCHEDULE', message: 'The real schedule is for NFL copy leagues. Your teams still have their real names and logos.' }
  }

  // League team → this season's roster, the link the commissioner rename uses (Roster.id = LeagueTeam.externalId).
  const leagueTeams = await prisma.leagueTeam.findMany({ where: { leagueId: season.leagueId }, select: { id: true, externalId: true } })
  const links = await prisma.roster.findMany({
    where: { leagueId: season.leagueId, id: { in: leagueTeams.map((t) => t.externalId) } },
    select: { id: true, redraftRosterId: true },
  })
  const codeByRoster = new Map<string, string>()
  for (const t of leagueTeams) {
    const code = copy.teams[t.id]
    const redraftId = links.find((l) => l.id === t.externalId)?.redraftRosterId
    if (code && redraftId) codeByRoster.set(redraftId, code)
  }
  const teams: CopyTeam[] = season.rosters
    .map((r) => ({ rosterId: r.id, code: codeByRoster.get(r.id) ?? null }))
    .sort((a, b) => a.rosterId.localeCompare(b.rosterId))

  const games = await prisma.sportsGame.findMany({
    where: { sport: 'NFL', season: season.season },
    select: { homeTeam: true, awayTeam: true, week: true, seasonType: true, startTime: true },
  })
  const real = realWeeksFromGames(games, season.season)

  const weeks: number[] = []
  for (let w = 1; w < season.playoffStartWeek; w++) {
    if (!weekHasStarted(w, { currentWeek: season.currentWeek, sport: season.sport, seasonYear: season.season, now, persisted: season.schedule })) weeks.push(w)
  }
  return {
    season: { id: season.id, leagueId: season.leagueId, season: season.season },
    plan: planRealSchedule({ weeks, real, teams }),
    settings: season.league.settings,
  }
}

const summary = (plan: RealSchedulePlan): RealScheduleWeek[] =>
  plan.map((w) => ({ week: w.week, loaded: w.loaded, real: w.real.length, total: w.pairs.length }))

export async function previewRealSchedule(input: { seasonId: string; now?: Date }): Promise<{ ok: true; weeks: RealScheduleWeek[] } | Refusal> {
  const loaded = await load(input.seasonId, input.now ?? new Date())
  if ('ok' in loaded) return loaded
  return { ok: true, weeks: summary(loaded.plan) }
}

/** `League.settings.copy_league.realGames[season][week]` — the pairs that are real NFL games, for the tag. */
function withRealGames(settings: unknown, seasonYear: number, byWeek: Map<number, CustomPair[]>): Record<string, unknown> {
  const s = { ...((settings && typeof settings === 'object' ? settings : {}) as Record<string, unknown>) }
  const copy = { ...((s[COPY_LEAGUE_SETTINGS_KEY] as Record<string, unknown>) ?? {}) }
  const all = { ...((copy.realGames as Record<string, unknown>) ?? {}) }
  const season = { ...((all[String(seasonYear)] as Record<string, unknown>) ?? {}) }
  for (const [week, pairs] of byWeek) season[String(week)] = pairs.map((p) => [p.home, p.away])
  all[String(seasonYear)] = season
  copy.realGames = all
  s[COPY_LEAGUE_SETTINGS_KEY] = copy
  return s
}

export async function applyRealSchedule(input: { seasonId: string; actorUserId: string; now?: Date }): Promise<{ ok: true; weeks: RealScheduleWeek[] } | Refusal> {
  const loaded = await load(input.seasonId, input.now ?? new Date())
  if ('ok' in loaded) return loaded
  const toWrite = loaded.plan.filter((w) => w.loaded)
  if (!toWrite.length) {
    return { ok: false, status: 409, code: 'SCHEDULE_NOT_LOADED', message: 'The real NFL schedule for these weeks isn’t loaded yet.' }
  }
  const { season } = loaded
  await prisma.$transaction(async (tx) => {
    for (const w of toWrite) {
      await tx.redraftMatchup.deleteMany({ where: { seasonId: season.id, week: w.week, type: 'regular', isMedianMatchup: false } })
      await tx.redraftMatchup.createMany({
        data: w.pairs.map((p) => ({
          seasonId: season.id, leagueId: season.leagueId, week: w.week, type: 'regular',
          homeRosterId: p.home, awayRosterId: p.away, isMedianMatchup: false, status: 'scheduled',
        })),
      })
    }
    const fresh = await tx.league.findUnique({ where: { id: season.leagueId }, select: { settings: true } })
    let settings: unknown = fresh?.settings
    for (const w of toWrite) settings = withCustomWeek(settings, season.season, w.week, w.pairs)
    settings = withRealGames(settings, season.season, new Map(toWrite.map((w) => [w.week, w.real])))
    await tx.league.update({ where: { id: season.leagueId }, data: { settings: settings as object } })
  })
  await logAction({
    leagueId: season.leagueId,
    userId: input.actorUserId,
    actionType: 'copy_league_real_schedule',
    entityType: 'schedule',
    entityId: season.id,
    metadata: { weeks: toWrite.map((w) => w.week), realGames: toWrite.reduce((n, w) => n + w.real.length, 0) },
  }).catch(() => {})
  return { ok: true, weeks: summary(loaded.plan) }
}
