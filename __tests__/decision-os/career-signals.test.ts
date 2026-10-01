import { describe, expect, it } from 'vitest'
import {
  careerTitleStakeSignals,
  deriveCareerAttentionSignals,
  leagueSyncAttentionSignals,
  resolveStakeLeagueId,
} from '@/lib/decision-os/careerSignals'
import { composeDailyBrief } from '@/lib/decision-os/dailyBrief'
import type { LegacyStake } from '@/lib/core-app/careerMilestones'
import type { WireLeague } from '@/lib/core-app/careerWireModel'

const NOW = new Date('2026-10-04T18:00:00Z')

const wl = (over: Partial<WireLeague>): WireLeague => ({
  leagueId: 'L1',
  leagueName: 'Alpha',
  platform: 'sleeper',
  status: 'ok',
  lastReadAt: null,
  record: null,
  rank: null,
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
  ask: 'q',
  ringNumber: 3,
  ...over,
})

describe('leagueSyncAttentionSignals', () => {
  it('raises a medium signal for stale, never-read and gone leagues only', () => {
    const signals = leagueSyncAttentionSignals(
      [
        wl({ leagueId: 'a', status: 'attention' }),
        wl({ leagueId: 'b', status: 'never' }),
        wl({ leagueId: 'c', status: 'gone' }),
        wl({ leagueId: 'd', status: 'ok' }),
        wl({ leagueId: 'e', status: 'delayed' }),
        wl({ leagueId: 'f', status: 'paused' }),
        wl({ leagueId: 'g', status: 'native', platform: 'allfantasy' }),
      ],
      NOW,
    )
    expect(signals.map((s) => [s.leagueId, s.severity])).toEqual([
      ['a', 'medium'],
      ['b', 'medium'],
      ['c', 'medium'],
    ])
    expect(signals[0].id).toBe('league_sync_attention:a')
    expect(signals[2].recommendedAction).toMatch(/Remove the league or reconnect/)
  })

  it('never puts a league name in the signal', () => {
    const [s] = leagueSyncAttentionSignals([wl({ status: 'attention', leagueName: 'Secret Name' })], NOW)
    expect(JSON.stringify(s)).not.toContain('Secret Name')
  })
})

describe('resolveStakeLeagueId', () => {
  it('matches platform + name, then an unambiguous name', () => {
    expect(resolveStakeLeagueId(stake(), [wl({ leagueId: 'S', platform: 'sleeper' }), wl({ leagueId: 'E', platform: 'espn' })])).toBe('S')
    expect(resolveStakeLeagueId(stake({ platform: 'allfantasy' as LegacyStake['platform'] }), [wl({ leagueId: 'N', platform: 'manual' })])).toBe('N')
  })

  it('drops a stake it cannot place exactly, rather than guessing', () => {
    expect(resolveStakeLeagueId(stake(), [wl({ leagueId: 'X', leagueName: 'Bravo' })])).toBeNull()
    expect(
      resolveStakeLeagueId(stake({ platform: 'yahoo' as LegacyStake['platform'] }), [
        wl({ leagueId: 'S', platform: 'sleeper' }),
        wl({ leagueId: 'E', platform: 'espn' }),
      ]),
    ).toBeNull()
  })
})

describe('careerTitleStakeSignals + the Daily Brief', () => {
  it('is informational, so it never makes a league "need attention"', () => {
    const signals = careerTitleStakeSignals([stake()], [wl({})], NOW)
    expect(signals).toEqual([
      expect.objectContaining({
        id: 'career_title_stake:L1:3',
        type: 'career_title_stake',
        severity: 'informational',
        title: 'A title here would be ring #3',
        recommendedAction: null,
      }),
    ])
    const brief = composeDailyBrief({
      leaguesMonitored: 1,
      healthyLeagueCount: 1,
      draftsApproachingCount: 0,
      signals,
      leagueTrends: [],
      legacyLine: "Win Alpha and it's ring #3.",
    })
    expect(brief.isHealthy).toBe(true)
    expect(brief.legacyLine).toBe("Win Alpha and it's ring #3.")
  })

  it('ranks a stale league above a title stake', () => {
    const all = deriveCareerAttentionSignals({
      wireLeagues: [wl({ leagueId: 'L1', status: 'attention' })],
      stakes: [stake()],
      now: NOW,
    })
    const brief = composeDailyBrief({ leaguesMonitored: 1, healthyLeagueCount: 0, draftsApproachingCount: 0, signals: all, leagueTrends: [] })
    expect(brief.topPriorityItems.map((s) => s.type)).toEqual(['league_sync_attention', 'career_title_stake'])
    expect(brief.isHealthy).toBe(false)
    expect(brief.legacyLine).toBeNull()
  })
})
