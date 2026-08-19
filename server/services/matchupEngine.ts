/**
 * Head-to-head resolution: compare team week totals, assign W / L / T.
 * Optional tiebreaker from `scoringSettings.rules.matchupTiebreaker` (e.g. bench_points).
 *
 * Category-mode leagues (settings.scoring_mode === 'h2h_category') branch into
 * `resolveCategoryOutcomesForWeek`, which reads the per-team stat totals that
 * weeklyProcessor wrote into TeamWeekResult.categoryBreakdown, resolves per-
 * category winners, and rewrites each row with the full breakdown.
 */
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { parseSettingsSnapshot } from '@/lib/league-contract/types'
import { getMatchupTiebreakerMode } from '@/lib/scoring-engine/scoringSettingsResolved'
import {
  getCategoryPresetDefinitions,
  resolveCategoryMatchup,
  type CategoryMatchupResult,
  type TeamStatTotals,
} from '@/lib/category-scoring'

function resolveScoringMode(settingsJson: unknown): 'points' | 'h2h_category' | 'roto' {
  if (!settingsJson || typeof settingsJson !== 'object') return 'points'
  const raw = (settingsJson as Record<string, unknown>).scoring_mode
  return raw === 'h2h_category' || raw === 'roto' ? raw : 'points'
}

function resolveCategoryPresetId(settingsJson: unknown): string | null {
  if (!settingsJson || typeof settingsJson !== 'object') return null
  const raw = (settingsJson as Record<string, unknown>).category_preset_id
  return typeof raw === 'string' && raw.length > 0 ? raw : null
}

function extractTeamStatsFromBreakdown(breakdown: unknown): TeamStatTotals {
  if (!breakdown || typeof breakdown !== 'object') return {}
  const teamStats = (breakdown as Record<string, unknown>).teamStats
  if (!teamStats || typeof teamStats !== 'object') return {}
  const out: TeamStatTotals = {}
  for (const [key, value] of Object.entries(teamStats)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
  }
  return out
}

async function sumNonStarterPoints(
  leagueId: string,
  season: number,
  week: number,
  rosterId: string,
): Promise<number> {
  const rows = await prisma.weeklyScore.findMany({
    where: { leagueId, season, week, rosterId, isStarter: false },
    select: { points: true },
  })
  let s = 0
  for (const r of rows) {
    s += Number(r.points) || 0
  }
  return Math.round(s * 100) / 100
}

async function resolveCategoryOutcomesForWeek(
  leagueId: string,
  season: number,
  week: number,
  categoryPresetId: string,
): Promise<void> {
  const categories = getCategoryPresetDefinitions(categoryPresetId)
  if (!categories) {
    console.warn(
      '[matchupEngine] category preset not found, falling back to no-op',
      { leagueId, categoryPresetId },
    )
    return
  }

  const rows = await prisma.teamWeekResult.findMany({
    where: { leagueId, season, week },
  })
  const byId = new Map(rows.map((r) => [r.rosterId, r]))

  // Cache resolved matchups by unordered pair so we don't recompute on each side.
  const resolved = new Map<string, { forA: CategoryMatchupResult; forB: CategoryMatchupResult }>()
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

  for (const r of rows) {
    const oppId = r.opponentRosterId
    if (!oppId) {
      await prisma.teamWeekResult.update({
        where: { id: r.id },
        data: { winLoss: null },
      })
      continue
    }
    const opp = byId.get(oppId)
    if (!opp) continue

    const key = pairKey(r.rosterId, oppId)
    let pairResult = resolved.get(key)
    if (!pairResult) {
      // r is always "a" from r's perspective — compute once, invert for opp.
      const aStats = extractTeamStatsFromBreakdown(r.categoryBreakdown)
      const bStats = extractTeamStatsFromBreakdown(opp.categoryBreakdown)
      const forA = resolveCategoryMatchup(aStats, bStats, categories)
      const forB: CategoryMatchupResult = {
        categories: forA.categories.map((c) => ({
          ...c,
          aValue: c.bValue,
          bValue: c.aValue,
          winner: c.winner === 'a' ? 'b' : c.winner === 'b' ? 'a' : 'tie',
        })),
        aWins: forA.bWins,
        bWins: forA.aWins,
        ties: forA.ties,
      }
      pairResult = { forA, forB }
      resolved.set(key, pairResult)
    }

    // Row `r` may be either side of the pair depending on hash order.
    const mine = r.rosterId < oppId ? pairResult.forA : pairResult.forB
    let wl: string
    if (mine.aWins > mine.bWins) wl = 'W'
    else if (mine.aWins < mine.bWins) wl = 'L'
    else {
      // Equal category wins — fall back to fantasy points (preserved on
      // TeamWeekResult.totalPoints alongside category stats).
      const a = Number(r.totalPoints) || 0
      const b = Number(opp.totalPoints) || 0
      if (a > b) wl = 'W'
      else if (a < b) wl = 'L'
      else wl = 'T'
    }

    await prisma.teamWeekResult.update({
      where: { id: r.id },
      data: {
        winLoss: wl,
        categoryBreakdown: toPrismaJsonInput({
          teamStats: extractTeamStatsFromBreakdown(r.categoryBreakdown),
          matchup: {
            categories: mine.categories,
            aWins: mine.aWins,
            bWins: mine.bWins,
            ties: mine.ties,
          },
        }),
      },
    })
  }
}

export async function resolveMatchupOutcomesForWeek(
  leagueId: string,
  season: number,
  week: number,
): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true },
  })
  const scoringMode = resolveScoringMode(league?.settings ?? null)
  if (scoringMode === 'h2h_category' || scoringMode === 'roto') {
    const presetId = resolveCategoryPresetId(league?.settings ?? null)
    if (presetId) {
      await resolveCategoryOutcomesForWeek(leagueId, season, week, presetId)
      return
    }
    console.warn(
      '[matchupEngine] category scoring mode without category_preset_id; falling back to points',
      { leagueId, scoringMode },
    )
  }

  const snap = parseSettingsSnapshot(league?.settings ?? null)
  const scoringSettings = (snap?.scoringSettings ?? null) as Record<string, unknown> | null
  const tieMode = getMatchupTiebreakerMode(scoringSettings)

  const rows = await prisma.teamWeekResult.findMany({
    where: { leagueId, season, week },
  })
  const byId = new Map(rows.map((r) => [r.rosterId, r]))

  for (const r of rows) {
    const oppId = r.opponentRosterId
    if (!oppId) {
      await prisma.teamWeekResult.update({
        where: { id: r.id },
        data: { winLoss: null },
      })
      continue
    }
    const opp = byId.get(oppId)
    if (!opp) continue

    const a = Number(r.totalPoints) || 0
    const b = Number(opp.totalPoints) || 0
    let wl: string

    if (a > b) wl = 'W'
    else if (a < b) wl = 'L'
    else {
      if (tieMode === 'bench_points') {
        const benchA = await sumNonStarterPoints(leagueId, season, week, r.rosterId)
        const benchB = await sumNonStarterPoints(leagueId, season, week, opp.rosterId)
        if (benchA > benchB) wl = 'W'
        else if (benchA < benchB) wl = 'L'
        else wl = 'T'
      } else {
        wl = 'T'
      }
    }

    await prisma.teamWeekResult.update({
      where: { id: r.id },
      data: { winLoss: wl },
    })
  }
}
