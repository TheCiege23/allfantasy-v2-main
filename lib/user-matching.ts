export interface PartyLike {
  userId?: string
  teamName?: string
  displayName?: string
  rosterId?: number
}

export function isUserParty(
  p: PartyLike,
  username: string,
  sleeperUserId?: string
): boolean {
  if (!p) return false
  const uLower = username?.toLowerCase() || ''

  if (sleeperUserId && p.userId === sleeperUserId) return true
  if (p.userId === username) return true

  if (p.displayName?.toLowerCase() === uLower) return true
  if (p.teamName?.toLowerCase() === uLower) return true

  if (uLower.length > 2) {
    if (p.displayName?.toLowerCase().includes(uLower)) return true
    if (p.teamName?.toLowerCase().includes(uLower)) return true
  }

  return false
}

