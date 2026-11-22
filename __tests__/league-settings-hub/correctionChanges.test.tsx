/**
 * Record Book → Stat Corrections: which players changed, before → after (2026-11-13).
 *
 * The per-player record is the stat-correction detector's stored review (a `sportsDataCache` row per
 * sealed week). This file pins the three layers: the merge onto weeks, the read (native + covered
 * sport only, this league's rows only, team names from the roster), and what the card shows.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { attachCorrectionChanges, type CorrectionChange } from '@/lib/league-settings-hub/recordBookModel'
import { loadCorrectionWeeks } from '@/lib/league-settings-hub/recordBookReads'
import { statCorrectionCacheKey } from '@/lib/stat-corrections/statCorrectionDetector'
import { LeagueSettingsHubView, type HubCallbacks, type HubViewData } from '@/components/league-settings/hub/LeagueSettingsHubView'
import { buildDraftGroups, buildGeneralGroups, buildNotificationGroups, buildTypeRuleGroups, buildWaiverGroups } from '@/lib/league-settings-hub/hubModel'

afterEach(cleanup)

const change = (player: string, delta: number, team = 'Blitz Brigade'): CorrectionChange => ({ player, position: 'WR', team, before: 10, after: 10 + delta, delta })

describe('attachCorrectionChanges', () => {
  it('puts each review on its week, biggest change first, and keeps a reviewed week the score rows missed', () => {
    const out = attachCorrectionChanges(
      [{ week: 1, final: true, rescoredAt: null }, { week: 2, final: false, rescoredAt: null }],
      [{ week: 2, changes: [change('Small', 0.5), change('Big', -3.2), change('Mid', 1.1)] }, { week: 3, changes: [] }],
    )
    expect(out.map((w) => w.week)).toEqual([1, 2, 3])
    expect(out[0]!.changes).toBeUndefined() // never checked
    expect(out[1]!.changes!.map((c) => c.player)).toEqual(['Big', 'Mid', 'Small'])
    expect(out[2]).toEqual({ week: 3, final: false, rescoredAt: null, changes: [] }) // checked, nothing moved
  })
})

/** Just the delegates loadCorrectionWeeks touches, with what each was asked recorded. */
function fakePrisma(opts: { platform: string; sport: string; reviews?: unknown[] }) {
  const calls: string[] = []
  const prisma = {
    league: { findUnique: vi.fn(async () => ({ platform: opts.platform, platformLeagueId: 'P1', season: 2026, sport: opts.sport })) },
    leaguePlayerWeeklyScore: { groupBy: vi.fn(async () => [{ week: 1, isFinalized: true, _count: { _all: 9 } }, { week: 2, isFinalized: false, _count: { _all: 9 } }]) },
    statReprocessLog: { findMany: vi.fn(async () => []) },
    redraftSeason: { findFirst: vi.fn(async () => { calls.push('season'); return { id: 'S1' } }) },
    sportsDataCache: {
      findMany: vi.fn(async (args: { where: { cacheKey: { startsWith: string } } }) => {
        calls.push(`cache:${args.where.cacheKey.startsWith}`)
        return (opts.reviews ?? []).map((data) => ({ data }))
      }),
    },
    redraftRoster: { findMany: vi.fn(async () => [{ id: 'r1', teamName: 'Blitz Brigade', ownerName: 'Zed' }, { id: 'r2', teamName: '  ', ownerName: 'Bo Ketch' }]) },
  }
  return { prisma: prisma as never, calls }
}

const review = (leagueId: string, week: number, changes: Array<{ rosterId: string; playerName: string; before: number; after: number }>) => ({
  seasonId: 'S1', leagueId, season: 2026, week, sealedAt: '2026-09-15T00:00:00Z', checkedAt: '2026-09-16T00:00:00Z',
  review: { changes: changes.map((c) => ({ ...c, playerId: c.playerName, position: 'RB', delta: Math.round((c.after - c.before) * 100) / 100 })), matchups: [] },
})

describe('loadCorrectionWeeks — the per-player read', () => {
  it('a native NFL league gets each checked week’s player changes, with team names and only its own rows', async () => {
    const { prisma, calls } = fakePrisma({
      platform: 'native', sport: 'NFL',
      reviews: [
        review('L1', 2, [{ rosterId: 'r1', playerName: 'J. Cook', before: 18.4, after: 21.4 }, { rosterId: 'r2', playerName: 'D. Moore', before: 9, after: 8.5 }]),
        review('OTHER', 2, [{ rosterId: 'r1', playerName: 'Not Mine', before: 1, after: 50 }]),
      ],
    })
    const out = await loadCorrectionWeeks(prisma, 'L1')
    expect(calls).toContain(`cache:${statCorrectionCacheKey('S1', 2).replace(/2$/, '')}`) // the detector's own key prefix
    const w2 = out!.weeks.find((w) => w.week === 2)!
    expect(w2.changes).toEqual([
      { player: 'J. Cook', position: 'RB', team: 'Blitz Brigade', before: 18.4, after: 21.4, delta: 3 },
      { player: 'D. Moore', position: 'RB', team: 'Bo Ketch', before: 9, after: 8.5, delta: -0.5 },
    ])
    expect(out!.weeks.find((w) => w.week === 1)!.changes).toBeUndefined()
  })

  it.each([['an imported league', 'sleeper', 'NFL'], ['a sport the check does not cover', 'native', 'SOCCER']])('%s never reads the reviews', async (_label, platform, sport) => {
    const { prisma, calls } = fakePrisma({ platform, sport, reviews: [review('L1', 2, [{ rosterId: 'r1', playerName: 'X', before: 1, after: 2 }])] })
    const out = await loadCorrectionWeeks(prisma, 'L1')
    expect(calls).toEqual([])
    expect(out!.weeks.every((w) => w.changes === undefined)).toBe(true)
  })
})

describe('the Stat Corrections card', () => {
  const cb = (): HubCallbacks => ({
    onToggleSetting: vi.fn(), onSaveTeamName: vi.fn(async () => null), onSaveNote: vi.fn(async () => null),
    onToggleNotification: vi.fn(), onToggleLeagueNotifications: vi.fn(), onToggleCoCommissioner: vi.fn(),
    onInviteCoOwner: vi.fn(async () => null), onOpenEditor: vi.fn(), onCopy: vi.fn(),
  })
  const view = (weeks: HubViewData['correctionWeeks']): HubViewData => {
    const p = { league: { teamCount: 12 }, settings: {}, settingsSnapshot: {} }
    return {
      leagueId: 'L1', kind: 'redraft', leagueName: 'Kingdom North', leagueAvatarUrl: null, sport: 'NFL', season: 2026, teamCount: 12, leagueArt: null,
      canEdit: false, isHeadCommissioner: false, importedFrom: null, myTeam: null,
      notifications: { groups: buildNotificationGroups('redraft', false), on: {}, leagueEnabled: true },
      general: buildGeneralGroups(p, 'redraft'), waivers: buildWaiverGroups(p, 'redraft'), typeRules: buildTypeRuleGroups(p, 'redraft'),
      commissionerNote: null, roster: [], scoring: null, draft: buildDraftGroups(p), draftOrder: [], members: [], coOwners: null,
      invite: null, draftHistory: null, seasons: [], standings: [], highScores: [], playerHighScores: { seasons: [], rows: [] },
      correctionWeeks: weeks,
    }
  }

  it('lists who changed, before → after, and the signed change', () => {
    render(<LeagueSettingsHubView data={view({ season: 2026, weeks: [{ week: 2, final: false, rescoredAt: null, changes: [change('J. Cook', 3), change('D. Moore', -0.5, 'Bo Ketch')] }] })} cb={cb()} initialTab="record" />)
    const list = screen.getByTestId('league-settings-hub-correction-changes')
    expect(within(list).getByText('J. Cook')).toBeTruthy()
    expect(within(list).getByText('Blitz Brigade · 10.00 → 13.00')).toBeTruthy()
    expect(within(list).getByText('+3.00')).toBeTruthy()
    expect(within(list).getByText('-0.50')).toBeTruthy()
  })

  it('says so when a checked week moved nobody, and shows nothing for a week never checked', () => {
    render(<LeagueSettingsHubView data={view({ season: 2026, weeks: [{ week: 1, final: true, rescoredAt: null }, { week: 2, final: false, rescoredAt: null, changes: [] }] })} cb={cb()} initialTab="record" />)
    expect(screen.getByText(/no player’s points changed/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    expect(screen.queryByTestId('league-settings-hub-correction-changes')).toBeNull()
  })

  it('shows the eight biggest and expands to all', () => {
    const many = Array.from({ length: 11 }, (_, i) => change(`P${i}`, 11 - i))
    render(<LeagueSettingsHubView data={view({ season: 2026, weeks: [{ week: 2, final: false, rescoredAt: null, changes: many }] })} cb={cb()} initialTab="record" />)
    const list = screen.getByTestId('league-settings-hub-correction-changes')
    expect(within(list).queryByText('P8')).toBeNull()
    fireEvent.click(within(list).getByRole('button', { name: 'Show all 11' }))
    expect(within(list).getByText('P10')).toBeTruthy()
  })
})
