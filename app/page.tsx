import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { PageJsonLd } from '@/components/seo/JsonLd'
import { LandingInviteCapture } from '@/components/landing/LandingInviteCapture'
import { getHomeInitialSession } from '@/lib/landing/get-home-initial-session'

/**
 * Client-only: SSR-bundling this module on Windows Next 14.2 reliably hits
 * webpack-runtime `reading 'call'` at `next/image` and can corrupt `.next-dev-local`
 * manifests (`React Client Manifest` / `entryCSSFiles` / empty JSON).
 */
const LandingPageClient = dynamic(() => import('@/components/landing/LandingPageClient'), {
  ssr: false,
  loading: () => (
    <div
      className="mode-readable flex min-h-[40vh] items-center justify-center text-sm"
      style={{ background: 'var(--bg)', color: 'var(--muted)' }}
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
  title: 'AllFantasy — Fantasy Football, College Football & Fantasy Sports Leagues',
  description:
    'AllFantasy is the fantasy sports platform built for commissioners and managers. Create a league, draft, trade, manage waivers, and score matchups for fantasy football, college football, NBA, NHL, MLB, and soccer — all season long.',
  canonicalPath: '/',
  openGraphTitle: 'AllFantasy — Fantasy Starts Here. Win All Season.',
  openGraphDescription:
    'Create your league, draft your team, and run your season. Fantasy football, college football, NBA, NHL, MLB, and soccer leagues built for commissioners and managers.',
  twitterTitle: 'AllFantasy — Fantasy Starts Here. Win All Season.',
  twitterDescription:
    'The fantasy sports platform for commissioners and managers. Fantasy football, college football, and every major fantasy sport.',
  imagePath: '/af-crest.png',
  keywords: [
    'fantasy football',
    'college fantasy football',
    'NCAAF fantasy football',
    'fantasy commissioner tools',
    'fantasy league management',
    'fantasy football draft',
    'fantasy trades',
    'waiver wire',
    'fantasy sports',
    'create a fantasy league',
    'AllFantasy',
  ],
})

const HOME_WEBPAGE_SCHEMA = getWebPageSchema({
  name: 'AllFantasy',
  description:
    'Fantasy sports platform for commissioners and managers — create leagues, draft, trade, manage waivers, and score matchups across fantasy football, college football, NBA, NHL, MLB, and soccer.',
  url: '/',
})

const HOME_SOFTWARE_APP_SCHEMA = getSoftwareApplicationSchema({
  name: 'AllFantasy',
  description:
    'Fantasy sports platform with league creation, drafting, trading, waivers, scoring, and commissioner tools for fantasy football, college football, and every major fantasy sport.',
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
