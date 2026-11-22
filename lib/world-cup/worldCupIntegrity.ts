import "server-only"
import { prisma } from "@/lib/prisma"
import { isWorldCupChallengeLocked } from "./worldCupBracketBuilder"
import type { WorldCupRound } from "./types"
import { hasWorldCupPickSelection } from "./worldCupProjectedBracket"

const WORLD_CUP_ROUNDS: readonly WorldCupRound[] = [
  "round_of_32",
  "round_of_16",
  "quarterfinal",
  "semifinal",
  "third_place",
  "final",
]

type IntegrityChallenge = {
  id: string
  maxParticipants: number
  maxEntriesPerParticipant: number
  pickLockStrategy?: string | null
  pickLockAt?: Date | string | null
  status?: string | null
  scoringProfileId?: string | null
}

type IntegrityMatch = {
  id: string
  round: string
  roundIndex: number
  matchNumber: number
  homeTeamId?: string | null
  awayTeamId?: string | null
  homeTeamName?: string | null
  awayTeamName?: string | null
  startsAt?: Date | string | null
  status?: string | null
  nextMatchId?: string | null
  nextMatchSlot?: string | null
}

type IntegritySlot = { id: string; slotKey: string }
type IntegrityParticipant = { id: string; userId: string }
type IntegrityEntry = { id: string; participantId: string; userId: string; isLocked?: boolean | null }
type IntegrityPick = {
  id: string
  entryId: string
  matchId: string
  selectedTeamId?: string | null
  selectedSlotKey?: string | null
}

type WorldCupChallengeIntegrityInput = {
  challenge: IntegrityChallenge
  matches: IntegrityMatch[]
  slots?: IntegritySlot[]
  participants: IntegrityParticipant[]
  entries: IntegrityEntry[]
  picks: IntegrityPick[]
}

type WorldCupChallengeIntegrityReport = {
  ok: boolean
  errors: string[]
  warnings: string[]
  stats: {
    participants: number
    entries: number
    matches: number
    picks: number
    completedMatches: number
    liveMatches: number
    lockedEntries: number
  }
}

function isPlaceholderTeam(name?: string | null) {
  if (!name) return true
  const n = name.trim()
  return (
    n === "" ||
    n === "TBD" ||
    n.startsWith("Winner ") ||
    n.startsWith("Loser ") ||
    n.startsWith("Group ") ||
    n.startsWith("Best ")
  )
}

function validateWorldCupChallengeIntegrity(input: WorldCupChallengeIntegrityInput): WorldCupChallengeIntegrityReport {
  const errors: string[] = []
  const warnings: string[] = []
  const matchById = new Map(input.matches.map((m) => [m.id, m]))
  const entryById = new Map(input.entries.map((e) => [e.id, e]))
  const participantById = new Map(input.participants.map((p) => [p.id, p]))
  const participantEntries = new Map<string, number>()

  if (input.challenge.maxParticipants > 100) {
    errors.push("maxParticipants exceeds allowed limit (100)")
  }
  if (input.challenge.maxEntriesPerParticipant > 5) {
    errors.push("maxEntriesPerParticipant exceeds allowed limit (5)")
  }
  if ((input.challenge.pickLockStrategy ?? "") !== "tournament_start") {
    warnings.push("pickLockStrategy is not tournament_start")
  }
  if (!input.challenge.scoringProfileId) {
    errors.push("scoring profile is missing")
  }
  if (input.matches.length === 0) {
    errors.push("challenge has no bracket matches")
  }
  if ((input.slots?.length ?? 0) === 0) {
    warnings.push("challenge has no slots")
  }

  const validRounds = new Set(WORLD_CUP_ROUNDS)
  const seenMatchNumbers = new Set<number>()
  const seenRoundOrder = new Set<string>()
  for (const match of input.matches) {
    if (!validRounds.has(match.round as (typeof WORLD_CUP_ROUNDS)[number])) {
      errors.push(`match ${match.id} has invalid round ${match.round}`)
    }
    if (!Number.isInteger(match.roundIndex) || match.roundIndex < 1) {
      errors.push(`match ${match.id} has invalid roundIndex`)
    }
    if (seenMatchNumbers.has(match.matchNumber)) {
      errors.push(`duplicate matchNumber detected: ${match.matchNumber}`)
    }
    seenMatchNumbers.add(match.matchNumber)

    const posKey = `${match.round}:${match.roundIndex}`
    if (seenRoundOrder.has(posKey)) {
      errors.push(`duplicate round position detected: ${posKey}`)
    }
    seenRoundOrder.add(posKey)

    if (match.nextMatchId && !matchById.has(match.nextMatchId)) {
      errors.push(`match ${match.id} points to missing nextMatchId ${match.nextMatchId}`)
    }
    if (match.nextMatchSlot && match.nextMatchSlot !== "home" && match.nextMatchSlot !== "away") {
      errors.push(`match ${match.id} has invalid nextMatchSlot ${match.nextMatchSlot}`)
    }
    if (!match.nextMatchId && match.nextMatchSlot) {
      warnings.push(`match ${match.id} has nextMatchSlot without nextMatchId`)
    }

    const homeKnown = Boolean(match.homeTeamId)
    const awayKnown = Boolean(match.awayTeamId)
    if (!homeKnown && !isPlaceholderTeam(match.homeTeamName)) {
      warnings.push(`match ${match.id} home team is unresolved without placeholder`) 
    }
    if (!awayKnown && !isPlaceholderTeam(match.awayTeamName)) {
      warnings.push(`match ${match.id} away team is unresolved without placeholder`)
    }
  }

  if (!input.matches.some((m) => m.round === "final")) {
    errors.push("final match is missing")
  }

  if (input.participants.length > input.challenge.maxParticipants) {
    errors.push("participant count exceeds challenge maxParticipants")
  }

  for (const entry of input.entries) {
    if (!participantById.has(entry.participantId)) {
      errors.push(`entry ${entry.id} references missing participant ${entry.participantId}`)
    }
    participantEntries.set(entry.participantId, (participantEntries.get(entry.participantId) ?? 0) + 1)
  }

  const maxTotalEntries = input.participants.length * input.challenge.maxEntriesPerParticipant
  if (input.entries.length > maxTotalEntries) {
    errors.push("entry count exceeds participant limit x maxEntriesPerParticipant")
  }

  for (const [participantId, count] of participantEntries) {
    if (count > input.challenge.maxEntriesPerParticipant) {
      errors.push(`participant ${participantId} has ${count} entries (max ${input.challenge.maxEntriesPerParticipant})`)
    }
  }

  for (const pick of input.picks) {
    const entry = entryById.get(pick.entryId)
    if (!entry) {
      errors.push(`pick ${pick.id} references missing entry ${pick.entryId}`)
      continue
    }
    const match = matchById.get(pick.matchId)
    if (!match) {
      errors.push(`pick ${pick.id} references missing match ${pick.matchId}`)
      continue
    }

    if (pick.selectedTeamId) {
      const isValidTeam =
        pick.selectedTeamId === match.homeTeamId || pick.selectedTeamId === match.awayTeamId
      if (!isValidTeam && match.homeTeamId && match.awayTeamId) {
        warnings.push(`pick ${pick.id} selectedTeamId is not valid for match ${pick.matchId}`)
      }
    }
  }

  const lock = isWorldCupChallengeLocked({
    challenge: {
      pickLockStrategy: input.challenge.pickLockStrategy,
      pickLockAt: input.challenge.pickLockAt,
      status: input.challenge.status,
    },
    matches: input.matches,
  })

  if (lock.locked) {
    const unlockedEntries = input.entries.filter((entry) => !entry.isLocked)
    if (unlockedEntries.length > 0) {
      errors.push(`challenge is locked but ${unlockedEntries.length} entries are still editable`)
    }
  }

  const completedMatches = input.matches.filter((m) => m.status === "final").length
  const liveMatches = input.matches.filter((m) => m.status === "live" || m.status === "halftime").length
  const lockedEntries = input.entries.filter((e) => Boolean(e.isLocked)).length
  const completedPicks = input.picks.filter(hasWorldCupPickSelection).length

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      participants: input.participants.length,
      entries: input.entries.length,
      matches: input.matches.length,
      picks: completedPicks,
      completedMatches,
      liveMatches,
      lockedEntries,
    },
  }
}

export async function getWorldCupChallengeIntegrityReport(challengeId: string): Promise<WorldCupChallengeIntegrityReport | null> {
  const challenge = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: challengeId },
    include: {
      matches: true,
      slots: { select: { id: true, slotKey: true } },
      participants: { select: { id: true, userId: true } },
      entries: { select: { id: true, participantId: true, userId: true, isLocked: true } },
      picks: { select: { id: true, entryId: true, matchId: true, selectedTeamId: true, selectedSlotKey: true } },
    },
  })
  if (!challenge) return null

  return validateWorldCupChallengeIntegrity({
    challenge: {
      id: challenge.id,
      maxParticipants: challenge.maxParticipants,
      maxEntriesPerParticipant: challenge.maxEntriesPerParticipant,
      pickLockStrategy: challenge.pickLockStrategy,
      pickLockAt: challenge.pickLockAt,
      status: challenge.status,
      scoringProfileId: challenge.scoringProfileId,
    },
    matches: challenge.matches,
    slots: challenge.slots,
    participants: challenge.participants,
    entries: challenge.entries,
    picks: challenge.picks,
  })
}
