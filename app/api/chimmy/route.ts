import { withPaidToolBilling } from '@/lib/tokens/paidToolBilling'
/**
 * Chimmy route alias. Accepts the legacy JSON contract and maps it into the dedicated handler.
 *
 * 🛑 DEPRECATED, AND NOT "CANONICAL" — THIS HEADER SAID IT WAS, AND THREE DOCS STILL DO.
 *
 * Measured 2026-08-31 across every call form — string literals, template paths, hooks, tests,
 * e2e and agent-tester: **nothing calls this route.** The traffic is on `/api/chat/chimmy`
 * (`app/core`, both CommsDrawer entry points, the mock-draft room).
 *
 * ⚠ THE DOCS DISAGREE AND THE DOCS ARE WRONG. `docs/AI_CHIMMY_QA_DELIVERABLE.md` states "League
 * chat AI tab: uses `useAIChat({ leagueId })` → POST /api/chimmy", and
 * `docs/CHIMMY_UNIFIED_ASSISTANT_DELIVERABLE.md` calls it "the preferred client entry point".
 * Traced: `useAIChat` posted to `/api/ai/chat?stream=1` (both since deleted as dead code, PR #1621)
 * and `ChimmyChatShell` to `/api/shared/chat/threads`. Neither touched this file. Those are dated
 * deliverables and are left as the historical record they are — this note is where a reader will
 * actually be.
 *
 * WHAT IT STILL DOES, AND WHY IT IS NOT DELETED: it adds commissioner, league-intelligence and
 * portfolio grounding, then forwards to `postChatChimmy`. All three resolvers are now also read by
 * `buildDecisionOsGroundingPacket`, so nothing here is unique any more — but that packet is behind
 * `DECISION_OS_GROUNDING_ENABLED`, and "nothing calls it" is a reason to stop maintaining a route,
 * not a reason to delete one while its replacement is still unproven.
 *
 * Retire it when the flag has been on long enough to compare answers. Until then: send nothing new
 * here, and if you are about to add a caller, use `/api/chat/chimmy` instead.
 *
 * ⚠ CORRECTION (2026-09-24): "NOTHING CALLS THIS ROUTE" IS NO LONGER TRUE, if it ever was.
 * `lib/chimmy-chat/ChimmyChatService.ts` (`sendChimmyMessage`) POSTs here, and it is mounted by
 * `app/components/ChimmyChat.tsx` (the dashboard's left chat panel and /legacy) and
 * `components/chimmy/ChimmyChatShell.tsx` (/chimmy/chat). Money rules here therefore reach real
 * users — which is why the AF Pro allowance below had to be applied here as well as there.
 *
 * ⚠ 2026-11-28: there is no "allowance below" any more. The `feature_chimmy_anthropic` branch that
 * ran `runAgentPipeline` here (and carried its own copy of the allowance, token gate and daily cap)
 * is gone; every non-tournament request is forwarded to `postChatChimmy`, which owns all of that.
 * See the comment at the forward in `paidToolPost`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { answerSeasonAssistant, loadSeasonAssistantContext, seasonAssistantTopics } from '@/lib/tournament/seasonAssistantContext'
import { resolveChimmyCommissionerGrounding } from '@/lib/intelligence/chimmy/resolveChimmyGrounding'
import { z } from 'zod'

import { readDeepAnalysisPreview } from '@/lib/chimmy/deepAnalysisPreview'
import { POST as postChatChimmy } from '@/app/api/chat/chimmy/route'
import { runAiProtection } from '@/lib/ai-protection'
import { authOptions } from '@/lib/auth'
import {
  CHIMMY_GENERIC_ERROR_MESSAGE,
  CHIMMY_PREMIUM_FEATURE_MESSAGE,
  isChimmyPremiumGateResponse,
  resolveChimmyUpgradePath,
} from '@/lib/chimmy-chat/response-copy'

const MAX_MESSAGE_CHARS = 4_000
const MAX_CONVERSATION_TURNS = 20
const MAX_CONVERSATION_CONTENT_CHARS = 4_000
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
} as const

const ConversationTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(MAX_CONVERSATION_CONTENT_CHARS),
})

const ChimmyImageSchema = z.object({
  dataUrl: z.string().trim().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  type: z.string().trim().min(1).max(120).optional(),
})

const ChimmyJsonRequestSchema = z.object({
  message: z.string().trim().max(MAX_MESSAGE_CHARS).default(''),
  stream: z.boolean().optional(),
  confirmTokenSpend: z.boolean().optional(),
  analysisPreviewVersion: z.literal('1').optional(),
  requestId: z.string().trim().min(8).max(120).optional(),
  tokenQuote: z.string().max(2048).optional(),
  analysisUnlock: z.boolean().optional(),
  conversation: z.array(ConversationTurnSchema).max(MAX_CONVERSATION_TURNS).optional(),
  image: ChimmyImageSchema.optional(),
  userContext: z.object({
    portfolioState: z.unknown().optional(),
    userId: z.string().trim().min(1).optional(),
    tier: z.enum(['free', 'pro']).optional(),
    sport: z.string().trim().min(1).max(32).optional(),
    sportScope: z.enum(['all']).optional(),
    leagueName: z.string().trim().min(1).max(120).optional(),
    leagueId: z.string().trim().min(1).max(120).optional(),
    tournament: z.object({
      id: z.string().trim().min(1).max(200),
      topic: z.enum(seasonAssistantTopics),
      leagueId: z.string().trim().min(1).max(200).optional(),
    }).optional(),
    sleeperUsername: z.string().trim().min(1).max(80).optional(),
    insightType: z.enum(['matchup', 'playoff', 'dynasty', 'trade', 'waiver', 'draft']).optional(),
    teamId: z.string().trim().min(1).max(120).optional(),
    season: z.number().int().min(1900).max(3000).optional(),
    week: z.number().int().min(1).max(100).optional(),
    conversationId: z.string().trim().min(1).max(120).optional(),
    sessionId: z.string().trim().min(1).max(120).optional(),
    privateMode: z.boolean().optional(),
    targetUsername: z.string().trim().min(1).max(80).optional(),
    assistantMode: z.string().trim().min(1).max(32).optional(),
    strategyMode: z.string().trim().min(1).max(48).optional(),
    source: z.string().trim().min(1).max(64).optional(),
    leagueFormat: z.string().trim().min(1).max(48).optional(),
    scoring: z.string().trim().min(1).max(48).optional(),
    memory: z.object({
      tone: z.string().trim().min(1).max(48).optional(),
      detailLevel: z.string().trim().min(1).max(32).optional(),
      riskMode: z.string().trim().min(1).max(32).optional(),
    }).optional(),
  }).default({}),
}).superRefine((value, ctx) => {
  if (!value.message.trim() && !value.image && !value.userContext.tournament) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['message'],
      message: 'Message is required when no image is provided.',
    })
  }
})

function shouldTreatAsJson(req: Request): boolean {
  return req.headers.get('content-type')?.toLowerCase().includes('application/json') === true
}

function buildCompatibilityPayload(body: unknown, status: number) {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const analysisPreview = readDeepAnalysisPreview(record.analysisPreview)
  if (analysisPreview) return {
    code: 'token_confirmation_required', response: analysisPreview.summary, result: analysisPreview.summary,
    analysisPreview, meta: { free: true, mode: 'fast_take', analysisPreview }, upgradeRequired: false,
  }
  const upgradeRequired = isChimmyPremiumGateResponse({
    status,
    code: record.code,
    upgradeRequired: record.upgradeRequired,
  })
  const responseText =
    typeof record.response === 'string'
      ? record.response
      : typeof record.result === 'string'
        ? record.result
        : null
  const normalizedResponse =
    responseText ??
    (upgradeRequired
      ? CHIMMY_PREMIUM_FEATURE_MESSAGE
      : status >= 500
        ? CHIMMY_GENERIC_ERROR_MESSAGE
        : null)
  const upgradePath = upgradeRequired
    ? resolveChimmyUpgradePath(record.upgradePath)
    : typeof record.upgradePath === 'string'
      ? record.upgradePath
      : undefined

  return {
    ...record,
    response: normalizedResponse,
    result: normalizedResponse,
    message:
      typeof record.message === 'string'
        ? record.message
        : normalizedResponse ?? undefined,
    upgradeRequired,
    upgradePath,
  }
}

function requiresLeagueGrounding(args: {
  message: string
  source?: string
  teamId?: string
  leagueId?: string
  insightType?: string
}): boolean {
  const message = args.message.toLowerCase()
  const source = String(args.source ?? '').toLowerCase()

  if (args.teamId) return true
  if (args.insightType === 'trade' || args.insightType === 'waiver' || args.insightType === 'dynasty') {
    return true
  }
  if (source.includes('trade') || source.includes('waiver') || source.includes('lineup')) {
    return true
  }
  if (/\b(trade|waiver|lineup|start|sit|bench|my team|my roster|future|next season|for my team)\b/.test(message)) {
    return true
  }

  return false
}

async function toCompatibilityResponse(response: Response): Promise<NextResponse> {
  const delegatedBody = await response.json().catch(() => null)
  const headers = new Headers()
  const retryAfter = response.headers.get('Retry-After')
  if (retryAfter) {
    headers.set('Retry-After', retryAfter)
  }

  return NextResponse.json(buildCompatibilityPayload(delegatedBody, response.status), {
    status: response.status,
    headers,
  })
}

function encodeSseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function appendImageToFormData(formData: FormData, image?: z.infer<typeof ChimmyImageSchema>) {
  if (!image) return

  const match = image.dataUrl.match(/^data:([^;,]+);base64,(.+)$/)
  if (!match) {
    throw new Error('Image payload must be a valid base64 data URL.')
  }

  const [, mimeType, base64Payload] = match
  const bytes = Buffer.from(base64Payload, 'base64')
  const fileType = image.type || mimeType
  const fileName = image.name?.trim() || `chimmy-upload.${mimeType.split('/')[1] || 'bin'}`
  const blob = new Blob([bytes], { type: fileType })
  formData.append('image', blob, fileName)
}

function buildForwardedRequest(
  req: NextRequest,
  payload: z.infer<typeof ChimmyJsonRequestSchema>,
  commissionerGrounding?: string | null,
) {
  const formData = new FormData()
  formData.append('message', payload.message)
  for (const key of ['analysisPreviewVersion', 'requestId', 'tokenQuote', 'analysisUnlock'] as const) {
    if (payload[key] != null) formData.append(key, String(payload[key]))
  }

  if (typeof payload.confirmTokenSpend === 'boolean') {
    formData.append('confirmTokenSpend', String(payload.confirmTokenSpend))
  }
  if (payload.conversation && payload.conversation.length > 0) {
    formData.append('messages', JSON.stringify(payload.conversation))
  }

  if (payload.userContext.portfolioState) formData.append('portfolioState', JSON.stringify(payload.userContext.portfolioState))
  if (payload.userContext.sport) {
    formData.append('sport', payload.userContext.sport)
  }
  if (payload.userContext.sportScope === 'all') {
    formData.append('sportScope', 'all')
  }
  if (payload.userContext.leagueName) {
    formData.append('leagueName', payload.userContext.leagueName)
  }
  if (payload.userContext.leagueId) {
    formData.append('leagueId', payload.userContext.leagueId)
  }
  if (commissionerGrounding) {
    // G15.10 — privacy-safe commissioner-intelligence grounding (additive; ignored if unused).
    formData.append('commissionerGrounding', commissionerGrounding)
  }
  if (payload.userContext.sleeperUsername) {
    formData.append('sleeperUsername', payload.userContext.sleeperUsername)
  }
  if (payload.userContext.insightType) {
    formData.append('insightType', payload.userContext.insightType)
  }
  if (payload.userContext.teamId) {
    formData.append('teamId', payload.userContext.teamId)
  }
  if (typeof payload.userContext.season === 'number') {
    formData.append('season', String(payload.userContext.season))
  }
  if (typeof payload.userContext.week === 'number') {
    formData.append('week', String(payload.userContext.week))
  }
  if (payload.userContext.conversationId) {
    formData.append('conversationId', payload.userContext.conversationId)
  }
  if (payload.userContext.sessionId) {
    formData.append('sessionId', payload.userContext.sessionId)
  }
  if (payload.userContext.privateMode) {
    formData.append('privateMode', 'true')
  }
  if (payload.userContext.targetUsername) {
    formData.append('targetUsername', payload.userContext.targetUsername)
  }
  if (payload.userContext.assistantMode) {
    formData.append('assistantMode', payload.userContext.assistantMode)
    formData.append('mode', payload.userContext.assistantMode)
  }
  if (payload.userContext.strategyMode) {
    formData.append('strategyMode', payload.userContext.strategyMode)
  }
  if (payload.userContext.source) {
    formData.append('source', payload.userContext.source)
  } else {
    formData.append('source', 'api_chimmy_json')
  }
  if (payload.userContext.leagueFormat) {
    formData.append('leagueFormat', payload.userContext.leagueFormat)
  }
  if (payload.userContext.scoring) {
    formData.append('scoring', payload.userContext.scoring)
  }
  if (payload.userContext.memory?.tone) {
    formData.append('tone', payload.userContext.memory.tone)
  }
  if (payload.userContext.memory?.detailLevel) {
    formData.append('detailLevel', payload.userContext.memory.detailLevel)
  }
  if (payload.userContext.memory?.riskMode) {
    formData.append('riskMode', payload.userContext.memory.riskMode)
    if (!payload.userContext.strategyMode) {
      formData.append('strategyMode', payload.userContext.memory.riskMode)
    }
  }
  appendImageToFormData(formData, payload.image)

  const headers = new Headers(req.headers)
  headers.delete('content-type')
  headers.delete('content-length')

  return new Request(req.url, {
    method: 'POST',
    headers,
    body: formData,
  })
}

async function paidToolPost(req: NextRequest) {
  if (!shouldTreatAsJson(req)) {
    return postChatChimmy(req)
  }

  const rawText = await req.text().catch(() => '')
  let rawBody: unknown = null
  if (rawText.trim().length > 0) {
    try {
      rawBody = JSON.parse(rawText)
    } catch {
      return NextResponse.json(
        {
          error: 'Invalid request format.',
          details: {
            formErrors: ['Request body must be valid JSON.'],
            fieldErrors: {},
          },
        },
        { status: 400 }
      )
    }
  }
  const parseResult = ChimmyJsonRequestSchema.safeParse(rawBody)

  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: 'Invalid request format.',
        details: parseResult.error.flatten(),
      },
      { status: 400 }
    )
  }

  // Versioned clients share the canonical preview, authorization and durable receipt path.
  if (parseResult.data.analysisPreviewVersion === '1') {
    return toCompatibilityResponse(await postChatChimmy(buildForwardedRequest(req, parseResult.data) as any))
  }

  const tournament = parseResult.data.userContext.tournament
  if (tournament) {
    const headers = { 'Cache-Control': 'private, no-store' }
    const session = await getServerSession(authOptions)
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers })
    const limitRes = await runAiProtection(req, { action: 'chimmy', getUserId: async () => userId })
    if (limitRes) return toCompatibilityResponse(limitRes)


    const context = await loadSeasonAssistantContext(tournament.id, userId, tournament.leagueId)
    if (!context) return NextResponse.json({ error: 'Tournament context not found.' }, { status: 404, headers })

    const response = answerSeasonAssistant(context, tournament.topic)
    const body = buildCompatibilityPayload({
      response,
      source: 'published_tournament',
      publication: context.publication,
      draftManifestHash: context.draft.room?.manifestHash ?? null,
      report: tournament.topic === 'standings' ? context.standings : null,
      draftHref: tournament.topic === 'draft' ? context.draft.assignment?.href ?? null : null,
    }, 200)
    if (!parseResult.data.stream) return NextResponse.json(body, { headers })
    return new Response(
      encodeSseEvent('chunk', { delta: response, response }) + encodeSseEvent('done', body),
      { headers: { ...SSE_HEADERS, ...headers } },
    )
  }

  const leagueGroundingRequired = requiresLeagueGrounding({
    message: parseResult.data.message,
    source: parseResult.data.userContext.source,
    teamId: parseResult.data.userContext.teamId,
    leagueId: parseResult.data.userContext.leagueId,
    insightType: parseResult.data.userContext.insightType,
  })

  if (leagueGroundingRequired && !parseResult.data.userContext.leagueId) {
    return NextResponse.json(
      buildCompatibilityPayload(
        {
          error:
            'League context is required for trade, waiver, and team-specific planning requests. Open Chimmy from a league context or include leagueId.',
        },
        412
      ),
      { status: 412 }
    )
  }

  /*
   * 🛑 EVERY PANEL GETS `/api/chat/chimmy`, WHATEVER `feature_chimmy_anthropic` SAYS (2026-11-28).
   *
   * This route used to run `runAgentPipeline` directly when `isAnthropicChimmyEnabled()` was true.
   * That path had no Decision OS grounding packet, no tool loop and no `decisionAnswerCheck`, so a
   * caller reaching it answered with less than the CommsDrawer did — and which one a user got turned
   * on a platformConfig row nobody here can see. The flag is no longer read on this route.
   *
   * Money: this route charges NOTHING on this path. The daily allowance, the token gate, the AI
   * protection limiter and the refunds all live in `postChatChimmy`, so a request is counted exactly
   * once — there — and none skips it. Do not add a gate here without removing it there.
   */
  // G15.10 — best-effort commissioner grounding (gated inside; returns null if not applicable).
  const commissionerGrounding = await resolveChimmyCommissionerGrounding({
    leagueId: parseResult.data.userContext.leagueId,
    question: parseResult.data.message,
  })
  const delegatedResponse = await postChatChimmy(buildForwardedRequest(req, parseResult.data, commissionerGrounding) as any)
  return toCompatibilityResponse(delegatedResponse)
}

export const dynamic = 'force-dynamic'

export const POST = withPaidToolBilling(paidToolPost)
