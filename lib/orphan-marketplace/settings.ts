import type { OrphanAdoptionRequest } from "./types"

const REQUESTS_SETTINGS_KEY = "orphan_adoption_requests"

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function parseRequest(value: unknown): OrphanAdoptionRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const row = value as Record<string, unknown>

  const id = typeof row.id === "string" ? row.id.trim() : ""
  const leagueId = typeof row.leagueId === "string" ? row.leagueId.trim() : ""
  const rosterId = typeof row.rosterId === "string" ? row.rosterId.trim() : ""
  const userId = typeof row.userId === "string" ? row.userId.trim() : ""
  const requesterName = typeof row.requesterName === "string" ? row.requesterName.trim() : ""
  const statusRaw = typeof row.status === "string" ? row.status.trim().toLowerCase() : "pending"
  const status = statusRaw === "approved" || statusRaw === "rejected" ? statusRaw : "pending"

  if (!id || !leagueId || !rosterId || !userId || !requesterName) return null

  return {
    id,
    leagueId,
    rosterId,
    userId,
    requesterName,
    message: typeof row.message === "string" && row.message.trim().length > 0 ? row.message.trim() : null,
    status,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString(),
    resolvedAt: typeof row.resolvedAt === "string" ? row.resolvedAt : null,
    resolvedBy: typeof row.resolvedBy === "string" ? row.resolvedBy : null,
    commissionerNote:
      typeof row.commissionerNote === "string" && row.commissionerNote.trim().length > 0
        ? row.commissionerNote.trim()
        : null,
    aiEvaluationSummary:
      typeof row.aiEvaluationSummary === "string" && row.aiEvaluationSummary.trim().length > 0
        ? row.aiEvaluationSummary.trim()
        : null,
  }
}

export function getOrphanAdoptionRequests(settings: unknown): OrphanAdoptionRequest[] {
  const root = toRecord(settings)
  const raw = root[REQUESTS_SETTINGS_KEY]
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry) => parseRequest(entry))
    .filter((entry): entry is OrphanAdoptionRequest => entry != null)
}

export function withOrphanAdoptionRequests(
  settings: unknown,
  requests: OrphanAdoptionRequest[]
): Record<string, unknown> {
  const root = toRecord(settings)
  return {
    ...root,
    [REQUESTS_SETTINGS_KEY]: requests,
  }
}

export function buildOrphanTeamEvaluationPreview(input: {
  wins: number
  losses: number
  ties: number
  rosterPreviewCount: number
  draftPicksOwned: number
  leagueTypeLabel: string
  scoringFormat: string
}): string {
  const gamesPlayed = input.wins + input.losses + input.ties
  const winRate = gamesPlayed > 0 ? (input.wins + input.ties * 0.5) / gamesPlayed : 0.5
  const competitiveness =
    winRate >= 0.62 ? "contender profile" : winRate >= 0.46 ? "mid-tier profile" : "rebuild profile"
  const rosterDepth =
    input.rosterPreviewCount >= 7 ? "strong visible depth" : input.rosterPreviewCount >= 4 ? "moderate visible depth" : "limited visible depth"
  const pickCapital =
    input.draftPicksOwned >= 4 ? "plus draft capital" : input.draftPicksOwned >= 2 ? "balanced draft capital" : "light draft capital"

  return `Chimmy preview: ${competitiveness} in ${input.leagueTypeLabel} (${input.scoringFormat}); ${rosterDepth}; ${pickCapital}.`
}

