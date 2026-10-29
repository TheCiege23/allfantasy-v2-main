/**
 * The per-slate game-day summary (lib/live/slateDigest.ts), which replaced an alert on every lead
 * change on 2026-10-11 — measured: 1,147 swing alerts to 41 managers in 14 days, 12.7% read, and 95
 * to one manager in one league in one day.
 *
 * Times are real NFL kickoffs on Sunday 2026-10-11 (Eastern = UTC-4): 1:00pm = 17:00Z,
 * 4:25pm = 20:25Z, Sunday night 8:20pm = 00:20Z on the 12th, Monday night 8:15pm = 00:15Z on the 13th.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/notification-engine', () => ({ ingestBatch: vi.fn() }))

import {
  closedNflSlate,
  digestLineFor,
  sendSlateDigests,
  slateDigestCopy,
  slateDigestStoredKey,
  type ClosedSlate,
  type DigestLeague,
  type DigestLine,
  type SlateGame,
} from '@/lib/live/slateDigest'
import { buildLeagueWeekState, type ScoreRow } from '@/lib/live/starterSwings'
import type { NotificationEvent } from '@/lib/notification-engine'

const at = (iso: string) => new Date(iso)
const game = (iso: string, status: string | null): SlateGame => ({ startTime: at(iso), status })

const SUNDAY = [
  game('2026-10-11T17:00:00Z', 'Final'),
  game('2026-10-11T17:00:00Z', 'Final'),
  game('2026-10-11T20:25:00Z', 'Final'),
  game('2026-10-12T00:20:00Z', 'Scheduled'),
]

describe('closedNflSlate', () => {
  it('stays open while any game that kicked off is still on', () => {
    const live = [game('2026-10-11T17:00:00Z', 'Final'), game('2026-10-11T20:25:00Z', 'In Progress')]
    expect(closedNflSlate(live, at('2026-10-11T22:00:00Z'))).toBeNull()
  })

  it('the early and late afternoon windows close as ONE slate, named by its last kickoff', () => {
    const slate = closedNflSlate(SUNDAY, at('2026-10-12T00:10:00Z'))
    expect(slate).toEqual({ key: '2026-10-11T1625', label: 'Sunday afternoon', weekComplete: false })
  })

  it('waits until the last kickoff is 3.5 hours old, so the points it reads have settled', () => {
    expect(closedNflSlate(SUNDAY, at('2026-10-11T23:40:00Z'))).toBeNull()
  })

  it('Monday night with nothing in the next 48 hours ends the week', () => {
    const mnf = [game('2026-10-13T00:15:00Z', 'Final'), game('2026-10-16T00:15:00Z', 'Scheduled')]
    expect(closedNflSlate(mnf, at('2026-10-13T04:00:00Z'))).toEqual({
      key: '2026-10-12T2015',
      label: 'Monday night',
      weekComplete: true,
    })
  })

  it('a game whose status never turned final, or a postponed one, cannot hold the slate open', () => {
    const stuck = [game('2026-10-11T17:00:00Z', 'In Progress'), game('2026-10-11T20:25:00Z', 'Final')]
    expect(closedNflSlate(stuck, at('2026-10-12T00:10:00Z'))).not.toBeNull()
    const postponed = [game('2026-10-11T17:00:00Z', 'Postponed'), game('2026-10-11T17:00:00Z', 'Final')]
    expect(closedNflSlate(postponed, at('2026-10-11T21:00:00Z'))).not.toBeNull()
  })

  /* The production shape, 2026-10-11: one game, five providers, and espn_live's copy last written
     before kickoff and still "scheduled" after the final. */
  it('🛑 a provider copy nobody updated since kickoff cannot hold the slate open', () => {
    const kick = '2026-10-11T20:25:00Z'
    const written = (iso: string) => at(iso)
    const copies: SlateGame[] = [
      { startTime: at(kick), status: 'final', updatedAt: written('2026-10-11T23:45:00Z') },
      { startTime: at(kick), status: 'final', updatedAt: written('2026-10-11T23:45:00Z') },
      { startTime: at(kick), status: 'scheduled', updatedAt: written('2026-10-08T05:45:00Z') },
    ]
    // 3h45m after kickoff: closed, not waiting for the five-hour backstop.
    expect(closedNflSlate(copies, at('2026-10-12T00:10:00Z'))).not.toBeNull()
    // …while a copy that IS following the game and says it is still on keeps it open.
    const stillOn = [...copies, { startTime: at(kick), status: 'In Progress', updatedAt: written('2026-10-12T00:05:00Z') }]
    expect(closedNflSlate(stillOn, at('2026-10-12T00:10:00Z'))).toBeNull()
  })

  it('nothing kicked off in the last eight hours: no slate', () => {
    expect(closedNflSlate(SUNDAY, at('2026-10-11T16:00:00Z'))).toBeNull()
    expect(closedNflSlate([], at('2026-10-11T22:00:00Z'))).toBeNull()
  })
})

const AFTERNOON: ClosedSlate = { key: '2026-10-11T1625', label: 'Sunday afternoon', weekComplete: false }
const FINAL: ClosedSlate = { key: '2026-10-12T2015', label: 'Monday night', weekComplete: true }
const h2h = (leagueName: string, you: number, opponent: number, pWin: number | null): DigestLine => ({
  kind: 'h2h',
  leagueId: `id-${leagueName}`,
  leagueName,
  you,
  opponent,
  pWin,
})

describe('slateDigestCopy', () => {
  it('one league: says where you stand, and opens that matchup', () => {
    const c = slateDigestCopy([h2h('Dynasty Gridiron', 88.4, 81, 0.63)], AFTERNOON, 6)!
    expect(c.title).toBe('After Sunday afternoon: you lead in Dynasty Gridiron')
    expect(c.body).toBe('Dynasty Gridiron: up 88.4–81.0, 63% to win.')
    expect(c.actionHref).toBe('/core/matchup?league=id-Dynasty%20Gridiron')
  })

  it('several leagues: one notification, closest games first', () => {
    const c = slateDigestCopy(
      [h2h('Blowout', 120, 60, 0.98), h2h('Coin Flip', 70, 72, 0.48), h2h('Close', 80, 75, 0.61)],
      AFTERNOON,
      6,
    )!
    expect(c.title).toBe('After Sunday afternoon: ahead in 2 of 3')
    expect(c.body).toBe(
      'Coin Flip: down 70.0–72.0, 48% to win. Close: up 80.0–75.0, 61% to win. Blowout: up 120.0–60.0, 98% to win.',
    )
    expect(c.actionHref).toBe('/core/live?sport=NFL')
  })

  it('the last slate of the week reads as the result, with no win chance', () => {
    const c = slateDigestCopy([h2h('B League', 90, 100, null), h2h('A League', 100, 90, null)], FINAL, 6)!
    expect(c.title).toBe('Week 6 final: won 1, lost 1')
    expect(c.body).toBe('A League: won 100.0–90.0. B League: lost 90.0–100.0.')
  })

  it('a Guilly league only appears when you are projected last', () => {
    const c = slateDigestCopy([{ kind: 'cut', leagueId: 'g', leagueName: 'Chopping Block', projectedFinish: 71.25 }], AFTERNOON, 6)!
    expect(c.title).toBe('After Sunday afternoon: projected last in Chopping Block')
    expect(c.body).toBe('Chopping Block: projected last (71.3 pts) — on the chopping block.')
  })

  it('caps the lines and says how many more', () => {
    const many = ['A', 'B', 'C', 'D', 'E', 'F'].map((n, i) => h2h(n, 50 + i, 50, 0.5))
    expect(slateDigestCopy(many, AFTERNOON, 6)!.body).toMatch(/\+2 more\.$/)
  })

  it('nothing to say: no notification', () => {
    expect(slateDigestCopy([], AFTERNOON, 6)).toBeNull()
  })
})

const row = (rosterId: number, playerId: string, points: number): ScoreRow => ({ rosterId, playerId, points, isStarter: true })
const PAIR = [
  { rosterId: '1', matchupId: 1 },
  { rosterId: '2', matchupId: 1 },
]
const P = new Map([['a', 10], ['b', 10]])

describe('digestLineFor', () => {
  it('0–0 means none of either side’s starters has played: no line', () => {
    const state = buildLeagueWeekState({ rows: [row(1, 'a', 0), row(2, 'b', 0)], pairing: PAIR, projectionByPlayer: P })
    expect(digestLineFor({ state, rosterId: '1', elimination: false, weekComplete: false, leagueId: 'L', leagueName: 'L' })).toBeNull()
  })

  it('a week that is over carries no win chance', () => {
    const state = buildLeagueWeekState({ rows: [row(1, 'a', 20), row(2, 'b', 5)], pairing: PAIR, projectionByPlayer: P })
    const line = digestLineFor({ state, rosterId: '1', elimination: false, weekComplete: true, leagueId: 'L', leagueName: 'L' })
    expect(line).toMatchObject({ kind: 'h2h', you: 20, opponent: 5, pWin: null })
  })
})

// ── The pass ──────────────────────────────────────────────────────────────────────────────

const LEAGUE = (id: string, name: string, platformLeagueId: string, teams: Array<[string, string | null]>): DigestLeague => ({
  id,
  name,
  platformLeagueId,
  settings: {},
  leagueType: 'redraft',
  leagueVariant: null,
  isDynasty: false,
  guillotineMode: false,
  teams: teams.map(([externalId, claimedByUserId]) => ({ externalId, claimedByUserId })),
})

function harness(over: { sent?: Set<string>; clock?: () => number; games?: SlateGame[] } = {}) {
  const ingest = vi.fn(async (_e: NotificationEvent[]) => undefined)
  const loadState = vi.fn(async ({ platformLeagueId }: { platformLeagueId: string }) =>
    buildLeagueWeekState({
      rows: platformLeagueId === 'SL1' ? [row(1, 'a', 80), row(2, 'b', 75)] : [row(1, 'a', 60), row(2, 'b', 90)],
      pairing: PAIR,
      projectionByPlayer: P,
    }),
  )
  const deps = {
    loadGames: async () => over.games ?? SUNDAY,
    loadLeagues: async () => [
      LEAGUE('lg-1', 'Dynasty Gridiron', 'SL1', [['1', 'you'], ['2', 'rival']]),
      LEAGUE('lg-2', 'Redraft', 'SL2', [['1', 'you'], ['2', null]]),
    ],
    currentWeek: async () => 6,
    loadState,
    alreadySent: async (keys: string[]) => new Set(keys.filter((k) => over.sent?.has(k))),
    ingest,
    clock: over.clock ?? (() => 0),
  }
  return { deps, ingest, loadState }
}
const NOW = at('2026-10-12T00:10:00Z')

describe('sendSlateDigests', () => {
  it('one notification per manager, covering every league they play, push + in-app only', async () => {
    const { deps, ingest } = harness()
    expect(await sendSlateDigests({ now: NOW, season: 2026 }, deps)).toBe(2)
    const events = ingest.mock.calls[0]![0]
    const you = events.find((e) => e.userIds[0] === 'you')!
    expect(you.title).toBe('After Sunday afternoon: ahead in 1 of 2')
    expect(you.skipChannels).toEqual({ email: true, sms: true })
    expect(you.meta).toMatchObject({ idempotencyKey: 'slate-digest:2026-10-11T1625', pushTag: 'slate-digest' })
    const rival = events.find((e) => e.userIds[0] === 'rival')!
    expect(rival.title).toBe('After Sunday afternoon: you trail in Dynasty Gridiron')
  })

  it('reads each platform league once, however many managers share it', async () => {
    const { deps, loadState } = harness()
    await sendSlateDigests({ now: NOW, season: 2026 }, deps)
    expect(loadState).toHaveBeenCalledTimes(2)
  })

  it('🛑 asked every two minutes, sent once: a manager who already has it is skipped before anything is built', async () => {
    const slate = closedNflSlate(SUNDAY, NOW)!
    const { deps, ingest, loadState } = harness({
      sent: new Set([slateDigestStoredKey(slate, 'you'), slateDigestStoredKey(slate, 'rival')]),
    })
    expect(await sendSlateDigests({ now: NOW, season: 2026 }, deps)).toBe(0)
    expect(ingest).not.toHaveBeenCalled()
    expect(loadState).not.toHaveBeenCalled()
  })

  it('the stored key is the one the dispatcher writes for this event', () => {
    const slate = closedNflSlate(SUNDAY, NOW)!
    expect(slateDigestStoredKey(slate, 'u1')).toBe('live_score_swing:slate-digest:2026-10-11T1625:u1')
  })

  it('does nothing at all while the slate is still on', async () => {
    const { deps, ingest, loadState } = harness()
    expect(await sendSlateDigests({ now: at('2026-10-11T22:00:00Z'), season: 2026 }, deps)).toBe(0)
    expect(loadState).not.toHaveBeenCalled()
    expect(ingest).not.toHaveBeenCalled()
  })

  it('out of time: a manager whose leagues were not all read waits for the next pass, rather than getting half a summary', async () => {
    let t = 0
    const { deps, ingest } = harness({ clock: () => (t++ < 2 ? 0 : 60_000) })
    await sendSlateDigests({ now: NOW, season: 2026 }, deps)
    const events = (ingest.mock.calls[0]?.[0] ?? []) as NotificationEvent[]
    expect(events.map((e) => e.userIds[0])).toEqual(['rival'])
  })

  it('never throws', async () => {
    const { deps } = harness()
    await expect(
      sendSlateDigests({ now: NOW, season: 2026 }, { ...deps, loadLeagues: async () => { throw new Error('db down') } }),
    ).resolves.toBe(0)
  })
})
