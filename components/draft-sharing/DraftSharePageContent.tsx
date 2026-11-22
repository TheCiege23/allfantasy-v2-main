'use client'

import Link from 'next/link'
import { DraftShareCard } from './DraftShareCard'
import type { DraftShareCardPayload } from '@/lib/draft-sharing/types'

interface DraftSharePageContentProps {
  payload: DraftShareCardPayload
  shareUrl: string
  /** Where "Try AllFantasy" goes: the sharer's referral landing, or /signup (lib/referral/referralShareLink.ts). */
  ctaHref?: string
}

export function DraftSharePageContent({ payload, shareUrl, ctaHref = '/signup' }: DraftSharePageContentProps) {
  return (
    <main className="min-h-screen bg-[#0f0f14] px-4 py-12">
      <div className="mx-auto max-w-xl space-y-6">
        <DraftShareCard payload={payload} captureId="draft-share-page-card" />
        <p className="text-center text-sm text-white/50">
          Draft results from AllFantasy — grades and rankings.
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
