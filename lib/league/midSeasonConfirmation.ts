/**
 * Mid-season scoring / roster change confirmation: the wire contract shared by the settings routes
 * (lib/league/settingsLifecycleGate.ts) and the commissioner UIs that call them. Client-safe — no
 * server imports — so a panel can import the code and flag names without pulling in Prisma.
 *
 * A route answers a mid-season edit that lacks the flag with
 *   409 { code: MID_SEASON_CONFIRMATION_CODE, message, error }
 * and the client re-sends the same request with `{ [MID_SEASON_CONFIRM_FLAG]: true }` merged into
 * its JSON body once the commissioner confirms.
 */

export const MID_SEASON_CONFIRMATION_CODE = 'mid_season_confirmation_required'
export const MID_SEASON_CONFIRM_FLAG = 'confirmMidSeasonChange'
export const MID_SEASON_CONFIRMATION_MESSAGE =
  "This league's season has started. Changing scoring/roster settings will recalculate scores and may make some lineups invalid. Confirm to continue."

export function hasMidSeasonConfirmation(body: unknown): boolean {
  return Boolean(
    body && typeof body === 'object' && (body as Record<string, unknown>)[MID_SEASON_CONFIRM_FLAG] === true,
  )
}

/** The JSON body of `init` with the confirmation flag merged in (an absent body becomes `{flag}`). */
export function withMidSeasonConfirmation(init: RequestInit | undefined): RequestInit {
  let parsed: Record<string, unknown> = {}
  if (typeof init?.body === 'string' && init.body.trim() !== '') {
    try {
      const v = JSON.parse(init.body) as unknown
      if (v && typeof v === 'object' && !Array.isArray(v)) parsed = v as Record<string, unknown>
    } catch {
      /* not JSON: send the flag alone */
    }
  }
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return { ...init, headers, body: JSON.stringify({ ...parsed, [MID_SEASON_CONFIRM_FLAG]: true }) }
}

/** The server's message when `res` is a confirmation-required 409; `null` for any other response. */
export async function midSeasonConfirmationMessage(res: Response): Promise<string | null> {
  if (res.status !== 409) return null
  const data = (await res.clone().json().catch(() => null)) as { code?: unknown; message?: unknown } | null
  if (!data || data.code !== MID_SEASON_CONFIRMATION_CODE) return null
  return typeof data.message === 'string' ? data.message : MID_SEASON_CONFIRMATION_MESSAGE
}

/**
 * `fetch`, but a confirmation-required 409 asks `confirm` and, on yes, re-sends with the flag.
 * On no it returns a 409 whose body is `{ cancelled: true, error: cancelledMessage }`, so a caller's
 * ordinary `if (!res.ok) setError(data.error)` path reports it without special handling.
 */
export async function fetchWithMidSeasonConfirmation(
  input: string,
  init: RequestInit | undefined,
  confirm: (message: string) => Promise<boolean>,
  cancelledMessage = 'Change not saved.',
): Promise<Response> {
  const first = await fetch(input, init)
  const message = await midSeasonConfirmationMessage(first)
  if (message == null) return first
  if (!(await confirm(message))) {
    return new Response(JSON.stringify({ cancelled: true, error: cancelledMessage }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return fetch(input, withMidSeasonConfirmation(init))
}
