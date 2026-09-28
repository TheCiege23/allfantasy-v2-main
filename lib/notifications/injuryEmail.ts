import 'server-only'

import { renderDigestEmail } from '@/lib/notifications/designedEmail'

/**
 * The injury email. There was not one.
 *
 * Every other channel for an injured starter existed — an in-app row, and a
 * push once the category allowlist was fixed — but nothing ever rendered an
 * email, so the notification most likely to actually be seen on a Sunday
 * morning was the one channel with no template at all.
 *
 * ⚠ IT LISTS EVERY FLAGGED STARTER, NOT JUST THE MOST URGENT ONE. The sweep
 * picks a single `top` alert to title the push, because a phone banner has
 * room for one sentence. An email does not have that constraint, and a manager
 * with three starters ruled out across sixty-one leagues is badly served by an
 * email about one of them: the other two are exactly the ones he will miss.
 *
 * ⚠ NOTHING IS INVENTED HERE. Every line is a sentence the alert engine
 * already produced. There is no projected points delta and no "expected to
 * miss N weeks" — no injury table in this database holds a return date. The
 * one replacement named is a BENCH player (the injury fan-out,
 * chimmy-alerts/injuryFanOut.ts, using the Player Finder's league-scored
 * picker) — never a free agent, which needs that league's whole pool.
 */

export type InjuryEmailAlert = {
  title: string
  message: string
  leagueName?: string | null
  leagueId?: string | null
  /**
   * The injury fan-out's per-league fix links (chimmy-alerts/injuryFanOut.ts): one "Fix your lineup"
   * link per league that has a verified destination. A league without one is named in the message
   * and gets no link — never a homepage dressed up as the lineup screen.
   */
  fixLinks?: Array<{ leagueName: string; href: string }>
}

/** A relative in-app link made absolute for an email client; platform links pass through. */
function absolute(href: string, baseUrl: string | null | undefined): string {
  return href.startsWith('/') ? `${baseUrl ?? ''}${href}` : href
}

/** Minimal escaping — renderDigestEmail is explicit that the caller owns it. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderInjuryEmail(params: {
  alerts: InjuryEmailAlert[]
  baseUrl?: string | null
}): { subject: string; html: string } | null {
  const alerts = params.alerts.filter((a) => a.title?.trim())
  if (alerts.length === 0) return null

  const subject =
    alerts.length === 1
      ? alerts[0].title
      : `${alerts.length} starters need a look before kickoff`

  const rows = alerts
    .map((a) => {
      const where = a.leagueName ? `<span style="color:#8b8fa3"> · ${esc(a.leagueName)}</span>` : ''
      const links = (a.fixLinks ?? [])
        .map((l) => `<br><a href="${esc(absolute(l.href, params.baseUrl))}" style="color:#7dd3fc">Fix your lineup in ${esc(l.leagueName)} →</a>`)
        .join('')
      return `<p style="margin:0 0 12px 0;font-size:15px;line-height:1.5">
  <strong style="color:#ffffff">${esc(a.title)}</strong>${where}<br>
  <span style="color:#c7cad8">${esc(a.message)}</span>${links}
</p>`
    })
    .join('\n')

  const html = renderDigestEmail({
    eyebrow: 'Lineup check',
    title: alerts.length === 1 ? 'A starter needs a look' : `${alerts.length} starters need a look`,
    /*
     * The sub-line says where the claim comes from. A manager who knows this
     * is built from the injury feed and his own lineups can judge it; one who
     * does not will read it as an opinion.
     */
    sub: 'From the injury feed, matched against the lineups you have set.',
    bodyHtml: rows,
    cta: { href: `${params.baseUrl ?? ''}/core`, label: 'Open your lineups' },
    baseUrl: params.baseUrl ?? null,
  })

  return { subject, html }
}
