/**
 * `/chimmy/chat` — the decisions the full-page Chimmy makes about its URL, its leagues and its way
 * out. Pure, so each one is proven in milliseconds; the page and its client only wire them up.
 *
 * The page itself is the drawer's Chimmy tab (`components/core-app/comms/ChimmyPanel.tsx`) at full
 * screen — owner's call, 2026-09-25.
 */

import { isSupportedSport } from '@/lib/sport-scope'

/**
 * What the page tells `/api/chat/chimmy` it is, in the question row's vocabulary
 * (`lib/chimmy-context/telemetry/questionEntry.ts`: "`messages_ai` is the /chimmy/chat page"). Kept,
 * so this page's questions and thumbs still join under the name they have always had.
 */
export const CHIMMY_PAGE_SOURCE = 'messages_ai'

/** Where "Back" goes when there is no earlier in-app page to return to. */
export const CHIMMY_PAGE_BACK_FALLBACK = '/core'

/** A league as the panel's scope picker needs it — `CommsLeague`'s fields. */
export type ChatPageLeague = {
  id: string
  name: string
  platform: string
  platformLeagueId: string | null
  isCommissioner: boolean
  teamCount: number
}

/**
 * The dashboard league list, shaped for the panel — the same projection /core makes for the drawer
 * (`comms.leagues` in `app/core/[[...screen]]/page.tsx`), so a league reads the same in both.
 *
 * ⚠ `platformLeagueId`, NOT `id`, IS WHAT A SLEEPER HAND-OFF LINK NEEDS. `id` is the AllFantasy
 * uuid and 404s off-site; the panel falls back to an in-app link when this is null.
 *
 * Rows without a usable id or name are dropped rather than rendered as a blank option.
 */
export function toChatPageLeagues(rows: readonly unknown[]): ChatPageLeague[] {
  const out: ChatPageLeague[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id.trim() : ''
    const name = typeof r.name === 'string' ? r.name.trim() : ''
    if (!id || !name) continue
    out.push({
      id,
      name,
      platform: String(r.platform ?? 'manual').toLowerCase(),
      platformLeagueId: typeof r.platformLeagueId === 'string' && r.platformLeagueId ? r.platformLeagueId : null,
      isCommissioner: Boolean(r.isCommissioner),
      teamCount: Number(r.teamCount ?? 0) || 0,
    })
  }
  return out
}

/**
 * The scope the page opens in: `?leagueId=` when it is one of the viewer's own leagues, otherwise
 * "All leagues". A league id in a URL is something anyone can type, so it scopes the chat only when
 * the picker could have scoped to it too — the drawer applies the same test to an open request.
 */
export function initialChatScope(
  leagueId: string | null | undefined,
  leagues: ReadonlyArray<{ id: string }>,
): string | null {
  if (typeof leagueId !== 'string' || !leagueId) return null
  return leagues.some((l) => l.id === leagueId) ? leagueId : null
}

/**
 * `?sport=` as the panel may send it, or null. Only a sport the app supports is kept, uppercased;
 * anything else is dropped rather than guessed at (normalizing an unknown value would quietly turn
 * it into NFL).
 */
export function readChatPageSport(raw: string | null | undefined): string | null {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s || !isSupportedSport(s)) return null
  return s.toUpperCase()
}

/** Pages a "Back" must never return to: the sign-in round trip, and this page itself. */
const NOT_A_PLACE_TO_GO_BACK_TO = /^\/(?:login|signup|signin|auth|verify|choose-username|chimmy\/chat)(?:[/?#]|$)/

/**
 * Whether "Back" should step back through history (true) or follow its link to `/core` (false).
 *
 * Two ways the previous page is known to be ours:
 *
 *   1. The DOCUMENT was loaded at another path — so this page was reached by an in-app, client-side
 *      navigation and the entry behind it is an AllFantasy screen. (`document.referrer` cannot see
 *      this: it describes the document's first load, not the in-app hops since.)
 *   2. The document was loaded here, from a same-origin referrer, with history behind it.
 *
 * Anything else — an email link in a fresh tab, a typed URL, a link from another site — goes to
 * `/core` rather than off-site or to nowhere. So does a way back that only leads into sign-in.
 */
export function shouldGoBackInHistory(args: {
  /** `performance.getEntriesByType('navigation')[0].name` — the URL this document was loaded at. */
  documentUrl: string | null | undefined
  /** `location.pathname` now. */
  currentPath: string
  referrer: string | null | undefined
  origin: string
  historyLength: number
}): boolean {
  if (!(args.historyLength > 1)) return false

  const loadedAt = absoluteUrl(args.documentUrl)
  if (loadedAt && loadedAt.origin === args.origin && loadedAt.pathname !== args.currentPath) {
    return !NOT_A_PLACE_TO_GO_BACK_TO.test(loadedAt.pathname)
  }

  const from = absoluteUrl(args.referrer)
  if (!from || from.origin !== args.origin) return false
  return !NOT_A_PLACE_TO_GO_BACK_TO.test(from.pathname)
}

/**
 * ⚠ ABSOLUTE ONLY. A browser always reports both values absolute; resolving a stray relative string
 * against our own origin would turn garbage into "one of our pages".
 */
function absoluteUrl(url: string | null | undefined): { origin: string; pathname: string } | null {
  if (typeof url !== 'string' || !url) return null
  try {
    const u = new URL(url)
    return { origin: u.origin, pathname: u.pathname }
  } catch {
    return null
  }
}
