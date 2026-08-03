import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { PageJsonLd } from '@/components/seo/JsonLd'
import { LandingInviteCapture } from '@/components/landing/LandingInviteCapture'
import LandingPageClient from '@/components/landing/nocturne/LandingNocturne'
import { getHomeInitialSession } from '@/lib/landing/get-home-initial-session'
import {
  buildSeoMeta,
  getSoftwareApplicationSchema,
  getWebPageSchema,
} from '@/lib/seo'

export const metadata: Metadata = buildSeoMeta({
  title: 'AllFantasy.ai — Every League You Play. One Screen.',
  description:
    'Connect Sleeper, ESPN, and Yahoo leagues to one read-only fantasy sports command center. See your leagues, matchups, and what needs your attention without changing anything on the source platform.',
  canonicalPath: '/',
  openGraphTitle: 'AllFantasy.ai — Every League You Play. One Screen.',
  openGraphDescription:
    'Connect your fantasy leagues to one read-only command center for managers and commissioners.',
  twitterTitle: 'AllFantasy.ai — Every League You Play. One Screen.',
  twitterDescription:
    'Connect Sleeper, ESPN, and Yahoo leagues to one read-only fantasy sports command center.',
  imagePath: '/af-crest.png',
  keywords: [
    'fantasy sports dashboard',
    'fantasy football league import',
    'Sleeper league dashboard',
    'ESPN fantasy league import',
    'Yahoo fantasy league import',
    'fantasy league commissioner tools',
    'multi league fantasy dashboard',
    'AllFantasy',
  ],
})

const HOME_WEBPAGE_SCHEMA = getWebPageSchema({
  name: 'AllFantasy.ai',
  description:
    'A read-only fantasy sports command center that connects supported external leagues and shows managers and commissioners what needs attention.',
  url: '/',
})

const HOME_SOFTWARE_APP_SCHEMA = getSoftwareApplicationSchema({
  name: 'AllFantasy.ai',
  description:
    'A read-only fantasy sports dashboard for connecting supported external leagues in one place.',
  url: 'https://allfantasy.ai/',
  applicationCategory: 'SportsApplication',
})

export default async function HomePage() {
  const initialSession = await getHomeInitialSession()
  if (initialSession?.user) {
    redirect('/dashboard')
  }

  return (
    <>
      <PageJsonLd schemas={[HOME_WEBPAGE_SCHEMA, HOME_SOFTWARE_APP_SCHEMA]} />
      <Suspense fallback={null}>
        <LandingInviteCapture />
      </Suspense>
      <LandingPageClient initialSession={initialSession} />
    </>
  )
}
