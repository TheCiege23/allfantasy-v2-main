/**
 * Player/commissioner "fair play" mode: commissioner competes and should not see
 * cross-tribe intel that normal commissioners see. Driven by league JSON from create wizard.
 */

export type SurvivorCommissionerRoleSetting = 'commissioner_only' | 'player_commissioner' | string | null | undefined

export function parseSurvivorFairPlayFromLeagueSettings(
  settings: Record<string, unknown> | null | undefined,
): { fairPlayLimited: boolean; commissionerRole: SurvivorCommissionerRoleSetting } {
  const s = settings ?? {}
  const role = s.survivor_commissioner_role
  const explicitFlag = s.survivor_commissioner_fair_play_limited_visibility === true
  const fairPlayLimited =
    explicitFlag || role === 'player_commissioner' || String(role).toLowerCase() === 'player_commissioner'
  return {
    fairPlayLimited,
    commissionerRole: typeof role === 'string' ? role : null,
  }
}

/** True when this viewer should receive redacted survivor summary + UI (playing commissioner). */
export function shouldApplySurvivorFairPlayRedaction(
  fairPlayLimited: boolean,
  isCommissioner: boolean,
  viewerHasTeam: boolean,
): boolean {
  return Boolean(fairPlayLimited && isCommissioner && viewerHasTeam)
}

type TribeSummary = {
  id: string
  name?: string
  slotIndex?: number
  members: Array<{ rosterId: string; isLeader?: boolean }>
}

/** Redacts cross-tribe roster linkage for fair-play commissioners. */
export function redactSurvivorSummaryPayloadForFairPlay<
  T extends {
    tribes: TribeSummary[]
    rosterDisplayNames: Record<string, string>
    exileTokens: Array<{
      rosterId: string
      mainRosterId: string | null
      displayName: string
      tokens: number
      lastAwardedWeek?: number | null
    }>
    votedOutHistory: unknown[]
    myRosterId?: string
    myTribeId?: string
    merged: boolean
  },
>(payload: T): T & { fairPlayMode: true } {
  const myRosterId = payload.myRosterId
  const myTribeId = payload.myTribeId ?? null

  const rosterDisplayNames: Record<string, string> = {}
  if (myRosterId && payload.rosterDisplayNames[myRosterId]) {
    rosterDisplayNames[myRosterId] = payload.rosterDisplayNames[myRosterId]!
  }

  const tribes = payload.tribes.map((t) => {
    if (payload.merged && t.id === 'merged') {
      const mine = myRosterId ? t.members.filter((m) => m.rosterId === myRosterId) : []
      const others = t.members.length - mine.length
      return {
        ...t,
        members: mine,
        fairPlayRedacted: others > 0,
        otherMemberCount: others,
      }
    }
    if (myTribeId && t.id === myTribeId) {
      return t
    }
    const n = t.members.length
    return {
      ...t,
      members: [],
      fairPlayRedacted: n > 0,
      memberCount: n,
    }
  })

  const exileTokens = myRosterId
    ? payload.exileTokens.filter((row) => row.mainRosterId === myRosterId)
    : []

  return {
    ...payload,
    tribes,
    rosterDisplayNames,
    exileTokens,
    votedOutHistory: [] as unknown[],
    fairPlayMode: true as const,
  }
}

/** Redacts `/api/survivor/season` payload for fair-play playing commissioners. */
export function redactSurvivorSeasonPayloadForFairPlay<Payload extends { tribes: unknown[]; players: unknown[]; weeklyScores?: unknown[] }>(
  payload: Payload,
  userId: string,
  myTribeId: string | null | undefined,
): Payload & { fairPlayMode: true } {
  const players = (payload.players as { userId?: string; tribeId?: string | null }[]).filter((p) => {
    if (p.userId === userId) return true
    if (myTribeId != null && p.tribeId === myTribeId) return true
    return false
  })
  const tribes = (payload.tribes as { id: string; members?: unknown[] }[]).map((t) => {
    if (myTribeId && t.id === myTribeId) return t
    const n = Array.isArray(t.members) ? t.members.length : 0
    return { ...t, members: [], fairPlayRedacted: n > 0, memberCount: n }
  })
  const weeklyScores = (payload.weeklyScores as { userId?: string; tribeId?: string | null }[] | undefined)?.filter(score =>
    score.userId === userId || (myTribeId != null && score.tribeId === myTribeId))
  return { ...payload, tribes, players, ...(weeklyScores ? { weeklyScores } : {}), fairPlayMode: true as const }
}
