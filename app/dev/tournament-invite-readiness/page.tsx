/** Development-only synthetic entry and commissioner surfaces for browser-size audits. */
import { notFound } from 'next/navigation'
import { SeasonTournamentEntry } from '@/components/tournament/SeasonTournamentEntry'
import { SeasonNativeSetup } from '@/components/tournament/SeasonNativeSetup'
import { nba2026PilotProposal } from '@/artifacts/tournament-nba-2026-pilot-proposal'
import type { SeasonEntryView } from '@/lib/tournament/seasonRegistration'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Tournament invite preview (dev)', robots: { index: false, follow: false } }

export default async function TournamentInvitePreview({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (process.env.NODE_ENV !== 'development') notFound()
  const { view } = await searchParams
  const config = nba2026PilotProposal()
  const assigned = view === 'assigned'
  const entry = {
    tournamentId: 'synthetic-tournament', name: config.name, sport: 'NBA', publicationId: 'synthetic-publication', hash: 'synthetic-rule-version', config,
    scheduleExceptions: { pendingGames: 30, excludedGames: [{ gameId: 'synthetic-excluded-game', startsAt: '2026-12-30T23:00:00Z' }] },
    registered: assigned ? 64 : 63, capacity: 64, status: assigned ? 'registered' : 'not_joined', participantId: assigned ? 'synthetic-member' : null,
    waitlistPosition: null, canJoin: !assigned, canWithdraw: false, fieldFrozen: assigned, closesAt: '2026-10-19T16:00:00Z',
    ...(assigned ? { assignment: { key: 'stage-1-league-1', name: 'Opening League with a Very Long Name for Phone Width', division: 'Gold', art: { sideId: 'gold', emblemId: 'basketball' }, teams: 8, draftSlot: 3, startsAt: '2026-10-19T22:00:00Z', draftId: 'synthetic-draft' } } : {}),
  } as SeasonEntryView
  return <div className="min-h-screen bg-slate-950 text-white">
    <p className="mx-auto max-w-3xl px-4 pt-4 text-sm font-semibold text-amber-200" role="note">Synthetic browser preview — no tournament, invite, or draft is created.</p>
    {view === 'commissioner' ? <main className="mx-auto max-w-3xl px-4 py-6"><SeasonNativeSetup tournamentId="synthetic-tournament" /></main> : <SeasonTournamentEntry entry={entry} token={'a'.repeat(64)} />}
  </div>
}
