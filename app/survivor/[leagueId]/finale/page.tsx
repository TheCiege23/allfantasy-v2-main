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
        className="sv-btn mb-4 min-w-[44px] !px-0"
      >
        ‹
      </Link>
      {leagueId ? <JuryFinale leagueId={leagueId} /> : null}
      <div className="mt-8 flex justify-center">
        <Link href={`/survivor/${leagueId}/chat`} className="sv-link inline-flex min-h-[44px] items-center text-[13px]">
          Open league chat
        </Link>
      </div>
    </div>
  )
}
