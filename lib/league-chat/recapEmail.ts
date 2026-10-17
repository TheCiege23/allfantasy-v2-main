import { renderDigestEmail } from '@/lib/notifications/designedEmail'
import { escapeHtml } from '@/lib/trade-intel/tradeGradeEmail'

/**
 * The Tuesday recap email: ONE per person per week, every league of theirs that got a recap, each
 * with a way to share it. PURE — the notify step sends it through the dispatcher, which applies the
 * person's results-email preference, unsubscribe and undeliverable-address checks.
 *
 * WHY EMAIL. Measured 2026-10-10: push reaches 2 of 42 managers, email 40. The recap's job is to get
 * shared into the league's own group chat (lib/league-chat/recapShare.ts), so the email's button
 * opens the league chat, where "Share with your league" sits under the recap. An email cannot open a
 * phone's share sheet itself.
 *
 * One email, not one per league: someone in five leagues used to be sent five on the same morning by
 * the old per-league path.
 */

export type RecapEmailLeague = { leagueId: string; leagueName: string; week: number; season: string; text: string }

/** The recap's closing line points at a tab; in an email the button below does that job. */
const IN_APP_FOOTER = /\n*Every number here comes from your real matchups\.[^\n]*$/

function chatHref(baseUrl: string, leagueId: string): string {
  return `${baseUrl}/league/${encodeURIComponent(leagueId)}?openChat=league`
}

export function recapEmailSubject(recaps: readonly RecapEmailLeague[]): string {
  const first = recaps[0]!
  if (recaps.length === 1) return `Week ${first.week} recap — ${first.leagueName}`
  return `Week ${first.week} recaps — ${first.leagueName} + ${recaps.length - 1} more`
}

export function renderRecapEmail(recaps: readonly RecapEmailLeague[], baseUrl: string): { subject: string; html: string } | null {
  if (recaps.length === 0) return null
  const first = recaps[0]!
  const sections = recaps.map((r) => {
    const lines = r.text.replace(IN_APP_FOOTER, '').trimEnd().split('\n')
    // The first line is the recap's own title ("📺 Week 5 recap — League (2026)"); the section heading says it.
    const body = lines.slice(lines[0]?.startsWith('📺') ? 1 : 0)
    const bodyHtml = body
      .join('\n')
      .trim()
      .split('\n')
      .map((l) => escapeHtml(l))
      .join('<br/>')
    const share =
      recaps.length > 1
        ? `<div style="margin-top:10px"><a href="${escapeHtml(chatHref(baseUrl, r.leagueId))}" style="color:#22d3ee;font-weight:700;text-decoration:none">Share ${escapeHtml(r.leagueName)}'s recap →</a></div>`
        : ''
    const heading =
      recaps.length > 1
        ? `<div style="font-size:15px;font-weight:800;color:#ffffff;margin-bottom:6px">${escapeHtml(r.leagueName)}</div>`
        : ''
    return `${heading}<div>${bodyHtml}</div>${share}`
  })
  const divider = '<div style="height:1px;background:rgba(255,255,255,0.10);margin:18px 0"></div>'
  const how =
    '<div style="margin-top:16px;color:#9aa4b2">Most of your league talks somewhere else. Open the recap and tap <b>Share with your league</b> to drop it in your group chat — it brings them a link to join the league chat here.</div>'
  const html = renderDigestEmail({
    eyebrow: `Week ${first.week} recap · ${first.season}`,
    title: recaps.length === 1 ? first.leagueName : `${recaps.length} of your leagues`,
    sub: 'Written up by Chimmy from your real matchups.',
    bodyHtml: sections.join(divider) + how,
    cta: { href: chatHref(baseUrl, first.leagueId), label: 'Share it with your league' },
    baseUrl,
  })
  return { subject: recapEmailSubject(recaps), html }
}
