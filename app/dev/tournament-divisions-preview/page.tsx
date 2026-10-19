/**
 * Dev-only preview of the divisions & conferences screens and the planner.
 *
 * The real screens need a signed-in member and a `TournamentShell` with divisions,
 * conference leagues and participants, and this checkout's env points at
 * production — so they are mounted here on the seeded sample field
 * (`sampleDivisionsField`) through the SAME `buildHubView` the DB loader uses.
 *
 * ⚠ INVENTED DATA, said so on screen. 404s outside development; nothing links here.
 *   /dev/tournament-divisions-preview                  hub (standings → wildcard → bracket → championship)
 *   ?plan=1                                            plan a tournament (format → identity)
 *   ?screen=join&state=open|almost_full|full|closed|in invite page
 *   ?screen=reveal                                     league reveal
 *   ?screen=control                                    seeding and round control (buttons disabled)
 *   ?screen=trophy                                     share card + full bracket (sample champion)
 *   ?preset=black-gold                                 any preset id for the identity
 */
import { notFound } from 'next/navigation'
import { DivisionsHub } from '@/components/tournament/divisions/DivisionsHub'
import { TournamentPlanFlow } from '@/components/tournament/divisions/TournamentPlanFlow'
import { TournamentJoin } from '@/components/tournament/divisions/TournamentJoin'
import { TournamentReveal } from '@/components/tournament/divisions/TournamentReveal'
import { DivisionControl } from '@/components/tournament/divisions/DivisionControl'
import { ChampionShareStudio } from '@/components/tournament/divisions/ChampionShareCard'
import { bracketFromSeeds, computeDivision, defaultFormatSettings, divisionsCalendar, gameKey, type GameScores } from '@/lib/tournament/divisions/engine'
import { buildHubView, type CommittedDivision } from '@/lib/tournament/divisions/hubView'
import { PRESETS, presetIdentity, leagueDisplayName } from '@/lib/tournament/divisions/identity'
import { sampleDivisionsField } from '@/lib/tournament/divisions/sampleData'
import { buildShareCard } from '@/lib/tournament/divisions/shareCard'
import type { JoinState } from '@/lib/tournament/divisions/registration'
import type { ControlView, JoinView, RevealView } from '@/lib/tournament/divisions/lifecycle'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Divisions preview (dev)', robots: { index: false, follow: false } }

/** Round-one finals and part of round two, repeatable, so the bracket has something to show. */
function sampleScores(teams: Parameters<typeof computeDivision>[0]): GameScores {
  const scores: GameScores = {}
  const first = computeDivision(teams, { autoBids: 52, wildcardSpots: 12 }).bracket
  if (!first) return scores
  first[0]!.forEach((_, i) => { scores[gameKey(1, i)] = { a: 120 + ((i * 37) % 45), b: 100 + ((i * 53) % 60) } })
  const second = computeDivision(teams, { autoBids: 52, wildcardSpots: 12 }, scores).bracket!
  second[1]!.forEach((_, i) => { if (i % 2 === 0) scores[gameKey(2, i)] = { a: 70 + ((i * 29) % 50), b: 65 + ((i * 31) % 50) } })
  return scores
}

/** A complete chalk bracket (higher seed always wins) for the trophy preview. */
function chalk(teams: Parameters<typeof computeDivision>[0]): CommittedDivision {
  const seeded = computeDivision(teams, { autoBids: 52, wildcardSpots: 12 }).seeded!
  const scores: GameScores = {}
  for (let r = 1; r <= 6; r++) bracketFromSeeds(seeded, scores)[r - 1]!.forEach((g, i) => { scores[gameKey(r, i)] = g.a!.overallSeed < g.b!.overallSeed ? { a: 121.4 + r, b: 104.2 + i } : { a: 99.1, b: 118.6 } })
  return { seeded, scores, overrides: {}, roundsCommitted: 6 }
}

export default async function DivisionsPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NODE_ENV !== 'development') notFound()
  const params = await searchParams
  if (params.plan) return <TournamentPlanFlow />
  const { teams, identity: sampleIdentity } = sampleDivisionsField()
  const identity = params.preset && PRESETS.some(p => p.id === params.preset) ? presetIdentity(params.preset, 10) : sampleIdentity
  const settings = defaultFormatSettings('NFL')
  const division0 = teams.filter(t => t.divisionIndex === 0)
  const ranked = computeDivision(division0, settings).ranked
  const meTeamId = ranked[57]?.id ?? null
  const tournament = { id: 'preview', name: `${identity.divisions[0].name} vs ${identity.divisions[1].name} 2026`, sport: 'NFL' as const, status: 'live', season: 2026 }
  const view = buildHubView({ tournament, settings, identity, teams, meTeamId, sample: true, scores: [sampleScores(division0), sampleScores(teams.filter(t => t.divisionIndex === 1))] })
  const me = teams.find(t => t.id === meTeamId)!

  if (params.screen === 'join') {
    const state = (['open', 'almost_full', 'full', 'closed', 'in'] as JoinState[]).includes(params.state as JoinState) ? (params.state as JoinState) : 'open'
    const join: JoinView = {
      tournamentId: 'preview', name: tournament.name, phase: state === 'closed' ? 'placed' : 'registering', sport: 'NFL', settings, calendar: divisionsCalendar(settings), identity,
      registration: { closesAt: '2026-09-01T16:00:00.000Z', allowPreference: true, allowGrouping: false, entry: 'Free' },
      capacity: 240, registered: state === 'open' ? 212 : state === 'almost_full' ? 236 : 240, waitlist: 3,
      me: state === 'in' ? { status: 'registered', waitlistPosition: null, preference: null, revealSeen: false } : null,
      myLeague: state === 'in' ? { name: leagueDisplayName(identity.conferences[5]!.name, identity.divisions[0].name), draftAt: '2026-09-03T00:00:00.000Z', leagueId: null, division: 0, conference: 5 } : null,
      commissioner: { name: 'TheCiege26', leaguesRun: 19 }, invitedBy: 'TheCiege26',
    }
    return <TournamentJoin view={join} refName={null} previewState={state} />
  }
  if (params.screen === 'reveal') {
    const reveal: RevealView = {
      tournamentId: 'preview', tournament: tournament.name, identity, settings, division: 0, conference: me.conferenceIndex, conferences: 10,
      league: { name: leagueDisplayName(identity.conferences[me.conferenceIndex]!.name, identity.divisions[0].name), teams: 12, draftAt: '2026-09-04T00:00:00.000Z', leagueId: null },
      mates: teams.filter(t => t.divisionIndex === 0 && t.conferenceIndex === me.conferenceIndex).map(t => ({ id: t.id, name: t.name, isMe: t.id === me.id })).sort((a, b) => Number(b.isMe) - Number(a.isMe)),
      seen: false,
    }
    return <TournamentReveal view={reveal} preview />
  }
  if (params.screen === 'control') {
    const control: NonNullable<ControlView> = {
      view, state: { status: 'placed', registration: { closesAt: null, allowPreference: true, allowGrouping: false, entry: 'Free' }, capacity: 240 },
      seeding: { week: 10, results: 240, provisional: true, correctionsClosed: true, ties: [], committed: false, blockers: [] },
      rounds: { committedRounds: 0, nextRound: 1, nextWeek: 11, nextLabel: 'Round of 64', correctionsClosed: false, championship: null },
      audits: [{ id: 'a1', action: 'divisions_corrections_closed', at: '2026-11-17T16:00:00.000Z', data: { week: 10 } }, { id: 'a2', action: 'divisions_leagues_placed', at: '2026-09-01T16:00:00.000Z', data: {} }],
      counts: { registered: 240, waitlisted: 3, following: 41 }, leagues: [], roundPreview: null,
    }
    return <DivisionControl control={control} preview />
  }
  if (params.screen === 'trophy') {
    const committed: [CommittedDivision, CommittedDivision] = [chalk(division0), chalk(teams.filter(t => t.divisionIndex === 1))]
    const done = buildHubView({ tournament: { ...tournament, status: 'complete' }, settings, identity, teams, sample: true, committed, championshipScore: { a: 141.6, b: 128.9 } })
    const card = buildShareCard(done, done.championship!.winnerId!)!
    return (
      <main className="mx-auto min-h-screen max-w-[1440px] space-y-6 bg-[#07080d] px-4 py-6 text-white sm:px-8">
        <header><h1 className="text-2xl font-bold sm:text-4xl">Share your title</h1><p className="text-slate-300">Trophy page · share card · preview with invented sample data</p></header>
        <ChampionShareStudio card={card} view={done} shareUrl="/tournament-trophy/preview" />
      </main>
    )
  }
  return <DivisionsHub view={view} />
}
