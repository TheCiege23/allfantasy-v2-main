import { resolveOverallForRoundSlot } from '@/lib/live-draft-engine/draftPickTradeInventory'

export type DraftTradeAiVerdict = 'accept' | 'reject' | 'counter'

export type DraftTradeAiReview = {
  verdict: DraftTradeAiVerdict
  reasons: string[]
  declineReasons: string[]
  counterReasons: string[]
  summary: string
  suggestedCounterPackage: string | null
}

export type DraftTradeAiReviewInput = {
  giveRound: number
  giveSlot: number
  receiveRound: number
  receiveSlot: number
  teamCount: number
  /** When set, overall pick delta uses real board order (snake / 3RR). */
  draftType?: 'snake' | 'linear' | 'auction'
  thirdRoundReversal?: boolean
}

function formatPickLabel(round: number, slot: number): string {
  return `${round}.${String(slot).padStart(2, '0')}`
}

export function buildDraftTradeAiReview(input: DraftTradeAiReviewInput): DraftTradeAiReview {
  const teamCount = Math.max(2, Number(input.teamCount) || 12)
  const draftType = input.draftType ?? 'snake'
  const thirdRoundReversal = Boolean(input.thirdRoundReversal)

  let giveOverall: number
  let receiveOverall: number
  if (draftType === 'auction') {
    giveOverall = (input.giveRound - 1) * teamCount + input.giveSlot
    receiveOverall = (input.receiveRound - 1) * teamCount + input.receiveSlot
  } else {
    const go = resolveOverallForRoundSlot({
      round: input.giveRound,
      slot: input.giveSlot,
      teamCount,
      draftType,
      thirdRoundReversal,
    })
    const ro = resolveOverallForRoundSlot({
      round: input.receiveRound,
      slot: input.receiveSlot,
      teamCount,
      draftType,
      thirdRoundReversal,
    })
    giveOverall = go ?? (input.giveRound - 1) * teamCount + input.giveSlot
    receiveOverall = ro ?? (input.receiveRound - 1) * teamCount + input.receiveSlot
  }

  const overallDelta = receiveOverall - giveOverall
  const giveLabel = formatPickLabel(input.giveRound, input.giveSlot)
  const receiveLabel = formatPickLabel(input.receiveRound, input.receiveSlot)

  let verdict: DraftTradeAiVerdict = 'accept'
  const reasons: string[] = []
  const declineReasons: string[] = []
  const counterReasons: string[] = []
  let suggestedCounterPackage: string | null = null

  if (overallDelta <= -2) {
    verdict = 'accept'
    reasons.push(
      `You would receive an earlier pick (${receiveLabel}) for a later pick (${giveLabel}), which is typically favorable.`
    )
    reasons.push('Accept if this aligns with your positional targets for that range.')
  } else if (overallDelta >= teamCount) {
    verdict = 'reject'
    reasons.push(
      `You would move back significantly from ${giveLabel} to ${receiveLabel}.`
    )
    declineReasons.push('Pick downgrade is too large without additional compensation.')
    declineReasons.push('Reject unless the offer includes extra draft value.')
  } else if (overallDelta > 0) {
    verdict = 'counter'
    reasons.push(
      `You are giving an earlier pick (${giveLabel}) for a later one (${receiveLabel}).`
    )
    const suggestedRound = Math.max(input.receiveRound + 1, input.giveRound + 1)
    suggestedCounterPackage = `Ask for an additional future pick (for example round ${suggestedRound}) or a move-up on the return pick.`
    counterReasons.push('Current offer favors the proposer on draft capital.')
    counterReasons.push(suggestedCounterPackage)
  } else {
    verdict = 'accept'
    reasons.push('Pick values are close. Accept if this improves your preferred board flow.')
    reasons.push('Counter only if you want a specific tier break in a nearby slot.')
  }

  const summary = reasons[0] ?? 'Review this proposal in your private Chimmy context before responding.'
  return {
    verdict,
    reasons,
    declineReasons,
    counterReasons,
    summary,
    suggestedCounterPackage,
  }
}
