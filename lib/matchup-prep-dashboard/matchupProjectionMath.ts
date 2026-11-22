import type { StartSitAnalyzeResult, StartSitPlayerRow } from '@/lib/ai-tools-start-sit/runStartSitAnalysis'
import type { MatchupPositionEdge, MatchupSlotEdge } from './types'

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export function roundToTenth(n: number): number {
  return Math.round(n * 10) / 10
}

function normalCdf(z: number): number {
  const absZ = Math.abs(z)
  const t = 1 / (1 + 0.2316419 * absZ)
  const d = 0.3989423 * Math.exp(-0.5 * z * z)
  const p =
    d *
    t *
    (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return z >= 0 ? 1 - p : p
}

/**
 * Logistic on mean projected point differential — used only when spread variance is unavailable.
 */
export function winProbFromMeanEdgeLogistic(edge: number): number {
  const p = 1 / (1 + Math.exp(-edge / 6.5))
  return clamp(Math.round(p * 100), 5, 95)
}

type BandAgg = { mean: number; variance: number; starterCount: number }

/**
 * Approximate team total variance from per-starter projection bands (floor/ceiling).
 * Win probability = P(you − opp > 0) under independent normal totals (rough but data-grounded).
 */
export function aggregateStarterBands(
  players: StartSitPlayerRow[],
  starterIds: Set<string>,
): BandAgg {
  const useStarters = starterIds.size > 0
  let mean = 0
  let varSum = 0
  let starterCount = 0
  for (const p of players) {
    if (p.projectedPoints == null) continue
    if (useStarters && !starterIds.has(p.playerId)) continue
    mean += p.projectedPoints
    starterCount += 1
    const low = p.floor ?? p.projectedPoints * 0.78
    const high = p.ceiling ?? p.projectedPoints * 1.22
    const halfWidth = Math.max(0.35, (high - low) / 2)
    const sigma = halfWidth / 1.35
    varSum += sigma * sigma
  }
  return { mean, variance: varSum, starterCount }
}

export function winProbabilityFromProjectionSpread(args: {
  my: BandAgg
  opp: BandAgg
}): { pct: number; model: 'starter_spread_normal'; z: number; combinedSigma: number } | null {
  if (args.my.starterCount < 1 || args.opp.starterCount < 1) return null
  const edge = args.my.mean - args.opp.mean
  const combinedSigma = Math.sqrt(Math.max(0.08, args.my.variance + args.opp.variance))
  if (!Number.isFinite(combinedSigma) || combinedSigma < 0.2) return null
  const z = edge / combinedSigma
  const pct = clamp(Math.round(normalCdf(z) * 100), 5, 95)
  return { pct, model: 'starter_spread_normal', z, combinedSigma }
}

function normPos(p: string): string {
  const u = p.toUpperCase()
  if (u.includes('QB')) return 'QB'
  if (u.includes('RB')) return 'RB'
  if (u.includes('WR')) return 'WR'
  if (u.includes('TE')) return 'TE'
  if (u.includes('K')) return 'K'
  if (u.includes('DEF') || u.includes('DST')) return 'DST'
  if (u.includes('FLEX')) return 'FLEX'
  return u.slice(0, 4)
}

export function sumLineupByPosition(
  players: StartSitPlayerRow[],
  starterIds: Set<string>,
  fallbackStarterCap?: number | null,
): { total: number; byPos: Record<string, number>; usedFallback: boolean } {
  const byPos: Record<string, number> = {}
  let total = 0
  if (starterIds.size > 0) {
    for (const p of players) {
      if (p.projectedPoints == null) continue
      if (!starterIds.has(p.playerId)) continue
      const k = normPos(p.position)
      byPos[k] = (byPos[k] ?? 0) + p.projectedPoints
      total += p.projectedPoints
    }
    return { total: roundToTenth(total), byPos, usedFallback: false }
  }
  // Fallback: starter JSON missing. Take the top-N by projection so we don't
  // overcount the whole roster (bench included). N comes from the league's
  // expected starter-slot count; defaults to 9 if unknown.
  const cap = fallbackStarterCap != null && fallbackStarterCap > 0 ? fallbackStarterCap : 9
  const ranked = [...players]
    .filter((p) => p.projectedPoints != null)
    .sort((a, b) => (b.projectedPoints ?? 0) - (a.projectedPoints ?? 0))
    .slice(0, cap)
  for (const p of ranked) {
    const k = normPos(p.position)
    byPos[k] = (byPos[k] ?? 0) + (p.projectedPoints ?? 0)
    total += p.projectedPoints ?? 0
  }
  return { total: roundToTenth(total), byPos, usedFallback: true }
}

export function buildPositionEdges(myBy: Record<string, number>, oppBy: Record<string, number>): MatchupPositionEdge[] {
  const keys = new Set([...Object.keys(myBy), ...Object.keys(oppBy)])
  const out: MatchupPositionEdge[] = []
  for (const position of keys) {
    const myPoints = roundToTenth(myBy[position] ?? 0)
    const oppPoints = roundToTenth(oppBy[position] ?? 0)
    out.push({ position, myPoints, oppPoints, edge: roundToTenth(myPoints - oppPoints) })
  }
  out.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))
  return out
}

function bestProjForCandidates(
  names: string[],
  byLower: Map<string, StartSitPlayerRow>,
): { name: string; proj: number } | null {
  let best: { name: string; proj: number } | null = null
  for (const n of names) {
    const row = byLower.get(n.toLowerCase())
    if (row?.projectedPoints != null) {
      if (!best || row.projectedPoints > best.proj) {
        best = { name: row.name, proj: row.projectedPoints }
      }
    }
  }
  return best
}

/**
 * Slot-level edge: compares best projected eligible starter per template slot (Start/Sit template parity).
 */
export function buildSlotEdgesFromStartSit(my: StartSitAnalyzeResult, opp: StartSitAnalyzeResult): MatchupSlotEdge[] {
  const myPlayers = new Map(my.players.map((p) => [p.name.toLowerCase(), p]))
  const oppPlayers = new Map(opp.players.map((p) => [p.name.toLowerCase(), p]))
  const out: MatchupSlotEdge[] = []

  for (const slot of my.lineupSlotAnalysis) {
    const oppSlot = opp.lineupSlotAnalysis.find((s) => s.slotName === slot.slotName)
    const myBest = bestProjForCandidates(slot.topCandidates, myPlayers)
    const oppBest = oppSlot ? bestProjForCandidates(oppSlot.topCandidates, oppPlayers) : null
    const myPoints = myBest?.proj ?? 0
    const oppPoints = oppBest?.proj ?? 0
    out.push({
      slotName: slot.slotName,
      myPoints: roundToTenth(myPoints),
      oppPoints: roundToTenth(oppPoints),
      edge: roundToTenth(myPoints - oppPoints),
      myStarterName: myBest?.name ?? null,
      oppStarterName: oppBest?.name ?? null,
    })
  }

  return out.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))
}
