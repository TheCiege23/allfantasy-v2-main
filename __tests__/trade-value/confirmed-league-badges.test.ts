import { describe, expect, it } from 'vitest'
import { snapshotFromLoaded } from '@/lib/trade-value-console/quick-badges'

const loaded = (settings: Record<string, unknown>, overrides: Record<string, unknown> = {}) => ({
  id: 'L', name: 'League', sport: 'NFL', leagueSize: 12,
  platformLeagueId: 'external', platform: 'sleeper',
  isDynasty: true, leagueType: 'dynasty', leagueVariant: 'keeper', bestBallMode: true,
  scoring: 'ppr', settings, waiverBudget: 100, taxiSlots: null, starters: ['QB', 'RB', 'WR'],
  ...overrides,
}) as never

describe('trade screen uses the confirmed league concept', () => {
  it('shows a confirmed Zombie identity and its proven dynasty base', () => {
    const snap = snapshotFromLoaded(loaded({ isDynasty: true, leagueTypeConfirmation: { type: 'zombie' } }))
    expect(snap).toMatchObject({ leagueType: 'zombie', isDynasty: true, bestBallMode: false })
    expect(snap.quickModeBadges).toEqual(expect.arrayContaining(['Zombie', 'Dynasty']))
    expect(snap.quickModeBadges).not.toContain('Keeper')
  })

  it('clears stale dynasty, keeper and Best Ball labels after redraft confirmation', () => {
    const snap = snapshotFromLoaded(loaded({ isDynasty: true, leagueTypeConfirmation: { type: 'redraft' } }))
    expect(snap).toMatchObject({ leagueType: 'redraft', isDynasty: false, bestBallMode: false })
    expect(snap.quickModeBadges).toContain('Redraft')
    for (const stale of ['Dynasty', 'Keeper', 'Best Ball']) expect(snap.quickModeBadges).not.toContain(stale)
  })

  it('retains the importer dynasty fact without a human confirmation', () => {
    expect(snapshotFromLoaded(loaded({})).isDynasty).toBe(true)
  })
})
