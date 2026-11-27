import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getLeagueRole } from '@/lib/league/permissions'
import { checkLeagueStoryAiGate } from '@/lib/league-story-ai/leagueStoryAiGate'
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
 * Gated exactly like `/story/create` (owner, 2026-11-27): the Studio itself needs AF Commissioner, and
 * the AI pass runs only when the league's COMMISSIONER (`League.userId`) holds AF Commissioner or AF
 * Supreme, at most LEAGUE_STORY_AI_DAILY_LIMITS.league_story times a league a day
 * (lib/league-story-ai/leagueStoryAiGate.ts). It replaced a token-billed `storyline_creation` check. A
 * locked or capped league gets the free template back with the reason, and no model is called. The
 * request is validated BEFORE the gate, so a bad request costs no cap.
 *
 * ⚠ THE FACT GUARD DECIDES, NOT THE MODEL. The hook is re-built on the server from its id, and the
 * rewrite must carry only its facts' numbers and names and clear the invented-claim, personal-attack
 * and profanity checks (`validateHookRewrite`). Anything else is discarded and the template returned.
 */

const TONES: HookTone[] = ['announcer', 'trash_talk', 'neutral']

export async function POST(req: Request, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string; email?: string | null } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  const role = await getLeagueRole(leagueId, userId)
  if (role === null) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(await canCommissionerAct(leagueId, userId, 'chat'))) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  if (!(await storylineEntitled(userId))) return NextResponse.json({ error: 'not_entitled' }, { status: 402 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const tone = TONES.includes(body.tone as HookTone) ? (body.tone as HookTone) : null
  const hookId = typeof body.hookId === 'string' ? body.hookId : ''
  const lang = body.lang === 'es' ? 'es' : 'en'
  if (!tone || !hookId) return NextResponse.json({ error: 'hookId and tone (announcer | trash_talk | neutral) required' }, { status: 400 })

  const view = await readStudioView(leagueId, userId, lang)
  const hook = view ? [...view.hooks.byMatchup.flatMap((m) => m.hooks), ...view.hooks.league].find((h) => h.id === hookId) : null
  if (!hook) return NextResponse.json({ error: 'hook_not_found' }, { status: 404 })

  const aiGate = await checkLeagueStoryAiGate({ leagueId, kind: 'league_story', lang })
  if (!aiGate.ok) {
    return NextResponse.json({
      text: hook.text,
      source: 'template',
      tone,
      factGuardErrors: [],
      message: aiGate.body.message,
      aiLocked: aiGate.body,
    })
  }

  const facts = hook.facts.map((f) => ({ key: f.key, value: f.value }))
  const rewritten = await rewriteHookInTone({ text: hook.text, facts, tone, language: lang }).catch(() => null)
  const check = rewritten ? validateHookRewrite(rewritten, facts, { hasProfanity }) : null
  if (!rewritten || !check?.passed) {
    return NextResponse.json({
      text: hook.text,
      source: 'template',
      tone,
      factGuardErrors: check?.errors ?? ['Chimmy did not return a rewrite.'],
    })
  }
  return NextResponse.json({
    text: rewritten,
    source: 'ai',
    tone,
    factGuardErrors: [],
  })
}
