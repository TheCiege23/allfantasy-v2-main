import type { Metadata } from 'next'
import { CHIMMY_TITLE, CHIMMY_DESCRIPTION } from '@/lib/seo-landing/config'
import ProductShellLayout from '@/components/navigation/ProductShellLayout'
import ChimmyLandingClient from './ChimmyLandingClient'
import EngagementEventTracker from '@/components/engagement/EngagementEventTracker'
import { readAdviceLearningSnapshot } from '@/lib/chimmy-outcomes/learningStore'
import { chimmyTrackRecordFor } from '@/lib/chimmy-outcomes/trackRecord'

const BASE = 'https://allfantasy.ai'

export const metadata: Metadata = {
  title: CHIMMY_TITLE,
  description: CHIMMY_DESCRIPTION,
  alternates: { canonical: `${BASE}/chimmy` },
  openGraph: {
    title: CHIMMY_TITLE,
    description: CHIMMY_DESCRIPTION,
    url: `${BASE}/chimmy`,
    siteName: 'AllFantasy',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: CHIMMY_TITLE,
    description: CHIMMY_DESCRIPTION,
  },
  robots: { index: true, follow: true },
}

/*
 * Chimmy's graded record is on this page, from the outcome snapshot the maintenance cron rebuilds at
 * most every six hours — so the page is rebuilt on that cadence too, never per request.
 */
export const revalidate = 21600

/*
 * The global app shell wraps THIS page, not the whole /chimmy folder. It used to be
 * app/chimmy/layout.tsx, which put its header, right rail and floating buttons around /chimmy/chat
 * too — and that page is now the chat drawer's Chimmy tab at full screen, which has none of them.
 * A layout cannot be opted out of by a child route, so the shell moved here.
 */
export default async function ChimmyPage() {
  const record = chimmyTrackRecordFor(await readAdviceLearningSnapshot(), null)?.everyone ?? null
  return (
    <ProductShellLayout>
      <EngagementEventTracker
        eventType="chimmy_chat"
        oncePerDayKey="tool_chimmy_chat"
        meta={{ product: "legacy" }}
      />
      <ChimmyLandingClient trackRecord={record} />
    </ProductShellLayout>
  )
}
