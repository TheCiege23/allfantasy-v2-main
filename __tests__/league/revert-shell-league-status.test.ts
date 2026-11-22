/**
 * The one-off that takes back the "in season" status the first status backfill wrote onto twelve empty
 * leagues. It resets a league only while it still looks exactly like what the backfill left behind.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { SHELL_LEAGUE_IDS, planShellStatusRevert, shellIdsFor, type ShellRow } from '../../scripts/revert-shell-league-status'

const shell = (id: string, over: Partial<ShellRow> = {}): ShellRow => ({
  id, name: id, platform: 'manual', leagueVariant: 'tournament_mode', status: 'in_season', lifecycleState: 'in_season', claimedTeams: 0, seasons: 0, ...over,
})

describe('the list', () => {
  it('names exactly twelve distinct leagues', () => {
    expect(SHELL_LEAGUE_IDS).toHaveLength(12)
    expect(new Set(SHELL_LEAGUE_IDS).size).toBe(12)
    for (const id of SHELL_LEAGUE_IDS) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})

describe('which leagues it runs over', () => {
  it('is the fixed twelve, on production and anywhere else', () => {
    expect(shellIdsFor(true, undefined)).toBe(SHELL_LEAGUE_IDS)
    expect(shellIdsFor(false, '')).toBe(SHELL_LEAGUE_IDS)
    expect(shellIdsFor(true, '  ,  ')).toBe(SHELL_LEAGUE_IDS)
  })
  it('a local test may name its own leagues', () => {
    expect(shellIdsFor(false, ' a , b ,')).toEqual(['a', 'b'])
  })
  it('🛑 against production an override is refused, not ignored and never obeyed', () => {
    expect(() => shellIdsFor(true, 'some-other-league')).toThrow(/refused against production/)
  })
})

describe('planShellStatusRevert', () => {
  it('resets a league that still looks like what the backfill left', () => {
    const plan = planShellStatusRevert(['a', 'b'], [shell('a'), shell('b', { leagueVariant: 'survivor_exile' })])
    expect(plan.reset.map((r) => r.id)).toEqual(['a', 'b'])
    expect(plan).toMatchObject({ alreadyReset: [], leftAlone: [], missing: [] })
  })

  it('🛑 leaves alone a league that has changed in any way, and says why', () => {
    const plan = planShellStatusRevert(
      ['claimed', 'season', 'moved', 'restatus', 'imported'],
      [
        shell('claimed', { claimedTeams: 2 }),
        shell('season', { seasons: 1 }),
        shell('moved', { lifecycleState: 'drafting' }),
        shell('restatus', { status: 'drafting', lifecycleState: 'drafting' }),
        shell('imported', { platform: 'sleeper' }),
      ],
    )
    expect(plan.reset).toEqual([])
    expect(plan.leftAlone.map((r) => [r.id, r.reason])).toEqual([
      ['claimed', '2 of its teams have been claimed'],
      ['season', 'it has a season'],
      ['moved', 'its phase is now "drafting", so it has moved since'],
      ['restatus', 'its status is now "drafting", not what the backfill wrote'],
      ['imported', 'it is an imported league'],
    ])
  })

  it('says "has" for one claimed team', () => {
    expect(planShellStatusRevert(['a'], [shell('a', { claimedTeams: 1 })]).leftAlone[0].reason).toBe('1 of its teams has been claimed')
  })

  it('a second run finds them already reset, and an id not in the database is reported, not guessed', () => {
    const plan = planShellStatusRevert(['done', 'gone'], [shell('done', { status: null })])
    expect(plan.reset).toEqual([])
    expect(plan.alreadyReset.map((r) => r.id)).toEqual(['done'])
    expect(plan.missing).toEqual(['gone'])
  })

  it('never looks past the list: a matching league that is not on it is not planned', () => {
    expect(planShellStatusRevert(['a'], [shell('a'), shell('not-listed')]).reset.map((r) => r.id)).toEqual(['a'])
  })
})
