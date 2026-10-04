import { accumulateTeamTotals, getCategoryPresetDefinitions, rankRotisserieTeams, type TeamStatTotals } from '@/lib/category-scoring'
/**
 * Aggregate season standings from `team_week_results` (deterministic).
 * Tie order from `scoringSettings.rules.standingsTiebreakerOrder` when present.
 *
 * H2H-category leagues additionally accumulate per-category wins/losses/ties
 * from TeamWeekResult.categoryBreakdown.matchup and rank primarily by total
 * category wins. Points-mode leagues ignore the category columns entirely.
 */
import { prisma } from '@/lib/prisma'
import { parseSettingsSnapshot } from '@/lib/league-contract/types'
import {
  getStandingsTiebreakerOrder,
  type StandingsTiebreakerKey,
} from '@/lib/scoring-engine/scoringSettingsResolved'

type Agg = {
  rosterId: string
  w: number
  l: number
  t: number
  pf: number
  pa: number
  /** Category totals; all zero for points-mode leagues. */
  cw: number
  cl: number
  ct: number
}

function resolveScoringMode(settingsJson: unknown): 'points' | 'h2h_category' | 'roto' {
  if (!settingsJson || typeof settingsJson !== 'object') return 'points'
  const raw = (settingsJson as Record<string, unknown>).scoring_mode
  return raw === 'h2h_category' || raw === 'roto' ? raw : 'points'
}

function extractMatchupTotals(
  categoryBreakdown: unknown,
): { aWins: number; bWins: number; ties: number } | null {
  if (!categoryBreakdown || typeof categoryBreakdown !== 'object') return null
  const m = (categoryBreakdown as Record<string, unknown>).matchup
  if (!m || typeof m !== 'object') return null
  const obj = m as Record<string, unknown>
  const aWins = typeof obj.aWins === 'number' && Number.isFinite(obj.aWins) ? obj.aWins : null
  const bWins = typeof obj.bWins === 'number' && Number.isFinite(obj.bWins) ? obj.bWins : null
  const ties = typeof obj.ties === 'number' && Number.isFinite(obj.ties) ? obj.ties : null
  if (aWins == null || bWins == null || ties == null) return null
  return { aWins, bWins, ties }
}

function compareAgg(a: Agg, b: Agg, order: StandingsTiebreakerKey[]): number {
  for (const key of order) {
    if (key === 'wins') {
      if (b.w !== a.w) return b.w - a.w
      continue
    }
    if (key === 'pointsFor') {
      if (b.pf !== a.pf) return b.pf - a.pf
      continue
    }
    if (key === 'pointsAgainst') {
      if (a.pa !== b.pa) return a.pa - b.pa
      continue
    }
    if (key === 'rosterId') {
      if (a.rosterId !== b.rosterId) return a.rosterId.localeCompare(b.rosterId)
    }
  }
  return a.rosterId.localeCompare(b.rosterId)
}

/**
 * Category-mode ranking: cumulative category wins is the primary sort key.
 * Falls back to matchup wins, then pointsFor, then rosterId for determinism.
 * Mirrors industry convention (Yahoo / ESPN H2H-categories).
 */
function compareAggCategory(a: Agg, b: Agg): number {
  if (b.cw !== a.cw) return b.cw - a.cw
  if (b.w !== a.w) return b.w - a.w
  if (b.pf !== a.pf) return b.pf - a.pf
  return a.rosterId.localeCompare(b.rosterId)
}

function compareAggBestBallCumulative(a: Agg, b: Agg): number {
  if (b.pf !== a.pf) return b.pf - a.pf
  if (b.w !== a.w) return b.w - a.w
  return a.rosterId.localeCompare(b.rosterId)
}

export async function recomputeStandingsForSeason(leagueId: string, season: number): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true, bestBallMode: true, bbMatchupFormat: true },
  })
  const snap = parseSettingsSnapshot(league?.settings ?? null)
  const scoringSettings = (snap?.scoringSettings ?? null) as Record<string, unknown> | null
  const tieOrder = getStandingsTiebreakerOrder(scoringSettings)
  const scoringMode = resolveScoringMode(league?.settings ?? null)
  const isCategoryMode = scoringMode === 'h2h_category' || scoringMode === 'roto'
  const isBestBallCumulative = league?.bestBallMode === true && league?.bbMatchupFormat === 'cumulative'

  const rosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { id: true },
  })
  const rosterIds = new Set(rosters.map((r) => r.id))

  const results = await prisma.teamWeekResult.findMany({
    where: { leagueId, season, status: 'final' },
  })

  const aggMap = new Map<string, Agg>()
  for (const id of rosterIds) {
    aggMap.set(id, { rosterId: id, w: 0, l: 0, t: 0, pf: 0, pa: 0, cw: 0, cl: 0, ct: 0 })
  }

  for (const tr of results) {
    const row = aggMap.get(tr.rosterId)
    if (!row) continue
    row.pf += Number(tr.totalPoints) || 0
    const oppId = tr.opponentRosterId
    if (oppId && rosterIds.has(oppId)) {
      const oppRow = results.find(
        (x) => x.rosterId === oppId && x.week === tr.week,
      )
      row.pa += oppRow ? Number(oppRow.totalPoints) || 0 : 0
    }
    const wl = tr.winLoss
    if (wl === 'W') row.w += 1
    else if (wl === 'L') row.l += 1
    else if (wl === 'T') row.t += 1

    // Category totals only accumulate for category-mode leagues; points-mode
    // rows never write the `matchup` breakdown so this is a no-op for them.
    if (isCategoryMode) {
      const totals = extractMatchupTotals(tr.categoryBreakdown)
      if (totals) {
        // From this roster's perspective, `aWins` is always "this roster's
        // category wins" — matchupEngine inverts the breakdown before
        // persisting so every row reads first-person.
        row.cw += totals.aWins
        row.cl += totals.bWins
        row.ct += totals.ties
      }
    }
  }

  if (scoringMode === 'roto') {
    const settings=league?.settings as Record<string,any> | null
    const categories=getCategoryPresetDefinitions(settings?.category_preset_id)
    if(!categories) throw new Error('Rotisserie category preset is missing.')
    const stats=new Map<string,TeamStatTotals[]>()
    for(const r of results) {
      const raw=(r.categoryBreakdown as Record<string,any> | null)?.teamStats
      if(raw) stats.set(r.rosterId,[...(stats.get(r.rosterId)??[]),raw])
    }
    const ranked=rankRotisserieTeams([...rosterIds].map(id=>({id,stats:accumulateTeamTotals(stats.get(id)??[])})),categories)
    for(const [id,r] of ranked) {const row=aggMap.get(id)!;row.pf=r.total;row.w=0;row.l=0;row.t=0;row.pa=0}
  }
  const eachCategory = (league?.settings as Record<string,unknown> | null)?.category_record_mode !== 'most'
  const sorted = [...aggMap.values()].sort((x, y) =>
    scoringMode === 'roto' ? y.pf-x.pf || x.rosterId.localeCompare(y.rosterId) : isCategoryMode
      ? eachCategory ? ((y.cw + .5*y.ct)/Math.max(1,y.cw+y.cl+y.ct) - (x.cw + .5*x.ct)/Math.max(1,x.cw+x.cl+x.ct) || compareAggCategory(x,y)) : compareAgg(x,y,tieOrder)
      : isBestBallCumulative
        ? compareAggBestBallCumulative(x, y)
        : compareAgg(x, y, tieOrder),
  )

  let rank = 1
  for (const s of sorted) {
    // Category totals only persisted for category-mode leagues; points-mode
    // writes 0 (columns are nullable + default 0, so the DB tolerates either).
    const categoryPayload = isCategoryMode
      ? {
          categoryWinsFor: s.cw,
          categoryLossesFor: s.cl,
          categoryTiesFor: s.ct,
        }
      : {
          categoryWinsFor: 0,
          categoryLossesFor: 0,
          categoryTiesFor: 0,
        }
    await prisma.fantasyStanding.upsert({
      where: {
        leagueId_season_rosterId: { leagueId, season, rosterId: s.rosterId },
      },
      create: {
        leagueId,
        season,
        rosterId: s.rosterId,
        wins: s.w,
        losses: s.l,
        ties: s.t,
        pointsFor: s.pf,
        pointsAgainst: s.pa,
        rank,
        ...categoryPayload,
      },
      update: {
        wins: s.w,
        losses: s.l,
        ties: s.t,
        pointsFor: s.pf,
        pointsAgainst: s.pa,
        rank,
        ...categoryPayload,
      },
    })
    rank += 1
  }

  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId },
    select: { id: true, platformUserId: true },
  })
  const rosterByPlatform = new Map(
    (
      await prisma.roster.findMany({
        where: { leagueId },
        select: { id: true, platformUserId: true },
      })
    ).map((r) => [r.platformUserId, r.id]),
  )
  for (const t of teams) {
    const rid = rosterByPlatform.get(t.platformUserId ?? '')
    if (!rid) continue
    const st = aggMap.get(rid)
    if (!st) continue
    await prisma.leagueTeam
      .update({
        where: { id: t.id },
        data: {
          wins: st.w,
          losses: st.l,
          ties: st.t,
          pointsFor: st.pf,
          pointsAgainst: st.pa,
        },
      })
      .catch(() => {})
  }
}
