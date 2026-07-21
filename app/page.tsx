import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { PageJsonLd } from '@/components/seo/JsonLd'
import { LandingInviteCapture } from '@/components/landing/LandingInviteCapture'
import { getHomeInitialSession } from '@/lib/landing/get-home-initial-session'

/**
 * Landing page (V3 "Fantasy Operating System" design). Replaces the Nocturne
 * landing, which stays on disk at `components/landing/nocturne/` for a one-line
 * rollback (swap the import below back to `nocturne/LandingNocturne`).
 *
 * Client-only: SSR-bundling this module on Windows Next 14.2 reliably hits
 * webpack-runtime `reading 'call'` at `next/image` and can corrupt `.next-dev-local`
 * manifests (`React Client Manifest` / `entryCSSFiles` / empty JSON).
 */
const LandingPageClient = dynamic(() => import('@/components/landing/v3/LandingV3'), {
  ssr: false,
  loading: () => (
    <div
      className="flex min-h-[40vh] items-center justify-center text-sm"
      style={{ background: '#0d0917', color: '#8f87a8' }}
    >
      Loading…
    </div>
  ),
})
import {
  buildSeoMeta,
  getSoftwareApplicationSchema,
  getWebPageSchema,
} from '@/lib/seo'

export const metadata: Metadata = buildSeoMeta({
  title: 'AllFantasy.ai — Run Your League. Win Your League. | NFL, NBA, NHL, MLB & More',
  description:
    'AllFantasy.ai is the commissioner-first fantasy sports platform for serious managers. Build your league, draft live, manage trades and waivers, and chase the championship across NFL, NBA, NHL, MLB, NCAA, and Soccer.',
  canonicalPath: '/',
  openGraphTitle: 'AllFantasy.ai — Run Your League. Win Your League.',
  openGraphDescription:
    'The commissioner-first fantasy sports platform for serious managers. Live drafts, trades, waivers, standings, and championships — across every sport you play.',
  twitterTitle: 'AllFantasy.ai — Run Your League. Win Your League.',
  twitterDescription: 'The commissioner-first fantasy sports platform for serious managers.',
  imagePath: '/af-crest.png',
  keywords: [
    'fantasy sports',
    'fantasy football',
    'fantasy basketball',
    'trade analyzer',
    'waiver wire',
    'draft assistant',
    'dynasty fantasy',
    'devy fantasy',
    'fantasy league commissioner',
    'AllFantasy',
  ],
})

const HOME_WEBPAGE_SCHEMA = getWebPageSchema({
  name: 'AllFantasy.ai',
  description:
    'Commissioner-first fantasy sports platform for NFL, NBA, NHL, MLB, NCAA, and Soccer with league management, live drafts, trades, and waiver tools.',
  url: '/',
})

const HOME_SOFTWARE_APP_SCHEMA = getSoftwareApplicationSchema({
  name: 'AllFantasy.ai',
  description:
    'Commissioner-first fantasy sports platform for serious managers with league management, live drafts, trade tools, and waiver wire tracking.',
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
