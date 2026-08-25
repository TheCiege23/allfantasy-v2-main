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
 * already produced. There is no projected points delta, no "expected to miss
 * N weeks" — no injury table in this database holds a return date — and no
 * replacement suggestion, because naming a free agent needs that league's
 * whole pool and this is a cron with sixty-one leagues to get through.
 */

export type InjuryEmailAlert = {
  title: string
  message: string
  leagueName?: string | null
  leagueId?: string | null
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
      return `<p style="margin:0 0 12px 0;font-size:15px;line-height:1.5">
  <strong style="color:#ffffff">${esc(a.title)}</strong>${where}<br>
  <span style="color:#c7cad8">${esc(a.message)}</span>
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
