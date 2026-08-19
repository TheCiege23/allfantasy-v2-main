import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import MockDraftSleeperRoomClient from '@/components/mock-draft/MockDraftSleeperRoomClient'
import { LandingToolVisitTracker } from '@/components/landing/LandingToolVisitTracker'
import EngagementEventTracker from '@/components/engagement/EngagementEventTracker'
import { isMockDraftsEnabled } from '@/lib/feature-toggle'
import { buildMetadata, getSEOPageConfig } from '@/lib/seo'

export const dynamic = 'force-dynamic'

export const metadata = buildMetadata(
  getSEOPageConfig('mock-draft') ?? {
    title: 'Mock Drafts – AllFantasy',
    description: 'Create, run, and share unlimited AllFantasy mock drafts with AI-powered insights.',
    canonical: 'https://allfantasy.ai/mock-draft',
  }
)

type MockDraftPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>
}

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

export default async function MockDraftPage({ searchParams }: MockDraftPageProps) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect('/login?callbackUrl=/mock-draft')
  const enabled = await isMockDraftsEnabled()
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {})
  const initialLeagueId = firstParam(resolvedSearchParams.leagueId).trim()
  const initialSport = firstParam(resolvedSearchParams.sport).trim()

  if (!enabled) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="rounded-xl border p-6 max-w-md text-center" style={{ borderColor: "var(--border)" }}>
          <h1 className="text-lg font-semibold mb-2" style={{ color: "var(--text)" }}>
            Mock drafts are temporarily disabled
          </h1>
          <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
            This tool has been turned off by the platform configuration.
          </p>
          <a href="/dashboard" className="text-sm font-medium" style={{ color: "var(--accent)" }}>
            Back to dashboard
          </a>
        </div>
      </div>
    )
  }

  return (
    <>
      <LandingToolVisitTracker path="/mock-draft" toolName="Draft Helper" />
      <EngagementEventTracker
        eventType="mock_draft"
        oncePerDayKey="tool_mock_draft"
        meta={{ product: "legacy" }}
      />
      <div className="min-h-screen bg-[#05060b] py-10 pb-20">
        <div className="container mx-auto max-w-[1680px] px-4">
          <div className="mb-8 text-center">
            <h1 className="bg-gradient-to-r from-cyan-400 via-purple-500 to-pink-500 bg-clip-text text-3xl font-bold text-transparent sm:text-4xl">
              AllFantasy Mock Drafts
            </h1>
            <p className="mt-2 text-sm text-white/60 sm:text-base">
              Run a full Sleeper-style AI mock room with league import, real manager slots, and shareable results.
            </p>
          </div>
          <MockDraftSleeperRoomClient initialLeagueId={initialLeagueId} initialSport={initialSport} />
        </div>
      </div>
    </>
  )
}
