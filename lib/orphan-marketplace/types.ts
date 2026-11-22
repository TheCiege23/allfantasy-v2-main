type OrphanAdoptionRequestStatus = "pending" | "approved" | "rejected"

export interface OrphanAdoptionRequest {
  id: string
  leagueId: string
  rosterId: string
  userId: string
  requesterName: string
  message: string | null
  status: OrphanAdoptionRequestStatus
  createdAt: string
  resolvedAt: string | null
  resolvedBy: string | null
  commissionerNote: string | null
  aiEvaluationSummary: string | null
}

