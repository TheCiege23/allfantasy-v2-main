/**
 * Shared scoring: set scoring once, apply it to several of your leagues (2026-11-16).
 *
 * A commissioner who runs several AllFantasy leagues of one sport kept them in step by opening each league's scoring
 * tab and re-entering the same table. This copies one league's scoring — its preset and its full table — onto the
 * leagues the commissioner picks.
 *
 * 🛑 EVERY LEAGUE IS SAVED THROUGH `applySportScoringToLeague`, THE SAME FUNCTION ITS OWN SCORING TAB USES. So each
 * league's commissioner check, settings lock, category-format guard, season-phase rule (a mid-season change needs the
 * commissioner's confirmation; a league mid-draft is refused) and league-log entry apply exactly as if the
 * commissioner had saved it there. A league that refuses is reported with its reason, never skipped silently, and
 * never forced.
 *
 * What it will not touch, and why (each is a league whose scoring is not the scoring tab's to change):
 *   - imported leagues — their scoring follows the host site;
 *   - season tournaments — scoring is frozen in the tournament's contract and checked against it;
 *   - survivor guillotine — scores from its own template and override rows;
 *   - devy and campus-to-canton — their own presets;
 *   - category or roto leagues — a points table does not apply;
 *   - a carried-over league that scores from its imported table (`sportConfig.categoryPoints`), which the live scorer
 *     reads ahead of the scoring tab, so a save there would change nothing.
 */
import { prisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { isOwnerOrLeagueCommissioner } from '@/lib/commissioner/leagueCommissionerAccount'
import { readScoringType } from '@/lib/category-scoring/leagueScoringType'
import { isDevyFormatLeague } from '@/lib/core-app/dynastyRosterMarkers'
import { lockedGroups } from '@/lib/league/settingsLockService'
import { SETTINGS_EDIT_POLICY } from '@/lib/league/settingsLifecycleGate'
import { MID_SEASON_CONFIRM_FLAG } from '@/lib/league/midSeasonConfirmation'
import { getLeagueLifecycleState } from '@/server/services/leagueLifecycleService'
import {
  applySportScoringToLeague,
  isPointsScoringSport,
  readLeagueSportScoring,
  scoringNeedsPremium,
  userHasAdvancedScoring,
  type PointsScoringSport,
  type ScoringApplyOutcome,
} from '@/lib/league/applySportScoring'

/** One apply touches at most this many leagues; a commissioner with more applies in batches. */
export const SHARED_SCORING_MAX_LEAGUES = 50

type LeagueRow = {
  id: string
  name: string | null
  sport: string
  platform: string | null
  leagueVariant: string | null
  leagueType: string | null
  settings: unknown
  userId: string | null
  lifecycleState: Parameters<typeof getLeagueLifecycleState>[0]['lifecycleState']
}

const LEAGUE_SELECT = {
  id: true,
  name: true,
  sport: true,
  platform: true,
  leagueVariant: true,
  leagueType: true,
  settings: true,
  userId: true,
  lifecycleState: true,
} as const

export type SharedScoringIncompatibility = 'imported' | 'tournament' | 'survivor_guillotine' | 'past_season' | 'devy' | 'category' | 'carried_over'

/** What each reason means, in the API's own words (the screen shows its own translated copy for each code). */
export const SHARED_SCORING_INCOMPATIBILITY_MESSAGE: Record<SharedScoringIncompatibility, string> = {
  imported: 'Imported league — its scoring follows the site it was imported from.',
  tournament: 'Tournament leagues keep the tournament’s scoring.',
  survivor_guillotine: 'Survivor guillotine scores from its own rules.',
  past_season: 'This is a past-season record, not a playable league.',
  devy: 'Devy and campus-to-canton leagues keep their own scoring.',
  category: 'Category league — a points table does not apply.',
  carried_over: 'This league scores from the table it was carried over with; change it in that league’s scoring tab.',
}

const OWN_SCORING_VARIANTS: Record<string, SharedScoringIncompatibility> = {
  season_tournament: 'tournament',
  survivor_guillotine: 'survivor_guillotine',
  legacy_summary: 'past_season',
}

/** Why this league cannot take another league's points table, or null when it can. Pure. */
export function sharedScoringIncompatibility(
  league: Pick<LeagueRow, 'platform' | 'leagueVariant' | 'leagueType' | 'settings' | 'sport'>,
): SharedScoringIncompatibility | null {
  if (!isNativePlatform(league.platform)) return 'imported'
  const variant = OWN_SCORING_VARIANTS[String(league.leagueVariant ?? '').toLowerCase()]
  if (variant) return variant
  if (isDevyFormatLeague(league)) return 'devy'
  if (readScoringType(league.settings).mode !== 'points') return 'category'
  if (league.sport !== 'MLB') {
    const sc = (league.settings as Record<string, unknown> | null)?.sportConfig as Record<string, unknown> | undefined
    const points = sc?.categoryPoints
    if (points && typeof points === 'object' && Object.keys(points).length > 0) return 'carried_over'
  }
  return null
}

function sameRules(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) if (Number(a[k] ?? 0) !== Number(b[k] ?? 0)) return false
  return true
}

/** Leagues this user can save scoring for: owned, plus leagues where their claimed team carries a commissioner flag. */
async function commissionerLeagues(userId: string, sport: string): Promise<LeagueRow[]> {
  const [owned, flagged] = await Promise.all([
    prisma.league.findMany({ where: { userId, sport: sport as never }, select: LEAGUE_SELECT }),
    prisma.leagueTeam.findMany({
      where: { claimedByUserId: userId, OR: [{ isCommissioner: true }, { isCoCommissioner: true }] },
      select: { leagueId: true },
    }),
  ])
  const ownedIds = new Set(owned.map((l) => l.id))
  const otherIds = [...new Set(flagged.map((t) => t.leagueId))].filter((id) => !ownedIds.has(id))
  const others = otherIds.length
    ? await prisma.league.findMany({ where: { id: { in: otherIds }, sport: sport as never }, select: LEAGUE_SELECT })
    : []
  // The same commissioner check the scoring save makes, so nothing is listed that the save would then refuse for it.
  const allowed = await Promise.all(others.map((l) => isOwnerOrLeagueCommissioner(l, l.id, userId)))
  return [...owned, ...others.filter((_, i) => allowed[i])] as LeagueRow[]
}

export type SharedScoringStatus = 'ready' | 'matches' | 'mid_season' | 'locked' | 'refused' | 'incompatible'

export type SharedScoringLeague = {
  id: string
  name: string
  status: SharedScoringStatus
  /** Set when status is `incompatible`. */
  incompatibility: SharedScoringIncompatibility | null
  presetKey: string | null
}

export type SharedScoringSource = {
  id: string
  name: string
  sport: PointsScoringSport
  presetKey: string
  customTable: boolean
  needsPremium: boolean
}

export type SharedScoringView =
  | { ok: true; source: SharedScoringSource; leagues: SharedScoringLeague[]; hasPremium: boolean }
  | { ok: false; status: number; error: string }

async function loadSource(userId: string, sourceLeagueId: string) {
  const league = (await prisma.league.findUnique({ where: { id: sourceLeagueId }, select: LEAGUE_SELECT })) as LeagueRow | null
  if (!league) return { ok: false as const, status: 404, error: 'League not found' }
  if (!(await isOwnerOrLeagueCommissioner(league, league.id, userId))) return { ok: false as const, status: 403, error: 'Commissioner only' }
  if (!isPointsScoringSport(league.sport)) return { ok: false as const, status: 400, error: 'This sport has no shared scoring.' }
  const incompatible = sharedScoringIncompatibility(league)
  if (incompatible) return { ok: false as const, status: 409, error: SHARED_SCORING_INCOMPATIBILITY_MESSAGE[incompatible] }
  const sport = league.sport
  const saved = await readLeagueSportScoring(sport, league.id)
  // A table that is exactly a preset travels as the preset key; anything else (custom, or a preset with additions
  // such as a TE premium) travels as the full table, so nothing the commissioner set is lost on the way.
  const customTable = saved.presetKey === 'custom' || !saved.matchesPreset
  const rules = customTable ? saved.rules : undefined
  const source: SharedScoringSource = {
    id: league.id,
    name: league.name ?? 'Your league',
    sport,
    presetKey: saved.presetKey,
    customTable,
    needsPremium: scoringNeedsPremium(saved.presetKey, rules),
  }
  return { ok: true as const, league, source, rules, savedRules: saved.rules }
}

export async function getSharedScoringView(userId: string, sourceLeagueId: string): Promise<SharedScoringView> {
  const src = await loadSource(userId, sourceLeagueId)
  if (!src.ok) return src
  const candidates = (await commissionerLeagues(userId, src.source.sport)).filter((l) => l.id !== src.source.id)
  const leagues = await Promise.all(
    candidates.map(async (l): Promise<SharedScoringLeague> => {
      const base = { id: l.id, name: l.name ?? 'Untitled league' }
      const incompatible = sharedScoringIncompatibility(l)
      if (incompatible) return { ...base, status: 'incompatible', incompatibility: incompatible, presetKey: null }
      const current = await readLeagueSportScoring(src.source.sport, l.id).catch(() => null)
      const presetKey = current?.presetKey ?? null
      if (current && current.presetKey === src.source.presetKey && sameRules(current.rules, src.savedRules)) {
        return { ...base, status: 'matches', incompatibility: null, presetKey }
      }
      // Fails open, like the save's own lock check: an unreadable lock is reported by the save, not guessed here.
      const locked = await lockedGroups(l.id, ['scoring']).catch(() => [])
      if (locked.length) return { ...base, status: 'locked', incompatibility: null, presetKey }
      const policy = SETTINGS_EDIT_POLICY[getLeagueLifecycleState(l)] ?? 'refused'
      if (policy === 'refused') return { ...base, status: 'refused', incompatibility: null, presetKey }
      if (policy === 'confirm') return { ...base, status: 'mid_season', incompatibility: null, presetKey }
      return { ...base, status: 'ready', incompatibility: null, presetKey }
    }),
  )
  const order: Record<SharedScoringStatus, number> = { ready: 0, mid_season: 1, matches: 2, locked: 3, refused: 4, incompatible: 5 }
  leagues.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name))
  const hasPremium = src.source.needsPremium ? await userHasAdvancedScoring(userId) : true
  return { ok: true, source: src.source, leagues, hasPremium }
}

export type SharedScoringResult = {
  leagueId: string
  name: string
  outcome: ScoringApplyOutcome
  message: string | null
  incompatibility?: SharedScoringIncompatibility
}

export type SharedScoringApply =
  | { ok: true; results: SharedScoringResult[]; saved: number }
  | { ok: false; status: number; error: string; code?: string }

export async function applySharedScoring(input: {
  userId: string
  sourceLeagueId: string
  leagueIds: string[]
  confirmMidSeasonChange?: boolean
}): Promise<SharedScoringApply> {
  const src = await loadSource(input.userId, input.sourceLeagueId)
  if (!src.ok) return src
  const ids = [...new Set(input.leagueIds.filter((id) => typeof id === 'string' && id && id !== src.source.id))]
  if (ids.length === 0) return { ok: false, status: 400, error: 'Pick at least one league.' }
  if (ids.length > SHARED_SCORING_MAX_LEAGUES) {
    return { ok: false, status: 400, error: `Apply to at most ${SHARED_SCORING_MAX_LEAGUES} leagues at a time.` }
  }
  // Premium is the user's, not the league's: asked once.
  const premium = src.source.needsPremium ? await userHasAdvancedScoring(input.userId) : true
  if (!premium) {
    return {
      ok: false,
      status: 403,
      error: 'Sharing a custom scoring table requires AF Commissioner Subscription.',
      code: 'premiumRequired',
    }
  }

  const rows = (await prisma.league.findMany({ where: { id: { in: ids } }, select: LEAGUE_SELECT })) as LeagueRow[]
  const byId = new Map(rows.map((r) => [r.id, r]))
  const results: SharedScoringResult[] = []
  // One league at a time: each save reads and rewrites its league's settings, and the league log keeps their order.
  for (const id of ids) {
    const row = byId.get(id)
    const name = row?.name ?? 'Untitled league'
    if (!row) {
      results.push({ leagueId: id, name, outcome: 'not_found', message: 'League not found.' })
      continue
    }
    const incompatible = sharedScoringIncompatibility(row)
    if (row.sport === src.source.sport && incompatible) {
      results.push({ leagueId: id, name, outcome: 'incompatible', message: SHARED_SCORING_INCOMPATIBILITY_MESSAGE[incompatible], incompatibility: incompatible })
      continue
    }
    try {
      const res = await applySportScoringToLeague({
        leagueId: id,
        userId: input.userId,
        sport: src.source.sport,
        presetKey: src.source.presetKey,
        rules: src.rules,
        confirmationBody: { [MID_SEASON_CONFIRM_FLAG]: input.confirmMidSeasonChange === true },
        source: 'shared-scoring',
        // The source league's id only: the log is read by this league's members, and the other league is not theirs.
        detail: { sharedFromLeagueId: src.source.id },
        premium,
      })
      results.push(
        res.ok
          ? { leagueId: id, name, outcome: 'saved', message: null }
          : { leagueId: id, name, outcome: res.outcome, message: String(res.body.message ?? res.body.error ?? '') || null },
      )
    } catch (e) {
      results.push({ leagueId: id, name, outcome: 'refused', message: e instanceof Error ? e.message : 'Could not save.' })
    }
  }
  return { ok: true, results, saved: results.filter((r) => r.outcome === 'saved').length }
}
