import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getLeagueRole } from '@/lib/league/permissions'
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'
import { withPaidToolBilling, paidToolNotDelivered } from '@/lib/tokens/paidToolBilling'
import { refundStorylineSpend } from '@/lib/tokens/storylineSpendRefund'
import { hasProfanity } from '@/lib/chat-core/censorProfanity'
import { rewriteHookInTone, type HookTone } from '@/lib/league-story-creator/OneBrainNarrativeComposer'
import { validateHookRewrite } from '@/lib/league-story-creator/StoryFactGuard'
import { readStudioView, storylineEntitled } from '@/lib/storyline-studio/storylineService'

export const dynamic = 'force-dynamic'

/**
 * POST /api/leagues/[leagueId]/storylines/rewrite — { hookId, tone, lang?, confirmTokenSpend? }
 *
 * The optional AI tone pass over one Storyline Studio hook: announcer, trash talk or neutral. The
 * template text is the free baseline and is what comes back whenever the AI cannot be trusted.
 *
 * Billed and gated exactly like `/story/create`: the Studio itself needs AF Commissioner, and the
 * AI pass needs `storyline_creation` with the same token fallback and confirm-before-spend. The
 * request is validated BEFORE anything is charged, and a rewrite that fails is refunded.
 *
 * ⚠ THE FACT GUARD DECIDES, NOT THE MODEL. The hook is re-built on the server from its id, and the
 * rewrite must carry only its facts' numbers and names and clear the invented-claim, personal-attack
 * and profanity checks (`validateHookRewrite`). Anything else is discarded and the template returned.
 */

const TONES: HookTone[] = ['announcer', 'trash_talk', 'neutral']

async function paidToolPost(req: Request, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string; email?: string | null } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  const role = await getLeagueRole(leagueId, userId)
  if (role === null) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (role !== 'commissioner' && role !== 'co_commissioner') return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  if (!(await storylineEntitled(userId))) return NextResponse.json({ error: 'not_entitled' }, { status: 402 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const tone = TONES.includes(body.tone as HookTone) ? (body.tone as HookTone) : null
  const hookId = typeof body.hookId === 'string' ? body.hookId : ''
  const lang = body.lang === 'es' ? 'es' : 'en'
  if (!tone || !hookId) return NextResponse.json({ error: 'hookId and tone (announcer | trash_talk | neutral) required' }, { status: 400 })

  const view = await readStudioView(leagueId, userId, lang)
  const hook = view ? [...view.hooks.byMatchup.flatMap((m) => m.hooks), ...view.hooks.league].find((h) => h.id === hookId) : null
  if (!hook) return NextResponse.json({ error: 'hook_not_found' }, { status: 404 })

  const gate = await requireFeatureEntitlement({
    userId,
    userEmail: session?.user?.email,
    featureId: 'storyline_creation',
    allowTokenFallback: true,
    confirmTokenSpend: body.confirmTokenSpend === true,
    tokenRuleCode: 'ai_storyline_creation',
    tokenSourceType: 'storyline_studio_rewrite',
    tokenSourceId: `${leagueId}:${hookId}:${Date.now()}`,
    tokenDescription: 'Storyline Studio tone rewrite',
    tokenMetadata: { leagueId, hookId, tone },
  })
  if (!gate.ok) return gate.response
  const spend = gate.tokenSpend

  const facts = hook.facts.map((f) => ({ key: f.key, value: f.value }))
  const rewritten = await rewriteHookInTone({ text: hook.text, facts, tone, language: lang }).catch(() => null)
  const check = rewritten ? validateHookRewrite(rewritten, facts, { hasProfanity }) : null
  if (!rewritten || !check?.passed) {
    if (spend) await refundStorylineSpend({ userId, ledgerId: spend.id, surface: 'storyline_studio_rewrite' })
    paidToolNotDelivered()
    return NextResponse.json({
      text: hook.text,
      source: 'template',
      tone,
      factGuardErrors: check?.errors ?? ['The AI did not return a rewrite.'],
      refunded: Boolean(spend),
    })
  }
  return NextResponse.json({
    text: rewritten,
    source: 'ai',
    tone,
    factGuardErrors: [],
    tokenSpend: spend ? { ledgerId: spend.id, balanceAfter: spend.balanceAfter } : null,
  })
}

export const POST = withPaidToolBilling(paidToolPost)
