/**
 * In bracket weeks, a conference league's matchup screen shows each of its entrants' TOURNAMENT
 * bracket opponent and round, read from the same hub view the tournament renders.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const m = vi.hoisted(() => ({ access: vi.fn(), load: vi.fn(), session: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => ({ getServerSession: () => m.session() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: (...a: unknown[]) => m.access(...a) }))
vi.mock('@/lib/tournament/divisions/divisionsStore', () => ({ loadLeagueBracketWeek: (...a: unknown[]) => m.load(...a) }))

import { buildHubView, type CommittedDivision } from '@/lib/tournament/divisions/hubView'
import { computeDivision, defaultFormatSettings, type SeededTeam } from '@/lib/tournament/divisions/engine'
import { sampleDivisionsField } from '@/lib/tournament/divisions/sampleData'
import { leagueBracketWeek } from '@/lib/tournament/divisions/leagueBracketWeek'
import { TournamentBracketCardView } from '@/components/league/native/screens/TournamentBracketCard'
const { GET } = await import('@/app/api/leagues/[leagueId]/tournament-bracket/handler')

const settings = defaultFormatSettings('NFL') // bracket weeks 11-17
const { teams, identity } = sampleDivisionsField(2026, 10)
const tournament = { id: 't1', name: 'Gold Cup', sport: 'NFL' as const, status: 'live', season: 2026 }
const leagueOf = (conferenceIndex: number, divisionIndex: 0 | 1) => new Set(teams.filter(t => t.conferenceIndex === conferenceIndex && t.divisionIndex === divisionIndex).map(t => t.id))

/** The committed snapshot both divisions would carry after "Commit seeding". */
function committed(): [CommittedDivision, CommittedDivision] {
  return ([0, 1] as const).map(d => {
    const r = computeDivision(teams.filter(t => t.divisionIndex === d), settings)
    return { seeded: r.seeded as SeededTeam[], scores: {}, overrides: {}, roundsCommitted: 0 }
  }) as [CommittedDivision, CommittedDivision]
}

describe('leagueBracketWeek', () => {
  const view = buildHubView({ tournament, settings, identity, teams, committed: committed() })
  const r1 = view.divisions[0].regions.North![0]![0]!
  const meTeam = teams.find(t => t.id === r1.a!.id)!
  const league = leagueOf(meTeam.conferenceIndex, 0)

  it('is null outside bracket weeks — the regular season shows nothing extra', () => {
    expect(leagueBracketWeek(view, league, 3)).toBeNull()
    expect(leagueBracketWeek(view, league, 10)).toBeNull()
  })

  it('round 1 (week 11): every entrant of this league in a game, with their real bracket opponent', () => {
    const asMe = buildHubView({ tournament, settings, identity, teams, committed: committed(), meTeamId: meTeam.id })
    const w = leagueBracketWeek(asMe, league, 11)!
    expect(w).toMatchObject({ round: 1, label: 'Round of 64', kind: 'division', projected: false, me: 'playing' })
    expect(w.entries[0]).toMatchObject({ teamId: meTeam.id, isMe: true, opponent: { name: r1.b!.name, seedLine: r1.b!.seedLine }, result: 'pending' })
    // Only this league's entrants, and each appears once.
    expect(w.entries.every(e => league.has(e.teamId))).toBe(true)
    expect(new Set(w.entries.map(e => e.teamId)).size).toBe(w.entries.length)
    const inRound1 = view.divisions[0].regions && Object.values(view.divisions[0].regions).flatMap(rs => rs![0]!).flatMap(g => [g.a, g.b]).filter(e => e && league.has(e.id))
    expect(w.entries).toHaveLength(inRound1.length)
  })

  it('round 2 before round 1 is decided: the viewer is waiting, not out', () => {
    const asMe = buildHubView({ tournament, settings, identity, teams, committed: committed(), meTeamId: meTeam.id })
    const w = leagueBracketWeek(asMe, league, 12)!
    expect(w).toMatchObject({ round: 2, label: 'Round of 32', me: 'waiting' })
  })

  it('a loser of round 1 is out from round 2 on; the winner plays on', () => {
    const c = committed()
    // Give game 0 of round 1 to the b side (the 16 seed).
    c[0] = { ...c[0], scores: { '1:0': { a: 80, b: 120 } }, roundsCommitted: 1 }
    const loser = buildHubView({ tournament, settings, identity, teams, committed: c, meTeamId: meTeam.id })
    expect(leagueBracketWeek(loser, league, 11)!.entries[0]).toMatchObject({ isMe: true, score: 80, opponentScore: 120, result: 'lost' })
    expect(leagueBracketWeek(loser, league, 12)!.me).toBe('out')
  })

  it('before seeding is committed the pairings are marked as a projection', () => {
    const open = buildHubView({ tournament, settings, identity, teams })
    expect(leagueBracketWeek(open, league, 11)?.projected).toBe(true)
  })

  it('a viewer in this league who missed the bracket is out', () => {
    const r = computeDivision(teams.filter(t => t.divisionIndex === 0), settings)
    const missed = r.ranked.at(-1)!
    const asMissed = buildHubView({ tournament, settings, identity, teams, committed: committed(), meTeamId: missed.id })
    const missedLeague = leagueOf(teams.find(t => t.id === missed.id)!.conferenceIndex, 0)
    expect(leagueBracketWeek(asMissed, missedLeague, 11)!.me).toBe('out')
  })
})

describe('the card', () => {
  it('shows the round, the viewer’s bracket opponent and a link to the bracket', () => {
    const html = renderToStaticMarkup(<TournamentBracketCardView bracket={{
      tournamentId: 't1', tournamentName: 'Gold Cup', week: 11, round: 1, label: 'Round of 64', kind: 'division', projected: false, leagueTeams: 12, me: 'playing',
      entries: [{ teamId: 'a', name: 'SackTheory', seedLine: 1, region: 'North', isMe: true, opponent: { name: 'SackCapital', seedLine: 16, region: 'North' }, score: null, opponentScore: null, result: 'pending' }],
    }} />)
    expect(html).toContain('Gold Cup · Round of 64')
    expect(html).toContain('#1 SackTheory (you)')
    expect(html).toContain('vs #16 SackCapital')
    expect(html).toContain('href="/tournament-hub/t1"')
    expect(html).not.toContain('Projected pairings')
  })
})

describe('GET /api/leagues/[id]/tournament-bracket', () => {
  const req = (week: string) => ({ nextUrl: new URL(`http://x/api/leagues/L1/tournament-bracket?week=${week}`) }) as never
  const ctx = { params: Promise.resolve({ leagueId: 'L1' }) }
  beforeEach(() => { vi.clearAllMocks(); m.session.mockResolvedValue({ user: { id: 'u1' } }); m.access.mockResolvedValue({ role: 'member' }); m.load.mockResolvedValue(null) })

  it('league members only', async () => {
    m.access.mockResolvedValue(null)
    expect((await GET(req('11'), ctx)).status).toBe(403)
    expect(m.load).not.toHaveBeenCalled()
    m.session.mockResolvedValue(null)
    expect((await GET(req('11'), ctx)).status).toBe(401)
  })

  it('reads the bracket week for this league and viewer', async () => {
    const res = await GET(req('12'), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ bracket: null })
    expect(m.load).toHaveBeenCalledWith('L1', 'u1', 12)
    expect((await GET(req('x'), ctx)).status).toBe(400)
  })
})
