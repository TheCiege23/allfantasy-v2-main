import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('trade visibility contract', () => {
  it('uses the reconciled completed ledger on the league API', () => {
    const route = read('app/api/league/trade-grades/route.ts')
    expect(route).toContain('getReconciledTradeGrades')
    expect(route).not.toMatch(/getTradeGrades\(league\.platformLeagueId\)/)
  })

  it('bypasses client caches and reloads pending plus completed after decisions', () => {
    const tab = read('app/league/[leagueId]/tabs/TradesTab.tsx')
    expect(tab.match(/cache: 'no-store'/g)?.length).toBeGreaterThanOrEqual(2)
    expect(tab.match(/Promise\.all\(\[load\(\), loadLedger\(\)\]\)/g)?.length).toBeGreaterThanOrEqual(2)
    expect(tab).toContain("window.addEventListener('focus', refresh)")
    expect(tab).toContain("document.addEventListener('visibilitychange', onVisibility)")
  })

  it('reconciles the core latest-trades feed and requests league-specific reasons', () => {
    const page = read('app/core/[[...screen]]/page.tsx')
    const leagueHome = read('lib/core-app/leagueHome.ts')
    for (const source of [page, leagueHome]) {
      expect(source).toContain('reconcileLive: true')
      expect(source).toContain('enrichLeagueContext: true')
    }
  })

  it('uses the saved AfLeagueTrade id across notifications, league cards, and Core cards', () => {
    const service = read('lib/league-trade-engine/tradeService.ts')
    const notifications = read('lib/notification-engine.ts')
    const panel = read('app/api/league/trades-panel/route.ts')
    const core = read('lib/core-app/recentTrades.ts')
    const mobileAndDesktop = read('app/league/[leagueId]/tabs/TradesTab.tsx')

    expect(service).toContain('tradeId: trade.id')
    expect(service).toContain('newTradeId: trade.id')
    expect(notifications).toContain('tradeId=${encodeURIComponent(opts.tradeId)}')
    expect(panel).toContain('id: t.id')
    expect(core).toContain('id: row.id')
    // One responsive card component serves both mobile and desktop, so neither can drift to a second id.
    expect(mobileAndDesktop).toContain('key={t.id}')
    expect(mobileAndDesktop).toContain("runTradeAction(t.id, 'accept')")
  })
})
