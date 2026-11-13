'use client'

import Link from 'next/link'
import { LeagueStoryCard } from './LeagueStoryCard'
import type { LeagueStoryPayload } from '@/lib/league-story-engine/types'

interface LeagueStoryPageContentProps {
  payload: LeagueStoryPayload
}

export function LeagueStoryPageContent({ payload }: LeagueStoryPageContentProps) {
  return (
    <main data-testid="league-story-page-content" className="min-h-screen bg-[#0f0f14] px-4 py-12">
      <div className="mx-auto max-w-xl space-y-6">
        <div className="flex items-center justify-between">
          <Link
            href="/app"
            data-testid="league-story-page-back-link"
            className="inline-flex items-center rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10"
          >
            Back to app
          </Link>
        </div>
        <LeagueStoryCard payload={payload} captureId="league-story-page-card" dataTestId="league-story-page-card" />
        <p className="text-center text-sm text-white/50">
          League story from AllFantasy — narratives around your league.
        </p>
        <div className="flex justify-center">
          <Link
            href="/app"
            data-testid="league-story-page-cta-link"
            className="inline-block rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500"
          >
            Try AllFantasy
          </Link>
        </div>
      </div>
    </main>
  )
}
