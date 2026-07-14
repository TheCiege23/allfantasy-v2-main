import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')
const nativeRoute = read('app/api/redraft/trade-proposals/route.ts')
const runtimeRoute = read('app/api/redraft/trade-runtime/route.ts')
const genericRoute = read('app/api/leagues/[leagueId]/trades/route.ts')
const runtime = read('lib/trade-runtime/resolveNflRedraftTradeRuntime.ts')
const settings = read('lib/league-trade-engine/tradeSettingsResolver.ts')

describe('server-enforced redraft trade governance', () => {
  it('rejects client governance fields on every public proposal path', () => {
    for (const source of [nativeRoute, runtimeRoute, genericRoute]) {
      expect(source).toContain('Trade governance is controlled by persisted league settings.')
    }
    expect(nativeRoute).toContain("'vetoMode', 'vetoThreshold', 'reviewWindow', 'tradeDeadline', 'maxAssets', 'processingMode', 'commissionerApproval', 'allowDraftPicks'")
  })

  it('resolves and returns persisted governance', () => {
    expect(settings).toContain("source: 'persisted_league_settings'")
    expect(settings).toContain('settingsVersion:')
    expect(settings).toContain('scoringVersion:')
    expect(nativeRoute).toContain('resolveLeagueTradeSettings(league)')
    expect(nativeRoute).toContain('governance,')
    expect(runtime).toContain('const vetoMode = governance.vetoMode')
    expect(runtime).toContain('const vetoThreshold = governance.vetoThreshold')
  })

  it('uses server week and blocks unsupported redraft assets', () => {
    expect(genericRoute).not.toContain('currentWeek: body.currentWeek')
    expect(nativeRoute).toContain("allowedAssetTypes = new Set(['player', 'draft_pick', 'faab'])")
    expect(nativeRoute).toContain('A player asset is not owned by the sending franchise.')
    expect(nativeRoute).toContain('A player asset is locked for the current scoring period.')
  })
})
