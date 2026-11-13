export type ProductInsightsResult = {
  since: string
  until: string
  countsByEvent: Array<{ event: string; _count: number }>
  dailySeries: Array<{ day: string; event: string; count: number }>
  createLeagueSummary: {
    serverSuccess: number
    serverFail: number
    clientSuccess: number
    clientFail: number
    funnelOpen: number
    funnelAbandon: number
  }
  engagementSummary: {
    draftCompleted: number
    waiverRuns: number
    tradesProcessed: number
    matchupViews: number
    commissionerSettings: number
    aiMatchup: number
    aiStartSit: number
    joinInviteTeamClaims: number
    draftRoomStarts: number
    draftRoomPicks: number
    draftRoomQueueAdds: number
    draftRoomChatSends: number
    draftRoomInviteCopies: number
    draftRoomCommissionerAutopickLeague: number
    draftRoomCommissionerForceAutopick: number
    draftRoomClaimSlots: number
  }
  engineSampleCounts: Array<{ event: string; _count: number }>
}

