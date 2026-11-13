/**
 * worldCupRootingGuide.ts
 *
 * Deterministic "Who Should I Root For Today?" helper for World Cup
 * bracket pools. Builds 0–3 rooting recommendations from the current
 * user's own picks + the public match schedule.
 *
 * No LLM call. No external fetch. No other users' picks accessed.
 */
import type {
  WorldCupMatchView,
  WorldCupPickView,
  WorldCupRound,
} from "./types"

export type RootingImpact = "Low" | "Medium" | "High"

type RootingTag =
  | "Champion path"
  | "Knockout pick"
  | "Group pick"
  | "Third-place pick"
  | "Upside"

type RootingStatus =
  | "ready"
  | "no_entry"
  | "no_matches"
  | "incomplete"

export type RootingRecommendation = {
  teamName: string
  matchLabel: string
  reason: string
  impact: RootingImpact
  tag: RootingTag
  matchId: string
  matchStartsAt: string | null
}

type RootingGuideResult = {
  title: string
  status: RootingStatus
  windowLabel: string
  recommendations: RootingRecommendation[]
  /** Optional free-vs-pro / fallback lines shown beneath recommendations. */
  lockedLines?: string[]
}

/** Minimum entry shape needed to compute rooting recommendations. */
type WorldCupRootingGuideEntry = {
  id: string
  name: string
  championTeamId: string | null
  championTeamName: string | null
  isComplete: boolean
}

export type BuildWorldCupRootingGuideInput = {
  entry: WorldCupRootingGuideEntry | null
  matches: WorldCupMatchView[]
  picks: WorldCupPickView[]
  /** ISO string or Date — defaults to current time. Injected for tests. */
  now?: Date | string | null
  /** AF Pro entitlement — controls richer reasoning and 3 vs 1 recommendation cap. */
  hasBracketBrainAi?: boolean
}

const TITLE = "Who Should I Root For Today?"

const ROUND_LABELS: Record<WorldCupRound, string> = {
  round_of_32: "Round of 32",
  round_of_16: "Round of 16",
  quarterfinal: "Quarterfinal",
  semifinal: "Semifinal",
  third_place: "Third-Place Match",
  final: "Final",
}

const ROUND_IMPACT: Record<WorldCupRound, RootingImpact> = {
  round_of_32: "Medium",
  round_of_16: "Medium",
  quarterfinal: "Medium",
  semifinal: "High",
  third_place: "Low",
  final: "High",
}

function impactScore(impact: RootingImpact): number {
  return impact === "High" ? 3 : impact === "Medium" ? 2 : 1
}

function matchLabel(match: WorldCupMatchView): string {
  return `${match.homeTeamName} vs ${match.awayTeamName} — ${ROUND_LABELS[match.round]}`
}

function isSameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  )
}

function normalizeNow(now: Date | string | null | undefined): Date {
  if (!now) return new Date()
  if (typeof now === "string") return new Date(now)
  return now
}

/**
 * Deterministic rooting guide.
 *
 * Priority order:
 *   1. Champion pick playing → High impact (Champion path)
 *   2. Knockout pick (selectedTeamId matches a side of a scheduled match)
 *      → impact derived from round (final/semi = High, QF/R16/R32 = Medium)
 *   3. Falls back to "Upcoming matches" if no matches today
 *   4. Falls back to safe message if no picks intersect any upcoming match
 */
export function buildWorldCupRootingGuide(
  input: BuildWorldCupRootingGuideInput
): RootingGuideResult {
  const { entry, matches, picks, hasBracketBrainAi = false } = input

  if (!entry) {
    return {
      title: TITLE,
      status: "no_entry",
      windowLabel: "No bracket selected",
      recommendations: [],
    }
  }

  const nowDate = normalizeNow(input.now)

  // Schedulable matches — exclude completed/cancelled/postponed.
  const scheduledMatches = matches.filter(
    (m) =>
      m.status === "scheduled" ||
      m.status === "live" ||
      m.status === "halftime"
  )
  const withStart = scheduledMatches.filter((m) => m.startsAt != null)

  const todayMatches = withStart.filter((m) => {
    if (!m.startsAt) return false
    return isSameUtcDay(new Date(m.startsAt), nowDate)
  })

  let targetMatches: WorldCupMatchView[]
  let windowLabel: string

  if (todayMatches.length > 0) {
    targetMatches = todayMatches
    windowLabel = "Today"
  } else {
    const upcoming = withStart
      .filter(
        (m) => m.startsAt && new Date(m.startsAt).getTime() >= nowDate.getTime()
      )
      .sort((a, b) => (a.startsAt ?? "").localeCompare(b.startsAt ?? ""))
      .slice(0, 6)

    if (upcoming.length === 0) {
      return {
        title: TITLE,
        status: "no_matches",
        windowLabel: "No matches scheduled",
        recommendations: [],
      }
    }
    targetMatches = upcoming
    windowLabel = "Upcoming matches"
  }

  // Pick lookup by matchId.
  const pickByMatchId = new Map<string, WorldCupPickView>()
  picks.forEach((p) => pickByMatchId.set(p.matchId, p))

  const championTeamId = entry.championTeamId
  const recsByKey = new Map<string, RootingRecommendation>()

  for (const match of targetMatches) {
    // 1. Champion path — highest priority. Champion playing in any match.
    if (
      championTeamId &&
      (match.homeTeamId === championTeamId || match.awayTeamId === championTeamId)
    ) {
      const championName =
        entry.championTeamName ??
        (match.homeTeamId === championTeamId
          ? match.homeTeamName
          : match.awayTeamName)
      const opponent =
        match.homeTeamId === championTeamId
          ? match.awayTeamName
          : match.homeTeamName
      const rec: RootingRecommendation = {
        teamName: championName,
        matchLabel: matchLabel(match),
        reason: `${championName} is your champion pick. Keeping them alive vs ${opponent} protects your max possible points and championship bonus.`,
        impact: "High",
        tag: "Champion path",
        matchId: match.id,
        matchStartsAt: match.startsAt,
      }
      recsByKey.set(`${match.id}:champion`, rec)
      continue // champion takes the slot for this match
    }

    // 2. Knockout pick — user has an explicit selectedTeamId for this match.
    const pick = pickByMatchId.get(match.id)
    if (pick && pick.selectedTeamId) {
      const isHomePick = match.homeTeamId === pick.selectedTeamId
      const opponent = isHomePick ? match.awayTeamName : match.homeTeamName
      const teamName = pick.selectedTeamName
      const roundLabel = ROUND_LABELS[match.round]
      const impact = ROUND_IMPACT[match.round]
      const rec: RootingRecommendation = {
        teamName,
        matchLabel: matchLabel(match),
        reason: `You picked ${teamName} to win this ${roundLabel} match. A win vs ${opponent} locks in your ${roundLabel} points.`,
        impact,
        tag: "Knockout pick",
        matchId: match.id,
        matchStartsAt: match.startsAt,
      }
      recsByKey.set(`${match.id}:knockout`, rec)
    }
  }

  const recs = Array.from(recsByKey.values())
  recs.sort((a, b) => {
    const scoreDiff = impactScore(b.impact) - impactScore(a.impact)
    if (scoreDiff !== 0) return scoreDiff
    return (a.matchStartsAt ?? "").localeCompare(b.matchStartsAt ?? "")
  })

  const limit = hasBracketBrainAi ? 3 : 1
  const limited = recs.slice(0, limit)

  if (limited.length === 0) {
    return {
      title: TITLE,
      status: entry.isComplete ? "ready" : "incomplete",
      windowLabel,
      recommendations: [],
      lockedLines: entry.isComplete
        ? [
            "No teams from your bracket play in the current window. Check back on the next matchday.",
          ]
        : [
            "Finish your group and knockout picks to unlock better rooting recommendations.",
          ],
    }
  }

  const result: RootingGuideResult = {
    title: TITLE,
    status: "ready",
    windowLabel,
    recommendations: limited,
  }

  if (!hasBracketBrainAi && recs.length > 1) {
    result.lockedLines = [
      `AF Pro unlocks ${Math.min(3, recs.length)} prioritized rooting picks with full reasoning.`,
    ]
  }

  return result
}
