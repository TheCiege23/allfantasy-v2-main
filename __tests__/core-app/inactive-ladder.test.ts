import { describe, expect, it } from 'vitest'
import {
  LADDER_DAYS,
  buildInactiveLadder,
  daysQuiet,
  ladderApplies,
  ladderCounts,
  ladderStep,
} from '@/lib/core-app/commissioner/inactiveLadder'
import { inactiveLadderMessages } from '@/lib/core-app/messages/inactiveLadder'

const NOW = new Date('2026-11-12T21:00:00Z')
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString()

describe('ladderStep', () => {
  it('climbs one rung per quiet week and needs nothing inside the first', () => {
    expect(ladderStep({ status: 'active', lastActionAt: ago(3) }, NOW)).toBeNull()
    expect(ladderStep({ status: 'active', lastActionAt: ago(LADDER_DAYS.nudge) }, NOW)).toBe('nudge')
    expect(ladderStep({ status: 'inactive', lastActionAt: ago(LADDER_DAYS.warn) }, NOW)).toBe('warn')
    expect(ladderStep({ status: 'inactive', lastActionAt: ago(LADDER_DAYS.replace) }, NOW)).toBe('replace')
    expect(ladderStep({ status: 'inactive', lastActionAt: ago(60) }, NOW)).toBe('replace')
  })

  it('puts an inactive manager with no move on file on the top rung, and never guesses on unknown', () => {
    expect(ladderStep({ status: 'inactive', lastActionAt: null }, NOW)).toBe('replace')
    expect(ladderStep({ status: 'active', lastActionAt: null }, NOW)).toBeNull()
    // `unknown` means the read could not judge them — a warning on a guess is worse than none.
    expect(ladderStep({ status: 'unknown', lastActionAt: ago(40) }, NOW)).toBeNull()
  })

  it('treats an unreadable stamp as no stamp rather than as day zero', () => {
    expect(daysQuiet('not a date', NOW)).toBeNull()
    expect(daysQuiet(ago(9), NOW)).toBe(9)
  })
})

describe('ladderApplies', () => {
  it('skips leagues where a quiet manager is normal', () => {
    expect(ladderApplies({ lifecycleState: 'in_season' })).toBe(true)
    expect(ladderApplies({ status: 'in_season', lifecycleState: null })).toBe(true)
    expect(ladderApplies({ lifecycleState: 'pre_draft' })).toBe(false)
    expect(ladderApplies({ status: 'complete' })).toBe(false)
    expect(ladderApplies({ lifecycleState: 'ARCHIVED' })).toBe(false)
  })
})

describe('buildInactiveLadder', () => {
  const leagues = [
    {
      leagueId: 'A',
      leagueName: 'Alpha',
      hubHref: '/hub/A',
      replaceHref: '/replace/A',
      managers: [
        { name: 'Ann', status: 'active' as const, lastActionAt: ago(2) },
        { name: 'Ben', status: 'active' as const, lastActionAt: ago(8) },
        { name: 'Cy', status: 'inactive' as const, lastActionAt: null },
      ],
    },
    {
      leagueId: 'B',
      leagueName: 'Bravo',
      hubHref: '/hub/B',
      replaceHref: '/replace/B',
      managers: [
        { name: 'Dee', status: 'inactive' as const, lastActionAt: ago(16) },
        { name: 'Eve', status: 'inactive' as const, lastActionAt: ago(30) },
      ],
    },
  ]

  it('orders worst rung first, longest quiet first, with no move on file the longest of all', () => {
    const ladder = buildInactiveLadder(leagues, NOW)
    expect(ladder.map((e) => `${e.step}:${e.manager}`)).toEqual(['replace:Cy', 'replace:Eve', 'warn:Dee', 'nudge:Ben'])
    expect(ladderCounts(ladder)).toEqual({ replace: 2, warn: 1, nudge: 1 })
  })

  it('links a replacement to the replace workflow and everything else to the league', () => {
    const ladder = buildInactiveLadder(leagues, NOW)
    expect(ladder.find((e) => e.manager === 'Eve')!.href).toBe('/replace/B')
    expect(ladder.find((e) => e.manager === 'Dee')!.href).toBe('/hub/B')
    expect(ladder.find((e) => e.manager === 'Cy')!.daysQuiet).toBeNull()
  })
})

describe('ladder messages', () => {
  const { en, es } = inactiveLadderMessages
  it('names the manager and league, and never invents a day count it does not have', () => {
    const warn = en.messageWarn({ manager: 'Dee', league: 'Bravo', days: 16 })
    expect(warn).toContain('Dee')
    expect(warn).toContain('Bravo')
    expect(warn).toContain('16 days')
    expect(en.messageReplace({ manager: 'Cy', league: 'Alpha', days: null })).toContain('several weeks')
    expect(en.quiet(null)).toBe('no move on file')
    expect(es.messageReplace!({ manager: 'Cy', league: 'Alpha', days: null })).toContain('varias semanas')
  })

  it('never mentions AllFantasy — these are the commissioner’s words', () => {
    for (const lang of [en, es]) {
      for (const fn of [lang.messageNudge!, lang.messageWarn!, lang.messageReplace!]) {
        expect(fn({ manager: 'M', league: 'L', days: 9 })).not.toMatch(/allfantasy/i)
      }
    }
  })
})
