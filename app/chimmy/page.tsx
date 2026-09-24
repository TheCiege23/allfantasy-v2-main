import type { Metadata } from 'next'
import { CHIMMY_TITLE, CHIMMY_DESCRIPTION } from '@/lib/seo-landing/config'
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

export default async function ChimmyPage() {
  const record = chimmyTrackRecordFor(await readAdviceLearningSnapshot(), null)?.everyone ?? null
  return (
    <>
      <EngagementEventTracker
        eventType="chimmy_chat"
        oncePerDayKey="tool_chimmy_chat"
        meta={{ product: "legacy" }}
      />
      <ChimmyLandingClient trackRecord={record} />
    </>
  )
}
