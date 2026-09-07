/**
 * Create a guillotine league's season shell, once its RedraftSeason exists.
 *
 * 🛑 THIS ONLY EVER HAPPENED IF A COMMISSIONER POSTED TO `/api/guillotine/season`
 * BY HAND. The create path writes `GuillotineLeagueConfig` in the same
 * transaction as the league — that half has always worked — and then nothing
 * ever created the `GuillotineSeason` the elimination engine, the chop audit,
 * the survival log and the waiver-release engine all hang off. Measured
 * 2026-09-07: `guillotine_seasons` holds ZERO rows in production against 12
 * guillotine leagues.
 *
 * ⚠ IT CANNOT BE DONE AT LEAGUE CREATE, WHICH IS WHERE IT LOOKS LIKE IT BELONGS.
 * `GuillotineSeason.redraftSeasonId` is a required unique FK, and
 * `totalTeamsStarted` / `currentTeamsActive` are counts of `RedraftRoster` rows.
 * Neither exists until the draft finalizes — `syncCompletedDraftToRedraftSeason`
 * is what creates them. So the hook is post-draft, beside the sync that produces
 * its dependency, not in the create transaction beside the config.
 *
 * ⚠ AND GUILLOTINE DOES REACH THAT SYNC, WHICH IS NOT OBVIOUS FROM ITS NAME.
 * `syncCompletedDraftToRedraftSeason` gates on
 * `leagueType === 'redraft' || isDynasty === false`, and `leagueModeColumns`
 * sets `isDynasty` false for guillotine — so it qualifies through the second
 * arm. If that gate is ever narrowed to the first arm alone, this stops firing
 * and guillotine loses its season shell again with nothing going red.
 */

import { prisma } from '@/lib/prisma'
import { isGuillotineLeague } from '@/lib/guillotine/GuillotineLeagueConfig'

export type EnsureGuillotineSeasonResult =
  | { ok: true; created: boolean; seasonId: string }
  | { ok: false; reason: 'NOT_GUILLOTINE' | 'REDRAFT_SEASON_NOT_FOUND' | 'NO_ROSTERS' }

/**
 * Idempotent: returns the existing season when one is already attached.
 *
 * `redraftSeasonId` is `@unique`, so a concurrent second call would raise rather
 * than duplicate — but the read-then-create window is real (the post-draft
 * artifacts run is itself throttled, not locked), so the create is guarded and a
 * lost race resolves by returning the winner's row instead of throwing.
 */
export async function ensureGuillotineSeason(input: {
  leagueId: string
  redraftSeasonId: string
}): Promise<EnsureGuillotineSeasonResult> {
  if (!(await isGuillotineLeague(input.leagueId))) {
    return { ok: false, reason: 'NOT_GUILLOTINE' }
  }

  const redraftSeason = await prisma.redraftSeason.findFirst({
    where: { id: input.redraftSeasonId, leagueId: input.leagueId },
    select: { id: true, sport: true, season: true },
  })
  if (!redraftSeason) return { ok: false, reason: 'REDRAFT_SEASON_NOT_FOUND' }

  const existing = await prisma.guillotineSeason.findFirst({
    where: { redraftSeasonId: redraftSeason.id },
    select: { id: true },
  })
  if (existing) return { ok: true, created: false, seasonId: existing.id }

  const rosters = await prisma.redraftRoster.count({ where: { seasonId: redraftSeason.id } })
  // A guillotine season is defined by how many teams it starts with — that is
  // the number the chop line counts down from. Creating one with zero would
  // produce a season that eliminates nobody and reports itself healthy.
  if (rosters === 0) return { ok: false, reason: 'NO_ROSTERS' }

  try {
    const created = await prisma.guillotineSeason.create({
      data: {
        leagueId: input.leagueId,
        redraftSeasonId: redraftSeason.id,
        sport: redraftSeason.sport,
        season: redraftSeason.season,
        status: 'setup',
        totalTeamsStarted: rosters,
        currentTeamsActive: rosters,
        currentScoringPeriod: 0,
      },
      select: { id: true },
    })
    return { ok: true, created: true, seasonId: created.id }
  } catch {
    // Lost the unique race: somebody else created it between the read above and
    // this write. Their row is as good as ours.
    const winner = await prisma.guillotineSeason.findFirst({
      where: { redraftSeasonId: redraftSeason.id },
      select: { id: true },
    })
    if (winner) return { ok: true, created: false, seasonId: winner.id }
    throw new Error('guillotine season create failed')
  }
}
