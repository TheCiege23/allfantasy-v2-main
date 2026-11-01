/** Current survivor status is authoritative; revivedAt records a prior revival. */
export function isRevivedSurvivor(team: { status: string; revivedAt: Date | null }): boolean {
  const status = team.status.toLowerCase()
  return status.includes('revived') || (status.includes('survivor') && team.revivedAt != null)
}
