/**
 * Commissioner Workspace tasks for the native commissioner tools
 * (lib/commissioner-workspace/commissionerFeatureTasks.ts): when each fires, when it steps aside, and
 * that it clears once the condition is gone.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  corrections: vi.fn(),
  inactive: vi.fn(),
  payouts: vi.fn(),
  rollover: vi.fn(),
  prisma: { redraftTradeProposal: { findMany: vi.fn() }, redraftRoster: { findMany: vi.fn() } },
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/stat-corrections/statCorrectionService', () => ({ readStatCorrections: m.corrections }))
vi.mock('@/lib/inactive-manager/inactiveManagerService', () => ({ readInactiveManagerView: m.inactive }))
vi.mock('@/lib/payouts/payoutService', () => ({ readPayoutOvercommitment: m.payouts }))
vi.mock('@/lib/season-rollover/rolloverService', () => ({ readRolloverDue: m.rollover }))

import {
  detectInactiveTeamsToManage,
  detectPayoutOvercommitment,
  detectRolloverDue,
  detectTradesInReview,
  detectUnappliedStatCorrection,
  readCommissionerFeatureTasks,
} from '@/lib/commissioner-workspace/commissionerFeatureTasks'

const NOW = new Date('2026-10-26T12:00:00Z')
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3600_000)
const correction = { season: 2026, week: 7, unapplied: 2, flipsResult: 0, autoApplied: false, refused: false }

describe('detectUnappliedStatCorrection', () => {
  it('fires while a correction is unapplied, and links to Score adjustments', () => {
    const t = detectUnappliedStatCorrection('L 1', correction)!
    expect(t.sourceKey).toBe('stat-correction:2026:7:v1')
    expect(t.title).toBe('Week 7 has a stat correction to apply')
    expect(t.priority).toBe('standard')
    expect(t.description).toMatch(/changing 2 matchups\. Results and standings stay as sealed/)
    expect(t.relatedLinks[0].href).toBe('/league/L%201?view=settings&settingsPanel=score-adjustments')
  })

  it('is elevated when a result would flip', () => {
    const t = detectUnappliedStatCorrection('L', { ...correction, flipsResult: 1 })!
    expect(t.priority).toBe('elevated')
    expect(t.title).toBe('A stat correction changes a week 7 result')
    expect(t.description).toMatch(/one result flips/)
  })

  it('steps aside once applied, where it can never be applied, and where AllFantasy applies it itself', () => {
    expect(detectUnappliedStatCorrection('L', null)).toBeNull()
    expect(detectUnappliedStatCorrection('L', { ...correction, unapplied: 0 })).toBeNull()
    expect(detectUnappliedStatCorrection('L', { ...correction, refused: true })).toBeNull()
    expect(detectUnappliedStatCorrection('L', { ...correction, autoApplied: true })).toBeNull()
  })
})

describe('detectTradesInReview', () => {
  it('one task per trade, due when its window ends; elevated inside the last day', () => {
    const tasks = detectTradesInReview('L', [
      { id: 't1', endsAt: hoursFromNow(30), teams: 'Aces and Bees' },
      { id: 't2', endsAt: hoursFromNow(5), teams: 'Cats and Dogs' },
    ], NOW)
    expect(tasks.map((t) => [t.sourceKey, t.priority])).toEqual([
      ['redraft-trade-review:t1:v1', 'standard'],
      ['redraft-trade-review:t2:v1', 'elevated'],
    ])
    expect(tasks[1].dueAt).toEqual(hoursFromNow(5))
    expect(tasks[1].description).toBe('Cats and Dogs: both managers accepted, and the trade goes through when its review window ends in 5 hours unless you veto it. You can also approve it now.')
    expect(tasks[0].relatedLinks[0].href).toBe('/core/trades?league=L')
  })

  it('drops a trade whose window has ended: it is going through, there is nothing left to decide', () => {
    expect(detectTradesInReview('L', [{ id: 't', endsAt: hoursFromNow(-1), teams: 'x' }], NOW)).toEqual([])
    expect(detectTradesInReview('L', [{ id: 't', endsAt: new Date(NOW.getTime() + 60_000), teams: 'x' }], NOW)[0].description).toMatch(/in under an hour/)
  })
})

describe('detectInactiveTeamsToManage', () => {
  it('one task for every suggested team, naming them, linking to the hub section', () => {
    const t = detectInactiveTeamsToManage('L', ['Aces', 'Bees', 'Cats'])!
    expect(t.title).toBe('3 inactive teams have nobody setting their lineups')
    expect(t.description).toMatch(/^Aces, Bees and Cats look inactive\./)
    expect(t.relatedLinks[0].href).toBe('/core/commissioner?league=L#ch-inactive-managers')
    expect(detectInactiveTeamsToManage('L', ['Aces'])!.title).toBe('An inactive team has nobody setting its lineup')
  })

  it('clears when no team is suggested (managed, or the manager came back)', () => {
    expect(detectInactiveTeamsToManage('L', [])).toBeNull()
  })
})

const matchup = (id: string, fullyApplied: boolean, resultFlipped = false) => ({ matchupId: id, fullyApplied, resultFlipped })

describe('detectPayoutOvercommitment', () => {
  it('fires when the weekly prizes come to more than the pot, and links to the payouts', () => {
    const t = detectPayoutOvercommitment('L 1', { potCents: 12_000, overCommittedCents: 3_050, season: 2026 })!
    expect(t.sourceKey).toBe('payout-overcommitted:2026:v1')
    expect(t.description).toMatch(/come to \$30\.50 more than the \$120 pot/)
    expect(t.relatedLinks[0].href).toBe('/core/standings?league=L%201')
    expect(t.automationCandidate).toBe(false)
  })

  it('clears once the pot covers them', () => {
    expect(detectPayoutOvercommitment('L', { potCents: 12_000, overCommittedCents: 0, season: 2026 })).toBeNull()
    expect(detectPayoutOvercommitment('L', null)).toBeNull()
  })
})

describe('detectRolloverDue', () => {
  it('fires once the season is over and unrenewed, and links to the wizard', () => {
    const t = detectRolloverDue('L 1', { season: 2026 })!
    expect(t.sourceKey).toBe('season-rollover:2026:v1')
    expect(t.title).toBe('Set up the 2027 season')
    expect(t.relatedLinks[0].href).toBe('/core/commissioner?league=L%201#ch-rollover')
    expect(t.automationCandidate).toBe(false)
    expect(detectRolloverDue('L', null)).toBeNull()
  })
  it('a dynasty league is walked through its own steps, and told its rosters carry over', () => {
    const t = detectRolloverDue('L', { season: 2026, kind: 'dynasty' })!
    expect(t.sourceKey).toBe('season-rollover:2026:v1')
    expect(t.description).toContain('rookie draft order')
    expect(t.description).toContain('Rosters carry over')
    expect(detectRolloverDue('L', { season: 2026, kind: 'redraft' })!.description).toContain('renews the league')
  })
})

describe('readCommissionerFeatureTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.payouts.mockResolvedValue(null)
    m.rollover.mockResolvedValue(null)
    m.corrections.mockResolvedValue({
      covered: true,
      extended: { enabled: false, available: false, refusal: null, windowDays: 6 },
      latest: { season: 2026, week: 7, changes: [{ rosterId: 'A' }], matchups: [matchup('m1', false, true), matchup('m2', true)] },
    })
    m.prisma.redraftTradeProposal.findMany.mockResolvedValue([{ id: 't1', expiresAt: hoursFromNow(10), proposerRosterId: 'A', receiverRosterId: 'B' }])
    m.prisma.redraftRoster.findMany.mockResolvedValue([{ id: 'A', teamName: 'Aces', ownerName: 'a' }, { id: 'B', teamName: ' ', ownerName: 'Bea' }])
    m.inactive.mockResolvedValue({
      native: true,
      teams: [
        { rosterId: 'A', teamName: 'Aces', managerName: 'a', suggested: false },
        { rosterId: 'C', teamName: null, managerName: 'Cy', suggested: true },
      ],
    })
  })

  it('reads all three and returns their tasks', async () => {
    const tasks = await readCommissionerFeatureTasks('L', NOW)
    expect(tasks.map((t) => t.sourceKey)).toEqual(['stat-correction:2026:7:v1', 'redraft-trade-review:t1:v1', 'inactive-manager-mode-suggestion:v1'])
    expect(tasks[0].priority).toBe('elevated')
    expect(tasks[1].description).toMatch(/^Aces and Bea: /)
    expect(tasks[2].description).toMatch(/^Cy looks inactive/)
  })

  it('asks only for commissioner-review trades that both managers accepted', async () => {
    await readCommissionerFeatureTasks('L', NOW)
    expect(m.prisma.redraftTradeProposal.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { leagueId: 'L', status: 'pending', vetoMode: 'commissioner', acceptedAt: { not: null }, expiresAt: { not: null } },
    }))
  })

  it('a review with no changes, an auto-applying league and a refused format file no correction task', async () => {
    m.corrections.mockResolvedValueOnce({ covered: true, latest: { season: 2026, week: 7, changes: [], matchups: [] } })
    expect((await readCommissionerFeatureTasks('L', NOW)).some((t) => t.sourceKey.startsWith('stat-correction'))).toBe(false)
    m.corrections.mockResolvedValueOnce({
      covered: true,
      extended: { enabled: true, available: true, refusal: null, windowDays: 14 },
      latest: { season: 2026, week: 7, changes: [{}], matchups: [matchup('m1', false)] },
    })
    expect((await readCommissionerFeatureTasks('L', NOW)).some((t) => t.sourceKey.startsWith('stat-correction'))).toBe(false)
    m.corrections.mockResolvedValueOnce({
      covered: true,
      extended: { enabled: false, available: false, refusal: 'elimination_format', windowDays: 6 },
      latest: { season: 2026, week: 7, changes: [{}], matchups: [matchup('m1', false)] },
    })
    expect((await readCommissionerFeatureTasks('L', NOW)).some((t) => t.sourceKey.startsWith('stat-correction'))).toBe(false)
  })

  it('files the payout task when the weekly prizes outrun the pot', async () => {
    m.payouts.mockResolvedValueOnce({ potCents: 10_000, overCommittedCents: 2_000, season: 2026 })
    expect((await readCommissionerFeatureTasks('L', NOW)).map((t) => t.sourceKey)).toContain('payout-overcommitted:2026:v1')
  })

  it('files the rollover task when the season is over and unrenewed', async () => {
    m.rollover.mockResolvedValueOnce({ season: 2026 })
    expect((await readCommissionerFeatureTasks('L', NOW)).map((t) => t.sourceKey)).toContain('season-rollover:2026:v1')
  })

  it('a failed payout read throws too', async () => {
    m.payouts.mockRejectedValueOnce(new Error('payouts down'))
    await expect(readCommissionerFeatureTasks('L', NOW)).rejects.toThrow('payouts down')
  })

  it('a failed read throws rather than returning nothing, so no open task is closed on a bad snapshot', async () => {
    m.prisma.redraftTradeProposal.findMany.mockRejectedValueOnce(new Error('db down'))
    await expect(readCommissionerFeatureTasks('L', NOW)).rejects.toThrow('db down')
  })
})
