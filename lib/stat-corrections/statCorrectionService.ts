/**
 * The commissioner's side of the stat-correction review (statCorrectionDetector.ts): the latest stored
 * review for the league's current season with team names and what has been applied, and Apply.
 *
 * Applying posts each team's correction as a score adjustment tagged `stat_correction`
 * (applyStatCorrectionAdjustment), which moves the stored score of the sealed week, refreshes the
 * standings and writes the audit log — the same path as a commissioner's own adjustment, so nothing
 * re-opens the week. Only what is still owed is added, so applying twice, or after a further
 * correction, lands the total exactly once.
 */
import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { readScoreAdjustments, statCorrectionApplied } from '@/lib/score-adjustments/scoreAdjustments'
import { applyStatCorrectionAdjustment, type AdjustmentError } from '@/lib/score-adjustments/scoreAdjustmentService'
import type { MatchupCorrection, PlayerCorrection } from './statCorrectionReview'
import {
  readStoredReview,
  statCorrectionCacheKeyPrefix,
  type StoredStatCorrectionReview,
} from './statCorrectionDetector'
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

type SideView = MatchupCorrection['home'] & {
  teamName: string
  /** The team's corrected points: the change the league office's stats make to its score. */
  correction: number
  /** How much of it is already applied as a stat-correction adjustment (by hand or automatically). */
  applied: number
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
      Omit<MatchupCorrection, 'home' | 'away'> & {
        home: SideView
        away: SideView
        /** Both teams' corrections are applied in full. */
        fullyApplied: boolean
      }
    >
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100

type LoadedLeague = { settings: unknown; userId: string | null; leagueVariant: string | null; guillotineMode: boolean | null }

async function loadLatest(leagueId: string): Promise<{
  covered: boolean
  league: LoadedLeague | null
  seasonStatus: string | null
  stored: StoredStatCorrectionReview | null
}> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, platform: true, settings: true, userId: true, leagueVariant: true, guillotineMode: true } })
  const covered = String(league?.sport ?? '').toUpperCase() === 'NFL' && resolveWriteAuthority(league?.platform) === 'NATIVE'
  if (!league || !covered) return { covered: false, league: null, seasonStatus: null, stored: null }

  const season = await prisma.redraftSeason.findFirst({ where: { leagueId }, orderBy: { season: 'desc' }, select: { id: true, status: true } })
  if (!season) return { covered, league, seasonStatus: null, stored: null }
  const rows = await prisma.sportsDataCache.findMany({
    where: { cacheKey: { startsWith: statCorrectionCacheKeyPrefix(season.id) } },
    select: { data: true },
  })
  const stored =
    rows
      .map((r) => readStoredReview(r.data))
      .filter((r): r is StoredStatCorrectionReview => r !== null && r.leagueId === leagueId)
      .sort((a, b) => b.week - a.week)[0] ?? null
  return { covered, league, seasonStatus: season.status ?? null, stored }
}

export async function readStatCorrections(leagueId: string): Promise<StatCorrectionView> {
  const { covered, league, seasonStatus, stored } = await loadLatest(leagueId)
  if (!league || !covered) return { covered: false, latest: null }
  const available = await ownerHasAfCommissionerPlan(league.userId)
  const enabled = readExtendedCorrections(league.settings) && available
  const extended = {
    enabled,
    available,
    refusal: correctionApplyRefusal(league, seasonStatus),
    windowDays: enabled ? EXTENDED_CORRECTION_WINDOW_DAYS : FREE_CORRECTION_WINDOW_DAYS,
  }
  if (!stored) return { covered, extended, latest: null }

  const { review } = stored
  const rosterIds = [...new Set([...review.changes.map((c) => c.rosterId), ...review.matchups.flatMap((m) => [m.home.rosterId, m.away.rosterId])])]
  const rosters = rosterIds.length
    ? await prisma.redraftRoster.findMany({ where: { id: { in: rosterIds }, leagueId }, select: { id: true, teamName: true, ownerName: true } })
    : []
  const names = new Map(rosters.map((r) => [r.id, r.teamName?.trim() || r.ownerName || 'Team']))
  const teamName = (id: string) => names.get(id) ?? 'Team'
  const adjustments = readScoreAdjustments(league.settings)
  const side = (matchupId: string, s: MatchupCorrection['home']): SideView => ({
    ...s,
    teamName: teamName(s.rosterId),
    correction: round2(s.after - s.before),
    applied: statCorrectionApplied(adjustments, matchupId, s.rosterId),
  })

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
      matchups: review.matchups.map((m) => {
        const home = side(m.matchupId, m.home)
        const away = side(m.matchupId, m.away)
        return { ...m, home, away, fullyApplied: home.applied === home.correction && away.applied === away.correction }
      }),
    },
  }
}

export type ApplyStatCorrectionsError = 'not_covered' | 'no_review' | 'not_in_review' | 'elimination_format' | 'playoffs'

export type ApplyStatCorrectionsResult =
  | { ok: true; week: number; adjustmentsAdded: number }
  | { ok: false; error: ApplyStatCorrectionsError | AdjustmentError }

/** The adjustment's reason: which players moved, so the audit log and the league log say why. */
export function statCorrectionReason(week: number, changes: readonly PlayerCorrection[]): string {
  const players = changes.map((c) => `${c.playerName} ${c.delta > 0 ? '+' : '−'}${Math.abs(c.delta)}`).join(', ')
  return `Stat correction, week ${week}${players ? `: ${players}` : ''}`
}

/**
 * The commissioner's Apply: the latest review's corrections to one matchup, or to every matchup it lists
 * (`'all'`). (Extended scoring corrections apply them automatically instead — ./applyStatCorrections.ts;
 * the two count each other's adjustments, so neither adds a correction the other already landed.)
 * Commissioner only — the route checks. Stops at the first refusal, leaving what already landed.
 */
export async function commissionerApplyStatCorrections(leagueId: string, userId: string, target: string): Promise<ApplyStatCorrectionsResult> {
  const { covered, league, seasonStatus, stored } = await loadLatest(leagueId)
  if (!covered || !league) return { ok: false, error: 'not_covered' }
  // The same line the automatic path holds: a score that already eliminated a team or set the playoff
  // seeds is never rewritten by a correction.
  const refused = correctionApplyRefusal(league, seasonStatus)
  if (refused) return { ok: false, error: refused }
  if (!stored) return { ok: false, error: 'no_review' }
  const matchups = target === 'all' ? stored.review.matchups : stored.review.matchups.filter((m) => m.matchupId === target)
  if (matchups.length === 0) return { ok: false, error: target === 'all' ? 'no_review' : 'not_in_review' }

  let adjustmentsAdded = 0
  for (const m of matchups) {
    for (const s of [m.home, m.away]) {
      const res = await applyStatCorrectionAdjustment(leagueId, userId, {
        matchupId: m.matchupId,
        rosterId: s.rosterId,
        targetNet: round2(s.after - s.before),
        reason: statCorrectionReason(stored.week, stored.review.changes.filter((c) => c.rosterId === s.rosterId)),
      })
      if (!res.ok) return res
      if (res.adjustment) adjustmentsAdded += 1
    }
  }
  return { ok: true, week: stored.week, adjustmentsAdded }
}

export const APPLY_STAT_CORRECTION_ERROR_TEXT: Record<ApplyStatCorrectionsError, string> = {
  not_covered: 'Stat-correction review covers AllFantasy NFL leagues only.',
  no_review: 'There is no stat-correction review to apply.',
  not_in_review: 'That matchup has no correction in the latest review.',
  elimination_format: 'In an elimination league a week can already have cost a team its season, so corrections are shown, never applied.',
  playoffs: 'Playoff seeds are set, so corrections are shown, never applied.',
}
