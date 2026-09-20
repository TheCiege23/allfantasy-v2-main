import type { PlayoffRoundKey, PlayoffSeriesView, PlayoffSport } from "./types"

/**
 * The mirrored bracket, derived from the series rows the database already
 * holds.
 *
 * 🛑 NOTHING HERE INVENTS STRUCTURE. The prototype this was built from carried
 * its own hard-coded SLOTS/CHILDREN graph; that would be a second source of
 * truth for a shape `buildPlayoffTemplate` already owns, and the two would
 * drift the first time a round changed. Every edge below is read off
 * `sourceSeriesHome` / `sourceSeriesAway`, which is the same wiring the pick
 * cascade and the results sync use.
 *
 * ⚠ IT IS SPORT-AGNOSTIC ON PURPOSE even though only MLB renders it today: the
 * NBA and NHL templates have the identical shape (two halves, four rounds,
 * one cross-half final), so a per-sport copy would be three copies of one
 * algorithm waiting to disagree.
 */

/** Which half of the draw a column belongs to, reading outward from the final. */
export type BracketSide = "left" | "right"

export type BracketNode = {
  series: PlayoffSeriesView
  /** 1-based, 1 = first round played. */
  roundIndex: number
  side: BracketSide
  /** Series numbers feeding this node, in home/away order. */
  sourceHome: number | null
  sourceAway: number | null
}

export type BracketColumn = {
  roundIndex: number
  side: BracketSide
  round: PlayoffRoundKey
  nodes: BracketNode[]
}

export type BracketGraph = {
  /** Columns ordered left-to-right as the mirrored tree renders them. */
  columns: BracketColumn[]
  /** The single cross-half final, if the template has one. */
  final: BracketNode | null
  /** seriesNumber -> the nodes that consume its winner. */
  children: Map<number, number[]>
  byNumber: Map<number, BracketNode>
  /** Conference value for each half, e.g. "al" / "nl". Empty when unsplit. */
  sides: { left: string | null; right: string | null }
}

/**
 * The half a conference sits on. The FIRST conference encountered in series
 * order takes the left; nothing here hard-codes "al" or "east", so a new
 * sport's vocabulary needs no change.
 */
function resolveSides(series: PlayoffSeriesView[]): { left: string | null; right: string | null } {
  const seen: string[] = []
  for (const s of series) {
    const c = String(s.conference ?? "").toLowerCase()
    if (!c || c === "finals") continue
    if (!seen.includes(c)) seen.push(c)
  }
  return { left: seen[0] ?? null, right: seen[1] ?? null }
}

export function buildBracketGraph(series: PlayoffSeriesView[]): BracketGraph {
  const sides = resolveSides(series)
  const byNumber = new Map<number, BracketNode>()
  const children = new Map<number, number[]>()

  const sideOf = (s: PlayoffSeriesView): BracketSide => {
    const c = String(s.conference ?? "").toLowerCase()
    return c && c === sides.right ? "right" : "left"
  }

  for (const s of series) {
    byNumber.set(s.seriesNumber, {
      series: s,
      roundIndex: s.roundIndex,
      side: sideOf(s),
      sourceHome: s.sourceSeriesHome ?? null,
      sourceAway: s.sourceSeriesAway ?? null,
    })
  }

  for (const node of byNumber.values()) {
    for (const src of [node.sourceHome, node.sourceAway]) {
      if (src == null) continue
      const list = children.get(src) ?? []
      list.push(node.series.seriesNumber)
      children.set(src, list)
    }
  }

  const final =
    [...byNumber.values()].find((n) => String(n.series.conference ?? "").toLowerCase() === "finals") ?? null

  const maxRound = series.reduce((m, s) => Math.max(m, s.roundIndex), 0)
  const columns: BracketColumn[] = []

  /*
   * Left half outward-in, then the right half inward-out — the classic
   * mirrored layout. The final is not a column; it renders in the centre slot
   * so the two halves meet at it.
   */
  const half = (side: BracketSide, order: number[]) => {
    for (const roundIndex of order) {
      const nodes = [...byNumber.values()]
        .filter((n) => n.side === side && n.roundIndex === roundIndex && n !== final)
        .sort((a, b) => a.series.seriesNumber - b.series.seriesNumber)
      if (nodes.length === 0) continue
      columns.push({ roundIndex, side, round: nodes[0].series.round, nodes })
    }
  }

  const ascending = Array.from({ length: maxRound }, (_, i) => i + 1)
  half("left", ascending)
  half("right", [...ascending].reverse())

  return { columns, final, children, byNumber, sides }
}

/** Every series number downstream of this one, transitively. */
export function descendantsOf(seriesNumber: number, graph: BracketGraph): Set<number> {
  const out = new Set<number>()
  const queue = [seriesNumber]
  while (queue.length) {
    const n = queue.shift()
    if (n == null) continue
    for (const child of graph.children.get(n) ?? []) {
      if (out.has(child)) continue
      out.add(child)
      queue.push(child)
    }
  }
  return out
}

export type SeriesOdds = { home: number; away: number; basis: "live" | "seed" | "unknown" }

/**
 * Win probability for a series.
 *
 * ⚠ LABELLED BY BASIS, NOT DRESSED UP AS A MODEL. `seed` is the design's own
 * formula — the better seed is favoured on a fixed slope — and it is arithmetic
 * on two integers, not a forecast. A surface that shows this must say so; the
 * one thing it must never do is imply a scouting model that does not exist.
 *
 * ⚠ RETURNS `unknown` RATHER THAN 50/50 WHEN A SIDE IS UNRESOLVED. An even
 * split is a claim; "we cannot say yet" is the truth, and the caller renders
 * TBD instead of two confident halves.
 */
export function seriesOdds(series: PlayoffSeriesView): SeriesOdds {
  const homeSeed = Number(series.homeSeed)
  const awaySeed = Number(series.awaySeed)
  if (!Number.isFinite(homeSeed) || !Number.isFinite(awaySeed) || homeSeed <= 0 || awaySeed <= 0) {
    return { home: 50, away: 50, basis: "unknown" }
  }
  // The design's slope: four points per seed of separation, clamped 30..80.
  const raw = 50 + (awaySeed - homeSeed) * 4
  const home = Math.max(30, Math.min(80, Math.round(raw)))
  return { home, away: 100 - home, basis: "seed" }
}

/** True once both sides name a real club rather than a placeholder. */
export function isResolved(series: PlayoffSeriesView, isOfficial: (n: string | null) => boolean): boolean {
  return isOfficial(series.homeTeamName) && isOfficial(series.awayTeamName)
}

export type SeriesStatusKind = "live" | "final" | "scheduled" | "tbd"

export function seriesStatusKind(
  series: PlayoffSeriesView,
  resolved: boolean,
): SeriesStatusKind {
  if (!resolved) return "tbd"
  if (series.status === "final" || series.winnerTeamName) return "final"
  if (series.status === "in_progress" || series.liveStatus) return "live"
  return "scheduled"
}

/**
 * The short record line a status cell shows ("CLE leads 2-1", "Tied 1-1").
 * Prefers the provider's own summary; falls back to the win columns.
 */
export function seriesRecordLine(series: PlayoffSeriesView): string | null {
  const summary = series.seriesSummary?.trim()
  if (summary) return summary
  const hw = Number(series.homeTeamWins ?? 0)
  const aw = Number(series.awayTeamWins ?? 0)
  if (!hw && !aw) return null
  if (hw === aw) return `Tied ${hw}-${aw}`
  const leaderIsHome = hw > aw
  const leader = leaderIsHome ? series.homeTeamName : series.awayTeamName
  return `${leader} leads ${Math.max(hw, aw)}-${Math.min(hw, aw)}`
}

/** Abbreviation for a club name — initials when we hold no short name. */
export function abbreviate(name: string | null | undefined): string {
  const text = String(name ?? "").trim()
  if (!text) return "—"
  // Already an abbreviation or a seed slot ("AL1", "NYY").
  if (/^[A-Z0-9]{2,4}$/.test(text)) return text
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  // Club names are "City Nickname" — the nickname is what fans read.
  return words[words.length - 1].slice(0, 3).toUpperCase()
}

export type SportRoundLabels = Partial<Record<PlayoffRoundKey, string>>

/** Short round labels for the column headers, per sport vocabulary. */
export const ROUND_SHORT_LABELS: Record<string, SportRoundLabels> = {
  mlb: {
    wild_card: "Wild Card",
    division_series: "Division",
    league_championship: "Championship",
    world_series: "World Series",
  },
  nba: {
    round_1: "Round 1",
    conference_semifinals: "Conf. Semis",
    conference_finals: "Conf. Finals",
    finals: "Finals",
  },
  nhl: {
    round_1: "Round 1",
    conference_semifinals: "Round 2",
    conference_finals: "Conf. Finals",
    finals: "Stanley Cup",
  },
}

export function roundLabel(sport: PlayoffSport | string | null | undefined, round: PlayoffRoundKey): string {
  const table = ROUND_SHORT_LABELS[String(sport ?? "").toLowerCase()] ?? {}
  return table[round] ?? round.replace(/_/g, " ")
}

/** League label for a half ("American League"), from the conference value. */
export function sideLabel(conference: string | null): string {
  switch (String(conference ?? "").toLowerCase()) {
    case "al":
      return "American League"
    case "nl":
      return "National League"
    case "east":
      return "Eastern Conference"
    case "west":
      return "Western Conference"
    default:
      return ""
  }
}
