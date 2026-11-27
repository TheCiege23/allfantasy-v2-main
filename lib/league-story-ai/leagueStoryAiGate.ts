/**
 * One gate for Chimmy's league WRITE-UPS: the Hall of Fame "why this matters", the league story, and the
 * rivalry explainer.
 *
 * 🛑 OWNER'S DECISION (2026-11-27), AFTER THE GATING AUDIT: these routes had no plan check and no daily cap,
 * so every click was a model call paid for by nobody. Now:
 *
 *   WHO.   The league's COMMISSIONER (`League.userId`) holding AF Commissioner, or AF Supreme (which includes
 *          it through SUPREME_INCLUDED_PLAN_IDS), unlocks the write-ups for the WHOLE league — every member
 *          then sees them. The caller's own plan does not matter. Same shape as `commissioner_automation`
 *          and the keeper card line (lib/keeper/keeperCommissionerPlan.ts). The key is the existing
 *          `storyline_creation` (requiredPlan commissioner), so no new feature key.
 *   HOW MUCH. A per-LEAGUE daily cap, durable on `apiRateLimitRecord` through `consumeDailyLimit` (atomic, so
 *          two replicas cannot both take the last call). Never an in-memory limiter.
 *
 * The plan check fails CLOSED (no plan resolved = no model call). The daily counter fails OPEN, exactly like
 * lib/ai-protection/costGate.ts: a counter outage must not take the feature down.
 *
 * Callers check the gate on the SERVER immediately before the model call — after the request is validated,
 * so a bad request costs no cap. A route that already serves a fact-built version keeps serving it when this
 * refuses; only the model write-up is gated.
 */
import 'server-only'

import { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { consumeDailyLimit } from '@/lib/rate-limit-daily'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import { buildFeatureUpgradePath } from '@/lib/subscription/feature-access'

export const LEAGUE_STORY_AI_FEATURE = 'storyline_creation' as const

export type LeagueStoryAiKind = 'hall_of_fame' | 'league_story' | 'rivalry'

/** Model write-ups per league per UTC day. Tune here and nowhere else. */
export const LEAGUE_STORY_AI_DAILY_LIMITS: Readonly<Record<LeagueStoryAiKind, number>> = {
  hall_of_fame: 5,
  league_story: 10,
  rivalry: 10,
}

const COUNTER_PROVIDER = 'league_story_ai'

type Lang = 'en' | 'es'

const LABELS: Record<LeagueStoryAiKind, Record<Lang, string>> = {
  hall_of_fame: { en: 'Hall of Fame write-ups', es: 'textos del Salón de la Fama' },
  league_story: { en: 'league story write-ups', es: 'relatos de la liga' },
  rivalry: { en: 'rivalry write-ups', es: 'textos de rivalidades' },
}

export type LeagueStoryAiGateOutcome =
  | { ok: true; commissionerUserId: string }
  | { ok: false; reason: 'plan' | 'daily'; status: 403 | 429; body: Record<string, unknown> }

function langOf(raw: unknown): Lang {
  return raw === 'es' ? 'es' : 'en'
}

/** Whether this commissioner's plan unlocks the write-ups. Fails closed. */
export async function commissionerHasLeagueStoryAi(commissionerUserId: string | null | undefined): Promise<boolean> {
  if (!commissionerUserId) return false
  const access = await new FeatureGateService()
    .evaluateUserFeatureAccess(commissionerUserId, LEAGUE_STORY_AI_FEATURE)
    .catch(() => null)
  return access?.allowed === true
}

/** The league's commissioner and whether their plan unlocks the write-ups. Fails closed. */
export async function leagueHasStoryAi(leagueId: string): Promise<{ entitled: boolean; commissionerUserId: string | null }> {
  const league = await prisma.league
    .findUnique({ where: { id: leagueId }, select: { userId: true } })
    .catch(() => null)
  const commissionerUserId = league?.userId ?? null
  return { entitled: await commissionerHasLeagueStoryAi(commissionerUserId), commissionerUserId }
}

function lockedBody(kind: LeagueStoryAiKind, lang: Lang): Record<string, unknown> {
  const label = LABELS[kind][lang]
  const message =
    lang === 'es'
      ? `Los ${label} de Chimmy se desbloquean para toda la liga cuando el comisionado tiene AF Commissioner o AF Supreme.`
      : `Chimmy's ${label} unlock for the whole league when the commissioner has AF Commissioner or AF Supreme.`
  return {
    error: 'Premium feature',
    code: 'feature_not_entitled',
    message,
    featureId: LEAGUE_STORY_AI_FEATURE,
    requiredPlan: 'AF Commissioner',
    upgradePath: buildFeatureUpgradePath(LEAGUE_STORY_AI_FEATURE),
    gatedBy: 'league_commissioner_plan',
  }
}

function cappedBody(kind: LeagueStoryAiKind, lang: Lang, limit: number, retryAfterSec: number): Record<string, unknown> {
  const label = LABELS[kind][lang]
  const message =
    lang === 'es'
      ? `Tu liga ya usó los ${limit} ${label} de Chimmy de hoy. Se reinicia a medianoche UTC.`
      : `Your league has used today's ${limit} Chimmy ${label}. It resets at midnight UTC.`
  return { error: 'Daily limit reached', code: 'daily_limit_reached', message, limit, retryAfterSec }
}

/**
 * Decide whether this league may spend one model write-up of `kind` now. On `ok` one call has been counted
 * against today's cap — call it only when the model call is about to happen.
 */
export async function checkLeagueStoryAiGate(input: {
  leagueId: string
  kind: LeagueStoryAiKind
  lang?: unknown
}): Promise<LeagueStoryAiGateOutcome> {
  const lang = langOf(input.lang)
  const { entitled, commissionerUserId } = await leagueHasStoryAi(input.leagueId)
  if (!entitled || !commissionerUserId) {
    return { ok: false, reason: 'plan', status: 403, body: lockedBody(input.kind, lang) }
  }

  const limit = LEAGUE_STORY_AI_DAILY_LIMITS[input.kind]
  try {
    const daily = await consumeDailyLimit({
      provider: COUNTER_PROVIDER,
      endpoint: `${input.kind}:${input.leagueId}`,
      callsLimit: limit,
    })
    if (!daily.success) {
      return { ok: false, reason: 'daily', status: 429, body: cappedBody(input.kind, lang, limit, daily.retryAfterSec) }
    }
  } catch (error) {
    console.error(`[league-story-ai] daily counter unavailable for ${input.kind}; allowing the call`, error)
  }
  return { ok: true, commissionerUserId }
}

/** The refusal as a response, for a route with no fact-built version to fall back to. */
export function leagueStoryAiRefusal(outcome: Extract<LeagueStoryAiGateOutcome, { ok: false }>): NextResponse {
  const headers: Record<string, string> = {}
  if (outcome.reason === 'daily') {
    headers['Retry-After'] = String(Math.max(1, Number(outcome.body.retryAfterSec) || 1))
  }
  return NextResponse.json(outcome.body, { status: outcome.status, headers })
}
