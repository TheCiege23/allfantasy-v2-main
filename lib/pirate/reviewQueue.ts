type ReviewableClaim = {
  id: string
  week: number
  status: string
  selectionDeadlineAt: string | null
  deadlineAt: string | null
  scoreCorrectionNeedsReversal: boolean
}

export function pirateReviewQueue<T extends ReviewableClaim>(
  claims: T[],
  ruledIds: ReadonlySet<string>,
  evidence: Record<string, {decision:string;issues:string[]} | null>,
  now: number,
) {
  return claims.flatMap(claim => {
    if (claim.status === 'transferred' && claim.scoreCorrectionNeedsReversal)
      return [{claim, priority:0, reason:'Final score changed after the transfer. Review both rosters before reversing.'}]
    if (['pending','countered'].includes(claim.status) && claim.deadlineAt && Date.parse(claim.deadlineAt)+5*60000<=now)
      return [{claim, priority:1, reason:'The response deadline passed and the player has not transferred. Review and retry if appropriate.'}]
    if (claim.status === 'selection_expired' || (claim.status === 'awaiting_selection' && claim.selectionDeadlineAt && Date.parse(claim.selectionDeadlineAt)<=now))
      return [{claim, priority:2, reason:'The winner missed the selection deadline. Review the claim before selecting for them.'}]
    const finding=evidence[claim.id]
    if (['pending','countered','awaiting_selection'].includes(claim.status) && !ruledIds.has(claim.id) &&
        finding?.decision==='review' && finding.issues.length)
      return [{claim, priority:3, reason:`Lineup evidence needs review: ${finding.issues.join('; ')}. Protections stay in place pending a ruling.`}]
    return []
  }).sort((a,b)=>a.priority-b.priority || b.claim.week-a.claim.week)
}
