// @vitest-environment node
/**
 * Guards the HTTP edge of standing a tournament up from imported leagues.
 *
 * 🛑 THE FORM HAS ALWAYS SENT THE LATER WEEKS AND THE ROUTE DROPPED THEM. Its body
 * type listed neither the redraft, elite redraft, championship nor bubble week, so
 * `importTournamentFromLeagues` received nothing for any of them, laid out one
 * "Regular season" round, and the tournament declared itself complete at the first
 * cut. `__tests__/tournament-import-from-leagues.test.ts` covers the importer, which
 * accepted these fields all along — only the route between the form and it lost them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { buildRoundScaffold } from '@/lib/tournament/roundScaffold'

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  importTournamentFromLeagues: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: h.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/tournament/importTournamentFromLeagues', () => ({
  importTournamentFromLeagues: h.importTournamentFromLeagues,
}))

/** What the form sends for KBI: a regular season to week 9, then the bracket weeks. */
const KBI_BODY = {
  name: 'King Buffalo Invitational',
  openingWeekStart: 1,
  openingWeekEnd: 9,
  conferences: [
    { name: 'BLACK', leagueIds: ['lg-black-1'] },
    { name: 'GOLD', leagueIds: ['lg-gold-1'] },
  ],
  advancersPerLeague: 0,
  wildcardCount: 64,
  bubbleEnabled: true,
  bubbleSize: 6,
  bubbleWeek: 9,
  redraftWeek: 10,
  eliteRedraftWeek: 15,
  championshipWeek: 17,
}

function post(body: unknown) {
  return new Request('http://localhost/api/tournament/import-from-leagues', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function callAs(userId: string | null, body: unknown) {
  h.getServerSession.mockResolvedValue(userId ? { user: { id: userId } } : null)
  const { POST } = await import('@/app/api/tournament/import-from-leagues/route')
  // The handler only reads `.json()`, so a plain Request stands in for NextRequest.
  return POST(post(body) as unknown as NextRequest)
}

function omit<T extends object>(source: T, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([k]) => !keys.includes(k)))
}

/** The arguments the route handed the importer. */
function sentInput() {
  expect(h.importTournamentFromLeagues).toHaveBeenCalledTimes(1)
  return h.importTournamentFromLeagues.mock.calls[0][0]
}

beforeEach(() => {
  vi.clearAllMocks()
  h.importTournamentFromLeagues.mockResolvedValue({
    ok: true,
    tournamentId: 'tour-1',
    leagueCount: 2,
    participantCount: 24,
    renamedLeagues: [],
    rounds: [],
    orphanTeamCount: 0,
  })
})

describe('POST /api/tournament/import-from-leagues', () => {
  it('401s without a session and imports nothing', async () => {
    const res = await callAs(null, KBI_BODY)

    expect(res.status).toBe(401)
    expect(h.importTournamentFromLeagues).not.toHaveBeenCalled()
  })

  it('400s on a body that is not JSON, and imports nothing', async () => {
    const res = await callAs('user-1', 'not json at all')

    expect(res.status).toBe(400)
    expect(h.importTournamentFromLeagues).not.toHaveBeenCalled()
  })

  it('forwards the redraft, elite redraft, championship and bubble weeks', async () => {
    await callAs('user-1', KBI_BODY)

    expect(sentInput()).toMatchObject({
      commissionerUserId: 'user-1',
      name: 'King Buffalo Invitational',
      openingWeekStart: 1,
      openingWeekEnd: 9,
      bubbleWeek: 9,
      redraftWeek: 10,
      eliteRedraftWeek: 15,
      championshipWeek: 17,
      wildcardCount: 64,
      bubbleSize: 6,
    })
  })

  /*
   * ⚠ ABSENT MUST STAY ABSENT. Week 0 is not "undecided" — it sits before the regular
   * season, so the scaffold refuses the whole tournament as out of order.
   */
  it('sends null, not 0, for a week the commissioner left blank', async () => {
    await callAs('user-1', omit(KBI_BODY, ['bubbleWeek', 'redraftWeek', 'eliteRedraftWeek', 'championshipWeek']))

    const input = sentInput()
    expect(input.bubbleWeek).toBeNull()
    expect(input.redraftWeek).toBeNull()
    expect(input.eliteRedraftWeek).toBeNull()
    expect(input.championshipWeek).toBeNull()
  })

  it('accepts weeks that arrive as strings, and treats an empty field as blank', async () => {
    await callAs('user-1', { ...KBI_BODY, redraftWeek: '10', championshipWeek: '' })

    expect(sentInput()).toMatchObject({ redraftWeek: 10, championshipWeek: null })
  })

  /*
   * The point of forwarding them: what the route sends has to lay out a whole
   * tournament. This runs the REAL scaffold over the forwarded numbers, so it fails
   * if they arrive in a shape the calendar can't use — not merely if they go missing.
   */
  it('what it forwards lays out the full KBI calendar, not a lone regular season', async () => {
    await callAs('user-1', KBI_BODY)
    const input = sentInput()

    const scaffold = buildRoundScaffold({
      openingWeekStart: input.openingWeekStart,
      openingWeekEnd: input.openingWeekEnd,
      bubbleWeek: input.bubbleWeek,
      redraftWeek: input.redraftWeek,
      eliteRedraftWeek: input.eliteRedraftWeek,
      championshipWeek: input.championshipWeek,
    })

    expect(scaffold.ok).toBe(true)
    expect(scaffold.ok && scaffold.rounds.map((r) => [r.roundLabel, r.weekStart, r.weekEnd])).toEqual([
      ['Regular season', 1, 9],
      ['Bubble', 9, 9],
      ['Elimination bracket', 11, 14],
      ['Elite bracket', 15, 16],
      ['Championship', 17, 17],
    ])

    // Control: the same call with the weeks dropped is the single round this fixes.
    const withoutWeeks = buildRoundScaffold({ openingWeekStart: 1, openingWeekEnd: 9 })
    expect(withoutWeeks.ok && withoutWeeks.rounds).toHaveLength(1)
  })

  it('passes the importer’s refusal straight back, with its status', async () => {
    h.importTournamentFromLeagues.mockResolvedValue({
      ok: false,
      error: 'One or more of those leagues could not be found.',
      status: 404,
    })

    const res = await callAs('user-1', KBI_BODY)

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'One or more of those leagues could not be found.' })
  })

  it('returns the new tournament id so the form can navigate to it', async () => {
    const res = await callAs('user-1', KBI_BODY)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ tournamentId: 'tour-1', leagueCount: 2, participantCount: 24 })
  })
})
