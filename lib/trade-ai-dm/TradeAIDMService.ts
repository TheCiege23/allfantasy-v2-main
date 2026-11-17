import { buildAIChatHref } from '@/lib/chimmy-chat/AIContextRouter'
import { createPlatformThread, createSystemMessage } from '@/lib/platform/chat-service'
import { prisma } from '@/lib/prisma'

export interface TradeAIDMReviewPayload {
  verdict: string
  summary: string
  reasons?: string[]
  counterReasons?: string[]
  declineReasons?: string[]
  suggestedCounterPackage?: string | null
}

export interface SendPrivateTradeAIDMInput {
  receiverUserId: string
  leagueId: string
  proposalId: string
  review: TradeAIDMReviewPayload
  trigger: 'trade_received' | 'review_requested'
}

export interface SendPrivateTradeAIDMResult {
  sent: boolean
  threadId: string | null
  counterSuggestion: string | null
}

function resolveCounterSuggestion(review: TradeAIDMReviewPayload): string {
  const preferred = review.suggestedCounterPackage?.trim()
  if (preferred) return preferred

  const fromReasons = Array.isArray(review.counterReasons)
    ? review.counterReasons.find((reason) => typeof reason === 'string' && reason.trim().length > 0)?.trim()
    : null
  if (fromReasons) return fromReasons

  return 'Counter by asking for a slightly stronger return before accepting.'
}

function buildTradeDmPrompt(input: {
  proposalId: string
  verdict: string
  counterSuggestion: string
}): string {
  const action = input.verdict.toUpperCase()
  return [
    `Re-check draft trade proposal ${input.proposalId}.`,
    `Current deterministic suggestion: ${action}.`,
    `Counter idea: ${input.counterSuggestion}`,
    'Give me one safer option and one higher-upside option.',
  ].join(' ')
}

export async function sendPrivateTradeAIDM(
  input: SendPrivateTradeAIDMInput
): Promise<SendPrivateTradeAIDMResult> {
  const counterSuggestion = resolveCounterSuggestion(input.review)

  try {
    const existingAiThreadMember = await (prisma as any).platformChatThreadMember.findFirst({
      where: {
        userId: input.receiverUserId,
        isBlocked: false,
        thread: { threadType: 'ai', productType: 'app' },
      },
      select: { threadId: true },
    })

    let aiThreadId = (existingAiThreadMember?.threadId as string | undefined) ?? null
    if (!aiThreadId) {
      const createdThread = await createPlatformThread({
        creatorUserId: input.receiverUserId,
        threadType: 'ai',
        productType: 'app',
        title: 'Trade Chimmy Private Reviews',
      })
      aiThreadId = createdThread?.id ?? null
    }
    if (!aiThreadId) {
      return { sent: false, threadId: null, counterSuggestion }
    }

    const aiChatHref = buildAIChatHref({
      source: 'trade_analyzer',
      leagueId: input.leagueId,
      insightType: 'trade',
      prompt: buildTradeDmPrompt({
        proposalId: input.proposalId,
        verdict: input.review.verdict,
        counterSuggestion,
      }),
    })

    const privateReviewText = [
      `Private Chimmy trade review for proposal ${input.proposalId}.`,
      `Suggested action: ${input.review.verdict.toUpperCase()}.`,
      input.review.summary,
      `Counter suggestion: ${counterSuggestion}`,
      'This review is private and not posted to league chat.',
    ].join(' ')

    const created = await createSystemMessage(aiThreadId, 'trade_ai_review', privateReviewText, {
      private: true,
      trigger: input.trigger,
      leagueId: input.leagueId,
      tradeProposalId: input.proposalId,
      suggestedAction: input.review.verdict,
      reasons: input.review.reasons ?? [],
      counterReasons: input.review.counterReasons ?? [],
      declineReasons: input.review.declineReasons ?? [],
      suggestedCounterPackage: input.review.suggestedCounterPackage ?? null,
      counterSuggestion,
      actionHref: aiChatHref,
      actionLabel: 'Open Chimmy trade chat',
    })

    return { sent: Boolean(created), threadId: aiThreadId, counterSuggestion }
  } catch {
    return { sent: false, threadId: null, counterSuggestion }
  }
}
