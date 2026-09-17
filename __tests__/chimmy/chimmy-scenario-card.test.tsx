/**
 * The trade-scenario card on the /core Chimmy drawer (Chimmy item 8).
 *
 * Two halves, for the reason `chimmy-evidence-core-drawer.test.tsx` records: the component renders
 * what it is given, AND the drawer actually reads `meta.scenario` off the envelope. A component
 * test alone passes with the wiring deleted.
 */
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ChimmyScenarioCard } from '@/components/core-app/comms/ChimmyScenario'
import { ChimmyEvidenceBlock, type ChimmyEvidence } from '@/components/core-app/comms/ChimmyEvidence'
import type { ReadyTradeScenario } from '@/lib/chimmy/tradeScenarioTypes'
import { fireEvent } from '@testing-library/react'

function scenario(over: Partial<ReadyTradeScenario> = {}): ReadyTradeScenario {
  return {
    status: 'ready',
    give: [{ playerId: 'p1', name: 'Bijan Robinson', position: 'RB' }],
    get: [{ playerId: 'p2', name: 'Puka Nacua', position: 'WR' }],
    partnerTeamName: 'Rival',
    value: { given: 8450, received: 7900, delta: -550, grade: 'C+', coveragePct: 100, coverageStatus: 'complete' },
    lineup: { before: 118.4, after: 120.1, delta: 1.7, unit: 'projected_points_per_game' },
    lineupUnavailable: null,
    playoffOdds: { available: false, reason: 'not computed' },
    ...over,
  }
}

const row = (name: string) => screen.getByRole('row', { name: new RegExp(name, 'i') })

describe('the scenario card', () => {
  it('names both sides and the partner', () => {
    render(<ChimmyScenarioCard scenario={scenario()} />)
    const card = screen.getByTestId('chimmy-scenario')
    expect(card.textContent).toContain('with Rival')
    expect(card.textContent).toContain('You give Bijan Robinson (RB)')
    expect(card.textContent).toContain('You get Puka Nacua (WR)')
  })

  it('shows value and lineup before, after and change, each with its direction', () => {
    render(<ChimmyScenarioCard scenario={scenario()} />)
    const value = row('value')
    expect(value.textContent).toContain('C+')
    expect(within(value).getByText('-550').getAttribute('data-direction')).toBe('down')

    const lineup = row('starting lineup')
    expect(lineup.textContent).toContain('pts / game')
    expect(lineup.textContent).toContain('118.4')
    expect(lineup.textContent).toContain('120.1')
    expect(within(lineup).getByText('+1.7').getAttribute('data-direction')).toBe('up')
  })

  /*
   * 🛑 THE ROW THAT MUST NOT BE MISSING. Omitting it reads as "not relevant"; a dash reads as "no
   * change". Neither is true.
   */
  it('says playoff odds were not computed, in words', () => {
    render(<ChimmyScenarioCard scenario={scenario()} />)
    expect(row('playoff odds').textContent).toMatch(/not computed/i)
    expect(row('playoff odds').textContent).not.toMatch(/\d/)
  })

  it('states why the lineup was not computed, rather than showing zeros', () => {
    render(
      <ChimmyScenarioCard
        scenario={scenario({ lineup: null, lineupUnavailable: 'Puka Nacua has no projection' })}
      />,
    )
    const lineup = row('starting lineup')
    expect(lineup.textContent).toContain('Not computed — Puka Nacua has no projection')
    expect(lineup.textContent).not.toMatch(/0\.0/)
  })

  it('flags value that could only be partly priced, and shows no change for it', () => {
    render(
      <ChimmyScenarioCard
        scenario={scenario({
          value: { given: 8450, received: null, delta: null, grade: null, coveragePct: 50, coverageStatus: 'partial' },
        })}
      />,
    )
    expect(screen.getByTestId('chimmy-scenario-coverage').textContent).toContain('only 50%')
    expect(row('value').textContent).toContain('—')
  })
})

describe('the trade scenario source reads in words', () => {
  it('labels trade_scenario', () => {
    const evidence: ChimmyEvidence = {
      confidencePct: 80,
      level: 'medium',
      rationale: null,
      freshness: 'fresh',
      leagueContext: 'available',
      basedOn: [],
      missing: [],
      dataSources: ['trade_scenario'],
      sourceLinks: [],
      syncedAt: null,
      staleMinutes: null,
    } as unknown as ChimmyEvidence
    render(<ChimmyEvidenceBlock evidence={evidence} />)
    fireEvent.click(screen.getByRole('button', { name: /what is this based on/i }))
    expect(screen.getByTestId('chimmy-evidence-detail').textContent).toContain("run against your league's rosters")
  })
})

describe('the drawer reads the scenario off the envelope', () => {
  const DRAWER = fs.readFileSync(
    path.join(process.cwd(), 'components', 'core-app', 'comms', 'CommsDrawer.tsx'),
    'utf8',
  )

  it('keeps only a resolved scenario and attaches it to the turn', () => {
    // `readReadyScenario` passes only well-formed READY shapes of each kind (tested with the types).
    expect(DRAWER).toContain('scenario: readReadyScenario(payload.meta?.scenario),')
    expect(DRAWER).toContain('<ChimmyScenarioCard scenario={t.scenario} />')
  })

  it('places it under the evidence and above the platform hand-off', () => {
    const card = DRAWER.indexOf('<ChimmyScenarioCard')
    expect(card).toBeGreaterThan(DRAWER.indexOf('<ChimmyEvidenceBlock'))
    expect(card).toBeLessThan(DRAWER.indexOf('af-cm-handoff'))
  })
})

describe('the route sends it', () => {
  const ROUTE = fs.readFileSync(path.join(process.cwd(), 'app', 'api', 'chat', 'chimmy', 'route.ts'), 'utf8')

  it('only for the membership-proven league', () => {
    const guardAt = ROUTE.indexOf('if (leagueSnapshot && userId) {')
    expect(guardAt).toBeGreaterThan(-1)
    const block = ROUTE.slice(guardAt, ROUTE.indexOf('} catch {', guardAt))
    expect(block).toContain('const scenarioArgs = { message: planInput.message, leagueId: leagueSnapshot.id, userId }')
    expect(block).toMatch(/buildTradeScenario\(\{\s*message: planInput\.message,\s*leagueId: leagueSnapshot\.id,/)
    expect(block).not.toMatch(/leagueId:\s*leagueId\b/)
  })

  /*
   * 🛑 START/SIT, THEN WAIVER, THEN TRADE. "Start A vs B" is also trade-shaped; the more specific
   * reading must win, or a lineup question gets "TRADE SCENARIO: NOT COMPUTED".
   */
  it('tries start/sit, then waiver, then trade — each only if the one before found nothing', () => {
    const guardAt = ROUTE.indexOf('if (leagueSnapshot && userId) {')
    const block = ROUTE.slice(guardAt, ROUTE.indexOf('} catch {', guardAt))
    const startSit = block.indexOf('scenario = await buildStartSitScenario(scenarioArgs)')
    const waiver = block.indexOf('scenario = await buildWaiverScenario({')
    const trade = block.indexOf('if (!scenario && looksLikeDescribedTrade(planInput.message))')
    expect(startSit).toBeGreaterThan(-1)
    expect(waiver).toBeGreaterThan(startSit)
    expect(trade).toBeGreaterThan(waiver)
    expect(block.slice(startSit, waiver)).toContain('if (!scenario) {')
    // The engine's claims only when its packet grounded this turn.
    expect(block).toContain("engineClaims: grounding.outcome === 'ok' ? waiverClaimsSeen.claims : null")
  })

  /*
   * A fault in the scenario must fall back to the described-trade grade, not skip it. Sharing one
   * `try` with that reader removed both on any scenario throw.
   */
  it('in its own try, ahead of the described-trade reader', () => {
    const scenarioAt = ROUTE.indexOf('if (leagueSnapshot && userId) {')
    const readerAt = ROUTE.indexOf('await buildDescribedTradeContext({')
    const between = ROUTE.slice(scenarioAt, readerAt)
    expect(scenarioAt).toBeGreaterThan(-1)
    expect(readerAt).toBeGreaterThan(scenarioAt)
    expect(between).toMatch(/\}\s*catch\s*\{\s*scenario = null\s*\}/)
    expect(ROUTE.slice(scenarioAt - 200, scenarioAt)).toMatch(/try \{\s*$/)
  })

  it('in meta, and supersedes the described-trade grade when any kind resolves', () => {
    expect(ROUTE).toContain('scenario: scenarioForMeta ?? undefined')
    expect(ROUTE).toMatch(/const describedTradeCtx = scenario\?\.status === 'ready'\s*\? null/)
    expect(ROUTE).toContain('dataSources.push(`${kind}_scenario`)')
  })
})
