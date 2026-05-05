/**
 * Pure utility functions shared between World Cup UI components and tests.
 * No JSX, no Next.js imports — safe to import in any context including Vitest.
 */

export type InviteInfo = {
  inviteCode: string
  challengeId: string
  name: string
  ownerName: string
  seasonYear: number
  participantCount: number
  status: string
  visibility?: string
  maxUses?: number | null
  useCount?: number
  expiresAt?: string | null
}

/** Returns a human-readable block reason string, or null if the bracket is joinable. */
export function getBracketBlockReason(invite: InviteInfo): string | null {
  if (invite.status === "final") return "This bracket challenge has ended."
  if (invite.status === "locked") return "This bracket is locked — picks are no longer accepted."
  if (invite.status === "setup") return "This bracket is still being set up and is not open yet."
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date())
    return "This invite link has expired."
  if (invite.maxUses != null && invite.useCount != null && invite.useCount >= invite.maxUses)
    return "This invite has reached its maximum number of uses."
  return null
}

/** Maps a raw API error string to a friendly UI message. */
export function mapJoinError(apiError: string): string {
  const e = apiError.toLowerCase()
  if (e.includes("unauthenticated") || e.includes("unauthorized")) return "__login__"
  if (e.includes("already") || e.includes("duplicate") || e.includes("unique constraint"))
    return "You have already joined this bracket."
  if (e.includes("locked")) return "This bracket is locked — picks are no longer accepted."
  if (e.includes("expired")) return "This invite link has expired."
  if (e.includes("max") || e.includes("full")) return "This bracket is full."
  if (e.includes("not found")) return "Bracket not found. It may have been deleted."
  if (e.includes("not open") || e.includes("setup")) return "This bracket is not open for entries yet."
  if (e.includes("final")) return "This bracket has already ended."
  return apiError || "Could not join bracket. Please try again."
}

/**
 * Given a bracket slot key (e.g. "A1", "TBD2", "W-M5") and optional team info,
 * returns a human-readable display name.
 */
export function formatWorldCupPlaceholder(
  slotKey: string,
  teamName?: string | null,
  teamId?: string | null
): string {
  const normalizedName = (teamName ?? "").trim()
  if (teamId && normalizedName && !normalizedName.toLowerCase().startsWith("tbd")) return normalizedName
  if (normalizedName && !normalizedName.toLowerCase().startsWith("tbd")) return normalizedName

  const groupMatch = slotKey.match(/^([A-L])(1|2|3)$/)
  if (groupMatch) {
    if (groupMatch[2] === "1") return `Group ${groupMatch[1]} Winner`
    if (groupMatch[2] === "2") return `Group ${groupMatch[1]} Runner-up`
    return "Best 3rd Place Qualifier"
  }

  const qualifierMatch = slotKey.match(/^TBD(\d+)$/)
  if (qualifierMatch) return `TBD Qualifier ${qualifierMatch[1]}`

  const winnerMatch = slotKey.match(/^W-M(\d+)$/)
  if (winnerMatch) return `Winner Match ${winnerMatch[1]}`

  const loserMatch = slotKey.match(/^L-M(\d+)$/)
  if (loserMatch) return `Loser Match ${loserMatch[1]}`

  return normalizedName || slotKey
}
