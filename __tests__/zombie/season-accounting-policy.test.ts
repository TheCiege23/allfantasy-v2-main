import { describe, expect, it } from 'vitest'
import { planSeasonAccounting, planUltimatePot, prorateSeasonEntitlements, splitSeasonPot, type AccountingTeam } from '@/lib/zombie/seasonAccountingPlan'
import { tallyUniverseVote } from '@/lib/zombie/governancePolicy'
const teams = (roles = ['Survivor', 'Zombie', 'Whisperer', 'Survivor']): AccountingTeam[] => roles.map((role, i) => ({ rosterId: `r${i}`, role, points: 100 + i, weeklyCents: 0, stints: [{ userId: `u${i}`, startWeek: 1, endWeek: 18 }] }))
const plan = (field: AccountingTeam[], fundedCents = 10_000) => planSeasonAccounting({ teams: field, totalWeeks: 18, fundedCents, feeCents: 0, otherPrizeCents: 0, paid: true })
describe('2025 season accounting policy', () => {
  it('splits remaining dollars between Survivors and gives the residual dollar to higher season points', () => {
    const field = teams(['Survivor', 'Survivor', 'Survivor', 'Zombie'])
    expect(plan(field).seasonByRoster).toEqual({ r0: 3300, r1: 3300, r2: 3400, r3: 0 })
  })
  it('allocates one third to the Whisperer when only the Horde remains', () => {
    const p = plan(teams(['Whisperer', 'Zombie', 'Zombie', 'Zombie']))
    expect(p.seasonByRoster.r0).toBe(3333); expect(p.allocatedCents).toBe(10_000)
    expect(Object.values(p.seasonByRoster).reduce((n, a) => n + a, 0)).toBe(10_000)
  })
  it('splits the whole residual pot when everyone is a Zombie', () => {
    expect(plan(teams(['Zombie', 'Zombie', 'Zombie', 'Zombie'])).seasonByRoster).toEqual({ r0: 2500, r1: 2500, r2: 2500, r3: 2500 })
  })
  it('reserves weekly winnings, fees and separately recorded prizes before the season split', () => {
    const field = teams(); field[0].weeklyCents = 600
    const p = planSeasonAccounting({ teams: field, totalWeeks: 18, fundedCents: 10_000, feeCents: 1000, otherPrizeCents: 400, paid: true })
    expect(p.seasonPoolCents).toBe(8000); expect(p.allocatedCents).toBe(8600)
  })
  it('prorates departed and replacement owners by weeks managed and marks late entry for Gamma', () => {
    const field = teams(['Survivor', 'Zombie', 'Zombie', 'Zombie'])
    field[0].stints = [{ userId: 'old', startWeek: 1, endWeek: 9 }, { userId: 'new', startWeek: 10, endWeek: 18 }]
    const p = plan(field, 18_000)
    expect(p.owners.find(o => o.userId === 'old')).toMatchObject({ amountCents: 9000, mustStartGamma: false })
    expect(p.owners.find(o => o.userId === 'new')).toMatchObject({ amountCents: 9000, mustStartGamma: true })
  })
  it('redistributes an uncovered ownership portion to other teams and conserves every cent', () => {
    const field = teams(['Survivor', 'Zombie', 'Zombie', 'Zombie']); field[0].stints[0].endWeek = 9
    const p = plan(field, 18_001)
    expect(p.owners.find(o => o.userId === 'u0')?.amountCents).toBe(9000)
    expect(p.owners.reduce((n, r) => n + r.amountCents, 0)).toBe(18_001)
    expect(p.redistributedByRoster.r0).toBe(0)
  })
  it.each([0, 1, 99, 100, 101, 10_001, 999_999])('conserves a pot of %i cents', n => {
    const shares = splitSeasonPot(n, teams()); expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBe(n)
  })
  it('does not generate cash in a free league', () => {
    const p = planSeasonAccounting({ teams: teams(), totalWeeks: 18, fundedCents: 0, feeCents: 0, otherPrizeCents: 0, paid: false })
    expect(p.allocatedCents).toBe(0); expect(p.paymentsAreExternal).toBe(true)
  })
  it('rejects an underfunded pot and overlapping ownership history', () => {
    const field = teams(); field[0].weeklyCents = 20_000; expect(() => plan(field)).toThrow('Funding')
    field[0].weeklyCents = 0; field[0].stints.push({ userId: 'other', startWeek: 9, endWeek: 18 }); expect(() => plan(field)).toThrow('Overlapping')
  })
  it('adds five dollars per Alpha member and carries the pot forward if nobody survives', () => {
    expect(planUltimatePot(10_000, teams(['Zombie', 'Zombie', 'Whisperer', 'Zombie']))).toMatchObject({ openingCents: 10_000, contributionsCents: 2000, closingCents: 12_000, awards: {} })
  })
  it('awards the accumulated Alpha pot only to Alpha survivors and resets its carryover', () => {
    const p = planUltimatePot(10_000, teams()); expect(p.awards).toEqual({ r0: 6000, r3: 6000 }); expect(p.closingCents).toBe(0)
  })
  it('prorates Ultimate awards using each Alpha league actual season length', () => {
    const field = teams(); field[0].stints = [{ userId: 'old', startWeek: 1, endWeek: 9 }, { userId: 'new', startWeek: 10, endWeek: 18 }]
    const result = prorateSeasonEntitlements(field.map(t => ({ ...t, totalWeeks: 18 })), { r0: 10_000 })
    expect(result.owners.find(o => o.userId === 'old')?.amountCents).toBe(5000)
    expect(result.owners.find(o => o.userId === 'new')?.amountCents).toBe(5000)
  })
})
describe('75 percent universe voting', () => {
  const electorate = ['a', 'b', 'c', 'd', 'e']
  it('excludes abstentions and uncast votes from the approved Yes/No denominator', () => {
    expect(tallyUniverseVote(electorate, [{ userId: 'a', choice: 'yes' }, { userId: 'b', choice: 'yes' }, { userId: 'c', choice: 'yes' }, { userId: 'd', choice: 'no' }, { userId: 'e', choice: 'abstain' }], 'votes_cast')).toMatchObject({ counted: 4, required: 3, passed: true })
  })
  it('does not pass an empty or abstention-only vote', () => {
    expect(tallyUniverseVote(electorate, [], 'votes_cast').passed).toBe(false)
    expect(tallyUniverseVote(electorate, [{ userId: 'a', choice: 'abstain' }], 'votes_cast').passed).toBe(false)
  })
  it('rejects duplicate voters and nonmembers', () => {
    expect(() => tallyUniverseVote(electorate, [{ userId: 'x', choice: 'yes' }], 'votes_cast')).toThrow()
    expect(() => tallyUniverseVote(electorate, [{ userId: 'a', choice: 'yes' }, { userId: 'a', choice: 'no' }], 'votes_cast')).toThrow()
  })
})
