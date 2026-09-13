import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')
const read = (relativePath: string) => readFileSync(resolve(root, relativePath), 'utf8')

describe('mobile trade access', () => {
  const coreShell = read('components/core-app/AfCoreShell.tsx')
  const leagueShell = read('app/league/[leagueId]/LeagueShell.tsx')
  const tradesTab = read('app/league/[leagueId]/tabs/TradesTab.tsx')

  it('pins Trades in the Core phone bottom bar', () => {
    expect(coreShell).toContain("const MOBILE_BAR_KEYS: CoreNavKey[] = ['home', 'my-team', 'trades', 'week', 'live']")
  })

  it('pins a direct Trades shortcut in the league phone navigation', () => {
    expect(leagueShell).toContain('data-testid="league-mobile-trades-shortcut"')
    expect(leagueShell).toContain("onClick={() => onTabChange('trades')}")
    expect(leagueShell).toContain('sm:hidden')
  })

  it('exposes season filtering and both first-season and current outcome grades', () => {
    expect(tradesTab).toContain('data-testid="league-trade-season-filter"')
    expect(tradesTab).toContain('you.initialGrade')
    expect(tradesTab).toContain('r.a.initialGrade')
    expect(tradesTab).toContain('groupTradeTimelineBySeason')
  })
})
