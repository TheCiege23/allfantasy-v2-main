/**
 * worldCupKnockoutDangerZones.ts
 *
 * Pure deterministic helper for "Knockout Danger Zone Highlights" on the
 * World Cup pool dashboard Knockouts tab.
 *
 * Surfaces 0–5 at-risk knockout picks based on:
 *   - Already-eliminated champion or knockout picks (status:final + winner != pick)
 *   - Live-now matches involving the user's picks
 *   - Scheduled matches where the opponent has a higher pre-tournament
 *     seed strength than the user's pick
 *
 * No LLM call. No external fetch. Uses only the current user's own picks
 * + the public match schedule already loaded on the shell view.
 */
import {
  getWorldCupSeedStrength,
} from "./worldCupAiInsights"
import {
  WORLD_CUP_ROUND_LABELS,
  type WorldCupMatchView,
  type WorldCupPickView,
  type WorldCupRound,
} from "./types"

export type DangerSeverity = "Low" | "Medium" | "High"

export type DangerTag =
  | "Champion path"
  | "Knockout pick"
  | "Already eliminated"
  | "Live now"

type DangerStatus = "ready" | "no_entry" | "no_picks" | "no_risks"

type DangerZone = {
  label: string
  description: string
  severity: DangerSeverity
  tag: DangerTag
  matchId: string
  teamName: string
  round: WorldCupRound
  roundLabel: string
  /** Optional seed-strength delta (opponent − pick). Undefined for elimination/live tags. */
  strengthDelta?: number
}

type DangerZoneResult = {
  status: DangerStatus
  zones: DangerZone[]
  lockedLines?: string[]
}

type DangerEntry = {
  id: string
  championTeamId: string | null
  championTeamName: string | null
}

export type BuildDangerZonesInput = {
  entry: DangerEntry | null
  picks: WorldCupPickView[]
  matches: WorldCupMatchView[]
  hasBracketBrainAi?: boolean
}

const STRENGTH_DELTA_HIGH = 15
const STRENGTH_DELTA_MEDIUM = 5

function severityScore(s: DangerSeverity): number {
  return s === "High" ? 3 : s === "Medium" ? 2 : 1
}

const ROUND_PRIORITY: Record<WorldCupRound, number> = {
  final: 6,
  semifinal: 5,
  third_place: 4,
  quarterfinal: 3,
  round_of_16: 2,
  round_of_32: 1,
}

function tagForRound(round: WorldCupRound): DangerTag {
  return round === "final" || round === "semifinal"
    ? "Champion path"
    : "Knockout pick"
}

export function buildWorldCupKnockoutDangerZones(
  input: BuildDangerZonesInput
): DangerZoneResult {
  const { entry, picks, matches, hasBracketBrainAi = false } = input

  if (!entry) {
    return { status: "no_entry", zones: [] }
  }
  if (picks.length === 0) {
    return {
      status: "no_picks",
      zones: [],
      lockedLines: ["Make knockout picks to see danger zones."],
    }
  }

  const matchById = new Map<string, WorldCupMatchView>(
    matches.map((m) => [m.id, m])
  )

  const zones: DangerZone[] = []

  // 1. Champion eliminated check — walk all completed matches.
  const championTeamId = entry.championTeamId
  if (championTeamId) {
    const championLostIn = matches.find(
      (m) =>
        m.status === "final" &&
        m.winnerTeamId &&
        m.winnerTeamId !== championTeamId &&
        (m.homeTeamId === championTeamId || m.awayTeamId === championTeamId)
    )
    if (championLostIn) {
      const round = championLostIn.round
      zones.push({
        label: "Champion eliminated",
        description: `${entry.championTeamName ?? "Your champion"} lost in the ${WORLD_CUP_ROUND_LABELS[round]}. Your bracket can no longer earn the champion bonus.`,
        severity: "High",
        tag: "Already eliminated",
        matchId: championLostIn.id,
        teamName: entry.championTeamName ?? championTeamId,
        round,
        roundLabel: WORLD_CUP_ROUND_LABELS[round],
      })
    }
  }

  // 2. Per-pick danger detection.
  for (const pick of picks) {
    if (!pick.selectedTeamId) continue
    const match = matchById.get(pick.matchId)
    if (!match) continue
    const round = match.round
    const roundLabel = WORLD_CUP_ROUND_LABELS[round]

    // Already eliminated.
    if (
      match.status === "final" &&
      match.winnerTeamId &&
      match.winnerTeamId !== pick.selectedTeamId
    ) {
      zones.push({
        label: `${pick.selectedTeamName} lost in ${roundLabel}`,
        description: `Your ${roundLabel} pick ${pick.selectedTeamName} was eliminated. Points for this round are out of reach.`,
        severity: "High",
        tag: "Already eliminated",
        matchId: match.id,
        teamName: pick.selectedTeamName,
        round,
        roundLabel,
      })
      continue
    }

    // Live or halftime — high urgency, no point checking strength delta.
    if (match.status === "live" || match.status === "halftime") {
      const opponentName =
        match.homeTeamId === pick.selectedTeamId
          ? match.awayTeamName
          : match.homeTeamName
      zones.push({
        label: `${pick.selectedTeamName} live now`,
        description: `Your ${roundLabel} pick ${pick.selectedTeamName} is playing ${opponentName} right now.`,
        severity: "High",
        tag: "Live now",
        matchId: match.id,
        teamName: pick.selectedTeamName,
        round,
        roundLabel,
      })
      continue
    }

    // Scheduled — compare slot strength.
    if (match.status === "scheduled" && match.homeTeamId && match.awayTeamId) {
      const isHomePick = match.homeTeamId === pick.selectedTeamId
      const opponentSlot = isHomePick ? match.awaySlotKey : match.homeSlotKey
      const pickSlot = isHomePick ? match.homeSlotKey : match.awaySlotKey
      const pickStrength = getWorldCupSeedStrength(pickSlot)
      const opponentStrength = getWorldCupSeedStrength(opponentSlot)
      const opponentName = isHomePick ? match.awayTeamName : match.homeTeamName
      const delta = opponentStrength - pickStrength

      if (delta >= STRENGTH_DELTA_HIGH) {
        zones.push({
          label: `${pick.selectedTeamName} vs ${opponentName}`,
          description: `${opponentName} has a significant pre-tournament strength edge (+${delta}). Your ${roundLabel} pick is at high risk.`,
          severity: "High",
          tag: tagForRound(round),
          matchId: match.id,
          teamName: pick.selectedTeamName,
          round,
          roundLabel,
          strengthDelta: delta,
        })
      } else if (delta >= STRENGTH_DELTA_MEDIUM) {
        zones.push({
          label: `${pick.selectedTeamName} vs ${opponentName}`,
          description: `${opponentName} has a small strength edge (+${delta}). Watch this ${roundLabel} pick.`,
          severity: "Medium",
          tag: tagForRound(round),
          matchId: match.id,
          teamName: pick.selectedTeamName,
          round,
          roundLabel,
          strengthDelta: delta,
        })
      }
    }
  }

  // Dedupe by matchId — keep highest-severity zone per match.
  const byMatchId = new Map<string, DangerZone>()
  for (const zone of zones) {
    const existing = byMatchId.get(zone.matchId)
    if (!existing || severityScore(zone.severity) > severityScore(existing.severity)) {
      byMatchId.set(zone.matchId, zone)
    }
  }
  const deduped = Array.from(byMatchId.values())

  // Sort by severity desc, then by round (later rounds first).
  deduped.sort((a, b) => {
    const sevDiff = severityScore(b.severity) - severityScore(a.severity)
    if (sevDiff !== 0) return sevDiff
    return ROUND_PRIORITY[b.round] - ROUND_PRIORITY[a.round]
  })

  if (deduped.length === 0) {
    return {
      status: "no_risks",
      zones: [],
      lockedLines: [
        "No danger zones right now. All your knockout picks look favored by pre-tournament strength.",
      ],
    }
  }

  const limit = hasBracketBrainAi ? 5 : 1
  const limited = deduped.slice(0, limit)

  const result: DangerZoneResult = { status: "ready", zones: limited }
  if (!hasBracketBrainAi && deduped.length > 1) {
    result.lockedLines = [
      `AF Pro unlocks ${Math.min(5, deduped.length)} danger zones with full severity breakdown.`,
    ]
  }
  return result
}
