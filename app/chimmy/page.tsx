import type { Metadata } from 'next'
import { CHIMMY_TITLE, CHIMMY_DESCRIPTION } from '@/lib/seo-landing/config'
import ChimmyLandingClient from './ChimmyLandingClient'
import EngagementEventTracker from '@/components/engagement/EngagementEventTracker'
import { getPublicSiteOrigin } from '@/lib/site-public-origin'

const BASE = getPublicSiteOrigin()

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

export default function ChimmyPage() {
  return (
    <>
      <EngagementEventTracker
        eventType="chimmy_chat"
        oncePerDayKey="tool_chimmy_chat"
        meta={{ product: "legacy" }}
      />
      <ChimmyLandingClient />
    </>
  )
}
