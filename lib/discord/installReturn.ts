/**
 * Where the "Add AllFantasy to your server" round trip lands afterwards.
 *
 * The install starts either from Settings (no league) or from a league's
 * `/core/discord` setup screen. The league id rides through Discord in an HttpOnly
 * cookie set by `/api/discord/bot-install` — only after that route has checked the
 * signed-in user commissions the league — and is read back by `/api/discord/bot-callback`.
 *
 * ⚠ THE REDIRECT IS BUILT HERE, NEVER FROM A CALLER-SUPPLIED URL. The only thing that
 * varies is a league id that must match a strict pattern, and it only ever becomes a
 * query parameter on our own `/core/discord` path. No open redirect, whatever sits in
 * the cookie. The page itself re-checks that the viewer commissions that league.
 */

export const BOT_LEAGUE_COOKIE = 'discord_bot_league'

const LEAGUE_ID = /^[A-Za-z0-9_-]{1,64}$/

export function safeLeagueId(raw: string | null | undefined): string | null {
  const v = raw?.trim() ?? ''
  return LEAGUE_ID.test(v) ? v : null
}

/** Path (with query) to send the user to, carrying a `discord=<status>` flag. */
export function installReturnPath(leagueId: string | null, status: string): string {
  const flag = encodeURIComponent(status)
  return leagueId
    ? `/core/discord?league=${encodeURIComponent(leagueId)}&discord=${flag}`
    : `/settings?tab=connected&discord=${flag}`
}
