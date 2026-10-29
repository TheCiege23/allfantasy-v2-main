import { describe, expect, it } from 'vitest'
import { almostFullThreshold, joinState, placeEntrants, promotions, waitlistOrder, waitlistPosition, type PlacementEntrant } from '@/lib/tournament/divisions/registration'
import { bracketFromSeeds, computeDivision, defaultFormatSettings, gameKey, planRound, type WeekScore } from '@/lib/tournament/divisions/engine'
import { MOMENTS, momentById, skipChannelsFor } from '@/lib/tournament/divisions/moments'
import { buildHubView } from '@/lib/tournament/divisions/hubView'
import { buildShareCard, SHARE_SIZES } from '@/lib/tournament/divisions/shareCard'
import { sampleDivisionsField } from '@/lib/tournament/divisions/sampleData'

describe('registration state', () => {
  it('open, almost full, full, closed, in and waitlisted', () => {
    const base = { phase: 'registering', capacity: 240, myStatus: null }
    expect(joinState({ ...base, registered: 100 })).toBe('open')
    expect(almostFullThreshold(240)).toBe(24)
    expect(joinState({ ...base, registered: 216 })).toBe('almost_full')
    expect(joinState({ ...base, registered: 240 })).toBe('full')
    expect(joinState({ ...base, phase: 'placed', registered: 240 })).toBe('closed')
    expect(joinState({ ...base, registered: 240, myStatus: 'registered' })).toBe('in')
    expect(joinState({ ...base, registered: 240, myStatus: 'waitlisted' })).toBe('waitlisted')
  })

  it('the waitlist is strict first in, first out — never by updatedAt', () => {
    const q = [
      { id: 'c', queuedAt: '2026-08-03T00:00:00Z' },
      { id: 'a', queuedAt: '2026-08-01T00:00:00Z' },
      { id: 'b', queuedAt: '2026-08-02T00:00:00Z' },
      { id: 'a2', queuedAt: '2026-08-01T00:00:00Z' },
    ]
    expect(waitlistOrder(q).map(e => e.id)).toEqual(['a', 'a2', 'b', 'c'])
    expect(promotions(q, 2).map(e => e.id)).toEqual(['a', 'a2'])
    expect(promotions(q, 0)).toEqual([])
    expect(waitlistPosition(q, 'b')).toBe(3)
    expect(waitlistPosition(q, 'zz')).toBeNull()
  })
})

const entrants = (n: number, pref: (i: number) => 0 | 1 | null = () => null, inviter: (i: number) => string | null = () => null): PlacementEntrant[] =>
  Array.from({ length: n }, (_, i) => ({ id: `e${String(i).padStart(3, '0')}`, preference: pref(i), invitedBy: inviter(i) }))

describe('placement', () => {
  const base = { conferences: 10, teamsPerConference: 12, allowPreference: true, allowGrouping: false, seed: 42 }

  it('is deterministic for a seed and different for another', () => {
    const a = placeEntrants({ ...base, entrants: entrants(240) })
    const b = placeEntrants({ ...base, entrants: [...entrants(240)].reverse() })
    expect(a.assignments).toEqual(b.assignments)
    const c = placeEntrants({ ...base, seed: 43, entrants: entrants(240) })
    expect(c.assignments).not.toEqual(a.assignments)
    expect(a.log.seed).toBe(42)
  })

  it('fills 20 leagues of 12 from 240, balanced', () => {
    const p = placeEntrants({ ...base, entrants: entrants(240) })
    expect(p.leagues).toHaveLength(20)
    expect(p.leagues.every(l => l.members.length === 12)).toBe(true)
    expect(Object.keys(p.assignments)).toHaveLength(240)
  })

  it('balances a partial field: divisions differ by at most one, leagues too', () => {
    const p = placeEntrants({ ...base, entrants: entrants(201) })
    const d0 = p.leagues.filter(l => l.division === 0).reduce((s, l) => s + l.members.length, 0)
    expect(Math.abs(d0 - (201 - d0))).toBeLessThanOrEqual(1)
    for (const d of [0, 1]) {
      const sizes = p.leagues.filter(l => l.division === d).map(l => l.members.length)
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
    }
  })

  it('honours preference only while divisions stay balanced ("not guaranteed")', () => {
    // 200 of 240 want division 0: only 120 can have it.
    const p = placeEntrants({ ...base, entrants: entrants(240, i => (i < 200 ? 0 : null)) })
    expect(p.log.preferenceHonoured).toBe(120)
    expect(p.log.preferenceOverflow).toBe(80)
    const inD0 = Object.values(p.assignments).filter(a => a.division === 0).length
    expect(inD0).toBe(120)
  })

  it('ignores preference when the commissioner turned it off', () => {
    const p = placeEntrants({ ...base, allowPreference: false, entrants: entrants(24, () => 0) })
    expect(p.log.preferenceHonoured).toBe(0)
    const inD0 = Object.values(p.assignments).filter(a => a.division === 0).length
    expect(inD0).toBe(12)
  })

  it('keeps an inviter and their friends together only when grouping is allowed', () => {
    const invited = (i: number) => (i >= 1 && i <= 3 ? 'e000' : null)
    const grouped = placeEntrants({ ...base, allowGrouping: true, entrants: entrants(240, () => null, invited) })
    const home = grouped.assignments['e000']
    for (const id of ['e001', 'e002', 'e003']) expect(grouped.assignments[id]).toEqual(home)
    expect(grouped.log.groupsKept).toBeGreaterThanOrEqual(1)
    // Without grouping, the same invite links do not change placement at all.
    const random = placeEntrants({ ...base, allowGrouping: false, entrants: entrants(240, () => null, invited) })
    const plain = placeEntrants({ ...base, allowGrouping: false, entrants: entrants(240) })
    expect(random.assignments).toEqual(plain.assignments)
  })

  it('refuses more entrants than spots and duplicates', () => {
    expect(() => placeEntrants({ ...base, entrants: entrants(241) })).toThrow(/spots/)
    const e = entrants(2)
    expect(() => placeEntrants({ ...base, entrants: [e[0]!, e[0]!] })).toThrow(/Duplicate/)
  })
})

describe('round planning — a missing score is never zero', () => {
  const { teams } = sampleDivisionsField()
  const settings = defaultFormatSettings('NFL')
  const division = computeDivision(teams.filter(t => t.divisionIndex === 0), settings)
  const rounds = bracketFromSeeds(division.seeded!)
  const allScores = (tie = false) => {
    const m = new Map<string, WeekScore>()
    rounds[0]!.forEach((g, i) => { m.set(g.a!.id, { points: tie ? 100 : 120 + i, final: true }); m.set(g.b!.id, { points: 100, final: true }) })
    return m
  }

  it('is ready when every game has two final scores', () => {
    const plan = planRound(rounds, 1, allScores())
    expect(plan.blockers).toEqual([])
    expect(Object.keys(plan.scores)).toHaveLength(32)
    expect(plan.games.every(g => g.winner)).toBe(true)
  })

  it('blocks on a missing score instead of treating it as 0', () => {
    const scores = allScores()
    scores.delete(rounds[0]![3]!.b!.id)
    const plan = planRound(rounds, 1, scores)
    expect(plan.blockers.join(' ')).toMatch(/1 game has a missing score/)
    expect(plan.scores[gameKey(1, 3)]).toBeUndefined()
  })

  it('blocks while a score is provisional', () => {
    const scores = allScores()
    scores.set(rounds[0]![0]!.a!.id, { points: 130, final: false })
    expect(planRound(rounds, 1, scores).blockers.join(' ')).toMatch(/not final/)
  })

  it('a tied game goes to the higher seed with no commissioner call', () => {
    const plan = planRound(rounds, 1, allScores(true))
    expect(plan.blockers).toEqual([])
    expect(plan.games.every(g => g.decidedBy === 'seed' && g.winner?.id === g.a?.id)).toBe(true)
  })

  it('round 2 waits on round 1', () => {
    expect(planRound(rounds, 2, allScores()).blockers.join(' ')).toMatch(/waiting on the previous round/)
    const after = bracketFromSeeds(division.seeded!, planRound(rounds, 1, allScores()).scores)
    expect(after[1]!.every(g => g.a && g.b)).toBe(true)
  })
})

describe('notification moments', () => {
  it('has the seven moments with the default channel matrix', () => {
    expect(MOMENTS.map(m => m.id)).toEqual(['league_revealed', 'draft_scheduled', 'made_the_cut', 'eliminated', 'wildcard_clinched', 'on_the_bubble', 'champion'])
    const matrix = Object.fromEntries(MOMENTS.map(m => [m.id, [m.defaults.push, m.defaults.inApp, m.defaults.email, m.defaults.leagueChat]]))
    expect(matrix).toEqual({
      league_revealed: [true, true, true, true], draft_scheduled: [true, true, true, true], made_the_cut: [true, true, true, false],
      eliminated: [true, true, true, false], wildcard_clinched: [true, true, true, true], on_the_bubble: [true, true, false, false], champion: [true, true, true, true],
    })
    expect(skipChannelsFor('on_the_bubble')).toEqual({ email: true, sms: true })
    expect(skipChannelsFor('champion')).toEqual({ sms: true })
  })

  it('keeps push titles under ~40 characters and free of URLs', () => {
    const ctx = { tournament: 'Angelic vs Demonic 2026', league: 'Thunder Angelic', division: 'Angelic', teams: 12, draftAt: 'Thu, Sep 3, 8:00 PM EDT', seedLine: 14, rank: 58, round: 'Round of 64', nextRound: 'Round of 32', line: 1043.2, week: 10, opponent: 'NickelNation3' }
    for (const m of MOMENTS) {
      const title = m.title(ctx)
      expect(title.length, `${m.id}: ${title}`).toBeLessThanOrEqual(42)
      expect(`${title} ${m.body(ctx)} ${m.chat?.(ctx) ?? ''}`).not.toMatch(/https?:|token|RSC_/i)
    }
    expect(momentById('league_revealed').body(ctx)).toMatch(/11 league-mates/)
  })
})

describe('share card', () => {
  const { teams, identity } = sampleDivisionsField()
  const settings = defaultFormatSettings('NFL')
  // Chalk: the higher seed wins every game, so the North 1 seed of division A wins the title.
  function chalkView() {
    const committed = ([0, 1] as const).map(d => {
      const seeded = computeDivision(teams.filter(t => t.divisionIndex === d), settings).seeded!
      const scores: Record<string, { a: number; b: number }> = {}
      for (let r = 1; r <= 6; r++) {
        const rounds = bracketFromSeeds(seeded, scores)
        rounds[r - 1]!.forEach((g, i) => { scores[gameKey(r, i)] = g.a!.overallSeed < g.b!.overallSeed ? { a: 120, b: 100 } : { a: 100, b: 120 } })
      }
      return { seeded, scores, overrides: {}, roundsCommitted: 6 }
    }) as [never, never]
    return buildHubView({ tournament: { id: 't', name: 'T', sport: 'NFL', status: 'complete', season: 2026 }, settings, identity, teams, committed, championshipScore: { a: 141.6, b: 128.9 } })
  }

  it('the champion gets CHAMPION, a full road to the title and their stats', () => {
    const view = chalkView()
    const champId = view.championship!.winnerId!
    const card = buildShareCard(view, champId)!
    expect(card.headline).toBe('CHAMPION')
    expect(card.path.map(p => p.label)).toEqual(['Round of 64', 'Round of 32', 'Sweet 16', 'North final', 'Final four', 'Angelic final', 'Championship'])
    expect(card.path.every(p => p.won)).toBe(true)
    expect(card.stats[0]).toEqual({ value: '141.6', label: 'Title score' })
    expect(card.stats[2]!.value).toBe('7-0')
    expect(card.subtitle).toMatch(/1 seed · North region/)
  })

  it('everyone else gets their own headline', () => {
    const view = chalkView()
    const d0 = view.divisions[0]
    const runnerUp = view.championship!.b!.id
    expect(buildShareCard(view, runnerUp)!.headline).toBe('Division champion')
    const ff = d0.finals[0]![0]!
    const ffLoser = ff.winnerId === ff.a!.id ? ff.b!.id : ff.a!.id
    expect(buildShareCard(view, ffLoser)!.headline).toBe('Final four')
    const r64Loser = d0.regions.North![0]![0]!.b!.id
    expect(buildShareCard(view, r64Loser)!.headline).toBe('Made the bracket')
    const missed = d0.rows.at(-1)!.id
    expect(buildShareCard(view, missed)!.headline).toBe('Regular season')
  })

  it('exports at the three sizes', () => {
    expect(Object.values(SHARE_SIZES).map(s => [s.width, s.height])).toEqual([[1080, 1350], [1080, 1920], [1080, 1080]])
  })
})
