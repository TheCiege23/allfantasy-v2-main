import { prisma } from '@/lib/prisma'

/** Only use the frozen server assessment attached to the actual offer. */
export function acceptedTradeGradeText(result: unknown): string {
  const decision = result as { evaluatorSupported?: boolean; participants?: Array<{ grade?: unknown; coverageStatus?: string }> } | null
  if (!decision?.evaluatorSupported || !Array.isArray(decision.participants) || !decision.participants.length) return 'Initial grade unavailable; open the trade for details.'
  const grades = decision.participants.map(p => typeof p.grade === 'string' && /^[A-F][+-]?$/.test(p.grade) && p.coverageStatus === 'complete' ? p.grade : null)
  if (grades.some(g => !g)) return 'Initial grade unavailable; the assessment has incomplete player coverage.'
  return `Initial market grades: ${grades.join(' / ')}.`
}

export async function loadAcceptedTradeGradeText(tradeId: string): Promise<string> {
  try {
    const snapshot = await prisma.tradeDecisionSnapshot.findUnique({ where: { tradeId }, select: { decisionResult: true } })
    return acceptedTradeGradeText(snapshot?.decisionResult)
  } catch { return 'Initial grade unavailable; open the trade for details.' }
}
