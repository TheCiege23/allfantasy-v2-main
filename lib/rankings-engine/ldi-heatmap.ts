import { getV2Rankings, getPosTotalsFromPartnerCounts } from "./v2-adapter"

export type HeatmapPos = "QB" | "RB" | "WR" | "TE" | "FLEX" | "PICKS"

export type HeatmapCell = {
  pos: HeatmapPos
  ldi: number
  trend: number
  posSample: number
  leagueSample: number
  tag: "HOT" | "COLD" | "NEUTRAL" | "LEARNING" | "LOW_LEAGUE_SAMPLE"
  topTargets: Array<{
    rosterId: string
    name: string
    score: number
    ldiByPos: number
    meanPremiumPct: number
    nByPos: number
  }>
  evidence: Array<{ key: string; value: string | number }>
}

export type LDIHeatmapResponse = {
  leagueId: string
  leagueName: string
  season: string
  week: number
  phase: string
  computedAt: number
  cells: HeatmapCell[]
}

function tagCell(args: { ldi: number; posSample: number; leagueSample: number }) {
  const { ldi, posSample, leagueSample } = args
  if (leagueSample < 30) return "LOW_LEAGUE_SAMPLE" as const
  if (posSample < 3) return "LEARNING" as const
  if (ldi >= 70) return "HOT" as const
  if (ldi <= 35) return "COLD" as const
  return "NEUTRAL" as const
}

export async function buildLDIHeatmap(args: {
  leagueId: string
  week: number
  positions?: HeatmapPos[]
}): Promise<LDIHeatmapResponse> {
  const positions: HeatmapPos[] = args.positions ?? ["QB", "RB", "WR", "TE"]

  const v2 = await getV2Rankings({ leagueId: args.leagueId, week: args.week })
  const meta = v2.meta

  const leagueSample = Number(meta.ldiSampleTotal ?? 0)
  const posTotals = getPosTotalsFromPartnerCounts(meta)

  const cells: HeatmapCell[] = positions.map((pos) => {
    const ldi = Number(meta.ldiByPos?.[pos] ?? 50)
    const trend = Number(meta.ldiTrend?.[pos] ?? 0)
    const posSample = Number(posTotals?.[pos] ?? 0)
    const tag = tagCell({ ldi, posSample, leagueSample })

    // Facts only, picked field by field: a characterisation label on a named manager is shown to
    // nobody (Milestone 32), and an explicit pick keeps one out even if an upstream payload still
    // carries it.
    const topTargets = (meta.proposalTargets ?? [])
      .filter((t) => t.position === pos)
      .slice(0, 3)
      .map((t) => ({
        rosterId: t.rosterId,
        name: t.name,
        score: t.score,
        ldiByPos: t.ldiByPos,
        meanPremiumPct: t.meanPremiumPct,
        nByPos: t.nByPos,
      }))

    return {
      pos,
      ldi: Math.round(ldi),
      trend: Math.round(trend),
      posSample,
      leagueSample,
      tag,
      topTargets,
      evidence: [
        { key: "LDI", value: Math.round(ldi) },
        { key: "Trend", value: Math.round(trend) },
        { key: "Pos sample", value: posSample },
        { key: "League sample", value: leagueSample }
      ]
    }
  })

  return {
    leagueId: v2.leagueId,
    leagueName: v2.leagueName,
    season: v2.season,
    week: v2.week,
    phase: v2.phase,
    computedAt: v2.computedAt,
    cells
  }
}
