/**
 * When to show the "turn on phone alerts" sheet after someone signs up or signs in (owner's call,
 * 2026-10-25). Measured that day: of ~45 people getting notifications, only 2–3 had a device that
 * could receive a push, so almost everything reached them by email or not at all.
 *
 * The rules, all here so the sheet stays dumb:
 *   - once per browser session (a new visit, a fresh sign-in, or a sign-in in this tab), never twice
 *     in one visit;
 *   - "Not now" asks again later: at the next visit at least ASK_GAP_MS after the last ask, and at
 *     most MAX_ASKS times in total, after which we stop;
 *   - never on the sign-in, sign-up and onboarding screens, so it cannot interrupt them.
 *
 * Whether the browser can push, or has already answered, is decided by the push hooks, not here.
 * Pure and client-safe.
 */

export const SIGN_IN_PUSH_ASK_KEY = 'af-signin-push-ask'
/** Set for the rest of the browser session once the sheet has shown. */
export const SIGN_IN_PUSH_ASK_SESSION_KEY = 'af-signin-push-ask-session'
export const MAX_ASKS = 3
export const ASK_GAP_MS = 20 * 60 * 60 * 1000

export type SignInPushAskState = { asks: number; lastAskAt: number | null }

const SKIP_PATHS = [
  '/login',
  '/signin',
  '/signup',
  '/logout',
  '/auth',
  '/verify',
  '/forgot-password',
  '/reset-password',
  '/choose-username',
  '/onboarding',
  '/admin',
  '/admin-login',
  '/e2e',
  '/geo-blocked',
  '/vpn-blocked',
]

export function readSignInPushAskState(raw: string | null): SignInPushAskState {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<SignInPushAskState>) : null
    const asks = typeof v?.asks === 'number' && Number.isFinite(v.asks) ? Math.max(0, Math.floor(v.asks)) : 0
    const lastAskAt = typeof v?.lastAskAt === 'number' && Number.isFinite(v.lastAskAt) ? v.lastAskAt : null
    return { asks, lastAskAt }
  } catch {
    return { asks: 0, lastAskAt: null }
  }
}

export function isSkippedPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return SKIP_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export function shouldShowSignInPushAsk(input: {
  state: SignInPushAskState
  askedThisSession: boolean
  pathname: string | null | undefined
  now: number
}): boolean {
  if (input.askedThisSession || isSkippedPath(input.pathname)) return false
  if (input.state.asks >= MAX_ASKS) return false
  const last = input.state.lastAskAt
  return last == null || last > input.now || input.now - last >= ASK_GAP_MS
}

/** The state after the sheet has been shown once. */
export function recordSignInPushAsk(state: SignInPushAskState, now: number): SignInPushAskState {
  return { asks: state.asks + 1, lastAskAt: now }
}
