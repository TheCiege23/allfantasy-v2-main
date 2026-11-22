import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
const source = (p: string) => readFileSync(p, 'utf8')
const route = source('app/api/chat/chimmy/route.ts')
describe('portfolio route billing and scope boundaries', () => {
  it('prepares comparisons after authentication and before the single-league gate', () => {
    const at = route.indexOf('const portfolioTurn =')
    expect(at).toBeGreaterThan(route.indexOf('const verifiedAuth = await requireAgeConfirmedUser()'))
    expect(at).toBeLessThan(route.indexOf('const leagueGroundingRequired ='))
    expect(route).toContain('!portfolioReport && requiresLeagueGrounding(')
  })
  it('returns a blocked report before either token or allowance consumption', () => {
    const at = route.indexOf("if (portfolioReport?.status === 'blocked')")
    expect(at).toBeLessThan(route.indexOf('await takeChimmyPlanAllowance'))
    expect(at).toBeLessThan(route.indexOf('await spendService.spendTokensForRule'))
  })
  it('returns a ready report after spending and before model generation', () => {
    const at = route.indexOf('if (portfolioReport) {')
    expect(at).toBeGreaterThan(route.indexOf('let spendLedger:'))
    expect(at).toBeLessThan(route.indexOf('const chimmyToolLoopEnabled ='))
    expect(route.slice(at, at + 1100)).toContain('portfolioEnvelope(')
    expect(route.slice(at, at + 1100)).toContain('persistPortfolioAnswer(')
  })
  it('forwards validated reference state through the full-chat JSON adapter', () => {
    const adapter = source('app/api/chimmy/route.ts')
    expect(adapter).toContain("formData.append('portfolioState', JSON.stringify(payload.userContext.portfolioState))")
    expect(route).toContain("previous: readPortfolioState(formData.get('portfolioState'))")
  })
  it('keeps the same comparison card in both chat surfaces and restores evidence', () => {
    expect(source('components/core-app/comms/ChimmyPanel.tsx')).toContain('<ChimmyPortfolioCard')
    expect(source('components/chimmy/ChimmyMessageBubble.tsx')).toContain('<ChimmyPortfolioCard')
    expect(route).toContain('const portfolio = readPortfolioEvidence(source.portfolio)')
    expect(route).toContain('contextBlocked: (toolContext as { portfolioBlocked?: boolean }).portfolioBlocked')
  })
})
