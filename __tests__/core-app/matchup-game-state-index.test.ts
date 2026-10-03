// @vitest-environment node
/**
 * `starterGameStates` builds its club → game index once per games array, and in linear time.
 *
 * 🛑 WHY: the all-leagues board called it 136 times on one account with the same 96 games, and each
 * call rebuilt the index with a pairwise scan — ~450–570 ms of one render (production, 2026-10-03).
 *
 * The rule must not move, so the new code is checked against the previous implementation, kept
 * verbatim below, on thousands of generated weeks built to hit every edge the old code had: rows
 * with no seasonType (the live-score writer's), `undefined` seasonType (counts as canonical), kickoffs
 * either side of the one-minute window, names that do not normalize, and equal fetch times.
 */
import { describe, expect, it, vi } from 'vitest'

const counter = vi.hoisted(() => ({ calls: 0 }))
vi.mock('@/lib/team-abbrev', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/team-abbrev')>()
  return {
    ...real,
    normalizeTeamAbbrev: (v: string | null | undefined) => {
      counter.calls++
      return real.normalizeTeamAbbrev(v)
    },
  }
})

import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { starterGameStates, type StarterGameState } from '@/lib/core-app/matchupGameState'

type Game = { homeTeam: string; awayTeam: string; status: string | null; startTime: Date | null; fetchedAt: Date; seasonType?: string | null }

/* The implementation this replaced, verbatim. */
function previous(players: ReadonlyMap<string, { team: string | null }>, games: Game[], now = new Date()): Map<string, StarterGameState> {
  const byClub = new Map<string, Game>()
  const canonical = games.filter((game) => game.seasonType !== null)
  const candidates = games.filter((game) => game.seasonType !== null || canonical.some((fixture) =>
    game.startTime && fixture.startTime && Math.abs(game.startTime.getTime() - fixture.startTime.getTime()) < 60_000 &&
    normalizeTeamAbbrev(game.homeTeam) === normalizeTeamAbbrev(fixture.homeTeam) &&
    normalizeTeamAbbrev(game.awayTeam) === normalizeTeamAbbrev(fixture.awayTeam)))
  for (const game of [...candidates].sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime())) {
    for (const team of [game.homeTeam, game.awayTeam]) {
      const club = normalizeTeamAbbrev(team)
      if (club && !byClub.has(club)) byClub.set(club, game)
    }
  }
  return new Map([...players].map(([id, player]) => {
    const game = byClub.get(normalizeTeamAbbrev(player.team) ?? '')
    const status = String(game?.status ?? '').toLowerCase()
    let state: StarterGameState = 'unknown'
    if (game && /^(final|finished|completed?|status_final|status_final_ot)$/.test(status)) state = 'final'
    else if (game && now.getTime() - game.fetchedAt.getTime() <= 3_600_000) {
      if (/^(live|in_progress|inprogress|status_in_progress|halftime|status_halftime)$/.test(status)) state = 'live'
      else if (game.startTime && game.startTime > now && /^(scheduled|pre|not_started|status_scheduled)$/.test(status)) state = 'upcoming'
    }
    return [id, state]
  }))
}

/* A small deterministic PRNG, so a failure reproduces from its seed. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const CLUBS = ['KC', 'BUF', 'SF', 'LAR', 'NYJ', 'MIA', 'Kansas City Chiefs', 'JAX', 'JAC', 'WSH', 'WAS', 'LV', 'OAK', 'NOPE', '', 'xx']
const STATUSES = ['final', 'Final', 'in_progress', 'halftime', 'scheduled', 'pre', 'postponed', null, 'STATUS_FINAL', 'live']
const NOW = new Date('2026-10-04T18:00:00Z')

function week(seed: number): { games: Game[]; players: Map<string, { team: string | null }> } {
  const r = rng(seed)
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]
  const base = NOW.getTime() - 3 * 3_600_000
  const fixtures: Game[] = Array.from({ length: 2 + Math.floor(r() * 10) }, () => ({
    homeTeam: pick(CLUBS),
    awayTeam: pick(CLUBS),
    status: pick(STATUSES),
    startTime: r() < 0.08 ? null : new Date(base + Math.floor(r() * 8) * 3_600_000),
    fetchedAt: new Date(NOW.getTime() - Math.floor(r() * 4) * 1_800_000),
    seasonType: r() < 0.15 ? undefined : pick(['regular', 'regular', 'pre', 'post']),
  }))
  /* Untyped rows: some exact copies of a fixture, some offset either side of the 60s window. */
  const untyped: Game[] = Array.from({ length: Math.floor(r() * 12) }, () => {
    const f = pick(fixtures)
    const offset = pick([0, 30_000, 59_999, 60_000, 61_000, -59_000, -60_000, 3_600_000])
    return {
      homeTeam: r() < 0.8 ? f.homeTeam : pick(CLUBS),
      awayTeam: r() < 0.8 ? f.awayTeam : pick(CLUBS),
      status: pick(STATUSES),
      startTime: f.startTime && r() < 0.95 ? new Date(f.startTime.getTime() + offset) : null,
      fetchedAt: r() < 0.3 ? f.fetchedAt : new Date(NOW.getTime() - Math.floor(r() * 4) * 1_800_000),
      seasonType: null,
    }
  })
  const games = [...fixtures, ...untyped].sort(() => r() - 0.5)
  const players = new Map(Array.from({ length: 6 }, (_, i) => [`p${i}`, { team: r() < 0.1 ? null : pick(CLUBS) }] as const))
  return { games, players }
}

describe('starterGameStates — the club index', () => {
  it('🛑 matches the previous implementation on 3,000 generated weeks', () => {
    let compared = 0
    for (let seed = 1; seed <= 3000; seed++) {
      const { games, players } = week(seed)
      const expected = [...previous(players, games, NOW)]
      const actual = [...starterGameStates(players, games, NOW)]
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`seed ${seed} differs:\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`)
      }
      compared += players.size
    }
    expect(compared).toBe(18_000)
  })

  it('the generator exercises every state, so the comparison above is not vacuous', () => {
    const seen = new Set<StarterGameState>()
    for (let seed = 1; seed <= 3000; seed++) {
      const { games, players } = week(seed)
      for (const s of starterGameStates(players, games, NOW).values()) seen.add(s)
    }
    expect([...seen].sort()).toEqual(['final', 'live', 'unknown', 'upcoming'])
  })

  it('🛑 a second call with the same games array does not rebuild the index', () => {
    const { games, players } = week(42)
    starterGameStates(players, games, NOW)
    counter.calls = 0
    starterGameStates(players, games, NOW)
    /* Only the players are normalized — one call each — never the games again. */
    expect(counter.calls).toBe(players.size)
  })

  it('an array that grows after a first call is rebuilt, and sees the new row', () => {
    const games: Game[] = [
      { homeTeam: 'KC', awayTeam: 'BUF', status: 'scheduled', startTime: new Date(NOW.getTime() + 3_600_000), fetchedAt: new Date(NOW.getTime() - 60_000), seasonType: 'regular' },
    ]
    const players = new Map([['a', { team: 'KC' }]])
    expect(starterGameStates(players, games, NOW).get('a')).toBe('upcoming')
    games.push({ homeTeam: 'KC', awayTeam: 'BUF', status: 'final', startTime: games[0].startTime, fetchedAt: NOW, seasonType: 'regular' })
    expect(starterGameStates(players, games, NOW).get('a')).toBe('final')
  })
})
