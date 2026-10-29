/**
 * Pure view-model for the Guillotine specialty home. No fetching, no rules: every tier comes from
 * the engine's `getDangerTiers` (summary.dangerTiers) exactly as served.
 */

export type DangerTierRow = { rosterId: string; displayName?: string; tier: string; pointsFromChopZone: number; immune?: boolean }

export interface ChopLineRow {
  rosterId: string
  rank: number
  name: string
  /** The score the engine ranked on (period points, or its fallback); null when not served. */
  points: number | null
  /** Points above the cut (lowest score); 0 for the chop zone. */
  margin: number
  tier: 'safe' | 'danger' | 'chop_zone'
  /** Last week's top scorer: this week's chop cannot take it (Chop Watch, lib/guillotine/chopWatch.ts). */
  immune: boolean
  isMe: boolean
  /** Bar width, 0–100, relative to the top score. */
  barPct: number
  /** Draw the dashed cut line above this row (the first chop-zone row). */
  cutAbove: boolean
}

export interface ChopLine {
  rows: ChopLineRow[]
  cutScore: number | null
  me: ChopLineRow | null
  alive: number
}

/**
 * Sorted safest-first by the engine's margin. `scores` is the engine's own ranking score per roster
 * (summary.home.scores); without it the line still orders and tags correctly but has no score to
 * print (`points` null).
 */
export function buildChopLine(
  tiers: readonly DangerTierRow[] | null | undefined,
  myRosterId: string | null | undefined,
  scores?: Record<string, number> | null,
): ChopLine {
  const list = [...(tiers ?? [])]
  if (list.length === 0) return { rows: [], cutScore: null, me: null, alive: 0 }
  const sorted = list.sort((a, b) => b.pointsFromChopZone - a.pointsFromChopZone)
  const scoreOf = (t: DangerTierRow): number | null => {
    const v = scores?.[t.rosterId]
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  }
  const zone = list.find((t) => t.tier === 'chop_zone')
  const cutScore = zone ? scoreOf(zone) : null
  // Bars scale on the score when known, else on the margin (same order either way).
  const barValue = (t: DangerTierRow) => scoreOf(t) ?? t.pointsFromChopZone
  const top = Math.max(...sorted.map(barValue), 0)
  let cutDrawn = false
  const rows: ChopLineRow[] = sorted.map((t, i) => {
    const tier = t.tier === 'chop_zone' || t.tier === 'danger' ? t.tier : 'safe'
    const cutAbove = tier === 'chop_zone' && !cutDrawn
    if (cutAbove) cutDrawn = true
    return {
      rosterId: t.rosterId,
      rank: i + 1,
      name: t.displayName?.trim() || 'A team',
      points: scoreOf(t),
      margin: t.pointsFromChopZone,
      tier,
      immune: t.immune === true,
      isMe: !!myRosterId && t.rosterId === myRosterId,
      barPct: top > 0 ? Math.max(4, Math.min(100, (barValue(t) / top) * 100)) : 4,
      cutAbove,
    }
  })
  return { rows, cutScore, me: rows.find((r) => r.isMe) ?? null, alive: rows.length }
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

/** Hero headline for the viewer, worded from the engine's tier. */
export function guillotineHeadline(args: {
  week: number
  me: ChopLineRow | null
  alive: number
  myChoppedWeek: number | null
}): string {
  const { week, me, alive, myChoppedWeek } = args
  if (myChoppedWeek != null) return `Week ${week} · You were chopped in week ${myChoppedWeek}`
  if (!me) return `Week ${week} · ${alive} alive`
  if (me.tier === 'chop_zone') return `Week ${week} · You’re in the chop zone`
  return `Week ${week} · You’re ${me.margin.toFixed(1)} points over the cut`
}

const TIEBREAK_LABEL: Record<string, string> = {
  season_points: 'Total season points',
  previous_period: 'Last week’s points',
  draft_slot: 'Draft slot, week 1 only (the later slot loses)',
  bench_points: 'Bench points',
  commissioner: 'Commissioner decision',
  random: 'Random draw',
}

/** The league's configured tiebreak order in words (falls back to the step id). */
export function tiebreakLabels(order: readonly string[] | null | undefined): string[] {
  return (order ?? []).map((s) => TIEBREAK_LABEL[s] ?? s.replace(/_/g, ' '))
}

/** Tier → the spec's words. Colour is never the only signal; this text always renders. */
export function tierLabel(tier: ChopLineRow['tier']): string {
  return tier === 'chop_zone' ? 'Chop zone' : tier === 'danger' ? 'Danger' : 'Safe'
}
