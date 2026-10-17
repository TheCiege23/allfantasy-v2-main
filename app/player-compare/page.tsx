import { Suspense } from 'react'
import { PlayerComparePageClient } from './PlayerComparePageClient'

function first(q: string | string[] | undefined): string | undefined {
  if (Array.isArray(q)) return q[0]
  return q
}

export default async function PlayerComparePage(
  props: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>
  }
) {
  const searchParams = await props.searchParams
  const sp = searchParams ? await searchParams : {}
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#040915] text-white/60">
          Loading…
        </div>
      }
    >
      <PlayerComparePageClient
        initialPlayerA={first(sp.playerA)}
        initialPlayerB={first(sp.playerB)}
        initialSport={first(sp.sport)}
        leagueId={first(sp.leagueId) ?? null}
      />
    </Suspense>
  )
}
