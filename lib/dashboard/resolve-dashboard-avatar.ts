/**
 * Avatar URL for the account chrome: a full URL passed through, or a bare Sleeper hash
 * expanded to the CDN. Older rows store the hash, newer ones a full sleepercdn URL.
 *
 * 🛑 THIS IS PLATFORM IDENTITY ONLY — the "you" avatar in the top nav and profile strip.
 * It is NOT the image for a manager on a league surface. Those come from
 * `LeagueTeam.avatarUrl`, the image imported from Sleeper/ESPN for that league, and the two
 * must not be conflated: changing your AllFantasy picture changes the account chrome
 * everywhere, and changes nothing on a league page. `lib/core-app/career.ts` states the same
 * split from the other side.
 *
 * ⚠ IT USED TO TAKE `sessionImage` FIRST, AND THAT ARGUMENT WAS A STALENESS BUG.
 * `lib/auth.ts` sets `token.picture` once, at sign-in, so `session.user.image` is frozen
 * into the JWT and never reflects a later avatar change. `/core` already passed `null` for
 * it; `/league/[leagueId]` passed the real value, so after changing your picture the league
 * page showed the OLD one while /core showed the new one — same account, two answers, in
 * one app. The parameter is removed rather than documented, so the stale value can no
 * longer be handed in by a future caller.
 */
export function resolveDashboardAvatarUrl(
  dbAvatarUrl: string | null | undefined,
): string | undefined {
  const raw = dbAvatarUrl?.trim() ?? ''
  if (!raw) return undefined
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  return `https://sleepercdn.com/avatars/${raw}`
}
