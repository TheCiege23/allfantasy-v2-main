// @vitest-environment node
/**
 * The native-league result push (2026-10-02): "Week 4 final — you won", sent once per person per
 * week, from each person's own side of the game, to people only, for native leagues only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isNativeResultPushDisabled,
  nativeResultMessages,
  notifyNativeWeekResults,
  type NativeResultGame,
} from '@/lib/redraft/nativeResultNotify'

const game = (over: Partial<NativeResultGame> = {}): NativeResultGame => ({
  homeOwnerId: 'u-amy',
  homeTeam: 'Amy FC',
  homeScore: 131.54,
  awayOwnerId: 'u-ben',
  awayTeam: 'Ben United',
  awayScore: 99,
  ...over,
})

describe('nativeResultMessages', () => {
  it('🛑 each person hears their OWN side — the away manager is told they lost', () => {
    const out = nativeResultMessages({ games: [game()], people: new Set(['u-amy', 'u-ben']), leagueName: 'Home League', week: 4 })
    expect(out).toEqual([
      { userId: 'u-amy', title: 'Week 4 final — you won', body: 'Home League: you beat Ben United 131.5–99.0.' },
      { userId: 'u-ben', title: 'Week 4 final — you lost', body: 'Home League: you fell to Amy FC 99.0–131.5.' },
    ])
  })

  it('an open seat is not a person and is not notified', () => {
    const out = nativeResultMessages({
      games: [game({ awayOwnerId: 'open-slot-L-3' })],
      people: new Set(['u-amy']),
      leagueName: 'Home League',
      week: 4,
    })
    expect(out.map((m) => m.userId)).toEqual(['u-amy'])
  })

  it('a tie says so on both sides', () => {
    const out = nativeResultMessages({ games: [game({ awayScore: 131.54 })], people: new Set(['u-amy', 'u-ben']), leagueName: 'L', week: 2 })
    expect(out.map((m) => m.title)).toEqual(['Week 2 final — a tie', 'Week 2 final — a tie'])
    expect(out[0].body).toBe('L: you tied Ben United 131.5–131.5.')
  })
})

describe('isNativeResultPushDisabled', () => {
  it('is on unless NATIVE_RESULT_PUSH=off', () => {
    expect(isNativeResultPushDisabled({} as NodeJS.ProcessEnv)).toBe(false)
    expect(isNativeResultPushDisabled({ NATIVE_RESULT_PUSH: 'OFF ' } as unknown as NodeJS.ProcessEnv)).toBe(true)
  })
})

describe('notifyNativeWeekResults', () => {
  const h = {
    season: vi.fn(),
    matchups: vi.fn(),
    users: vi.fn(),
    existing: vi.fn(),
    dispatch: vi.fn(),
  }
  const prisma = {
    redraftSeason: { findUnique: h.season },
    redraftMatchup: { findMany: h.matchups },
    appUser: { findMany: h.users },
    platformNotification: { findMany: h.existing },
  } as any
  const row = (home: string, away: string, hs: number, as: number) => ({
    homeScore: hs,
    awayScore: as,
    homeRoster: { ownerId: home, teamName: `${home} team`, ownerName: home },
    awayRoster: { ownerId: away, teamName: `${away} team`, ownerName: away },
  })
  const run = () => notifyNativeWeekResults({ prisma, seasonId: 'S1', week: 4, env: {} as NodeJS.ProcessEnv, dispatch: h.dispatch })

  beforeEach(() => {
    for (const f of Object.values(h)) f.mockReset()
    h.season.mockResolvedValue({ leagueId: 'L1', league: { name: 'Home League', platform: 'allfantasy' } })
    h.matchups.mockResolvedValue([row('u-amy', 'u-ben', 120, 100)])
    h.users.mockResolvedValue([{ id: 'u-amy' }, { id: 'u-ben' }])
    h.existing.mockResolvedValue([])
    h.dispatch.mockResolvedValue(undefined)
  })

  it('reads only final, non-median games with an opponent, and pushes each person once', async () => {
    expect(await run()).toEqual({ targeted: 2, sent: 2, skipped: 0 })
    expect(h.matchups.mock.calls[0][0].where).toEqual({
      seasonId: 'S1',
      week: 4,
      status: 'final',
      isMedianMatchup: false,
      awayRosterId: { not: null },
    })
    expect(h.dispatch).toHaveBeenCalledTimes(2)
    expect(h.dispatch.mock.calls[0][0]).toMatchObject({
      userIds: ['u-amy'],
      category: 'matchup_results',
      title: 'Week 4 final — you won',
      actionHref: '/core/matchup?league=L1',
      dedupePrefix: 'native-result:S1:4',
      skipChannels: { email: true, sms: true },
      meta: { pushTag: 'native-result:L1:4' },
    })
  })

  it('🛑 a person already notified this week is not pushed again (the finalizer re-runs)', async () => {
    h.existing.mockResolvedValue([{ sourceKey: 'native-result:S1:4:u-amy' }])
    expect(await run()).toEqual({ targeted: 2, sent: 1, skipped: 1 })
    expect(h.dispatch.mock.calls.map((c) => c[0].userIds[0])).toEqual(['u-ben'])
  })

  it('a failed dedupe read sends NOTHING — a missed push beats a repeated one', async () => {
    h.existing.mockRejectedValue(new Error('db'))
    expect(await run()).toEqual({ targeted: 2, sent: 0, skipped: 2 })
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('an imported league is its provider’s to announce', async () => {
    h.season.mockResolvedValue({ leagueId: 'L1', league: { name: 'Sleeper League', platform: 'sleeper' } })
    expect(await run()).toEqual({ targeted: 0, sent: 0, skipped: 0 })
    expect(h.matchups).not.toHaveBeenCalled()
  })

  it('one failed dispatch does not cost the rest of the league theirs, and nothing throws', async () => {
    h.dispatch.mockRejectedValueOnce(new Error('push down'))
    expect(await run()).toEqual({ targeted: 2, sent: 1, skipped: 0 })
    h.season.mockRejectedValue(new Error('db down'))
    await expect(run()).resolves.toEqual({ targeted: 0, sent: 0, skipped: 0 })
  })

  it('the kill switch sends nothing and reads nothing', async () => {
    const out = await notifyNativeWeekResults({
      prisma,
      seasonId: 'S1',
      week: 4,
      env: { NATIVE_RESULT_PUSH: 'off' } as unknown as NodeJS.ProcessEnv,
      dispatch: h.dispatch,
    })
    expect(out).toEqual({ targeted: 0, sent: 0, skipped: 0 })
    expect(h.season).not.toHaveBeenCalled()
  })
})
