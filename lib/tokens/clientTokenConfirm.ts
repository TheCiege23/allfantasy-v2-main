/**
 * Ask before spending tokens — the client half of `requireFeatureEntitlement`'s token fallback.
 *
 * The server never charges a token without `confirmTokenSpend: true`. Without it, a user who has no
 * plan but can pay gets `409 { code: 'token_confirmation_required', preview }`. This helper is the
 * one place a screen turns that 409 into a question: it posts once WITHOUT confirming, and only if
 * the server asks — and the person says yes, having been told the cost — posts again with
 * `confirmTokenSpend: true`. A plan holder is never asked, because the server never returns the 409.
 *
 * 🛑 WHY IT EXISTS (2026-09-29): the storyline routes hardcoded `confirmTokenSpend: true`, so one
 * click spent tokens with no question asked, and the Survivor AI panel never sent it at all, so the
 * 409 surfaced as an error and a paying user could never get an answer. Both now go through here.
 *
 * PURE apart from `fetch` and the confirm prompt, both injectable. Never throws for an HTTP status;
 * network errors propagate as `fetch` raises them.
 */

export type TokenConfirmationPreview = {
  tokenCost?: number
  currentBalance?: number
  featureLabel?: string
}

export type TokenConfirmationBody = {
  code?: string
  message?: string
  preview?: TokenConfirmationPreview
}

export function isTokenConfirmationRequired(status: number, body: unknown): body is TokenConfirmationBody {
  return (
    status === 409 &&
    typeof body === 'object' &&
    body !== null &&
    (body as { code?: unknown }).code === 'token_confirmation_required'
  )
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** "This uses 30 tokens (you have 120). Continue?" — the cost is always named before any spend. */
export function tokenConfirmationMessage(body: TokenConfirmationBody): string {
  const p = body.preview ?? {}
  const what = p.featureLabel ? `${p.featureLabel} uses` : 'This uses'
  const cost = finite(p.tokenCost) ? `${p.tokenCost} token${p.tokenCost === 1 ? '' : 's'}` : 'tokens'
  const balance = finite(p.currentBalance) ? ` (you have ${p.currentBalance})` : ''
  return `${what} ${cost}${balance}. Continue?`
}

function defaultConfirm(message: string): boolean {
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false
  return window.confirm(message)
}

export type TokenConfirmedPost = {
  /** The last response: the confirmed call's, or the 409 when the person declined. */
  response: Response
  /** True when the server asked and the person said no — nothing was spent. */
  declined: boolean
}

export async function postWithTokenConfirm(
  url: string,
  payload: Record<string, unknown>,
  opts: {
    confirm?: (message: string) => boolean | Promise<boolean>
    fetchImpl?: typeof fetch
  } = {},
): Promise<TokenConfirmedPost> {
  const doFetch = opts.fetchImpl ?? fetch
  const post = (body: Record<string, unknown>) =>
    doFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  const first = await post({ ...payload, confirmTokenSpend: false })
  if (first.status !== 409) return { response: first, declined: false }

  const body = await first.clone().json().catch(() => null)
  if (!isTokenConfirmationRequired(first.status, body)) return { response: first, declined: false }

  const yes = await (opts.confirm ?? defaultConfirm)(tokenConfirmationMessage(body))
  if (!yes) return { response: first, declined: true }
  return { response: await post({ ...payload, confirmTokenSpend: true }), declined: false }
}

/** The message a failed response carries, in the order the gate and the routes write them. */
export async function responseErrorMessage(response: Response, fallback: string): Promise<string> {
  const data = (await response.clone().json().catch(() => ({}))) as { message?: unknown; error?: unknown }
  if (typeof data.message === 'string' && data.message.trim()) return data.message
  if (typeof data.error === 'string' && data.error.trim()) return data.error
  return fallback
}
