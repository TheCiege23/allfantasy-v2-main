/**
 * E2E self-seeding harness for the G8/R1 browser spec.
 *
 * Creates a UI-RENDERABLE NFL redraft league through the REAL canonical
 * create-league pipeline (`executeCanonicalLeagueCreation`) — so `LeagueShellClient`
 * renders it exactly like a commissioner-created league — then overlays the redraft
 * DEF/ST data the Playwright flow exercises: an active season, two rosters, a
 * rostered team defense (`nfl:def:<TEAM>`), a matchup, seeded DEF + QB weekly
 * scores, and a commissioner scoring override set THROUGH the surfaced NFL panel
 * path (`saveLeagueNflScoringConfig`, bridged to `sportConfig.categoryPoints`).
 *
 * tsx-importable + integration-tested against the Neon STAGING branch by the engine
 * E2E. NEVER touches production: callers gate on NODE_ENV/x-allfantasy-e2e. Cleanup
 * is deterministic — `cleanupG8League` cascade-deletes the league and the non-FK
 * weekly scores it seeded.
 */
import type { PrismaClient } from '@prisma/client'
import { saveLeagueNflScoringConfig } from '@/lib/nfl-scoring/NflScoringConfigService'
import { updateMatchupScores } from '@/lib/redraft/scoringEngine'
import { formatNflTeamDefenseName } from '@/lib/redraft/teamDefenseIdentity'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'
import { executeCanonicalLeagueCreation } from '@/lib/league-creation/canonical/executeCanonicalLeagueCreation'
import { syncCompletedDraftToRedraftSeason } from '@/lib/redraft/finalizeDraftToRedraftSeason'

export type SeededG8League = {
  mark: string
  leagueId: string
  seasonId: string
  season: number
  week: number
  homeRosterId: string
  awayRosterId: string
  matchupId: string
  defPlayerId: string
  defTeam: string
  /** PlayerWeeklyScore rows (no FK cascade) — deleted explicitly on cleanup. */
  seededScoreIds: string[]
  /**
   * SportsPlayer rows backing `Roster.playerData` (no FK to the league, so no
   * cascade) — deleted explicitly on cleanup. See `seedMyTeamRoster` below.
   */
  seededPlayerIds: string[]
}

/**
 * `SportsPlayer.source` for the rows this fixture owns.
 *
 * ⚠ IT IS PART OF `@@unique([sport, externalId, source])`, and that is what makes
 * cleanup safe: a delete filtered on this source cannot reach a real ingested
 * player row even if some other importer ever used the same external id.
 */
const E2E_PLAYER_SOURCE = 'e2e-g8-fixture'

export type SeedG8Options = {
  team?: string
  /** Unique season year isolates the global PlayerWeeklyScore rows per run. */
  season?: number
  week?: number
}

/**
 * Seed a commissioner-owned NFL redraft league with a scored team defense.
 * `userId` must be a real AppUser (the freshly-registered Playwright commissioner).
 */
export async function seedG8CommissionerLeague(
  prisma: PrismaClient,
  userId: string,
  opts: SeedG8Options = {},
): Promise<SeededG8League> {
  const mark = `G8WEB-${Date.now()}-${Math.floor(Math.random() * 1e4)}`
  const team = (opts.team ?? 'KC').toUpperCase()
  // Unique season per run so the global nfl:def weekly-score rows never collide.
  const season = opts.season ?? 2090 + Math.floor(Math.random() * 9)
  const week = opts.week ?? 1
  const defPlayerId = `nfl:def:${team}`
  const homeQbId = `${mark}-hqb`
  const awayQbId = `${mark}-aqb`

  // 1) Create a UI-RENDERABLE league via the REAL canonical pipeline (full
  // settings snapshot + commissioner + draft session) so LeagueShellClient renders.
  const validated = validateCreatePayload({
    concept: 'redraft',
    sport: 'NFL',
    scoringPreset: 'PPR',
    teamCount: 12,
    draftType: 'snake',
    leagueName: `G8 DST Verify ${team} ${mark.slice(-4)}`,
  })
  if (!validated.ok) throw new Error(`G8 seed: invalid create body: ${validated.error}`)
  const created = await executeCanonicalLeagueCreation({ appUserId: userId, body: validated.data })
  if (!created.ok) {
    /*
     * ⚠ CARRY THE `detail`, NOT JUST THE `error`. executeCanonicalLeagueCreation
     * already computes a real Prisma diagnostic via prismaErrorDetail() and returns it
     * as `response.detail`; `response.error` is the fixed string "Failed to create
     * league" and says nothing. Throwing only the latter is the second place this
     * failure was stripped of its cause — the route above it was the first — and
     * between them a seed that fails for a specific, nameable reason surfaced to CI as
     * a bare 500 for weeks.
     */
    const detail = (created.response as { detail?: unknown }).detail
    const suffix = typeof detail === 'string' && detail.trim() ? ` — ${detail}` : ''
    throw new Error(`G8 seed: canonical create failed: ${created.response.error}${suffix}`)
  }
  const leagueId = created.response.league.id
  const league = { id: leagueId }

  // 2) Drive the league through the REAL draft-completion path so the roster UI
  //    populates exactly like a customer league: seed DraftPicks on the
  //    commissioner + an opponent generic roster, mark the session completed, then
  //    sync into RedraftRoster via the production finalizer (no hand-built rosters).
  const draftSession = await prisma.draftSession.findUnique({ where: { leagueId: league.id }, select: { id: true } })
  if (!draftSession) throw new Error('G8 seed: canonical league has no draft session')
  const commishRoster = await prisma.roster.findFirst({ where: { leagueId: league.id, platformUserId: userId }, select: { id: true } })
  const oppRoster = await prisma.roster.findFirst({ where: { leagueId: league.id, NOT: { id: commishRoster?.id ?? '' } }, select: { id: true } })
  if (!commishRoster || !oppRoster) throw new Error('G8 seed: missing generic rosters for draft')

  const commishPicks = [
    { playerId: homeQbId, playerName: 'Starting QB', position: 'QB' },
    { playerId: `${mark}-rb1`, playerName: 'Starting RB1', position: 'RB' },
    { playerId: `${mark}-rb2`, playerName: 'Starting RB2', position: 'RB' },
    { playerId: `${mark}-wr1`, playerName: 'Starting WR1', position: 'WR' },
    { playerId: `${mark}-wr2`, playerName: 'Starting WR2', position: 'WR' },
    { playerId: `${mark}-te`, playerName: 'Starting TE', position: 'TE' },
    { playerId: `${mark}-k`, playerName: 'Starting K', position: 'K' },
    { playerId: defPlayerId, playerName: formatNflTeamDefenseName(team), position: 'DEF' },
  ]
  const oppPicks = [{ playerId: awayQbId, playerName: 'Opp QB', position: 'QB' }]
  let overall = 0
  const pickData = [
    ...commishPicks.map((p) => ({ sessionId: draftSession.id, overall: ++overall, round: overall, slot: overall, rosterId: commishRoster.id, playerId: p.playerId, playerName: p.playerName, position: p.position, team: p.position === 'DEF' ? team : null, sportType: 'NFL' })),
    ...oppPicks.map((p) => ({ sessionId: draftSession.id, overall: ++overall, round: overall, slot: overall, rosterId: oppRoster.id, playerId: p.playerId, playerName: p.playerName, position: p.position, team: null, sportType: 'NFL' })),
  ]
  await prisma.draftPick.createMany({ data: pickData })
  await prisma.draftSession.update({ where: { id: draftSession.id }, data: { status: 'completed', completedAt: new Date() } })

  // Production finalizer: builds RedraftSeason + RedraftRosters + players from the
  // completed draft — the same path the roster UI reads for a real league.
  const sync = await syncCompletedDraftToRedraftSeason(league.id)
  if (!sync.seasonId) throw new Error(`G8 seed: draft sync did not produce a season (${sync.reason ?? 'unknown'})`)

  // Isolate this run's global weekly-score rows under a unique season year (the UI
  // redraft layer reads RedraftSeason.season for score lookups; League.season is
  // display-only). Then place the synced starters into their starter slots so the
  // DEF shows in the DEF slot (the finalizer defaults synced players to bench).
  await prisma.redraftSeason.update({ where: { id: sync.seasonId }, data: { season, currentWeek: week } })
  const homeRosterId = (await prisma.redraftRosterPlayer.findFirst({ where: { playerId: defPlayerId, roster: { seasonId: sync.seasonId } }, select: { rosterId: true } }))?.rosterId
  if (!homeRosterId) throw new Error('G8 seed: DEF did not sync into a redraft roster')
  const awayRoster = await prisma.redraftRoster.findFirst({ where: { seasonId: sync.seasonId, NOT: { id: homeRosterId } }, select: { id: true } })

  // Map each synced starter to its slot (DEF→DEF, QB→QB, …) across BOTH rosters so
  // home AND away render player rows in the matchup-center (the finalizer defaults
  // synced players to bench). 2nd RB/WR stay as the position too (capacity covers).
  const allPlayers = await prisma.redraftRosterPlayer.findMany({ where: { roster: { seasonId: sync.seasonId } }, select: { id: true, position: true } })
  for (const pl of allPlayers) {
    const slot = String(pl.position ?? '').toUpperCase()
    if (['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(slot)) {
      await prisma.redraftRosterPlayer.update({ where: { id: pl.id }, data: { slotType: slot } })
    }
  }

  // The production finalizer now auto-generates a round-robin RedraftMatchup
  // schedule for the new season. Reuse its week-1 matchup (re-pointing it to the
  // DEF-bearing roster as home so the matchup-center renders the seeded DEF on the
  // home side), and only fall back to creating one if generation produced none.
  const generatedWeek1 = await prisma.redraftMatchup.findFirst({
    where: { seasonId: sync.seasonId, week },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  const matchup = generatedWeek1
    ? await prisma.redraftMatchup.update({
        where: { id: generatedWeek1.id },
        data: { homeRosterId, awayRosterId: awayRoster?.id ?? null, status: 'scheduled' },
      })
    : await prisma.redraftMatchup.create({
        data: { seasonId: sync.seasonId, leagueId: league.id, week, homeRosterId, awayRosterId: awayRoster?.id ?? null, status: 'scheduled' },
      })

  // DEF box score (incl. points-allowed) + the home QB + the away QB, at the isolated
  // season — so both matchup sides carry real canonical per-player scores.
  const scoreRows = [
    { playerId: defPlayerId, stats: { def_sack: 3, def_int: 1, def_points_allowed: 10 } },
    { playerId: homeQbId, stats: { pass_yds: 300, pass_td: 2 } },
    { playerId: awayQbId, stats: { pass_yds: 250, pass_td: 1 } },
  ]
  for (const r of scoreRows) {
    await prisma.playerWeeklyScore.upsert({
      where: { playerId_week_season_sport: { playerId: r.playerId, week, season, sport: 'NFL' } },
      update: { stats: r.stats, isFinalized: true },
      create: { playerId: r.playerId, week, season, sport: 'NFL', fantasyPts: 0, isFinalized: true, stats: r.stats },
    })
  }

  // Commissioner scoring THROUGH the surfaced panel path: a DEF override (dst_sack
  // = 5, PA 7-13 tier = 4) → nfl_scoring_config + bridged sportConfig.categoryPoints.
  await saveLeagueNflScoringConfig(league.id, { presetKey: 'custom', rules: { dst_sack: 5, dst_pa_7_13: 4 }, userId })
  await updateMatchupScores(matchup.id)

  const seededPlayerIds = await seedMyTeamRoster(prisma, league.id, userId, mark, team)

  return {
    mark,
    leagueId: league.id,
    seasonId: sync.seasonId,
    season,
    week,
    homeRosterId,
    awayRosterId: awayRoster?.id ?? '',
    matchupId: matchup.id,
    defPlayerId,
    defTeam: team,
    seededScoreIds: [defPlayerId, homeQbId, awayQbId],
    seededPlayerIds,
  }
}

/**
 * Give /core/my-team a roster it can actually render.
 *
 * 🛑 THE REDRAFT PATH ABOVE DOES NOT FEED THIS SCREEN. The draft finalizer writes
 * `RedraftRosterPlayer`, which is what the matchup centre reads. `/core/my-team`
 * reads a different pair entirely (`lib/core-app/myTeam.ts`):
 *
 *   1. `LeagueTeam` where `claimedByUserId = userId`  — the canonical create
 *      already writes this one, claimed, for the commissioner.
 *   2. `Roster.playerData` — `{ starters, players, reserve, taxi }`, arrays of
 *      ids — which the canonical create leaves EMPTY.
 *
 * So before this function existed the fixture produced a league whose My Team
 * screen rendered zero roster rows and not one primary control, while every
 * other seeded surface looked correct. That cost a whole verification batch:
 * the mobile touch-target work had to be proved at component level because the
 * live screen had nothing on it to measure.
 *
 * The ids are then resolved to names through `SportsPlayer.sleeperId`
 * (`resolvePlayers` in myTeam.ts), so each one needs a row there or the screen
 * renders an "unresolved id" slot instead of a player. Those rows carry no FK to
 * the league, so they do NOT cascade — `cleanupG8League` deletes them by id.
 */
async function seedMyTeamRoster(
  prisma: PrismaClient,
  leagueId: string,
  userId: string,
  mark: string,
  team: string,
): Promise<string[]> {
  const id = (suffix: string) => `${mark}-${suffix}`

  /*
   * One deliberately long name. The phone layout ellipsises the name cell, and a
   * roster of short names cannot show whether that still holds — the mobile audit
   * measured a two-line name as nearly twice the height of a one-line one.
   */
  const squad = [
    { key: 'qb', name: 'Christian Kirkpatrick-Wetherington III', position: 'QB', role: 'starter' },
    { key: 'rb1', name: 'Javonte Fixture', position: 'RB', role: 'starter' },
    { key: 'rb2', name: 'Rhamondre Sample', position: 'RB', role: 'starter' },
    { key: 'wr1', name: 'Amon-Ra Fixture', position: 'WR', role: 'starter' },
    { key: 'wr2', name: 'Puka Sample', position: 'WR', role: 'starter' },
    { key: 'te', name: 'Trey Fixture', position: 'TE', role: 'starter' },
    { key: 'k', name: 'Harrison Sample', position: 'K', role: 'starter' },
    { key: 'bench1', name: 'Tyjae Fixture', position: 'RB', role: 'bench' },
    { key: 'bench2', name: 'Jaxon Sample', position: 'WR', role: 'bench' },
    { key: 'ir1', name: 'Injured Fixture', position: 'WR', role: 'reserve' },
    { key: 'taxi1', name: 'Taxi Sample', position: 'RB', role: 'taxi' },
  ] as const

  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
  await prisma.sportsPlayer.createMany({
    data: squad.map((p) => ({
      sport: 'NFL',
      externalId: id(p.key),
      // The lookup is on sleeperId, not externalId — see resolvePlayers().
      sleeperId: id(p.key),
      name: p.name,
      position: p.position,
      team,
      source: E2E_PLAYER_SOURCE,
      expiresAt,
    })),
    skipDuplicates: true,
  })

  const of = (role: string) => squad.filter((p) => p.role === role).map((p) => id(p.key))
  const playerData = {
    starters: of('starter'),
    players: squad.map((p) => id(p.key)),
    reserve: of('reserve'),
    taxi: of('taxi'),
  }

  /*
   * The same candidate rule the screen uses (`myRosterCandidates`): the claimed
   * LeagueTeam's `platformUserId` is the app user id for a canonically-created
   * league, and that is what the commissioner's Roster row carries.
   */
  const roster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: userId },
    select: { id: true },
  })
  if (!roster) throw new Error('G8 seed: no commissioner Roster row to attach playerData to')
  await prisma.roster.update({ where: { id: roster.id }, data: { playerData } })

  return squad.map((p) => id(p.key))
}

/**
 * Deterministic cleanup: cascade-delete the league + every row this fixture wrote
 * that has no FK to it.
 *
 * ⚠ TWO TABLES DO NOT CASCADE, NOT ONE. `PlayerWeeklyScore` never did, and
 * `SportsPlayer` (added with the My Team roster) does not either — both are
 * global, league-agnostic tables. A cleanup that only deletes the league leaves
 * eleven player rows per run behind in a shared test database.
 *
 * `seededPlayerIds` is optional so a DELETE issued by an older caller — or one
 * replaying a seed response captured before this field existed — still cleans the
 * league and the scores instead of failing outright. The source filter makes the
 * delete safe regardless of what ids are passed.
 */
export async function cleanupG8League(
  prisma: PrismaClient,
  args: { leagueId: string; season: number; seededScoreIds: string[]; seededPlayerIds?: string[] },
): Promise<void> {
  await prisma.league.delete({ where: { id: args.leagueId } }).catch(() => undefined)
  if (args.seededScoreIds.length) {
    await prisma.playerWeeklyScore
      .deleteMany({ where: { playerId: { in: args.seededScoreIds }, season: args.season, sport: 'NFL' } })
      .catch(() => undefined)
  }
  if (args.seededPlayerIds?.length) {
    await prisma.sportsPlayer
      .deleteMany({
        where: {
          externalId: { in: args.seededPlayerIds },
          // Belt and braces: never reach a real ingested row. See E2E_PLAYER_SOURCE.
          source: E2E_PLAYER_SOURCE,
        },
      })
      .catch(() => undefined)
  }
}
