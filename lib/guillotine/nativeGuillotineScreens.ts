/**
 * The Matchup and Standings tabs of a guillotine league that plays on AllFantasy.
 *
 * 🛑 BOTH TABS ASSUMED HEAD-TO-HEAD, AND A GUILLOTINE LEAGUE HAS NONE. Its season is created with no
 * matchups on purpose (`finalizeDraftToRedraftSeason`), so the Matchup tab said "your team has a bye"
 * every week and the Standings tab ranked a field of 0-0 teams with playoff seeds, never saying who had
 * been chopped. The league's real state was only on the Guilly tab.
 *
 * Both tabs now read the same summary the Guilly tab reads (`/api/leagues/[id]/guillotine/summary`), so
 * the three cannot disagree. This is the pure half: which leagues, and the survival table.
 */

import { isNativePlatform } from '@/lib/dashboard/platform-label'

/** A league hosted here whose format is guillotine, by any of the three ways a row can say so. */
export function isNativeGuillotineLeague(league: {
  platform?: string | null
  guillotineMode?: boolean | null
  leagueVariant?: string | null
  leagueType?: string | null
}): boolean {
  // An imported guillotine league keeps its provider's schedule and its own Guilly tab; it has no chop
  // engine data here, and most imports carry `leagueType: 'guillotine'` too.
  if (!isNativePlatform(league.platform)) return false
  return isGuillotineFormat(league)
}

/** The format alone, whoever hosts the league. */
export function isGuillotineFormat(league: { guillotineMode?: boolean | null; leagueVariant?: string | null; leagueType?: string | null }): boolean {
  const is = (v: string | null | undefined) => String(v ?? '').trim().toLowerCase() === 'guillotine'
  return league.guillotineMode === true || is(league.leagueVariant) || is(league.leagueType)
}

export type SurvivalAliveRow = { rosterId: string; name: string; rank: number; seasonPoints: number | null; weekPoints: number | null; isMe: boolean }
export type SurvivalChoppedRow = { rosterId: string; name: string; week: number | null; points: number | null; isMe: boolean }
export type SurvivalTable = { alive: SurvivalAliveRow[]; chopped: SurvivalChoppedRow[] }

type SummaryForTable = {
  myRosterId?: string | null
  survivalStandings?: ReadonlyArray<{ rosterId: string; displayName?: string; rank: number; seasonPointsCumul: number }> | null
  dangerTiers?: ReadonlyArray<{ rosterId: string; displayName?: string }> | null
  home?: {
    scores?: Record<string, number> | null
    chopped?: ReadonlyArray<{ rosterId: string; name: string; week: number | null; points: number | null }> | null
  } | null
}

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * Who is still in, best first, then who has been chopped, most recent first.
 *
 * The teams alive are every team the chop line knows (`dangerTiers`), not only the ones with a sealed
 * week on file: season totals are written when a week is chopped, so before the first chop that list is
 * empty while the whole field is alive. A team with no sealed week keeps its place below those with one
 * and shows no total, never a 0.
 */
export function buildSurvivalTable(summary: SummaryForTable): SurvivalTable {
  const me = summary.myRosterId ?? null
  const choppedIds = new Set((summary.home?.chopped ?? []).map((c) => c.rosterId))
  const sealed = new Map((summary.survivalStandings ?? []).map((s) => [s.rosterId, s]))
  const names = new Map<string, string>()
  for (const t of summary.dangerTiers ?? []) if (t.displayName?.trim()) names.set(t.rosterId, t.displayName.trim())
  for (const s of summary.survivalStandings ?? []) if (s.displayName?.trim() && !names.has(s.rosterId)) names.set(s.rosterId, s.displayName.trim())

  const ids = [...new Set([...(summary.survivalStandings ?? []).map((s) => s.rosterId), ...(summary.dangerTiers ?? []).map((t) => t.rosterId)])].filter((id) => !choppedIds.has(id))
  const week = summary.home?.scores ?? {}
  const alive = ids
    .map((rosterId) => ({
      rosterId,
      name: names.get(rosterId) ?? 'A team',
      seasonPoints: finite(sealed.get(rosterId)?.seasonPointsCumul),
      weekPoints: finite(week[rosterId]),
      isMe: rosterId === me,
    }))
    .sort((a, b) => (b.seasonPoints ?? -Infinity) - (a.seasonPoints ?? -Infinity) || (b.weekPoints ?? -Infinity) - (a.weekPoints ?? -Infinity) || a.name.localeCompare(b.name))
    .map((r, i) => ({ ...r, rank: i + 1 }))

  const chopped = [...(summary.home?.chopped ?? [])]
    .map((c) => ({ rosterId: c.rosterId, name: c.name?.trim() || 'A team', week: c.week ?? null, points: finite(c.points), isMe: c.rosterId === me }))
    .sort((a, b) => (b.week ?? -1) - (a.week ?? -1) || a.name.localeCompare(b.name))
  return { alive, chopped }
}
