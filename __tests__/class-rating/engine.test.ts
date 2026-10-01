// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  GLICKO,
  classFromPercentile,
  classify,
  divisionOf,
  glicko2Update,
  idle,
  newRating,
  rdOf,
  replay,
  toDisplay,
  type RatingGame,
  type RatingState,
} from '@/lib/class-rating/engine'

const S = GLICKO.scale
const state = (r: number, rd: number, sigma = 0.06): RatingState => ({
  mu: (r - 1500) / S,
  phi: rd / S,
  sigma,
  games: 0,
  lastPeriod: null,
})

describe('glicko2Update — the published method', () => {
  it("reproduces Glickman's worked example (1500/200 vs 1400 W, 1550 L, 1700 L)", () => {
    const opp = (r: number, rd: number, s: number) => ({ muj: (r - 1500) / S, phij: rd / S, s })
    const { next } = glicko2Update(state(1500, 200), [opp(1400, 30, 1), opp(1550, 100, 0), opp(1700, 300, 0)])
    expect(toDisplay(next.mu)).toBeCloseTo(1464.06, 1)
    expect(rdOf(next.phi)).toBeCloseTo(151.52, 1)
    expect(next.sigma).toBeCloseTo(0.05999, 4)
    expect(next.games).toBe(3)
  })

  it("splits the move into per-observation shares that sum exactly to it", () => {
    const p = state(1520, 80)
    const { next, shares } = glicko2Update(p, [
      { muj: 0.1, phij: 0.2, s: 0.9 },
      { muj: -0.2, phij: 0.3, s: 0.1 },
    ])
    expect(shares).toHaveLength(2)
    expect(shares[0]).toBeGreaterThan(0)
    expect(shares[1]).toBeLessThan(0)
    expect(shares[0] + shares[1]).toBeCloseTo(next.mu - p.mu, 12)
  })

  it('an idle period only grows the uncertainty, and never past the starting RD', () => {
    const p = state(1600, 60)
    const q = idle(p)
    expect(q.mu).toBe(p.mu)
    expect(q.phi).toBeGreaterThan(p.phi)
    // Each idle step adds only σ² to the variance — ~64 steps from 340 reach the cap.
    let r = state(1600, 340)
    for (let i = 0; i < 200; i++) r = idle(r)
    expect(rdOf(r.phi)).toBeCloseTo(GLICKO.startRd, 6)
  })
})

/** A league-week of `teams` people where team i scores 100 + 10*i (so the last team beats everyone). */
function leagueWeek(leagueId: string, season: number, week: number, people: string[]): RatingGame[] {
  const out: RatingGame[] = []
  for (let i = 0; i + 1 < people.length; i += 2) {
    out.push({ leagueId, season, week, a: people[i], b: people[i + 1], scoreA: 100 + 10 * i, scoreB: 100 + 10 * (i + 1) })
  }
  return out
}

describe('replay — all-play over league-weeks', () => {
  const people = ['s:a', 's:b', 's:c', 's:d', 's:e', 's:f']

  it('moves the field-beater up and the field-trailer down, and logs every league-week', async () => {
    const games = [1, 2, 3, 4, 5, 6].flatMap((w) => leagueWeek('L1', 2024, w, people))
    const { ratings, events } = await replay(games)
    const top = ratings.get('s:f')!
    const bottom = ratings.get('s:a')!
    expect(toDisplay(top.mu)).toBeGreaterThan(1500)
    expect(toDisplay(bottom.mu)).toBeLessThan(1500)
    expect(top.games).toBe(6)
    expect(top.lastPeriod).toBe(202406)
    expect(events).toHaveLength(6 * people.length)
    const fWeek1 = events.find((e) => e.subjectKey === 's:f' && e.week === 1)!
    expect(fWeek1).toMatchObject({ allPlayWins: 5, allPlayGames: 5, opponentKey: 's:e', result: 'W', ratingBefore: 1500 })
    expect(fWeek1.ratingDelta).toBeCloseTo(fWeek1.ratingAfter - fWeek1.ratingBefore, 9)
  })

  it('is deterministic whatever order the games arrive in', async () => {
    const games = [1, 2, 3].flatMap((w) => leagueWeek('L1', 2024, w, people))
    const shuffled = [...games].reverse()
    const a = await replay(games)
    const b = await replay(shuffled)
    for (const p of people) expect(b.ratings.get(p)!.mu).toBeCloseTo(a.ratings.get(p)!.mu, 12)
  })

  it('skips a league-week with fewer than four teams — no rating move, no log row', async () => {
    const { ratings, events } = await replay(leagueWeek('L2', 2024, 1, ['s:a', 's:b']))
    expect(events).toHaveLength(0)
    expect(ratings.size).toBe(0)
  })

  it('folds two leagues in one week into one update, with league shares summing to the week', async () => {
    const other = ['s:f', 's:g', 's:h', 's:i']
    const games = [...leagueWeek('L1', 2024, 1, people), ...leagueWeek('L2', 2024, 1, other)]
    const { ratings, events } = await replay(games)
    const f = events.filter((e) => e.subjectKey === 's:f')
    expect(f).toHaveLength(2)
    expect(f[0].ratingBefore).toBe(f[1].ratingBefore)
    expect(f[0].ratingAfter).toBe(f[1].ratingAfter)
    expect(f[0].ratingDelta + f[1].ratingDelta).toBeCloseTo(f[0].ratingAfter - f[0].ratingBefore, 9)
    expect(ratings.get('s:f')!.games).toBe(2)
  })

  it('widens everyone across an offseason, so the same result moves the rating further', async () => {
    const season = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((w) => leagueWeek('L1', 2024, w, people))
    // The same ninth game, played either as 2024 week 9 or as 2025 week 1.
    const sameSeason = await replay([...season, ...leagueWeek('L1', 2024, 9, people)])
    const nextSeason = await replay([...season, ...leagueWeek('L1', 2025, 1, people)])
    const moveIn = (r: Awaited<ReturnType<typeof replay>>, s: number, w: number) =>
      Math.abs(r.events.find((e) => e.subjectKey === 's:f' && e.season === s && e.week === w)!.ratingDelta)
    expect(moveIn(nextSeason, 2025, 1)).toBeGreaterThan(moveIn(sameSeason, 2024, 9))
  })

  it('a game against oneself never reaches the rating', async () => {
    const games: RatingGame[] = [{ leagueId: 'L1', season: 2024, week: 1, a: 's:a', b: 's:a', scoreA: 1, scoreB: 2 }]
    const { ratings, events } = await replay(games)
    expect(ratings.size).toBe(0)
    expect(events).toHaveLength(0)
  })
})

describe('classify — Class and division', () => {
  it('maps percentiles to 25 Classes and Classes to 5 divisions', () => {
    expect(classFromPercentile(0)).toBe(1)
    expect(classFromPercentile(0.0399)).toBe(1)
    expect(classFromPercentile(0.04)).toBe(2)
    expect(classFromPercentile(0.999)).toBe(25)
    expect([1, 5, 6, 10, 11, 25].map(divisionOf)).toEqual([1, 1, 2, 2, 3, 5])
  })

  it('gives a provisional rating no Class, and keeps it out of everyone else’s percentile', () => {
    const ratings = new Map<string, RatingState>()
    // 25 established people, 1400..1640 in steps of 10, and one provisional at 2000.
    for (let i = 0; i < 25; i++) ratings.set(`s:${i}`, { ...state(1400 + 10 * i, 60), games: 40 })
    ratings.set('s:new', { ...state(2000, 250), games: 3 })
    const c = classify(ratings)
    const newbie = c.get('s:new')!
    expect(newbie).toMatchObject({ established: false, percentile: null, classLevel: null, division: null })
    expect(c.get('s:0')).toMatchObject({ established: true, percentile: 0, classLevel: 1, division: 1 })
    expect(c.get('s:24')).toMatchObject({ classLevel: 25, division: 5 })
    expect(c.get('s:12')!.classLevel).toBe(13)
  })

  it('treats the establishment line as inclusive', () => {
    const c = classify(new Map([['s:x', state(1500, GLICKO.establishedRd)]]))
    expect(c.get('s:x')!.established).toBe(true)
    expect(newRating().phi * S).toBeCloseTo(GLICKO.startRd, 9)
  })
})
