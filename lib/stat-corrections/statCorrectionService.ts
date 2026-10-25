/**
 * The commissioner's read of the stat-correction review (statCorrectionDetector.ts): the latest
 * stored review for the league's current season, with team names attached. Read-only.
 */
import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import type { MatchupCorrection, PlayerCorrection } from './statCorrectionReview'
import { readStoredReview, statCorrectionCacheKeyPrefix } from './statCorrectionDetector'
import {
  correctionApplyRefusal,
  EXTENDED_CORRECTION_WINDOW_DAYS,
  EXTENDED_CORRECTIONS_KEY,
  FREE_CORRECTION_WINDOW_DAYS,
  readExtendedCorrections,
} from './extendedCorrections'
import { ownerHasAfCommissionerPlan } from './applyStatCorrections'

/**
 * Switch "Extended scoring corrections". Turning it ON needs the league owner's AF Commissioner (what
 * the detector checks before applying anything); turning it off is always allowed. A League.settings
 * key, written under the league row lock.
 */
export async function setExtendedCorrections(leagueId: string, enabled: unknown): Promise<{ ok: true; enabled: boolean } | { ok: false; status: 400 | 402 | 404; error: string }> {
  if (typeof enabled !== 'boolean') return { ok: false, status: 400, error: 'Say whether to turn extended corrections on or off.' }
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true } })
  if (!league) return { ok: false, status: 404, error: 'League not found.' }
  if (enabled && !(await ownerHasAfCommissionerPlan(league.userId))) {
    return { ok: false, status: 402, error: 'Extended scoring corrections are part of AF Commissioner.' }
  }
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const row = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    const next = { ...((row?.settings as Record<string, unknown> | null) ?? {}) }
    if (enabled) next[EXTENDED_CORRECTIONS_KEY] = true
    else delete next[EXTENDED_CORRECTIONS_KEY]
    await tx.league.update({ where: { id: leagueId }, data: { settings: next as object } })
  })
  return { ok: true, enabled }
}

export type StatCorrectionView = {
  /** False when the league is outside what the review covers (see the detector's scope note). */
  covered: boolean
  /** Extended scoring corrections (./extendedCorrections.ts). */
  extended?: {
    enabled: boolean
    /** The league owner has AF Commissioner, which the switch needs. */
    available: boolean
    /** Null when corrections can be applied in this league; otherwise why not. */
    refusal: 'elimination_format' | 'playoffs' | null
    windowDays: number
  }
  latest: null | {
    season: number
    week: number
    checkedAt: string
    /** Re-checks stop after this; a correction posted later is not picked up. */
    windowClosesAt: string
    unchecked: number
    changes: Array<PlayerCorrection & { teamName: string }>
    matchups: Array<
      MatchupCorrection & { home: MatchupCorrection['home'] & { teamName: string }; away: MatchupCorrection['away'] & { teamName: string } }
    >
  }
}

export async function readStatCorrections(leagueId: string): Promise<StatCorrectionView> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, platform: true, settings: true, userId: true, leagueVariant: true, guillotineMode: true } })
  const covered = String(league?.sport ?? '').toUpperCase() === 'NFL' && resolveWriteAuthority(league?.platform) === 'NATIVE'
  if (!league || !covered) return { covered: false, latest: null }

  const season = await prisma.redraftSeason.findFirst({ where: { leagueId }, orderBy: { season: 'desc' }, select: { id: true, status: true } })
  const available = await ownerHasAfCommissionerPlan(league.userId)
  const enabled = readExtendedCorrections(league.settings) && available
  const extended = {
    enabled,
    available,
    refusal: correctionApplyRefusal(league, season?.status ?? null),
    windowDays: enabled ? EXTENDED_CORRECTION_WINDOW_DAYS : FREE_CORRECTION_WINDOW_DAYS,
  }
  if (!season) return { covered, extended, latest: null }
  const rows = await prisma.sportsDataCache.findMany({
    where: { cacheKey: { startsWith: statCorrectionCacheKeyPrefix(season.id) } },
    select: { data: true },
  })
  const stored = rows
    .map((r) => readStoredReview(r.data))
    .filter((r): r is NonNullable<typeof r> => r !== null && r.leagueId === leagueId)
    .sort((a, b) => b.week - a.week)[0]
  if (!stored) return { covered, extended, latest: null }

  const { review } = stored
  const rosterIds = [...new Set([...review.changes.map((c) => c.rosterId), ...review.matchups.flatMap((m) => [m.home.rosterId, m.away.rosterId])])]
  const rosters = rosterIds.length
    ? await prisma.redraftRoster.findMany({ where: { id: { in: rosterIds }, leagueId }, select: { id: true, teamName: true, ownerName: true } })
    : []
  const names = new Map(rosters.map((r) => [r.id, r.teamName?.trim() || r.ownerName || 'Team']))
  const teamName = (id: string) => names.get(id) ?? 'Team'

  return {
    covered,
    extended,
    latest: {
      season: stored.season,
      week: stored.week,
      checkedAt: stored.checkedAt,
      windowClosesAt: new Date(Date.parse(stored.sealedAt) + extended.windowDays * 24 * 60 * 60 * 1000).toISOString(),
      unchecked: review.unchecked,
      changes: review.changes.map((c) => ({ ...c, teamName: teamName(c.rosterId) })),
      matchups: review.matchups.map((m) => ({
        ...m,
        home: { ...m.home, teamName: teamName(m.home.rosterId) },
        away: { ...m.away, teamName: teamName(m.away.rosterId) },
      })),
    },
  }
}
