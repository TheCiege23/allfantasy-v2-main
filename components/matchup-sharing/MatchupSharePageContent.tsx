'use client'

import Link from 'next/link'
import { MatchupShareCard } from './MatchupShareCard'
import type { MatchupSharePayload } from '@/lib/matchup-sharing/types'

interface MatchupSharePageContentProps {
  payload: MatchupSharePayload
  /** Where "Try AllFantasy" goes: the sharer's referral landing, or /signup (lib/referral/referralShareLink.ts). */
  ctaHref?: string
}

export function MatchupSharePageContent({ payload, ctaHref = '/signup' }: MatchupSharePageContentProps) {
  return (
    <main className="min-h-screen bg-[#0f0f14] px-4 py-12">
      <div className="mx-auto max-w-xl space-y-6">
        <MatchupShareCard payload={payload} captureId="matchup-share-page-card" />
        <p className="text-center text-sm text-white/50">
          Matchup simulation from AllFantasy — projected winner and score.
        </p>
        <div className="flex justify-center">
          <Link
            href={ctaHref}
            className="inline-block rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500"
          >
            Try AllFantasy
          </Link>
        </div>
      </div>
    </main>
  )
}
