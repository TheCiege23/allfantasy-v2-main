import type { PlayoffChallengeConfig, PlayoffChallengeListItem, PlayoffChallengeView, PlayoffCreateResponse, PlayoffSport } from "./types"

export async function createPlayoffBracketChallengeClient(input: {
  name?: string
  sport: PlayoffSport
  seasonYear: number
  isTestMode?: boolean
  visibility?: "private" | "public"
  maxUsers?: number
  bracketsPerUser?: number
  scoringStyle?: string
  lockRule?: string
  config?: Partial<PlayoffChallengeConfig>
}): Promise<PlayoffCreateResponse> {
  const response = await fetch("/api/brackets/playoffs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.message ?? payload?.error ?? "Failed to create playoff bracket")
  }

  if (!payload?.challengeId) {
    throw new Error("Bracket was not created. Please try again.")
  }

  return {
    challengeId: payload.challengeId,
    entryId: payload.entryId ?? null,
    sport: payload.sport,
    name: payload.name,
    redirectUrl: payload.redirectUrl ?? `/brackets/leagues/${payload.challengeId}`,
  }
}

export async function listPlayoffBracketChallengesClient(sport?: PlayoffSport): Promise<PlayoffChallengeListItem[]> {
  const query = sport ? `?sport=${encodeURIComponent(sport)}` : ""
  const response = await fetch(`/api/brackets/playoffs${query}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.error ?? "Failed to load playoff challenges")
  }

  return Array.isArray(payload?.challenges) ? payload.challenges : []
}

export async function getPlayoffBracketViewClient(challengeId: string): Promise<PlayoffChallengeView> {
  const response = await fetch(`/api/brackets/playoffs/${challengeId}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.error ?? "Failed to load playoff bracket")
  }

  return payload.view as PlayoffChallengeView
}

export async function savePlayoffBracketPickClient(input: {
  challengeId: string
  entryId: string
  seriesId: string
  pickTeamName: string
}): Promise<PlayoffChallengeView> {
  const response = await fetch(`/api/brackets/playoffs/${input.challengeId}/entries/${input.entryId}/picks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      seriesId: input.seriesId,
      pickTeamName: input.pickTeamName,
    }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.error ?? "Failed to save playoff pick")
  }

  return payload.view as PlayoffChallengeView
}

export async function createPlayoffBracketEntryClient(input: {
  challengeId: string
  name?: string
}): Promise<{ challengeId: string; entryId: string; redirectUrl: string }> {
  const response = await fetch(`/api/brackets/playoffs/${input.challengeId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "create_entry",
      name: input.name,
    }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.error ?? "Failed to create playoff entry")
  }

  return {
    challengeId: payload.challengeId,
    entryId: payload.entryId,
    redirectUrl: payload.redirectUrl,
  }
}

export async function submitPlayoffBracketEntryClient(input: {
  challengeId: string
  entryId: string
  tiebreakerTotalScore?: number
}): Promise<{ challengeId: string; entryId: string; redirectUrl: string }> {
  const response = await fetch(`/api/brackets/playoffs/${input.challengeId}/entries/${input.entryId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "submit_entry",
      tiebreakerTotalScore: input.tiebreakerTotalScore,
    }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.error ?? "Failed to submit playoff bracket")
  }

  return {
    challengeId: payload.challengeId,
    entryId: payload.entryId,
    redirectUrl: payload.redirectUrl,
  }
}
