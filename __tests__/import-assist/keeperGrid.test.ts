import { describe, expect, it } from 'vitest'
import { buildKeeperGrid, historyByPlayer, keeperChecklist } from '@/lib/import-assist/keeperGrid'
import { resolveKeeperRules } from '@/lib/keeper/keeperRules'
import type { KeeperCostRule, KeeperDraftPick } from '@/lib/keeper/importedKeeperCost'

const pick = (playerId: string, season: number, round: number, isKeeper = false): KeeperDraftPick => ({ playerId, season, round, isKeeper })
// 2026 draft, 12 rounds. p1 went R5; p2 was kept at R3 in 2025 and 2026; p3 went R1. p9 was drafted
// in 2025 only (dropped, then picked up), and p8 was never drafted.
const picks = [pick('p1', 2026, 5), pick('p2', 2025, 3, true), pick('p2', 2026, 3, true), pick('p3', 2026, 1), pick('p9', 2025, 7), pick('pX', 2026, 12)]
const notMeasured: KeeperCostRule = { rule: null, season: 2026, measured: 0, agreeing: 0, reason: 'none' }
const names = new Map([['p1', 'Puka'], ['p2', 'Bijan'], ['p3', 'Chase'], ['p8', 'Waiver Guy'], ['p9', 'Dropped Guy']])
const team = { teamId: 'r1', name: 'Gridiron Ghosts', playerIds: ['p1', 'p2', 'p3', 'p8', 'p9'] }
const rules = (over: Record<string, unknown> = {}) => resolveKeeperRules({ keeperCostSystem: 'round_based', keeperRoundPenalty: 1, keeperConflictRule: 'player_chooses', ...over })
const build = (over: Partial<Parameters<typeof buildKeeperGrid>[0]> = {}) =>
  buildKeeperGrid({ rules: rules(), picks, measured: notMeasured, teams: [team], names, waiverPickupsAllowed: true, maxYears: null, ...over })!

describe('historyByPlayer', () => {
  it('reads the latest draft and the unbroken run of keeper seasons', () => {
    const h = historyByPlayer(picks)
    expect(h.season).toBe(2026)
    expect(h.totalRounds).toBe(12)
    expect(h.last.get('p2')).toEqual({ round: 3, kept: true })
    expect(h.yearsKept.get('p2')).toBe(2)
    expect(h.last.has('p9')).toBe(false)
  })
  it('a gap breaks the run: kept 2024 and 2026 but drafted fresh in 2025 is one season kept', () => {
    const h = historyByPlayer([pick('q', 2024, 4, true), pick('q', 2025, 6, false), pick('q', 2026, 6, true)])
    expect(h.yearsKept.get('q')).toBe(1)
  })
})

describe('buildKeeperGrid', () => {
  it('prices every rostered player with the league’s rules', () => {
    const g = build()
    expect(g).toMatchObject({ draftSeason: 2027, basedOnSeason: 2026, totalRounds: 12 })
    const by = new Map(g.teams[0].players.map((p) => [p.name, p]))
    expect(by.get('Puka')).toMatchObject({ costRound: 4, basis: 'drafted' }) // one round earlier
    expect(by.get('Bijan')).toMatchObject({ costRound: 2, yearsKept: 2, keptThisSeason: true })
    expect(by.get('Chase')).toMatchObject({ costRound: 1 }) // nothing earlier than round 1
    // Not in the latest draft = picked up after it, whatever happened the year before.
    expect(by.get('Waiver Guy')).toMatchObject({ costRound: 12, basis: 'waiver' })
    expect(by.get('Dropped Guy')).toMatchObject({ costRound: 12, basis: 'waiver' })
    // Cheapest round first.
    expect(g.teams[0].players[0].costRound).toBe(12)
  })
  it('inflation adds a round per season already kept', () => {
    const g = build({ rules: rules({ keeperCostSystem: 'inflation', keeperRoundPenalty: 0, keeperInflationRate: 1 }) })
    expect(g.teams[0].players.find((p) => p.name === 'Bijan')!.costRound).toBe(1)
  })
  it('blocks what the league does not allow: max years, pickups, the round floor', () => {
    const g = build({ maxYears: 2, waiverPickupsAllowed: false, rules: rules({ settings: { keeper_min_cost_round: 2 } }) })
    const by = new Map(g.teams[0].players.map((p) => [p.name, p]))
    expect(by.get('Bijan')!.blocked).toMatch(/allows 2/)
    expect(by.get('Waiver Guy')!.blocked).toMatch(/does not allow pickups/)
    expect(by.get('Chase')!.blocked).toMatch(/earlier than this league allows/)
    expect(by.get('Puka')!.blocked).toBeNull()
  })
  it('warns when the league’s own drafts disagree with the rules set here', () => {
    const same: KeeperCostRule = { rule: 'same_round', season: 2026, measured: 8, agreeing: 7 }
    expect(build({ measured: same }).warnings.join(' ')).toMatch(/kept 7 of 8 keepers at the round they went.*1 round earlier/)
    expect(build({ measured: same, rules: rules({ keeperRoundPenalty: 0 }) }).warnings.join(' ')).not.toMatch(/kept 7 of 8/)
  })
  it('shows no rounds when keepers are not priced by round', () => {
    const g = build({ rules: rules({ keeperCostSystem: 'free' }) })
    expect(g.teams[0].players.every((p) => p.costRound == null)).toBe(true)
    expect(g.warnings[0]).toMatch(/cost nothing/)
  })
  it('null with no imported draft', () => {
    expect(buildKeeperGrid({ rules: rules(), picks: [], measured: notMeasured, teams: [team], names, waiverPickupsAllowed: true, maxYears: null })).toBeNull()
  })
})

describe('keeperChecklist', () => {
  it('platform steps and a cost list for league chat', () => {
    const c = keeperChecklist(build(), 'sleeper')
    expect(c.steps.join(' ')).toMatch(/Sleeper app/)
    expect(c.shareText).toMatch(/^2027 keeper costs/)
    expect(c.shareText).toMatch(/Gridiron Ghosts\n  Dropped Guy: Round 12 \(pickup\)\n  Waiver Guy: Round 12 \(pickup\)/)
    expect(c.shareText).toMatch(/Bijan: Round 2, kept 2x/)
  })
})
