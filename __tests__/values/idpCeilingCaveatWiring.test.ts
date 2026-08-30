import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The IDP ceiling caveat reaching an actual manager.
 *
 * 🛑 THE FAILURE THIS EXISTS FOR IS ALREADY IN THIS REPO, TWICE OVER.
 *
 * `components/idp/IdpTradeLineupWarning.tsx` has zero importers — a component built to display
 * `idpLineupWarning` that nothing renders. The field itself is fine (the evaluator page picks it
 * up in `buildWarnings`), so the dead thing is the component, not the wiring. I initially
 * reported the opposite, having grepped for the component name rather than the field. Both
 * halves have to be checked, and only a source assertion sees either: a component test passes
 * perfectly well on a component nobody imports, and an API test passes on a field nobody reads.
 *
 * So these assert the CHAIN — route builds it, page types it, page maps it, page renders it.
 * Break any link and the caveat silently stops reaching anyone while every other test stays green.
 */
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8').replace(/\r/g, '')
const ROUTE = read('app/api/trade-evaluator/route.ts')
const PAGE = read('app/trade-evaluator/page.tsx')

describe('the route emits the caveat', () => {
  it('computes it from the already-priced assets', () => {
    expect(ROUTE).toContain('idpCeilingCompositeBand(')
    expect(ROUTE).toContain('senderReceivedAssetsList')
  })

  /**
   * ⚠ FAAB IS PART OF A SIDE AND MUST BE PASSED. Leaving it out overstates how much of a side
   * the ceiling moves, over-reporting the caveat on exactly the trades where cash is balancing.
   */
  it('passes FAAB as the constant offset', () => {
    expect(ROUTE).toMatch(/gives_faab[\s\S]{0,120}gives_faab/)
    expect(ROUTE).toMatch(/idpCeilingCompositeBand\([\s\S]{0,200}received:[\s\S]{0,60}gives_faab/)
  })

  /** 🛑 THE GATE. Without it every IDP trade nags, and a caveat that always fires is ignored. */
  it('fires only when the band flips who wins', () => {
    expect(ROUTE).toContain('flipsWinner')
    expect(ROUTE).toMatch(/const flipsWinner = lo < 50 && hi > 50/)
    expect(ROUTE).toMatch(/if \(flipsWinner\) \{/)
  })

  it('returns it inside tradeInsights, where the page reads its siblings', () => {
    const insights = ROUTE.indexOf('const tradeInsights = {')
    const field = ROUTE.indexOf('...(idpCeilingCaveat && { idpCeilingCaveat })')
    expect(insights).toBeGreaterThan(-1)
    expect(field).toBeGreaterThan(insights)
  })
})

describe('the page consumes and renders it', () => {
  it('declares the shape on the API response', () => {
    expect(PAGE).toMatch(/idpCeilingCaveat\?: IdpCeilingCaveat \| null/)
  })

  it('maps it onto the result the view reads', () => {
    expect(PAGE).toContain('idpCeilingCaveat: payload.tradeInsights?.idpCeilingCaveat ?? null')
  })

  /** 🛑 THE ASSERTION THAT CATCHES THE DEAD-COMPONENT CLASS OF BUG. */
  it('actually renders it', () => {
    expect(PAGE).toContain('result.idpCeilingCaveat')
    expect(PAGE).toContain('data-testid="idp-ceiling-caveat"')
    expect(PAGE).toContain('{result.idpCeilingCaveat.note}')
  })

  it('renders nothing when there is no caveat', () => {
    expect(PAGE).toMatch(/\{result\.idpCeilingCaveat \? \([\s\S]*?\) : null\}/)
  })

  it('shows the range, so the manager sees how far it moves', () => {
    expect(PAGE).toContain('lowFairness')
    expect(PAGE).toContain('highFairness')
  })

  /**
   * 🛑 IT MUST NOT JOIN THE RED WARNINGS LIST. `buildWarnings` collects veto reasons, expert
   * flags and risk flags — things wrong with the TRADE. This says the trade is close and our
   * own unmeasured exchange rate is what decided it, which is a statement about US. Filing it
   * as a red warning would tell a manager their opponent is offering something dangerous.
   */
  it('is kept out of the red warnings list', () => {
    const build = PAGE.slice(PAGE.indexOf('function buildWarnings'))
    const body = build.slice(0, build.indexOf('}'))
    expect(body).not.toContain('idpCeilingCaveat')
  })

  /** The verdict is what it qualifies, so it has to sit with the verdict rather than below. */
  it('sits between the verdict badge and the score cards', () => {
    const badge = PAGE.indexOf('<ResultBadge verdict={result.verdict} />')
    const caveat = PAGE.indexOf('data-testid="idp-ceiling-caveat"')
    const scores = PAGE.indexOf('Score Cards')
    expect(badge).toBeGreaterThan(-1)
    expect(caveat).toBeGreaterThan(badge)
    expect(caveat).toBeLessThan(scores)
  })
})
