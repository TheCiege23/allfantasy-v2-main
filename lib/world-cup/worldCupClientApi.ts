import { paidToolFetch } from '@/lib/tokens/paidToolClient'
/**
 * Client-side API helpers for World Cup bracket entries.
 * All functions are safe to call from React components ("use client").
 */

import type {
  WorldCupAiMatchupPreview,
  WorldCupAiStrategy,
  WorldCupChallengeView,
  WorldCupLeaderboardRow,
  WorldCupMatchupIntelligence,
  WorldCupPickView,
} from "./types"
import {
  confirmWorldCupTokenSpend,
  isWorldCupTokenConfirmationResponse,
} from "./worldCupClientTokenConfirm"
import { trackMetaEventsFromResponse } from "@/lib/meta-client"

// ── Local types ──────────────────────────────────────────────────────────────

export type WorldCupEntryStatus =
  | "not_started"
  | "in_progress"
  | "complete"
  | "locked"
  | "live"

export type WorldCupBracketEntryClient = {
  id: string
  challengeId: string
  participantId: string
  userId: string
  name: string
  championTeamId: string | null
  championTeamName: string | null
  totalScore: number
  maxPossibleScore: number
  correctPicks: number
  incorrectPicks: number
  rank: number | null
  roundBreakdown: Record<string, number>
  isComplete: boolean
  isLocked: boolean
  submittedAt: string | null
  createdAt: string
  updatedAt: string
}

export type WorldCupEntryPickPayload = {
  activeEntryId?: string
  matchId: string
  selectedTeamId?: string | null
  selectedTeamName?: string | null
  selectedSide?: "home" | "away"
  selectedSlotKey?: string | null
  round?: string
  sourceSlotKey?: string | null
  nextMatchId?: string | null
  nextMatchSlot?: "home" | "away" | null
  matchNumber?: number
  confidencePoints?: number | null
}

export type WorldCupEntryPickResult = {
  success: boolean
  entry: WorldCupBracketEntryClient | null
  pick: unknown
  picks: unknown[]
  isComplete: boolean
  view?: WorldCupChallengeView
}

export type WorldCupBracketEntryDetailClient = WorldCupBracketEntryClient & {
  picks?: WorldCupPickView[]
}

export type WorldCupGroupStageTeamClient = {
  id: string
  teamId: string
  name: string
  country: string
  fifaCode: string | null
  flagUrl: string | null
  logoUrl: string | null
  seedOrder: number
  actualRank: number | null
  points: number | null
  goalDifference: number | null
  goalsFor: number | null
}

export type WorldCupGroupStageViewClient = {
  challengeId: string
  entryId: string
  groups: Array<{
    id: string
    groupKey: string
    displayName: string
    sortOrder: number
    teams: WorldCupGroupStageTeamClient[]
  }>
  groupRankingPicks: Array<{
    id: string
    groupId: string
    teamId: string
    predictedRank: number
    actualRank: number | null
    isCorrect: boolean | null
    pointsAwarded: number
  }>
  thirdPlaceAdvancerPicks: Array<{
    id: string
    groupId: string
    teamId: string
    isSelected: boolean
    actualAdvanced: boolean | null
    isCorrect: boolean | null
    pointsAwarded: number
  }>
  completion: {
    groupsRankedCount: number
    allGroupsRanked: boolean
    thirdPlaceSelectedCount: number
    thirdPlaceComplete: boolean
    groupStageComplete: boolean
  }
  lock: {
    isLocked: boolean
    lockReason: string | null
  }
  warnings: Array<{ code: string; message: string; groupKey?: string }>
}

export type WorldCupEntryCompletionReviewClient = {
  challengeId: string
  entryId: string
  groupStageComplete: boolean
  knockoutComplete: boolean
  fullEntryComplete: boolean
  groupsRankedCount: number
  missingGroups: string[]
  thirdPlaceSelectedCount: number
  missingKnockoutPicks: number
  requiredKnockoutPicks: number
  completedKnockoutPicks: number
  isLocked: boolean
  isComplete: boolean
  submittedAt: string | null
  staleSubmittedIncomplete?: boolean
  needsRefinalize?: boolean
}

export type WorldCupEntryFinalizeResult = {
  ok: boolean
  entry: WorldCupBracketEntryClient
  completion: WorldCupEntryCompletionReviewClient
  view?: WorldCupChallengeView
}

export type WorldCupEntryLeaderboardRow = WorldCupLeaderboardRow & {
  championAlive?: boolean
}

export type WorldCupChallengeIntegrityReport = {
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

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const transport = url.endsWith('/ai/matchup') ? paidToolFetch : fetch
  const res = await transport(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  })
  return res
}

async function readApiJson<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json().catch(() => ({}))) as T
}

// ── Entry CRUD ────────────────────────────────────────────────────────────────

export async function listWorldCupBracketEntries(
  challengeId: string
): Promise<WorldCupBracketEntryClient[]> {
  const res = await apiFetch(`/api/brackets/world-cup/${challengeId}/entries`)
  const data = await readApiJson<{ error?: string; entries?: WorldCupBracketEntryClient[] }>(res)
  if (!res.ok) throw new Error(data.error ?? "Failed to load bracket entries")
  return Array.isArray(data.entries) ? data.entries : []
}

export async function createWorldCupBracketEntry(
  challengeId: string,
  name?: string
): Promise<WorldCupBracketEntryClient> {
  const res = await apiFetch(`/api/brackets/world-cup/${challengeId}/entries`, {
    method: "POST",
    body: JSON.stringify({ name: name ?? null }),
  })
  const data = await readApiJson<{ error?: string; entry?: WorldCupBracketEntryClient; metaEvent?: unknown }>(res)
  if (!res.ok) throw new Error(data.error ?? "Failed to create entry")
  if (!data.entry) throw new Error("Create entry response missing entry")
  trackMetaEventsFromResponse(data)
  return data.entry
}

export async function getWorldCupBracketEntry(
  challengeId: string,
  entryId: string
): Promise<WorldCupBracketEntryDetailClient | null> {
  const res = await apiFetch(
    `/api/brackets/world-cup/${challengeId}/entries/${entryId}`
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error("Failed to load entry")
  const data = await readApiJson<{ entry?: WorldCupBracketEntryDetailClient | null }>(res)
  return (data.entry ?? null) as WorldCupBracketEntryDetailClient | null
}

export async function renameWorldCupBracketEntry(
  challengeId: string,
  entryId: string,
  name: string
): Promise<WorldCupBracketEntryClient> {
  const res = await apiFetch(
    `/api/brackets/world-cup/${challengeId}/entries/${entryId}`,
    { method: "PATCH", body: JSON.stringify({ name }) }
  )
  const data = await readApiJson<{ error?: string; entry?: WorldCupBracketEntryClient }>(res)
  if (!res.ok) throw new Error(data.error ?? "Failed to rename entry")
  if (!data.entry) throw new Error("Rename entry response missing entry")
  return data.entry
}

export async function deleteWorldCupBracketEntry(
  challengeId: string,
  entryId: string
): Promise<void> {
  const res = await apiFetch(
    `/api/brackets/world-cup/${challengeId}/entries/${entryId}`,
    { method: "DELETE" }
  )
  if (!res.ok) {
    const data = await readApiJson<{ error?: string }>(res)
    throw new Error(
      (data as { error?: string }).error ?? "Failed to delete entry"
    )
  }
}

export async function fetchWorldCupEntryCompletionReview(
  challengeId: string,
  entryId: string
): Promise<WorldCupEntryCompletionReviewClient> {
  const res = await apiFetch(`/api/brackets/world-cup/${challengeId}/entries/${entryId}/finalize`, {
    cache: "no-store",
  })
  const data = await readApiJson<{ error?: string; completion?: WorldCupEntryCompletionReviewClient }>(res)
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Failed to load completion review")
  if (!data.completion) throw new Error("Completion review response missing completion")
  return data.completion
}

export async function finalizeWorldCupEntryClient(
  challengeId: string,
  entryId: string
): Promise<WorldCupEntryFinalizeResult> {
  const res = await apiFetch(`/api/brackets/world-cup/${challengeId}/entries/${entryId}/finalize`, {
    method: "POST",
    body: JSON.stringify({}),
  })
  const data = await readApiJson<Partial<WorldCupEntryFinalizeResult> & { error?: string; completion?: WorldCupEntryCompletionReviewClient }>(res)
  if (!res.ok) {
    const error = new Error((data as { error?: string }).error ?? "Failed to finalize entry") as Error & {
      completion?: WorldCupEntryCompletionReviewClient
    }
    error.completion = (data as { completion?: WorldCupEntryCompletionReviewClient }).completion
    throw error
  }
  if (!data.entry || !data.completion) throw new Error("Finalize response missing entry or completion")
  return data as WorldCupEntryFinalizeResult
}

export async function saveWorldCupBracketEntryPick(
  challengeId: string,
  entryId: string,
  payload: WorldCupEntryPickPayload
): Promise<WorldCupEntryPickResult> {
  const res = await apiFetch(
    `/api/brackets/world-cup/${challengeId}/entries/${entryId}/picks`,
    { method: "POST", body: JSON.stringify(payload) }
  )
  const data = await readApiJson<WorldCupEntryPickResult & { error?: string }>(res)
  if (!res.ok) throw new Error(data.error ?? "Failed to save pick")
  if (!Array.isArray(data.picks)) throw new Error("Save pick response missing picks")
  return data as WorldCupEntryPickResult
}

/**
 * Clear specific picks for an entry (used when an earlier-round pick changes
 * and downstream picks are now invalid).
 * Returns the remaining picks after deletion.
 */
export async function clearWorldCupBracketEntryPicks(
  challengeId: string,
  entryId: string,
  matchIds: string[]
): Promise<unknown[]> {
  if (matchIds.length === 0) return []
  const res = await apiFetch(
    `/api/brackets/world-cup/${challengeId}/entries/${entryId}/picks`,
    { method: "DELETE", body: JSON.stringify({ matchIds }) }
  )
  const data = await readApiJson<{ error?: string; picks?: unknown[] }>(res)
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Failed to clear picks")
  return (data as { picks: unknown[] }).picks ?? []
}

export async function fetchWorldCupGroupStageView(
  challengeId: string,
  entryId: string
): Promise<WorldCupGroupStageViewClient> {
  const res = await apiFetch(`/api/brackets/world-cup/${challengeId}/entries/${entryId}/group-stage`, {
    cache: "no-store",
  })
  const data = await readApiJson<{ error?: string; view?: WorldCupGroupStageViewClient }>(res)
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Failed to load group stage")
  if (!data.view) throw new Error("Group stage response missing view")
  return data.view
}

export async function saveWorldCupGroupRankingClient(
  challengeId: string,
  entryId: string,
  groupId: string,
  orderedTeamIds: string[]
): Promise<WorldCupGroupStageViewClient> {
  const res = await apiFetch(`/api/brackets/world-cup/${challengeId}/entries/${entryId}/group-rankings`, {
    method: "POST",
    body: JSON.stringify({ groupId, orderedTeamIds }),
  })
  const data = await readApiJson<{ error?: string; view?: WorldCupGroupStageViewClient }>(res)
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Failed to save group ranking")
  if (!data.view) throw new Error("Save group ranking response missing view")
  return data.view
}

export async function saveWorldCupThirdPlaceAdvancersClient(
  challengeId: string,
  entryId: string,
  input: { selectedTeamIds?: string[]; selectedGroupIds?: string[] }
): Promise<WorldCupGroupStageViewClient> {
  const res = await apiFetch(`/api/brackets/world-cup/${challengeId}/entries/${entryId}/third-place-advancers`, {
    method: "POST",
    body: JSON.stringify(input),
  })
  const data = await readApiJson<{ error?: string; view?: WorldCupGroupStageViewClient }>(res)
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Failed to save third-place advancers")
  if (!data.view) throw new Error("Save third-place response missing view")
  return data.view
}

export async function getWorldCupIntegrityReport(
  challengeId: string
): Promise<WorldCupChallengeIntegrityReport> {
  const res = await apiFetch(`/api/brackets/world-cup/${challengeId}/admin/integrity`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? "Failed to run integrity check")
  }
  return (data as { report: WorldCupChallengeIntegrityReport }).report
}

// ── AI matchup preview ────────────────────────────────────────────────────────

export async function getWorldCupAiMatchupPreview(
  challengeId: string,
  payload: {
    matchId: string
    entryId?: string
    strategy?: WorldCupAiStrategy
  }
): Promise<WorldCupAiMatchupPreview> {
  const res = await apiFetch(
    `/api/brackets/world-cup/${challengeId}/ai/matchup-preview`,
    { method: "POST", body: JSON.stringify(payload) }
  )
  const data = await res.json()
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "AI preview failed")
  return (data as { preview: WorldCupAiMatchupPreview }).preview
}

export async function getWorldCupMatchupIntelligence(
  challengeId: string,
  entryId: string,
  payload: {
    matchId: string
    strategy?: WorldCupAiStrategy
    intent?: "panel" | "ask_ai" | "explain"
    confirmTokenSpend?: boolean
  }
): Promise<WorldCupMatchupIntelligence> {
  const res = await apiFetch(
    `/api/brackets/world-cup/${challengeId}/entries/${entryId}/ai/matchup`,
    { method: "POST", body: JSON.stringify(payload) }
  )
  const data = await res.json()
  if (isWorldCupTokenConfirmationResponse(res.status, data)) {
    if (!confirmWorldCupTokenSpend(data)) {
      throw new Error("Token spend was not confirmed.")
    }
    return getWorldCupMatchupIntelligence(challengeId, entryId, {
      ...payload,
      confirmTokenSpend: true,
    })
  }
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Matchup intelligence failed")
  return (data as { intelligence: WorldCupMatchupIntelligence }).intelligence
}

// ── Status helper ─────────────────────────────────────────────────────────────

export function getEntryStatus(
  entry: Pick<
    WorldCupBracketEntryClient,
    "isLocked" | "isComplete" | "correctPicks" | "totalScore"
  >,
  isChallengeLive?: boolean
): WorldCupEntryStatus {
  if (entry.isLocked && isChallengeLive) return "live"
  if (entry.isLocked) return "locked"
  if (entry.isComplete) return "complete"
  if (entry.correctPicks > 0 || entry.totalScore > 0) return "in_progress"
  return "not_started"
}

// ── Admin sync helpers ────────────────────────────────────────────────────────

export type WorldCupAdminSyncProvider = "mock" | "apifootball" | "sportsdata" | "manual"

export type WorldCupAdminSyncTeamsResult = {
  ok: boolean
  created: number
  updated: number
  skipped: number
  groupsAssigned?: number
  officialGroupsReady?: boolean
  incompleteGroups?: Array<{ groupName: string; teamCount: number; missingTeams: number }>
  warnings: string[]
  teamCount: number
  syncedAt: string
  dryRun: boolean
}

export type WorldCupAdminSyncFixturesResult = {
  ok: boolean
  created: number
  updated: number
  skipped: number
  warnings: string[]
  lockTimeInferred: string | null
  fixtureCount: number
  syncedAt: string
  dryRun: boolean
}

export type WorldCupAdminSyncLiveResult = {
  ok: boolean
  updated: number
  skipped: number
  finalMatches: number
  recalculated: boolean
  warnings: string[]
  syncedAt: string
  dryRun: boolean
}

export type WorldCupAdminSyncInjuriesResult = {
  ok: boolean
  created: number
  changed: number
  skipped: number
  notificationsCreated: number
  warnings: string[]
  injuryCount: number
  syncedAt: string
  dryRun: boolean
}

export type WorldCupAdminSyncGroupStandingsResult = {
  ok: boolean
  provider: WorldCupAdminSyncProvider
  result: {
    challengeId: string
    standingsReceived: number
    groupsUpdated: number
    groupTeamsUpdated: number
    thirdPlaceTeamsUpdated: number
    warnings?: string[]
  }
  view?: WorldCupChallengeView
  syncedAt: string
}

export type WorldCupAdminSimulationStrategy = "random" | "higher_seed" | "home" | "away"

export type WorldCupAdminSimulationMatchResult = {
  ok: boolean
  result: {
    challengeId: string
    dryRun: boolean
    updatedMatch: unknown
    advancedMatchIds: string[]
    recalculated: boolean
    leaderboardTop: unknown[]
  }
}

export type WorldCupAdminSimulationRoundResult = {
  ok: boolean
  result: {
    challengeId: string
    round: string
    dryRun: boolean
    strategy: WorldCupAdminSimulationStrategy
    simulatedMatches: number
    skippedMatches: number
    skippedMatchIds: string[]
  }
}

export type WorldCupAdminSimulationTournamentResult = {
  ok: boolean
  result: {
    challengeId: string
    dryRun: boolean
    strategy: WorldCupAdminSimulationStrategy
    rounds: Array<{
      round: string
      simulatedMatches: number
      skippedMatches: number
      skippedMatchIds: string[]
    }>
    champion: {
      winnerTeamId: string | null
      winnerTeamName: string | null
    }
    leaderboardTop: unknown[]
  }
}

export type WorldCupAdminResetSimulationResult = {
  ok: boolean
  result: {
    challengeId: string
    dryRun: boolean
    resetMatches: number
    recalculated: boolean
  }
}

export async function adminSyncWorldCupTeams(opts: {
  provider?: WorldCupAdminSyncProvider
  dryRun?: boolean
}): Promise<WorldCupAdminSyncTeamsResult> {
  const res = await apiFetch("/api/brackets/world-cup/admin/sync-teams", {
    method: "POST",
    body: JSON.stringify(opts),
  })
  const data = await res.json()
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Sync teams failed")
  return data as WorldCupAdminSyncTeamsResult
}

export async function adminSyncWorldCupFixtures(
  challengeId: string,
  opts: { provider?: WorldCupAdminSyncProvider; dryRun?: boolean }
): Promise<WorldCupAdminSyncFixturesResult> {
  const res = await apiFetch(
    `/api/brackets/world-cup/${challengeId}/admin/sync-fixtures`,
    { method: "POST", body: JSON.stringify(opts) }
  )
  const data = await res.json()
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Sync fixtures failed")
  return data as WorldCupAdminSyncFixturesResult
}

export async function adminSyncWorldCupLive(
  challengeId: string,
  opts: {
    provider?: WorldCupAdminSyncProvider
    dryRun?: boolean
    recalculate?: boolean
  }
): Promise<WorldCupAdminSyncLiveResult> {
  const res = await apiFetch(
    `/api/brackets/world-cup/${challengeId}/admin/sync-live`,
    { method: "POST", body: JSON.stringify(opts) }
  )
  const data = await res.json()
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Sync live failed")
  return data as WorldCupAdminSyncLiveResult
}

export async function adminSyncWorldCupInjuries(
  challengeId: string,
  opts: { provider?: WorldCupAdminSyncProvider; dryRun?: boolean }
): Promise<WorldCupAdminSyncInjuriesResult> {
  const res = await apiFetch(
    `/api/brackets/world-cup/${challengeId}/admin/sync-injuries`,
    { method: "POST", body: JSON.stringify(opts) }
  )
  const data = await res.json()
  if (!res.ok) throw new Error((data as { error?: string; message?: string }).message ?? (data as { error?: string }).error ?? "Sync injuries failed")
  return data as WorldCupAdminSyncInjuriesResult
}

export async function adminSyncWorldCupGroupStandings(
  challengeId: string,
  opts: { provider?: WorldCupAdminSyncProvider }
): Promise<WorldCupAdminSyncGroupStandingsResult> {
  const res = await apiFetch(
    `/api/brackets/world-cup/${challengeId}/admin/sync-group-standings`,
    { method: "POST", body: JSON.stringify(opts) }
  )
  const data = await res.json()
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Sync group standings failed")
  return data as WorldCupAdminSyncGroupStandingsResult
}

export async function adminSimulateWorldCupMatch(
  challengeId: string,
  payload: {
    matchId: string
    winnerTeamId?: string | null
    homeScore?: number | null
    awayScore?: number | null
    elapsedMinute?: number | null
    dryRun?: boolean
    status?: "scheduled" | "live" | "final"
  }
): Promise<WorldCupAdminSimulationMatchResult> {
  const res = await apiFetch(
    `/api/brackets/world-cup/${challengeId}/admin/simulate-match`,
    {
      method: "POST",
      body: JSON.stringify({ ...payload, confirmSimulation: true }),
    }
  )
  const data = await res.json()
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Simulate match failed")
  return data as WorldCupAdminSimulationMatchResult
}

export async function adminSimulateWorldCupRound(
  challengeId: string,
  payload: {
    round: "round_of_32" | "round_of_16" | "quarterfinal" | "semifinal" | "third_place" | "final"
    strategy: WorldCupAdminSimulationStrategy
    dryRun?: boolean
  }
): Promise<WorldCupAdminSimulationRoundResult> {
  const res = await apiFetch(
    `/api/brackets/world-cup/${challengeId}/admin/simulate-round`,
    {
      method: "POST",
      body: JSON.stringify({ ...payload, confirmSimulation: true }),
    }
  )
  const data = await res.json()
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Simulate round failed")
  return data as WorldCupAdminSimulationRoundResult
}

export async function adminSimulateWorldCupTournament(
  challengeId: string,
  payload: {
    strategy: WorldCupAdminSimulationStrategy
    dryRun?: boolean
  }
): Promise<WorldCupAdminSimulationTournamentResult> {
  const res = await apiFetch(
    `/api/brackets/world-cup/${challengeId}/admin/simulate-tournament`,
    {
      method: "POST",
      body: JSON.stringify({ ...payload, confirmSimulation: true }),
    }
  )
  const data = await res.json()
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Simulate tournament failed")
  return data as WorldCupAdminSimulationTournamentResult
}

export async function adminResetWorldCupSimulation(
  challengeId: string,
  payload?: { dryRun?: boolean }
): Promise<WorldCupAdminResetSimulationResult> {
  const res = await apiFetch(
    `/api/brackets/world-cup/${challengeId}/admin/reset-simulation`,
    {
      method: "POST",
      body: JSON.stringify({ ...(payload ?? {}), confirmSimulationReset: true }),
    }
  )
  const data = await res.json()
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Reset simulation failed")
  return data as WorldCupAdminResetSimulationResult
}

export type WorldCupAdminLoadTestFixturesResult = {
  ok: boolean
  result: {
    success: boolean
    teamsCreated: number
    teamsUpdated: number
    slotsUpdated?: number
    templateMatchesCreated?: number
    templateSlotsCreated?: number
    matchesUpdated: number
    pickableMatchesAfter: number
    totalMatchesAfter: number
    unresolvedMatchesAfter: number
    warnings: string[]
  }
  view?: WorldCupChallengeView
}

export async function adminLoadWorldCupTestFixtures(
  challengeId: string,
  payload?: { dryRun?: boolean }
): Promise<WorldCupAdminLoadTestFixturesResult> {
  const res = await apiFetch(
    `/api/brackets/world-cup/${challengeId}/admin/load-test-fixtures`,
    {
      method: "POST",
      body: JSON.stringify({ ...(payload ?? {}), confirmTestFixtures: true }),
    }
  )
  const data = await res.json()
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Load test fixtures failed")
  return data as WorldCupAdminLoadTestFixturesResult
}
