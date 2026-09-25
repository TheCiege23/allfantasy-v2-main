/**
 * Turns a paywall refusal from the server into something a screen can SHOW: the sentence to say and
 * the button that fixes it. Client-safe (no server imports).
 *
 * WHY (owner's call 2026-09-25, "get ready for October 15"): from launch, the cost gate
 * (lib/ai-protection/costGate.ts) and the entitlement middleware answer a free user with
 *   403 { error: 'Premium feature', code: 'feature_not_entitled', message, requiredPlan, upgradePath }
 * and at the daily cap with
 *   429 { code: 'daily_limit_reached', message, upgradePath: '/pricing' | null }.
 * The Chimmy tool screens printed `error` — the bare words "Premium feature" — with no way forward.
 * The server already says what to do; this reads it the same way everywhere.
 */

export type PlanRefusal = {
  kind: 'plan' | 'daily_limit' | 'sign_in'
  /** A full sentence from the server, or a plain fallback. Never the bare code. */
  message: string
  /** Where the button goes. Null when there is nothing to buy (a plan holder at the daily cap). */
  actionHref: string | null
  actionLabel: string | null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** An internal path only: a server-supplied URL must never send someone off-site. */
function internalPath(v: unknown): string | null {
  const s = str(v)
  return s && s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\') ? s : null
}

export function readPlanRefusal(
  status: number,
  body: unknown,
  opts: { returnTo?: string } = {},
): PlanRefusal | null {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const code = str(b.code)

  if (code === 'feature_not_entitled' || (status === 403 && b.error === 'Premium feature')) {
    const plan = str(b.requiredPlan)
    return {
      kind: 'plan',
      message: str(b.message) ?? `This is part of ${plan ?? 'a paid plan'}.`,
      actionHref: internalPath(b.upgradePath) ?? '/pricing',
      actionLabel: plan ? `See ${plan}` : 'See plans',
    }
  }

  if (code === 'daily_limit_reached') {
    const href = internalPath(b.upgradePath)
    return {
      kind: 'daily_limit',
      message: str(b.message) ?? "You've reached today's limit. It resets at midnight UTC.",
      actionHref: href,
      actionLabel: href ? 'See plans' : null,
    }
  }

  if (code === 'sign_in_required') {
    const back = internalPath(opts.returnTo) ?? '/'
    return {
      kind: 'sign_in',
      message: str(b.message) ?? 'Sign in to use this.',
      actionHref: `/login?callbackUrl=${encodeURIComponent(back)}`,
      actionLabel: 'Sign in',
    }
  }

  return null
}

/** The current page, for a sign-in round trip. Empty on the server. */
export function currentPathForReturn(): string {
  if (typeof window === 'undefined') return '/'
  return `${window.location.pathname}${window.location.search}`
}

/**
 * For code that reports failure by THROWING (hooks): the refusal travels with the error, and its
 * message is the server's sentence, so even a catch that only prints `e.message` reads properly.
 */
export class PlanRefusalError extends Error {
  readonly refusal: PlanRefusal
  constructor(refusal: PlanRefusal) {
    super(refusal.message)
    this.name = 'PlanRefusalError'
    this.refusal = refusal
  }
}

export function refusalOf(error: unknown): PlanRefusal | null {
  return error instanceof PlanRefusalError ? error.refusal : null
}
