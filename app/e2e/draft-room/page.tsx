import { Suspense } from 'react'
import E2eDraftRoomHarnessClient from '@/app/e2e/draft-room/E2eDraftRoomHarnessClient'
import { DEFAULT_SPORT, normalizeToSupportedSport } from '@/lib/sport-scope'

export default async function E2eDraftRoomHarnessPage({
  searchParams,
}: {
  searchParams: Promise<{
    draftId?: string
    leagueId?: string | string[]
    sport?: string
    commissioner?: string
    variant?: string
    /** When `1`, skip the harness gate and mount draft room immediately (Playwright / narrow E2E). */
    e2eRoom?: string
  }>
}) {
  const sp = await searchParams
  const rawLeagueId = sp.leagueId
  const leagueId =
    typeof rawLeagueId === 'string' && rawLeagueId.trim().length > 0
      ? rawLeagueId.trim()
      : Array.isArray(rawLeagueId)
        ? String(rawLeagueId.find((x) => typeof x === 'string' && x.trim().length > 0) ?? '').trim() ||
          'e2e-league'
        : 'e2e-league'

  const draftId = sp.draftId?.trim() || leagueId
  const sport = normalizeToSupportedSport(sp.sport) ?? DEFAULT_SPORT

  const variantParam = String(sp.variant ?? '').toUpperCase()
  const isIdp = variantParam === 'IDP' || variantParam === 'DYNASTY_IDP'
  // Auto-detect redraft_snake: NFL non-IDP snake (default in the E2E mock suite).
  const presentationVariant: 'default' | 'redraft_snake' =
    !isIdp && sport === 'NFL' ? 'redraft_snake' : 'default'

  const isCommissioner = String(sp.commissioner ?? '1').toLowerCase() !== '0'
  const harnessStatus = sp.e2eRoom === '1' ? 'open' : undefined

  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#0a0a0f] p-6 text-sm text-white/70">Loading draft harness…</main>
      }
    >
      <E2eDraftRoomHarnessClient
        draftId={draftId}
        leagueId={leagueId}
        leagueName="E2E Draft Room"
        sport={sport}
        isDynasty={false}
        isCommissioner={isCommissioner}
        presentationVariant={presentationVariant}
        harnessStatus={harnessStatus}
      />
    </Suspense>
  )
}
