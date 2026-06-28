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
}

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
  if (!created.ok) throw new Error(`G8 seed: canonical create failed: ${created.response.error}`)
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
  }
}

/** Deterministic cleanup: cascade-delete the league + the non-FK weekly scores. */
export async function cleanupG8League(
  prisma: PrismaClient,
  args: { leagueId: string; season: number; seededScoreIds: string[] },
): Promise<void> {
  await prisma.league.delete({ where: { id: args.leagueId } }).catch(() => undefined)
  if (args.seededScoreIds.length) {
    await prisma.playerWeeklyScore
      .deleteMany({ where: { playerId: { in: args.seededScoreIds }, season: args.season, sport: 'NFL' } })
      .catch(() => undefined)
  }
}
