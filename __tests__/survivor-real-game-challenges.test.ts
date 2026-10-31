// @vitest-environment node
/**
 * Real-game challenges: the system features a real game of the league's sport, castaways pick the
 * winner before kickoff, and the STORED final settles it with a real (FAAB) prize. Never before a
 * final; void (no prize) when the game is cancelled, postponed or never gets a trusted final.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const TEAMS: Record<string, string> = {
  'KANSAS CITY CHIEFS': 'KC', KC: 'KC', 'BUFFALO BILLS': 'BUF', BUF: 'BUF',
  'MIAMI DOLPHINS': 'MIA', MIA: 'MIA', 'NEW YORK JETS': 'NYJ', NYJ: 'NYJ',
  'BOSTON BRUINS': 'BOS', 'TORONTO MAPLE LEAFS': 'TOR',
}

const h = vi.hoisted(() => {
  const state = {
    games: [] as any[],
    challenges: [] as any[],
    submissions: [] as any[],
    audits: [] as any[],
    language: 'en' as string | null,
    settings: {} as Record<string, unknown>,
    systemRun: true,
    players: [] as any[],
    rosterPlayers: [] as any[],
    tribes: [] as any[],
  }
  const inRange = (t: Date | null, r: any) => !!t && (!r?.gte || t >= r.gte) && (!r?.lt || t < r.lt) && (!r?.lte || t <= r.lte)
  return {
    state,
    rewards: vi.fn(async (_id: string, result: any) => (result.rewards as any[]).map(r => ({ ...r, appliedMode: 'full' }))),
    db: {
      survivorLeagueConfig: { findUnique: vi.fn(async () => ({ id: 'cfg', challengesSystemRun: state.systemRun })) },
      league: { findUnique: vi.fn(async () => ({ settings: state.settings, language: state.language })) },
      sportsGame: { findMany: vi.fn(async ({ where }: any) => state.games.filter(g => g.sport === where.sport && inRange(g.startTime, where.startTime) && where.source.in.includes(g.source))) },
      survivorPlayer: {
        findMany: vi.fn(async ({ where }: any) => state.players.filter(p => !where.playerState || p.playerState === where.playerState)),
        findFirst: vi.fn(async ({ where }: any) => state.players.find(p => p.userId === where.userId && (!where.playerState || p.playerState === where.playerState)) ?? null),
      },
      redraftRosterPlayer: { findMany: vi.fn(async ({ where }: any) => state.rosterPlayers.filter(r => where.rosterId.in.includes(r.rosterId))) },
      survivorTribe: { findMany: vi.fn(async () => state.tribes) },
      survivorChallenge: {
        findFirst: vi.fn(async ({ where }: any) => state.challenges.find(c => (!where.id || c.id === where.id) && (where.week == null || c.week === where.week) && c.challengeType === where.challengeType) ?? null),
        findMany: vi.fn(async ({ where, include }: any) => state.challenges
          .filter(c => c.challengeType === where.challengeType && (!where.status || c.status === where.status) && (!where.locksAt || c.locksAt <= where.locksAt.lte))
          .map(c => (include ? { ...c, submissions: state.submissions.filter(s => s.challengeId === c.id) } : c))),
        upsert: vi.fn(async ({ where, create }: any) => {
          const k = where.configId_week_challengeNumber_challengeType
          const found = state.challenges.find(c => c.week === k.week && c.challengeNumber === k.challengeNumber && c.challengeType === k.challengeType)
          if (found) return found
          const row = { id: `ch-${create.week}-${create.challengeNumber}`, resultJson: null, resultSummary: null, winnerUserIds: [], ...create }
          state.challenges.push(row)
          return row
        }),
        updateMany: vi.fn(async ({ where, data }: any) => {
          const row = state.challenges.find(c => c.id === where.id && c.status === where.status)
          if (!row) return { count: 0 }
          Object.assign(row, data)
          return { count: 1 }
        }),
        update: vi.fn(async ({ where, data }: any) => Object.assign(state.challenges.find(c => c.id === where.id), data)),
      },
      survivorChallengeSubmission: {
        upsert: vi.fn(async ({ where, create, update }: any) => {
          const key = where.uniq_challenge_user
          const row = state.submissions.find(s => s.challengeId === key.challengeId && s.userId === key.userId)
          if (row) return Object.assign(row, update)
          const made = { id: `s-${state.submissions.length}`, isCorrect: null, ...create }
          state.submissions.push(made)
          return made
        }),
        findMany: vi.fn(async ({ where }: any) => state.submissions.filter(s => s.challengeId === where.challengeId)),
        update: vi.fn(async ({ where, data }: any) => Object.assign(state.submissions.find(s => s.id === where.id), data)),
      },
      survivorAuditEntry: { create: vi.fn(async ({ data }: any) => { state.audits.push(data); return data }) },
      $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    },
  }
})
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/follows/teamFollows', () => ({ getTeamIndex: vi.fn(async () => ({})) }))
vi.mock('@/lib/follows/teamResolver', () => ({ resolveTeam: (_i: unknown, name: string) => TEAMS[String(name).toUpperCase()] ?? null }))
vi.mock('@/lib/survivor/SurvivorEffectEngine', () => ({ applyChallengeRewards: h.rewards }))

import {
  classifyFixtureResult, groupFixtures, readRealGameSettings, realGameChallengeCopy, realGameResultSummary,
  selectFeaturedFixtures, settleRealGamePicks, SINGLE_SOURCE_GRACE_MS,
} from '@/lib/survivor/survivorRealGameChallengeLogic'
import { ensureRealGameChallenges, loadRealGameBoard, settleRealGameChallenges, submitRealGamePick } from '@/lib/survivor/survivorRealGameChallenges'

const resolve = (name: string) => TEAMS[name.toUpperCase()] ?? null
const SOURCES = ['espn', 'espn_live', 'thesportsdb', 'rolling_insights', 'api_sports']
const HOUR = 3_600_000
const opened = new Date('2026-10-13T12:00:00Z') // NFL week 6 Tuesday
const kcKick = new Date('2026-10-18T20:25:00Z')
const miaKick = new Date('2026-10-18T17:00:00Z')

function game(over: Partial<any>) {
  return { sport: 'NFL', source: 'espn', homeTeam: 'KC', awayTeam: 'BUF', homeScore: null, awayScore: null, status: 'scheduled', startTime: kcKick, fetchedAt: opened, seasonType: 'regular', ...over }
}

beforeEach(() => {
  Object.assign(h.state, {
    games: [
      game({}),
      game({ source: 'thesportsdb', homeTeam: 'Kansas City Chiefs', awayTeam: 'Buffalo Bills', startTime: new Date(kcKick.getTime() + 5 * 60_000) }),
      game({ homeTeam: 'MIA', awayTeam: 'NYJ', startTime: miaKick }),
    ],
    challenges: [], submissions: [], audits: [], language: 'en', settings: {}, systemRun: true,
    players: [
      { userId: 'a', displayName: 'Ava', playerState: 'active', tribeId: 't1', redraftRosterId: 'r-a' },
      { userId: 'b', displayName: 'Ben', playerState: 'active', tribeId: 't1', redraftRosterId: 'r-b' },
      { userId: 'c', displayName: 'Cy', playerState: 'active', tribeId: 't2', redraftRosterId: 'r-c' },
      { userId: 'd', displayName: 'Di', playerState: 'active', tribeId: 't2', redraftRosterId: 'r-d' },
      { userId: 'x', displayName: 'Xan', playerState: 'eliminated', tribeId: null, redraftRosterId: 'r-x' },
    ],
    rosterPlayers: [
      { rosterId: 'r-a', team: 'KC' }, { rosterId: 'r-b', team: 'KC' }, { rosterId: 'r-c', team: 'BUF' },
      { rosterId: 'r-d', team: 'MIA' }, { rosterId: 'r-x', team: 'NYJ' },
    ],
    tribes: [{ id: 't1', name: 'Tala' }, { id: 't2', name: 'Moto' }],
  })
  vi.clearAllMocks()
})

describe('selection (pure)', () => {
  it('groups one fixture across providers and spellings, keeping the earliest kickoff and the preferred label', () => {
    const fixtures = groupFixtures(h.state.games, resolve, SOURCES)
    expect(fixtures).toHaveLength(2)
    const kc = fixtures.find(f => f.homeAbbr === 'KC')!
    expect(kc.kickoff.toISOString()).toBe(kcKick.toISOString())
    expect(kc.homeLabel).toBe('KC') // espn outranks thesportsdb
  })

  it('features the game with the most rostered players, tie-broken by kickoff, deterministically', () => {
    const fixtures = groupFixtures(h.state.games, resolve, SOURCES)
    const counts = new Map([['KC', 2], ['BUF', 1], ['MIA', 1]])
    const picked = selectFeaturedFixtures(fixtures, counts, opened)
    expect(picked.map(f => f.homeAbbr)).toEqual(['KC', 'MIA'])
    // Equal counts: the earlier kickoff leads.
    expect(selectFeaturedFixtures(fixtures, new Map([['KC', 1], ['MIA', 1]]), opened).map(f => f.homeAbbr)).toEqual(['MIA', 'KC'])
    // A second game with nobody rostered is not offered; a game about to start is never offered.
    expect(selectFeaturedFixtures(fixtures, new Map([['KC', 3]]), opened).map(f => f.homeAbbr)).toEqual(['KC'])
    expect(selectFeaturedFixtures(fixtures, counts, new Date(kcKick.getTime() - 30 * 60_000))).toEqual([])
    // Same inputs, same answer, whatever the row order.
    expect(selectFeaturedFixtures(groupFixtures([...h.state.games].reverse(), resolve, SOURCES), counts, opened).map(f => f.key))
      .toEqual(picked.map(f => f.key))
  })
})

describe('settlement rules (pure)', () => {
  const fixture = { homeAbbr: 'KC', awayAbbr: 'BUF', kickoff: kcKick }
  const after = (hours: number) => new Date(kcKick.getTime() + hours * HOUR)

  it('never settles before a final', () => {
    expect(classifyFixtureResult(fixture, [game({ status: 'in_progress', homeScore: 21, awayScore: 7 })], resolve, after(2)))
      .toEqual({ state: 'pending', reason: 'not_final' })
  })

  it('settles on two agreeing providers, matched by TEAM even when one swapped home and away', () => {
    const rows = [
      game({ status: 'final', homeScore: 27, awayScore: 24 }),
      game({ source: 'thesportsdb', status: 'FT', homeTeam: 'Buffalo Bills', awayTeam: 'Kansas City Chiefs', homeScore: 24, awayScore: 27 }),
    ]
    expect(classifyFixtureResult(fixture, rows, resolve, after(4))).toEqual({ state: 'final', winnerAbbr: 'KC', scores: { KC: 27, BUF: 24 }, sources: ['espn', 'thesportsdb'] })
  })

  it('waits on a single provider until the grace has passed, and holds (then voids) a conflict', () => {
    const one = [game({ status: 'final', homeScore: 20, awayScore: 23 })]
    expect(classifyFixtureResult(fixture, one, resolve, after(4)).state).toBe('pending')
    expect(classifyFixtureResult(fixture, one, resolve, new Date(kcKick.getTime() + SINGLE_SOURCE_GRACE_MS))).toMatchObject({ state: 'final', winnerAbbr: 'BUF' })
    const conflict = [...one, game({ source: 'thesportsdb', status: 'FT', homeScore: 23, awayScore: 20 })]
    expect(classifyFixtureResult(fixture, conflict, resolve, after(20))).toEqual({ state: 'pending', reason: 'conflicting_results' })
    expect(classifyFixtureResult(fixture, conflict, resolve, after(72))).toEqual({ state: 'void', reason: 'conflicting_results' })
  })

  it('reads a tie as a final with no winner', () => {
    const rows = [game({ status: 'final', homeScore: 20, awayScore: 20 }), game({ source: 'thesportsdb', status: 'FT', homeScore: 20, awayScore: 20 })]
    expect(classifyFixtureResult(fixture, rows, resolve, after(4))).toMatchObject({ state: 'final', winnerAbbr: null })
  })

  it('voids a cancelled game, a game postponed for a day, and a game with no final after three days', () => {
    expect(classifyFixtureResult(fixture, [game({ status: 'CANC' })], resolve, after(1))).toEqual({ state: 'void', reason: 'cancelled' })
    expect(classifyFixtureResult(fixture, [game({ status: 'postponed' })], resolve, after(3)).state).toBe('pending')
    expect(classifyFixtureResult(fixture, [game({ status: 'postponed' })], resolve, after(24))).toEqual({ state: 'void', reason: 'postponed' })
    expect(classifyFixtureResult(fixture, [game({ status: 'scheduled' })], resolve, after(72))).toEqual({ state: 'void', reason: 'no_final_result' })
  })

  it('tribe rule: the best SHARE of correct members wins, every member is paid, equal shares share', () => {
    const tribes = [{ id: 't1', name: 'Tala', memberUserIds: ['a', 'b'] }, { id: 't2', name: 'Moto', memberUserIds: ['c', 'd', 'e'] }]
    const active = new Set(['a', 'b', 'c', 'd'])
    const s = settleRealGamePicks({ answerAbbr: 'KC', picks: [{ userId: 'a', optionId: 'KC' }, { userId: 'c', optionId: 'KC' }, { userId: 'd', optionId: 'KC' }, { userId: 'b', optionId: 'BUF' }], tribes, activeUserIds: active })
    // Tala 1/2 vs Moto 2/3: Moto wins; 'e' left the game, so is not paid.
    expect(s.winnerTribeIds).toEqual(['t2'])
    expect(s.prizeUserIds).toEqual(['c', 'd'])
    const tied = settleRealGamePicks({ answerAbbr: 'KC', picks: [{ userId: 'a', optionId: 'KC' }, { userId: 'c', optionId: 'KC' }], tribes: [tribes[0]!, { id: 't2', name: 'Moto', memberUserIds: ['c', 'd'] }], activeUserIds: active })
    expect(tied.winnerTribeIds).toEqual(['t1', 't2'])
    expect(settleRealGamePicks({ answerAbbr: 'KC', picks: [{ userId: 'a', optionId: 'BUF' }], tribes, activeUserIds: active }).winnerTribeIds).toEqual([])
    // After the merge: everyone who called it, and only active castaways are paid.
    expect(settleRealGamePicks({ answerAbbr: 'KC', picks: [{ userId: 'a', optionId: 'KC' }, { userId: 'x', optionId: 'KC' }, { userId: 'b', optionId: 'BUF' }], tribes: null, activeUserIds: active }))
      .toMatchObject({ correctUserIds: ['a', 'x'], prizeUserIds: ['a'] })
  })

  it('pays only allowed prizes: FAAB (default $5, clamped) or none, never immunity', () => {
    expect(readRealGameSettings(null)).toEqual({ enabled: true, prize: { type: 'faab', amount: 5 } })
    expect(readRealGameSettings({ survivorRealGameChallenges: { prizeType: 'immunity' } }).prize).toEqual({ type: 'faab', amount: 5 })
    expect(readRealGameSettings({ survivorRealGameChallenges: { prizeType: 'tribe_immunity' } }).prize.type).toBe('faab')
    expect(readRealGameSettings({ survivorRealGameChallenges: { faabAmount: 500 } }).prize.amount).toBe(25)
    expect(readRealGameSettings({ survivorRealGameChallenges: { prizeType: 'none' } }).prize).toEqual({ type: 'none', amount: 0 })
    expect(readRealGameSettings({ survivorRealGameChallenges: { enabled: false } }).enabled).toBe(false)
  })

  it('speaks Spanish', () => {
    const copy = realGameChallengeCopy({ lang: 'es', sport: 'NHL', homeLabel: 'Boston Bruins', awayLabel: 'Toronto Maple Leafs', tribeScope: true, prize: { type: 'faab', amount: 5 } })
    expect(copy.title).toBe('¿Quién gana: Toronto Maple Leafs vs. Boston Bruins?')
    expect(copy.description).toContain('5 $ de FAAB')
    expect(copy.instructions).toContain('aplazado o cancelado se anula')
    const labels = { BOS: 'Boston Bruins', TOR: 'Toronto Maple Leafs' }
    const base = { lang: 'es' as const, labels, pickCount: 4, correctCount: 2, paidCount: 2, winnerTribeNames: ['Moto'], prize: { type: 'faab' as const, amount: 5 } }
    expect(realGameResultSummary({ ...base, outcome: { state: 'final', winnerAbbr: 'BOS', scores: { BOS: 4, TOR: 2 }, sources: ['espn'] } }))
      .toBe('Ganó Boston Bruins 4-2. 2 de 4 acertaron. Tribu ganadora: Moto. 2 náufragos ganan 5 $ de FAAB.')
    expect(realGameResultSummary({ ...base, outcome: { state: 'void', reason: 'postponed' } })).toBe('El partido fue aplazado: este reto se anula y no da premio.')
    expect(realGameResultSummary({ ...base, outcome: { state: 'final', winnerAbbr: null, scores: { BOS: 3, TOR: 3 }, sources: [] } })).toContain('empatado 3-3')
  })
})

describe('the real-game challenge, end to end', () => {
  const final = (kcScore: number, bufScore: number) => {
    h.state.games[0] = { ...h.state.games[0], status: 'final', homeScore: kcScore, awayScore: bufScore, fetchedAt: new Date(kcKick.getTime() + 4 * HOUR) }
    h.state.games[1] = { ...h.state.games[1], status: 'FT', homeScore: kcScore, awayScore: bufScore, fetchedAt: new Date(kcKick.getTime() + 4 * HOUR) }
  }

  it('opens once per week, locks at kickoff, settles from the final and pays FAAB through the effect engine, once', async () => {
    expect(await ensureRealGameChallenges('L1', 6, { sport: 'NFL', season: 2026, merged: false, now: opened })).toBe('created')
    expect(await ensureRealGameChallenges('L1', 6, { sport: 'NFL', season: 2026, merged: false, now: opened })).toBe('exists')
    expect(h.db.survivorChallenge.upsert).toHaveBeenCalledTimes(2)
    const [kc, mia] = h.state.challenges
    expect(kc).toMatchObject({ challengeNumber: 4, scope: 'tribe', title: 'Who wins: BUF vs. KC?', locksAt: kcKick, rewardType: 'faab', rewardAmount: 5 })
    expect(mia.challengeNumber).toBe(5)
    expect(kc.configJson.tribes).toEqual([{ id: 't1', name: 'Tala', memberUserIds: ['a', 'b'] }, { id: 't2', name: 'Moto', memberUserIds: ['c', 'd'] }])

    expect(await submitRealGamePick('L1', 'a', kc.id, 'KC', opened)).toMatchObject({ ok: true })
    expect(await submitRealGamePick('L1', 'b', kc.id, 'KC', opened)).toMatchObject({ ok: true })
    expect(await submitRealGamePick('L1', 'c', kc.id, 'BUF', opened)).toMatchObject({ ok: true })
    expect(await submitRealGamePick('L1', 'd', kc.id, 'NYJ', opened)).toMatchObject({ ok: false, status: 400 })
    expect(await submitRealGamePick('L1', 'x', kc.id, 'KC', opened)).toMatchObject({ ok: false, status: 403 })
    expect(await submitRealGamePick('L1', 'd', kc.id, 'KC', kcKick)).toMatchObject({ ok: false, status: 409 })

    // Locked, not final: nothing settles, and picks show as counts.
    expect(await settleRealGameChallenges('L1', new Date(kcKick.getTime() + 2 * HOUR))).toMatchObject({ settled: 0 })
    const locked = await loadRealGameBoard('L1', 'a', new Date(kcKick.getTime() + HOUR))
    expect(locked.current[0]!.options.map(o => o.picks)).toEqual([1, 2])

    final(31, 17)
    const now = new Date(kcKick.getTime() + 5 * HOUR)
    expect(await settleRealGameChallenges('L1', now)).toMatchObject({ settled: 1 })
    expect(h.rewards).toHaveBeenCalledTimes(1)
    expect(h.rewards).toHaveBeenCalledWith(kc.id, { rewards: [{ rewardType: 'faab', rosterId: 'r-a', amount: 5 }, { rewardType: 'faab', rosterId: 'r-b', amount: 5 }], source: 'real_game_pick' })
    expect(kc.status).toBe('complete')
    expect(kc.winnerTribeId).toBe('t1')
    expect(kc.resultSummary).toBe('KC won 31-17. 2 of 3 called it. Winning tribe: Tala. 2 castaways earn $5 FAAB.')
    expect(h.state.submissions.map(s => s.isCorrect)).toEqual([true, true, false])
    expect(h.state.audits.some(a => a.action === 'real_game_pick_result' && a.relatedEntityId === kc.id)).toBe(true)

    // Idempotent: a second tick pays nobody again.
    await settleRealGameChallenges('L1', now)
    expect(h.rewards).toHaveBeenCalledTimes(1)
    const board = await loadRealGameBoard('L1', 'a', now)
    expect(board.past.find(p => p.id === kc.id)).toMatchObject({ outcome: 'win', answer: { id: 'KC', label: 'KC' }, winners: ['Ava', 'Ben'] })
  })

  it('a loss pays the other side, after the merge individually', async () => {
    await ensureRealGameChallenges('L1', 6, { sport: 'NFL', season: 2026, merged: true, now: opened })
    const kc = h.state.challenges[0]
    expect(kc.scope).toBe('individual')
    await submitRealGamePick('L1', 'a', kc.id, 'KC', opened)
    await submitRealGamePick('L1', 'c', kc.id, 'BUF', opened)
    final(10, 13)
    await settleRealGameChallenges('L1', new Date(kcKick.getTime() + 5 * HOUR))
    expect(h.rewards).toHaveBeenCalledWith(kc.id, { rewards: [{ rewardType: 'faab', rosterId: 'r-c', amount: 5 }], source: 'real_game_pick' })
    expect(kc.winnerUserIds).toEqual(['c'])
  })

  it('a tie and a void pay nothing; a void marks no pick right or wrong', async () => {
    await ensureRealGameChallenges('L1', 6, { sport: 'NFL', season: 2026, merged: true, now: opened })
    const [kc, mia] = h.state.challenges
    await submitRealGamePick('L1', 'a', kc.id, 'KC', opened)
    await submitRealGamePick('L1', 'd', mia.id, 'MIA', opened)
    final(20, 20)
    h.state.games[2] = { ...h.state.games[2], status: 'CANC', fetchedAt: miaKick }
    expect(await settleRealGameChallenges('L1', new Date(kcKick.getTime() + 5 * HOUR))).toEqual({ settled: 1, voided: 1, pending: 0 })
    expect(h.rewards).not.toHaveBeenCalled()
    expect(kc.resultJson.outcome).toBe('tie')
    expect(mia.resultJson).toMatchObject({ outcome: 'void', voidReason: 'cancelled' })
    expect(mia.resultSummary).toBe('The game was cancelled: this challenge is void and pays nothing.')
    expect(h.state.submissions.every(s => s.isCorrect === null)).toBe(true)
  })

  it('posts in Spanish for a Spanish league, and stays off when the commissioner turns it off', async () => {
    h.state.language = 'es-MX'
    await ensureRealGameChallenges('L1', 6, { sport: 'NFL', season: 2026, merged: false, now: opened })
    expect(h.state.challenges[0].title).toBe('¿Quién gana: BUF vs. KC?')
    expect((await loadRealGameBoard('L1', 'a', opened)).lang).toBe('es')
    h.state.challenges.length = 0
    h.state.settings = { survivorRealGameChallenges: { enabled: false } }
    expect(await ensureRealGameChallenges('L1', 6, { sport: 'NFL', season: 2026, merged: false, now: opened })).toBe('disabled')
    h.state.settings = {}
    h.state.systemRun = false
    expect(await ensureRealGameChallenges('L1', 6, { sport: 'NFL', season: 2026, merged: false, now: opened })).toBe('disabled')
  })

  it('two runners settling at once pay once: the open → settling claim decides', async () => {
    await ensureRealGameChallenges('L1', 6, { sport: 'NFL', season: 2026, merged: true, now: opened })
    const kc = h.state.challenges[0]
    await submitRealGamePick('L1', 'a', kc.id, 'KC', opened)
    final(30, 3)
    const now = new Date(kcKick.getTime() + 5 * HOUR)
    await Promise.all([settleRealGameChallenges('L1', now), settleRealGameChallenges('L1', now)])
    expect(h.rewards).toHaveBeenCalledTimes(1)
  })

  it('a failed payout is recorded and never retried (no double pay)', async () => {
    await ensureRealGameChallenges('L1', 6, { sport: 'NFL', season: 2026, merged: true, now: opened })
    const kc = h.state.challenges[0]
    await submitRealGamePick('L1', 'a', kc.id, 'KC', opened)
    final(30, 3)
    h.rewards.mockRejectedValueOnce(new Error('db down'))
    const now = new Date(kcKick.getTime() + 5 * HOUR)
    await settleRealGameChallenges('L1', now)
    await settleRealGameChallenges('L1', now)
    expect(h.rewards).toHaveBeenCalledTimes(1)
    expect(kc).toMatchObject({ status: 'complete', winnerUserIds: [] })
    expect(kc.resultJson.rewardError).toBe('db down')
  })
})

describe('wiring', () => {
  it('the season runner opens and settles real-game challenges, best-effort', () => {
    const src = readFileSync(join(process.cwd(), 'lib/survivor/survivorPlannedSeasonRunner.ts'), 'utf8')
    expect(src).toMatch(/^\s*await ensureRealGameChallenges\(leagueId, week, \{[^\n]*\}\)\.catch\(/m)
    expect(src).toMatch(/^\s*await settleRealGameChallenges\(leagueId, now\)\.catch\(/m)
  })
})
