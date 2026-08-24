/**
 * Dev-only preview of the twelve handoff drops: 22a–c, 23a–b, 24a–b, 25a–b,
 * 26a–b, 27a.
 *
 * Five of the twelve are real signed-in screens and are LINKED rather than
 * mocked here — a copy of them rendered with synthetic data is a copy that
 * drifts. What this page renders itself is the four things that have no route of
 * their own: the three email templates, the phone lock screen, and the league
 * tile in all five of its lifecycle states.
 *
 * ⚠ PRODUCTION-SAFE: 404s outside development, and nothing links to it. Same
 * guard and same purpose as /dev/states-preview and /dev/d6-preview.
 */

import { notFound } from 'next/navigation'
import { HandoffPreviewClient } from './HandoffPreviewClient'
import { buildTradeGradeEmail } from '@/lib/trade-intel/tradeGradeEmail'
import { buildDraftStartingEmail, buildDraftRecapEmail } from '@/lib/draft-notifications/draftEmails'
import { selectPushNotifications } from '@/lib/core-app/notificationsCenter'
import { PREVIEW_EXPECTATION, PREVIEW_ISSUES, PREVIEW_TRADE, previewNow } from './fixtures'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Handoff preview — 22a to 27a',
  robots: { index: false, follow: false },
}

export default function HandoffPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  const base = 'https://allfantasy.ai'

  /*
   * The emails are rendered SERVER-SIDE by the same functions the cron sends
   * through. Not a re-implementation for the preview — if the template breaks,
   * this page breaks with it, which is the only way a preview is worth having.
   */
  const tradeEmail = buildTradeGradeEmail({
    leagueName: 'Preview Dynasty',
    trade: PREVIEW_TRADE,
    ledgerUrl: `${base}/league/preview-league-0001?view=legacy`,
    expectation: PREVIEW_EXPECTATION,
    baseUrl: base,
    leagueId: 'preview-league-0001',
    unsubscribeUrl: `${base}/api/email/unsubscribe?token=preview`,
  })

  const draftStartingEmail = buildDraftStartingEmail({
    leagueName: 'Preview Redraft',
    leagueId: 'preview-league-0002',
    pickSlot: '1.04',
    minutesUntilStart: 60,
    queueSize: 0,
    rosterHoles: ['TE', 'DEF'],
    availability: [
      { name: 'Sample Runner', position: 'RB', probability: 0.72 },
      { name: 'Sample Catcher', position: 'WR', probability: 0.41 },
      { name: 'Sample Tight', position: 'TE', probability: 0.18 },
    ],
    draftsSampled: 4,
    queueUrl: `${base}/core/draft-hq`,
    baseUrl: base,
    unsubscribeUrl: `${base}/api/email/unsubscribe?token=preview`,
  })

  const draftRecapEmail = buildDraftRecapEmail({
    leagueName: 'Preview Redraft',
    leagueId: 'preview-league-0002',
    overallGrade: 'B',
    summary:
      'You left with two startable running backs and a tight end who is worth more here than anywhere else.',
    leagueNote: '10-team redraft · half PPR · TE premium (+0.5/rec)',
    picks: [
      {
        slot: '1.04',
        playerName: 'Sample Runner',
        position: 'RB',
        marketSlot: '1.06',
        grade: 'B',
        note: 'Two picks earlier than the market, which is a small premium for the position you were thinnest at.',
      },
      {
        slot: '2.07',
        playerName: 'Sample Tight',
        position: 'TE',
        marketSlot: '4.02',
        grade: 'A',
        note: 'A reach on a generic board, correct here — TE premium adds about half a point a catch.',
      },
      {
        slot: '3.04',
        playerName: 'Sample Catcher',
        position: 'WR',
        marketSlot: null,
        grade: 'C',
        note: 'Nothing priced him, so this pick is unscored rather than graded low.',
      },
    ],
    gaps: [
      {
        position: 'DEF',
        fixable: true,
        note: 'Streamable every week. Nothing was lost by leaving it.',
      },
      {
        position: 'QB2',
        fixable: false,
        note: 'The last startable second quarterback went at 8.09, before your ninth-round pick.',
      },
    ],
    boardUrl: `${base}/core/draft-hq`,
    baseUrl: base,
    unsubscribeUrl: `${base}/api/email/unsubscribe?token=preview`,
  })

  /*
   * The lock screen is rendered from the SAME selection function the product
   * uses. The point of the preview is to see the suppression rule work — three
   * through, the rest collapsed — not to see a hand-arranged stack.
   */
  const push = selectPushNotifications(PREVIEW_ISSUES, previewNow())

  return (
    <HandoffPreviewClient
      tradeEmail={tradeEmail}
      draftStartingEmail={draftStartingEmail}
      draftRecapEmail={draftRecapEmail}
      push={push}
    />
  )
}
