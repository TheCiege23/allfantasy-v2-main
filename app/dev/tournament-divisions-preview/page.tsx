/**
 * Dev-only preview of the divisions & conferences screens and the planner.
 *
 * The real hub needs a signed-in member and a `TournamentShell` with divisions,
 * conference leagues and participants, and this checkout's env points at
 * production — so the screens are mounted here on the seeded sample field
 * (`sampleDivisionsField`) through the SAME `buildHubView` the DB loader uses.
 *
 * ⚠ INVENTED DATA, said so on screen. 404s outside development; nothing links here.
 *   /dev/tournament-divisions-preview            hub (standings → wildcard → bracket → championship)
 *   /dev/tournament-divisions-preview?plan=1     plan a tournament (format → identity)
 *   ?preset=black-gold                           any preset id for the hub's identity
 */
import { notFound } from 'next/navigation'
import { DivisionsHub } from '@/components/tournament/divisions/DivisionsHub'
import { TournamentPlanFlow } from '@/components/tournament/divisions/TournamentPlanFlow'
import { computeDivision, defaultFormatSettings, gameKey, type GameScores } from '@/lib/tournament/divisions/engine'
import { buildHubView } from '@/lib/tournament/divisions/hubView'
import { PRESETS, presetIdentity } from '@/lib/tournament/divisions/identity'
import { sampleDivisionsField } from '@/lib/tournament/divisions/sampleData'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Divisions preview (dev)', robots: { index: false, follow: false } }

/** Round-one finals and a live round two, repeatable, so the bracket has something to show. */
function sampleScores(teams: Parameters<typeof computeDivision>[0]): GameScores {
  const scores: GameScores = {}
  const first = computeDivision(teams, { autoBids: 52, wildcardSpots: 12 }).bracket
  if (!first) return scores
  first[0]!.forEach((g, i) => { scores[gameKey(1, i)] = { a: 120 + ((i * 37) % 45), b: 100 + ((i * 53) % 60) } })
  const second = computeDivision(teams, { autoBids: 52, wildcardSpots: 12 }, scores).bracket!
  second[1]!.forEach((g, i) => { if (i % 2 === 0) scores[gameKey(2, i)] = { a: 70 + ((i * 29) % 50), b: 65 + ((i * 31) % 50) } })
  return scores
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
  const view = buildHubView({
    tournament: { id: 'preview', name: 'Preview', sport: 'NFL', status: 'live', season: 2026 },
    settings, identity, teams, meTeamId, sample: true,
    scores: [sampleScores(division0), sampleScores(teams.filter(t => t.divisionIndex === 1))],
  })
  return <DivisionsHub view={view} />
}
