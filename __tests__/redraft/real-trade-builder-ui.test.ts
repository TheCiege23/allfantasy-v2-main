import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
}

const tradeCenterSrc = read('app/league/[leagueId]/tabs/redraft/TradeCenter.tsx')
const tradeModalSrc = read('app/league/[leagueId]/tabs/redraft/TradeCenterModal.tsx')
const redraftTabSrc = read('app/league/[leagueId]/tabs/RedraftTab.tsx')
const clientSrc = read('lib/redraft/client.ts')
const settlementSrc = read('lib/redraft/tradeSettlement.ts')
const voteRouteSrc = read('app/api/redraft/trade-votes/route.ts')

describe('redraft Trade Center rebuild — stepped flow contract', () => {
  it('hosts a stepped propose flow (partner -> assets -> review) in the shared AppModal', () => {
    expect(tradeModalSrc).toContain("from '@/components/ui/AppModal'")
    expect(tradeModalSrc).toContain('Propose a Trade')
    expect(tradeModalSrc).toContain("'partner'")
    expect(tradeModalSrc).toContain("'assets'")
    expect(tradeModalSrc).toContain("'review'")
    expect(tradeCenterSrc).toContain('trade-center-open')
    expect(tradeCenterSrc).toContain('<TradeCenterModal')
  })

  it('loads actual roster players for the active redraft week (no fabricated picks)', () => {
    expect(tradeModalSrc).toContain('fetchRedraftRoster')
    expect(redraftTabSrc).toContain('currentWeek={currentWeek}')
    // The rebuild removed the synthetic buildPickOptions fake-pick generator.
    expect(tradeCenterSrc).not.toContain('buildPickOptions')
    expect(tradeModalSrc).not.toContain('buildPickOptions')
  })

  it('sends real player + FAAB assets to the canonical proposal API', () => {
    expect(tradeModalSrc).toContain('createTradeProposal')
    expect(tradeModalSrc).toContain("assetType: 'player'")
    expect(tradeModalSrc).toContain("assetType: 'faab'")
    expect(clientSrc).toContain('export type RedraftTradeAssetInput')
  })

  it('gates the draft-pick note on the league setting, and says picks are not offered here', () => {
    // Picks were "reference-only" — recorded, never moved. Both validators now refuse them
    // (DRAFT_PICK_NOT_SETTLED), so the modal must not promise a pick will be recorded.
    expect(tradeModalSrc).toContain('settings?.draftPickTrading')
    expect(tradeModalSrc.toLowerCase()).not.toContain('reference-only')
    expect(tradeModalSrc).toContain('Trade Center')
  })

  it('settles accepted trades for real (players + FAAB) on the accept path', () => {
    expect(settlementSrc).toContain('redraftRosterPlayer.updateMany')
    expect(settlementSrc).toContain('faabBalance')
    expect(voteRouteSrc).toContain('settleRedraftTradeAssets')
  })

  it('surfaces league trade settings and a multi-team coming-soon affordance', () => {
    expect(tradeCenterSrc).toContain('trade-settings-summary')
    expect(tradeModalSrc).toContain('Multi-team')
  })

  it('does not expose dynasty value copy in the redraft builder', () => {
    expect(tradeCenterSrc.toLowerCase()).not.toContain('dynasty value')
    expect(tradeModalSrc.toLowerCase()).not.toContain('dynasty value')
  })
})
