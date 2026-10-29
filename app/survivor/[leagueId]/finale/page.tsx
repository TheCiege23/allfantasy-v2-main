'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { JuryFinale } from '@/components/survivor/late/JuryFinale'

export default function SurvivorFinalePage() {
  const params = useParams()
  const leagueId = typeof params?.leagueId === 'string' ? params.leagueId : ''

  return (
    <div className="px-3 pb-28 pt-4 md:px-6 md:pb-10">
      <Link
        href={`/survivor/${leagueId}`}
        aria-label="Back to the island"
        className="mb-4 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-white/80"
      >
        ‹
      </Link>
      {leagueId ? <JuryFinale leagueId={leagueId} /> : null}
      <div className="mt-8 flex justify-center">
        <Link href={`/survivor/${leagueId}/chat`} className="inline-flex min-h-[44px] items-center text-[13px] text-amber-200/90">
          Open league chat
        </Link>
      </div>
    </div>
  )
}
