import { describe, expect, it } from 'vitest'
import { buildCareerFeed, feedHref } from '@/lib/core-app/careerFeed'
import type { LegacyStake } from '@/lib/core-app/careerMilestones'
import type { CareerWireData, WireChange, WireLeague } from '@/lib/core-app/careerWireModel'
import { leagueSyncAttentionSignals } from '@/lib/decision-os/careerSignals'

const NOW = new Date('2026-10-04T18:00:00Z')

const wl = (over: Partial<WireLeague> = {}): WireLeague => ({
  leagueId: 'L1',
  leagueName: 'Alpha',
  platform: 'sleeper',
  status: 'ok',
  lastReadAt: null,
  record: null,
  rank: null,
  ...over,
})

const change = (over: Partial<WireChange> = {}): WireChange => ({
  leagueId: 'L1',
  leagueName: 'Alpha',
  wins: 3,
  losses: 1,
  ties: 0,
  won: 1,
  lost: 0,
  tied: 0,
  rank: 2,
  previousRank: 2,
  platform: 'sleeper',
  ask: 'In Alpha I went 1-0…',
  ...over,
})

const stake = (over: Partial<LegacyStake> = {}): LegacyStake => ({
  key: 'k',
  leagueName: 'Alpha',
  platform: 'sleeper',
  record: '3-1',
  title: 'Win Alpha',
  detail: 'Ring #3 of your career.',
  tone: 'title',
  ask: 'What would a title in Alpha mean?',
  ringNumber: 3,
  ...over,
})

const wire = (over: Partial<CareerWireData> = {}): CareerWireData => ({
  platforms: [],
  leagues: [wl()],
  changes: [],
  sinceAt: '2026-10-02T18:00:00Z',
  firstVisit: false,
  windowCapped: false,
  comparisonPending: false,
  ...over,
})

describe('buildCareerFeed', () => {
  it('is empty when nothing moved, nothing is broken and nothing is at stake', () => {
    expect(buildCareerFeed({ wire: wire(), stakes: [], now: NOW })).toEqual([])
  })

  it('sends a loss to My Team and a win to the next matchup, each with its Chimmy question', () => {
    const feed = buildCareerFeed({
      wire: wire({
        leagues: [wl(), wl({ leagueId: 'L2', leagueName: 'Beta', platform: 'yahoo' })],
        changes: [
          change(),
          change({ leagueId: 'L2', leagueName: 'Beta', platform: 'yahoo', won: 0, lost: 1, ask: 'beta?' }),
        ],
      }),
      stakes: [],
      now: NOW,
    })
    expect(feed.map((i) => [i.leagueId, i.tone, i.title, i.action.href, i.ask])).toEqual([
      ['L2', 'bad', 'Dropped 0-1', feedHref.myTeam('L2'), 'beta?'],
      ['L1', 'good', 'Won 1-0', feedHref.matchup('L1'), 'In Alpha I went 1-0…'],
    ])
    expect(feed[0].platform).toBe('Yahoo')
  })

  it('lets the standings move be the headline — a loss that still climbed is good news', () => {
    const [climb] = buildCareerFeed({
      wire: wire({ changes: [change({ won: 0, lost: 1, rank: 3, previousRank: 5 })] }),
      stakes: [],
      now: NOW,
    })
    expect(climb.tone).toBe('good')
    expect(climb.title).toBe('Climbed to #3')
    expect(climb.detail).toBe('Went 0-1, now 3-1, up to #3 (was #5)')

    const [slip] = buildCareerFeed({
      wire: wire({ changes: [change({ won: 1, lost: 0, rank: 4, previousRank: 2 })] }),
      stakes: [],
      now: NOW,
    })
    expect(slip.tone).toBe('bad')
    expect(slip.title).toBe('Slipped to #4')
    expect(slip.action.label).toBe('Set lineup')
  })

  it('drops a change with no games and no rank move', () => {
    expect(
      buildCareerFeed({ wire: wire({ changes: [change({ won: 0, lost: 0, tied: 0 })] }), stakes: [], now: NOW }),
    ).toEqual([])
  })

  it("uses Decision OS's own sync signal wording, links to Sync, and asks Chimmy nothing", () => {
    const leagues = [wl({ status: 'attention' }), wl({ leagueId: 'L2', leagueName: 'Beta', status: 'gone' })]
    const feed = buildCareerFeed({ wire: wire({ leagues }), stakes: [], now: NOW })
    const signals = leagueSyncAttentionSignals(leagues, NOW)

    expect(feed.map((i) => i.title)).toEqual(signals.map((s) => s.title))
    expect(feed.map((i) => i.detail)).toEqual(signals.map((s) => s.explanation))
    expect(feed.map((i) => [i.action.label, i.action.href, i.ask])).toEqual([
      ['Re-sync', feedHref.sync('L1'), null],
      ['Open Sync', feedHref.sync('L2'), null],
    ])
  })

  it('links a stake to its matchup, and drops one that does not resolve to exactly one league', () => {
    const leagues = [wl(), wl({ leagueId: 'L2', leagueName: 'Twin', platform: 'espn' }), wl({ leagueId: 'L3', leagueName: 'Twin', platform: 'yahoo' })]
    const feed = buildCareerFeed({
      wire: wire({ leagues }),
      stakes: [stake({ tone: 'streak', ringNumber: 4 }), stake({ leagueName: 'Twin', platform: 'mfl' })],
      now: NOW,
    })
    expect(feed).toHaveLength(1)
    expect(feed[0]).toMatchObject({
      kind: 'stake',
      leagueId: 'L1',
      title: 'A repeat would be ring #4',
      action: { label: 'Open matchup', href: feedHref.matchup('L1') },
      ask: 'What would a title in Alpha mean?',
    })
  })

  it('orders problems, then losses, then stakes, then good news — stable within each', () => {
    const feed = buildCareerFeed({
      wire: wire({
        leagues: [wl(), wl({ leagueId: 'L2', leagueName: 'Beta' }), wl({ leagueId: 'L3', leagueName: 'Gamma', status: 'never' })],
        changes: [
          change(),
          change({ leagueId: 'L2', leagueName: 'Beta', won: 0, lost: 1 }),
          change({ leagueId: 'L3', leagueName: 'Gamma', won: 1, lost: 0 }),
        ],
      }),
      stakes: [stake()],
      now: NOW,
    })
    expect(feed.map((i) => `${i.kind}:${i.leagueId}`)).toEqual([
      'sync:L3',
      'result:L2',
      'stake:L1',
      'result:L1',
      'result:L3',
    ])
  })

  it('encodes league ids into every href', () => {
    expect(feedHref.myTeam('a b/c')).toBe('/core/my-team?league=a%20b%2Fc')
  })
})
