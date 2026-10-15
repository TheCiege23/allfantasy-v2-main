/**
 * Sharing Chimmy's weekly recap OUT of AllFantasy, into the place the league already talks.
 *
 * WHY THIS EXISTS. Measured on production 2026-10-12: 163 recaps posted to 107 leagues in 45 days drew
 * ZERO human replies, and 87 of those 107 leagues have exactly one AllFantasy member — the person who
 * imported it. Their leaguemates talk in Sleeper, a group text or Discord, so a recap that stays in our
 * chat is read by one person. The recap is good content; it was in the wrong room. This turns it into
 * text that person can paste into the right one, ending with the league's invite link so the people
 * who read it there can join the league's chat here.
 *
 * PURE and client-safe: no prisma, no fetch. The invite link is fetched by the button from the
 * existing `GET /api/leagues/join?leagueId=` (any member may read it).
 */

/** The recap's closing line inside AllFantasy — it points at a tab the reader outside cannot open. */
const IN_APP_FOOTER = /\n*Every number here comes from your real matchups\.[^\n]*$/

/** True for the weekly recap row Chimmy posts (`postWeeklyRecapAsChimmy` merges this card in). */
export function isWeeklyRecap(metadata: Record<string, unknown> | null | undefined): boolean {
  if (!metadata || typeof metadata !== 'object') return false
  if (metadata.weeklyRecap !== true) return false
  const moment = metadata.chimmyMoment
  return Boolean(moment && typeof moment === 'object' && (moment as Record<string, unknown>).kind === 'weekly_awards')
}

/**
 * What gets pasted into the league's group chat: the recap as Chimmy wrote it, minus the in-app footer,
 * then one line that says where it came from and how to join. No link → the recap alone, still worth
 * sharing, with no dangling invitation that goes nowhere.
 *
 * "Join our league chat", not "claim your team": a link newcomer joins an imported league as a MEMBER
 * and lands in its chat (POST /api/leagues/join). Claiming a provider team needs proof of the Sleeper
 * account, which a shared link cannot give, so the line promises only what the link does.
 */
/**
 * The invite link as it leaves in a shared recap, marked `src=recap` so its opens and joins can be
 * counted apart from every other invite (`RECAP_SHARE` in lib/analytics/eventNames.ts). Anything that
 * is not an http(s) URL comes back untouched, and buildRecapShareText then leaves it out.
 */
export function tagRecapInviteLink(link: string | null | undefined): string | null {
  if (typeof link !== 'string' || !/^https?:\/\//i.test(link.trim())) return link ?? null
  try {
    const url = new URL(link.trim())
    url.searchParams.set('src', 'recap')
    return url.toString()
  } catch {
    return link
  }
}

export function buildRecapShareText(recap: string, inviteLink: string | null | undefined): string {
  const body = recap.replace(IN_APP_FOOTER, '').trimEnd()
  const link = typeof inviteLink === 'string' && /^https?:\/\//i.test(inviteLink.trim()) ? inviteLink.trim() : null
  if (!link) return `${body}\n\n— Chimmy, on AllFantasy`
  return `${body}\n\n— Chimmy, on AllFantasy. Join our league chat and get next week's recap: ${link}`
}
