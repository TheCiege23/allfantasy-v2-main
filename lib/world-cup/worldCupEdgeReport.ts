/**
 * World Cup Daily Edge Report — deterministic computation engine
 *
 * Pure function: takes a WorldCupChimmyContext (already fetched) and returns a
 * structured daily edge report with five sections. No LLM calls here. All
 * output is grounded in the pool data already in the context.
 *
 * Sections:
 *  1. matchThatMatters  — highest-value upcoming match where user has a pick
 *  2. rootFor           — result that maximises user's relative gain
 *  3. threats           — rivals below the user who can still catch up
 *  4. bestPath          — optimistic remaining pick chain to highest climb
 *  5. mistakeToAvoid    — biggest structural risk in the user's bracket today
 *
 * The `grounding` field is passed to the LLM coaching layer so it can explain
 * these sections in natural language without inventing data.
 */

import type {
  WorldCupChimmyContext,
  ChimmyKnockoutPickRow,
  ChimmyLeaderboardRow,
  ChimmyMatchSummary,
} from "./worldCupChimmyContext"
import type { WorldCupScoringValues } from "./types"

// ── Public types ──────────────────────────────────────────────────────────────

export type EdgeSection = {
  /** Short bold headline — shown as the primary line in the UI. */
  headline: string
  /** One-sentence supporting detail. */
  subtext: string
  /** Up to 3 bullet-point data facts. */
  bullets: string[]
  /** How reliably this section was computed (drives UI freshness badge). */
  confidence: "high" | "medium" | "low"
}

/**
 * Structured data passed to the LLM coaching layer.
 * Contains only primitive values so the prompt serialiser can't hallucinate.
 */
export type EdgeReportGrounding = {
  poolName: string
  userRank: number | null
  totalEntries: number
  userScore: number
  userMaxPossible: number
  userChampion: string | null
  championStillAlive: boolean
  threatCount: number         // rivals below user who can still pass them
  pendingPickCount: number    // user's picks still pending a result
  pendingPickPoints: number   // total points still available to user
  topThreatName: string | null
  topThreatCanReach: number   // topThreat.maxPossible - user.score (> 0 means threat is real)
  bestClimbSpots: number      // spots user could gain if remaining top picks land
  hasLiveMatches: boolean
}

export type WorldCupEdgeReport = {
  generatedAt: string
  challengeId: string
  poolName: string
  userRank: number | null
  totalEntries: number
  sections: {
    matchThatMatters: EdgeSection
    rootFor: EdgeSection
    threats: EdgeSection
    bestPath: EdgeSection
    mistakeToAvoid: EdgeSection
  }
  grounding: EdgeReportGrounding
  hasLiveData: boolean
  hasPendingPicks: boolean
  /** True when user has no bracket entry — all sections degrade gracefully. */
  noEntry: boolean
}

// ── Round → points mapping ────────────────────────────────────────────────────

function roundPoints(round: string, scoring: WorldCupScoringValues): number {
  const r = round.toLowerCase().replace(/[-_ ]/g, "")
  if (r.includes("32") || r === "groupstage" || r === "groups") return scoring.roundOf32Points
  if (r.includes("16")) return scoring.roundOf16Points
  if (r.includes("quarter") || r === "qf") return scoring.quarterFinalPoints
  if (r.includes("semi") || r === "sf") return scoring.semiFinalPoints
  if ((r.includes("final") && !r.includes("semi") && !r.includes("third")) || r === "f")
    return scoring.finalPoints
  if (r.includes("champion") || r === "winner") return scoring.championBonusPoints
  if (r.includes("third") || r.includes("3rd")) return scoring.thirdPlacePoints ?? 0
  return 0
}

function roundLabel(round: string): string {
  const r = round.toLowerCase().replace(/[-_ ]/g, "")
  if (r.includes("32")) return "Round of 32"
  if (r.includes("16")) return "Round of 16"
  if (r.includes("quarter") || r === "qf") return "Quarter-final"
  if (r.includes("semi") || r === "sf") return "Semi-final"
  if ((r.includes("final") && !r.includes("semi") && !r.includes("third")) || r === "f") return "Final"
  if (r.includes("champion") || r === "winner") return "Champion"
  if (r.includes("third") || r.includes("3rd")) return "3rd place"
  return round
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Picks where the result hasn't been decided yet. */
function pendingPicks(picks: ChimmyKnockoutPickRow[]): ChimmyKnockoutPickRow[] {
  return picks.filter((p) => p.isCorrect === null)
}

/**
 * Find the upcoming match that corresponds to a user's pending pick.
 * Matches by checking if the picked team appears in the match's home or away slot.
 */
function matchForPick(
  pick: ChimmyKnockoutPickRow,
  matches: ChimmyMatchSummary[]
): ChimmyMatchSummary | null {
  const picked = pick.pickedTeam.toLowerCase()
  // First try: exact home/away match using both teams from the pick
  const exactMatch = matches.find(
    (m) =>
      (m.homeTeamName.toLowerCase() === pick.homeTeamName.toLowerCase() &&
        m.awayTeamName.toLowerCase() === pick.awayTeamName.toLowerCase()) ||
      (m.homeTeamName.toLowerCase() === pick.awayTeamName.toLowerCase() &&
        m.awayTeamName.toLowerCase() === pick.homeTeamName.toLowerCase())
  )
  if (exactMatch) return exactMatch
  // Fallback: at least one team in the match matches the picked team
  return (
    matches.find(
      (m) =>
        m.homeTeamName.toLowerCase() === picked ||
        m.awayTeamName.toLowerCase() === picked
    ) ?? null
  )
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"]
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

// ── Section builders ──────────────────────────────────────────────────────────

function buildMatchThatMatters(
  pending: ChimmyKnockoutPickRow[],
  upcoming: ChimmyMatchSummary[],
  live: ChimmyMatchSummary[],
  scoring: WorldCupScoringValues
): EdgeSection {
  if (pending.length === 0 && upcoming.length === 0 && live.length === 0) {
    return {
      headline: "No upcoming matches found",
      subtext: "Your remaining bracket picks are waiting on scheduled fixtures.",
      bullets: [],
      confidence: "low",
    }
  }

  // Find the pending pick with the highest point value that has an upcoming/live match
  const scoredPending = pending
    .map((pick) => {
      const pts = roundPoints(pick.round, scoring)
      const match = matchForPick(pick, [...live, ...upcoming])
      return { pick, pts, match }
    })
    .filter((x) => x.pts > 0)
    .sort((a, b) => b.pts - a.pts)

  if (scoredPending.length > 0) {
    const { pick, pts, match } = scoredPending[0]
    const roundName = roundLabel(pick.round)
    const matchStr = match
      ? `${match.homeTeamName} vs ${match.awayTeamName}`
      : `${pick.homeTeamName} vs ${pick.awayTeamName}`
    const isLive = match ? live.some((m) => m.matchId === match.matchId) : false
    const bullets: string[] = [
      `You picked ${pick.pickedTeam} to win (+${pts} pts)`,
      ...(match?.startsAt && !isLive
        ? [`Kicks off ${new Date(match.startsAt).toUTCString().replace(/ GMT$/, " UTC")}`]
        : isLive
        ? [`Match is live now`]
        : []),
      ...(scoredPending.length > 1
        ? [`${scoredPending.length - 1} more pending pick${scoredPending.length > 2 ? "s" : ""} after this`]
        : []),
    ].slice(0, 3)

    return {
      headline: `${matchStr} · ${roundName}`,
      subtext: isLive
        ? `This match is live — a ${pick.pickedTeam} result lands you ${pts} points right now.`
        : `A ${pick.pickedTeam} win here is your next scoring opportunity (${pts} pts).`,
      bullets,
      confidence: match ? "high" : "medium",
    }
  }

  // No picks matched to a match — show the most valuable upcoming match regardless
  const topUpcoming = [...live, ...upcoming][0]
  if (topUpcoming) {
    return {
      headline: `${topUpcoming.homeTeamName} vs ${topUpcoming.awayTeamName}`,
      subtext: "Keep an eye on this match — it may affect your pool standings.",
      bullets: ["You may not have a direct pick in this match"],
      confidence: "low",
    }
  }

  return {
    headline: "No matches currently upcoming",
    subtext: "Check back once the next round of fixtures is scheduled.",
    bullets: [],
    confidence: "low",
  }
}

function buildRootFor(
  pending: ChimmyKnockoutPickRow[],
  leaderboard: ChimmyLeaderboardRow[],
  userEntry: WorldCupChimmyContext["entry"],
  upcoming: ChimmyMatchSummary[],
  live: ChimmyMatchSummary[],
  scoring: WorldCupScoringValues
): EdgeSection {
  if (!userEntry) {
    return {
      headline: "No bracket entry found",
      subtext: "Add your bracket picks to see what results to root for.",
      bullets: [],
      confidence: "low",
    }
  }

  const bullets: string[] = []
  let headline = ""
  let subtext = ""

  // Primary: root for user's own highest-value pending pick
  const topPick = pending
    .map((p) => ({ pick: p, pts: roundPoints(p.round, scoring) }))
    .sort((a, b) => b.pts - a.pts)[0]

  if (topPick) {
    headline = `${topPick.pick.pickedTeam} to win`
    subtext = `Correct on your ${roundLabel(topPick.pick.round)} pick for +${topPick.pts} pts.`
    bullets.push(`🙌 ${topPick.pick.pickedTeam} win → +${topPick.pts} pts for you`)
  }

  // Secondary: root against the current leader's champion if it's different from user's
  const leader = leaderboard.find((r) => r.rank === 1)
  if (
    leader &&
    leader.userId !== (userEntry as any).userId &&
    leader.championPickName &&
    leader.championPickName !== userEntry.championPick
  ) {
    const leaderChampion = leader.championPickName
    // Find an upcoming match involving the leader's champion pick
    const relevantMatch = [...live, ...upcoming].find(
      (m) =>
        m.homeTeamName.toLowerCase() === leaderChampion.toLowerCase() ||
        m.awayTeamName.toLowerCase() === leaderChampion.toLowerCase()
    )
    if (relevantMatch) {
      const opponent =
        relevantMatch.homeTeamName.toLowerCase() === leaderChampion.toLowerCase()
          ? relevantMatch.awayTeamName
          : relevantMatch.homeTeamName
      bullets.push(`📉 Root for ${opponent} — knocks out ${leader.entryName}'s champion pick`)
    } else {
      bullets.push(`📉 Root against ${leaderChampion} — it's ${leader.entryName}'s champion pick`)
    }
  }

  // Tertiary: if user has no top pick, show pool-wide interest
  if (!topPick) {
    if (leaderboard.length > 1) {
      const second = leaderboard.find((r) => r.rank === 2)
      const first = leaderboard.find((r) => r.rank === 1)
      headline = first ? `Watch ${first.entryName} closely` : "Track the leaderboard"
      subtext = "Your remaining picks can still change everything."
      if (second) {
        const gap = (first?.totalScore ?? 0) - second.totalScore
        bullets.push(`${first?.entryName} leads by ${gap} pts — still catchable`)
      }
    } else {
      headline = "Check the full leaderboard"
      subtext = "No clear pick result to root for right now."
    }
  }

  return {
    headline: headline || "Root for your pending picks",
    subtext,
    bullets: bullets.slice(0, 3),
    confidence: topPick ? "high" : "medium",
  }
}

function buildThreats(
  leaderboard: ChimmyLeaderboardRow[],
  userEntry: WorldCupChimmyContext["entry"],
  userId: string
): { section: EdgeSection; threatCount: number; topThreatName: string | null; topThreatCanReach: number } {
  if (!userEntry || userEntry.rank === null) {
    return {
      section: {
        headline: "No bracket entry found",
        subtext: "Add your entry to see who can catch you.",
        bullets: [],
        confidence: "low",
      },
      threatCount: 0,
      topThreatName: null,
      topThreatCanReach: 0,
    }
  }

  const userScore = userEntry.totalScore
  const userRank = userEntry.rank

  // Threats: entries currently ranked below user but with maxPossible > user's current score
  const threats = leaderboard
    .filter(
      (r) =>
        r.userId !== userId &&
        r.rank > userRank &&
        r.maxPossibleScore > userScore
    )
    .map((r) => ({
      ...r,
      canReach: r.maxPossibleScore - userScore,   // how far above user's current score they can climb
      currentGap: userScore - r.totalScore,        // how far behind they currently are
    }))
    .sort((a, b) => b.maxPossibleScore - a.maxPossibleScore)  // most dangerous first

  if (threats.length === 0) {
    const behinds = leaderboard.filter((r) => r.userId !== userId && r.rank > userRank)
    return {
      section: {
        headline: "You're safe from the pack",
        subtext:
          behinds.length === 0
            ? "No one is ranked below you — or everyone is accounted for."
            : `${behinds.length} entr${behinds.length === 1 ? "y" : "ies"} below you can't catch up based on max possible scores.`,
        bullets: behinds.length > 0 ? [`Largest gap below: ${userScore - behinds[0].totalScore} pts`] : [],
        confidence: "high",
      },
      threatCount: 0,
      topThreatName: null,
      topThreatCanReach: 0,
    }
  }

  const top3 = threats.slice(0, 3)
  const bullets = top3.map(
    (t) =>
      `${t.entryName} (#${t.rank}): currently ${t.currentGap} pts behind, max possible ${t.maxPossibleScore - userScore > 0 ? `+${t.maxPossibleScore - userScore}` : "0"} pts ahead`
  )

  return {
    section: {
      headline:
        threats.length === 1
          ? `1 rival can still pass you`
          : `${threats.length} rivals can still pass you`,
      subtext: `${top3[0].entryName} is the biggest threat — could reach ${top3[0].maxPossibleScore} pts (you're at ${userScore}).`,
      bullets,
      confidence: "high",
    },
    threatCount: threats.length,
    topThreatName: threats[0].entryName,
    topThreatCanReach: threats[0].canReach,
  }
}

function buildBestPath(
  pending: ChimmyKnockoutPickRow[],
  leaderboard: ChimmyLeaderboardRow[],
  userEntry: WorldCupChimmyContext["entry"],
  userId: string,
  scoring: WorldCupScoringValues
): { section: EdgeSection; bestClimbSpots: number; pendingPickPoints: number } {
  if (!userEntry) {
    return {
      section: {
        headline: "No entry to compute a path for",
        subtext: "Add your bracket picks to see how to climb.",
        bullets: [],
        confidence: "low",
      },
      bestClimbSpots: 0,
      pendingPickPoints: 0,
    }
  }

  const pendingWithPoints = pending
    .map((p) => ({ pick: p, pts: roundPoints(p.round, scoring) }))
    .filter((x) => x.pts > 0)
    .sort((a, b) => b.pts - a.pts)

  const totalPendingPoints = pendingWithPoints.reduce((s, x) => s + x.pts, 0)
  const optimisticScore = userEntry.totalScore + totalPendingPoints

  // Rivals currently ahead who user can reach
  const rivarAbove = leaderboard.filter(
    (r) => r.userId !== userId && (r.rank ?? 0) < (userEntry.rank ?? Infinity)
  )
  const reachable = rivarAbove.filter((r) => r.totalScore < optimisticScore).length
  const bestClimb = reachable // spots climbed if all picks land

  if (pendingWithPoints.length === 0) {
    const finalRank = userEntry.rank
    return {
      section: {
        headline: finalRank !== null ? `Your final rank: ${ordinal(finalRank)}` : "Bracket complete",
        subtext: "All your picks have been decided. Your score is locked in.",
        bullets: [`Total score: ${userEntry.totalScore} pts`, `Max possible: ${userEntry.maxPossibleScore} pts`],
        confidence: "high",
      },
      bestClimbSpots: 0,
      pendingPickPoints: 0,
    }
  }

  const topPicks = pendingWithPoints.slice(0, 3)
  const topPicksText = topPicks.map((x) => `${x.pick.pickedTeam} (${x.pts} pts)`).join(", ")

  const bullets = [
    `${totalPendingPoints} pts still available to you across ${pendingWithPoints.length} pending pick${pendingWithPoints.length !== 1 ? "s" : ""}`,
    topPicks.length > 0 ? `Key picks: ${topPicksText}` : null,
    reachable > 0
      ? `Hit all pending picks → could overtake ${reachable} rival${reachable !== 1 ? "s" : ""} currently ahead`
      : "Your optimistic score doesn't overtake anyone currently ahead of you",
  ].filter(Boolean) as string[]

  return {
    section: {
      headline:
        reachable > 0
          ? `+${reachable} spot${reachable !== 1 ? "s" : ""} possible if your picks land`
          : `Hold your position — ${totalPendingPoints} pts still to play for`,
      subtext:
        reachable > 0
          ? `If all your remaining picks hit, you'd score ${optimisticScore} pts and rise ${reachable} place${reachable !== 1 ? "s" : ""}.`
          : `You have ${totalPendingPoints} pts remaining but the rivals ahead are out of reach even if you go perfect.`,
      bullets,
      confidence: totalPendingPoints > 0 ? "high" : "medium",
    },
    bestClimbSpots: bestClimb,
    pendingPickPoints: totalPendingPoints,
  }
}

function buildMistakeToAvoid(
  userEntry: WorldCupChimmyContext["entry"],
  leaderboard: ChimmyLeaderboardRow[],
  pending: ChimmyKnockoutPickRow[],
  scoring: WorldCupScoringValues,
  userId: string
): EdgeSection {
  if (!userEntry) {
    return {
      headline: "No entry to analyse",
      subtext: "Add your bracket to see which risks to watch out for.",
      bullets: [],
      confidence: "low",
    }
  }

  const risks: Array<{ priority: number; headline: string; subtext: string; bullet: string }> = []

  // Risk 1: Champion pick worth a lot but widely shared (crowd pick = no differentiation)
  // Exclude the user's own entry so we're measuring how many *others* share the pick.
  if (userEntry.championPick) {
    const others = leaderboard.filter((r) => r.userId !== userId)
    const totalOthers = others.length
    const sameChampion = others.filter(
      (r) => r.championPickName?.toLowerCase() === userEntry.championPick?.toLowerCase()
    ).length
    const shareRate = totalOthers > 0 ? sameChampion / totalOthers : 0
    if (shareRate >= 0.5) {
      risks.push({
        priority: 2,
        headline: `Crowd champion pick: ${userEntry.championPick}`,
        subtext: `${Math.round(shareRate * 100)}% of other entries picked the same champion — winning it won't separate you.`,
        bullet: `${sameChampion} of ${totalOthers} other entries share your ${userEntry.championPick} champion pick`,
      })
    }
  }

  // Risk 2: Champion pick worth a lot but the team is in trouble / you're overly dependent
  const championBonus = scoring.championBonusPoints
  const championShareOfMax = userEntry.maxPossibleScore > 0
    ? championBonus / userEntry.maxPossibleScore
    : 0
  if (championShareOfMax >= 0.35 && userEntry.championPick) {
    risks.push({
      priority: 1,
      headline: `High champion dependency: ${userEntry.championPick}`,
      subtext: `${Math.round(championShareOfMax * 100)}% of your max possible score rests on ${userEntry.championPick} winning it all.`,
      bullet: `Champion bonus = ${championBonus} pts (${Math.round(championShareOfMax * 100)}% of your max ${userEntry.maxPossibleScore})`,
    })
  }

  // Risk 3: No pending picks — bracket is fully decided, no more agency
  if (pending.length === 0 && userEntry.maxPossibleScore > userEntry.totalScore) {
    risks.push({
      priority: 3,
      headline: "All picks decided — no more scoring opportunities",
      subtext: "Your max possible score is locked. Focus shifts to where rivals' brackets land.",
      bullet: `Current score: ${userEntry.totalScore} · Max: ${userEntry.maxPossibleScore}`,
    })
  }

  // Risk 4: Significant incorrect picks dragging down the score
  const pickAccuracy = userEntry.correctPicks + userEntry.incorrectPicks > 0
    ? userEntry.correctPicks / (userEntry.correctPicks + userEntry.incorrectPicks)
    : null
  if (pickAccuracy !== null && pickAccuracy < 0.45 && userEntry.incorrectPicks >= 3) {
    risks.push({
      priority: 4,
      headline: "Low pick accuracy — lean on your pending picks",
      subtext: `${userEntry.incorrectPicks} incorrect picks so far. Your remaining picks are crucial to recover ground.`,
      bullet: `${userEntry.correctPicks} correct / ${userEntry.incorrectPicks} incorrect (${Math.round((pickAccuracy ?? 0) * 100)}% accuracy)`,
    })
  }

  if (risks.length === 0) {
    return {
      headline: "No major risks detected",
      subtext: "Your bracket looks solid. Keep an eye on rival champion picks.",
      bullets: [],
      confidence: "medium",
    }
  }

  risks.sort((a, b) => a.priority - b.priority)
  const topRisk = risks[0]
  return {
    headline: topRisk.headline,
    subtext: topRisk.subtext,
    bullets: risks.map((r) => r.bullet).slice(0, 3),
    confidence: "high",
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Compute the full daily edge report for a user from their pool context.
 * Pure function — no DB calls, no LLM calls. Safe to call repeatedly.
 */
export function computeWorldCupEdgeReport(
  context: WorldCupChimmyContext,
  userId: string
): WorldCupEdgeReport {
  const now = new Date().toISOString()
  const entry = context.entry
  const noEntry = !entry

  const pending = entry ? pendingPicks(entry.knockoutPicks) : []

  // Section 1: Match that matters
  const matchThatMatters = buildMatchThatMatters(
    pending,
    context.upcomingMatches,
    context.liveMatches,
    context.scoring
  )

  // Section 2: Root for
  const rootFor = buildRootFor(
    pending,
    context.leaderboard,
    entry,
    context.upcomingMatches,
    context.liveMatches,
    context.scoring
  )

  // Section 3: Threats
  const {
    section: threats,
    threatCount,
    topThreatName,
    topThreatCanReach,
  } = buildThreats(context.leaderboard, entry, userId)

  // Section 4: Best path
  const {
    section: bestPath,
    bestClimbSpots,
    pendingPickPoints,
  } = buildBestPath(pending, context.leaderboard, entry, userId, context.scoring)

  // Section 5: Mistake to avoid
  const mistakeToAvoid = buildMistakeToAvoid(entry, context.leaderboard, pending, context.scoring, userId)

  // Whether the champion pick is still "possible" (not already eliminated by having isCorrect=false)
  const championStillAlive = entry
    ? !entry.knockoutPicks.some(
        (p) => p.pickedTeam === entry.championPick && p.isCorrect === false
      )
    : false

  const grounding: EdgeReportGrounding = {
    poolName: context.poolName,
    userRank: entry?.rank ?? null,
    totalEntries: context.leaderboard.length,
    userScore: entry?.totalScore ?? 0,
    userMaxPossible: entry?.maxPossibleScore ?? 0,
    userChampion: entry?.championPick ?? null,
    championStillAlive,
    threatCount,
    pendingPickCount: pending.length,
    pendingPickPoints,
    topThreatName,
    topThreatCanReach,
    bestClimbSpots,
    hasLiveMatches: context.liveMatches.length > 0,
  }

  return {
    generatedAt: now,
    challengeId: context.challengeId,
    poolName: context.poolName,
    userRank: entry?.rank ?? null,
    totalEntries: context.leaderboard.length,
    sections: {
      matchThatMatters,
      rootFor,
      threats,
      bestPath,
      mistakeToAvoid,
    },
    grounding,
    hasLiveData: context.liveMatches.length > 0,
    hasPendingPicks: pending.length > 0,
    noEntry,
  }
}
