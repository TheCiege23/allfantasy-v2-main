/**
 * Phase 5 — the concept registry is the contract for `createLeagueTradeGrader`'s dispatch.
 *
 * (a) every league concept × supported sport has an entry, so a new concept cannot grade without one;
 * (b) parity: for every registered combination the registry picks the same sub-grader as the old
 *     if-chain. The old chain is kept below as the ORACLE, built from the real sub-grader factories —
 *     their own gates decide, not a copy of the registry;
 * (c) a league type with no entry withholds with a reason instead of reaching the default chart.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import { LEAGUE_TYPE_IDS, LEAGUE_TYPE_LABELS } from '@/lib/league-creation-wizard/league-type-registry'
import { LEAGUE_CONCEPT_OPTIONS } from '@/lib/league/leagueConceptOptions'
import {
  CONCEPT_GRADING_REGISTRY,
  UNREGISTERED_CONCEPT_REASON,
  registeredGradedConcepts,
  resolveConceptGrading,
  type ConceptGradingRule,
} from '@/lib/decision-os/trade/conceptGradingRegistry'
import { createZombieGrader } from '@/lib/decision-os/trade/zombieGrader'
import { createNcaafLeagueGrader } from '@/lib/decision-os/trade/ncaafLeagueGrader'
import { createGuillotineGrader } from '@/lib/decision-os/trade/guillotineGrader'
import { createSportPointsGrader } from '@/lib/decision-os/trade/sportPointsGrader'
import { createFootballTradeFormatGrader } from '@/lib/decision-os/trade/footballTradeFormatGrade'
import { createFootballCampusDraftGrader } from '@/lib/decision-os/trade/footballCampusDraftGrade'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'

const REGISTRY_FILE = 'lib/decision-os/trade/conceptGradingRegistry.ts'

/** Every concept a league can carry: the format engine's ids, the wizard's extras, and the confirmable concepts. */
const ALL_CONCEPTS = [...new Set<string>([
  ...LEAGUE_TYPE_IDS,
  ...Object.keys(LEAGUE_TYPE_LABELS),
  ...LEAGUE_CONCEPT_OPTIONS.map((o) => o.id),
])].sort()

const noLoad = async () => ({ ok: false as const, reason: 'oracle: not loaded' })
const PLAYER: TradeAssetInput = { kind: 'player', name: 'Oracle Player' }

/**
 * 🛑 THE OLD IF-CHAIN, verbatim in order, as it stood in `createLeagueTradeGrader` before the registry:
 * zombie → college (NCAAF) → guillotine → sport points → NFL market chart, with the NFL format
 * post-processor and the Campus draft decided by the factories' own gates.
 */
async function oldChain(args: { type: string; variant: string | null; sport: string }) {
  const { type, variant, sport } = args
  const league = { id: 'L', settings: null, leagueSize: 12, sport }
  const nfl = sport === 'NFL'
  const format = nfl ? createFootballTradeFormatGrader({ id: 'L', type }) !== null : false
  const campusDraft = nfl ? createFootballCampusDraftGrader({ id: 'L', platform: 'native', type }) !== null : false
  const combinedPick = nfl && type === 'c2c'
  const zombie = createZombieGrader({ leagueType: type, dynastyBase: false, league }, { loadContext: noLoad as never })
  if (zombie) return { core: 'zombie', format, campusDraft, combinedPick }
  if (sport === 'NCAAF') {
    const college = createNcaafLeagueGrader(
      { id: 'L', platform: 'sleeper', settings: null, leagueType: { type, label: type, source: 'assumed', platform: null } },
      { loadBase: noLoad as never },
    )
    // The chain fell through only on a null view; a deal with no picks is the case that can be null.
    const view = await college.grade([PLAYER], [PLAYER])
    if (view) return { core: 'ncaaf_college', format, campusDraft, combinedPick }
    return { core: 'ncaaf_college_then_chart', format, campusDraft, combinedPick }
  }
  const guillotine = createGuillotineGrader(
    { sport, leagueType: type, leagueVariant: variant, league: { id: 'L', settings: null, leagueSize: 12 } },
    { loadContext: noLoad as never },
  )
  if (guillotine) return { core: 'guillotine', format, campusDraft, combinedPick }
  const points = createSportPointsGrader(
    { sport, league: { id: 'L', platform: 'sleeper', settings: null, leagueType: type, leagueSize: 12 } },
    { loadBase: noLoad as never },
  )
  if (points) return { core: 'sport_points', format, campusDraft, combinedPick }
  return { core: 'market_chart', format, campusDraft, combinedPick }
}

function registryDecision(rule: ConceptGradingRule, formatRule: string | null) {
  const core = rule.grader === 'ncaaf_college' && rule.collegeFallback === 'market_chart' ? 'ncaaf_college_then_chart' : rule.grader
  return { core, format: formatRule != null, campusDraft: formatRule === 'c2c_campus', combinedPick: formatRule === 'c2c_campus' }
}

describe('(a) every concept × sport has a registry entry', () => {
  it('covers every league concept the product can carry, in every supported sport', () => {
    const missing: string[] = []
    for (const concept of ALL_CONCEPTS) {
      const row = (CONCEPT_GRADING_REGISTRY as Record<string, Record<string, ConceptGradingRule> | undefined>)[concept]
      for (const sport of SUPPORTED_SPORTS) {
        if (!row?.[sport]) missing.push(`${concept} × ${sport}`)
      }
    }
    expect(
      missing,
      `These concepts have no trade-grading rule. Add each to CONCEPT_GRADING_REGISTRY in ${REGISTRY_FILE} ` +
        '(one rule per sport, or `withheld` with a reason), and land grading tests for that rule in the same change.',
    ).toEqual([])
  })

  it('names a grader and a basis for every entry, and a reason for every withheld one', () => {
    for (const concept of registeredGradedConcepts()) {
      for (const sport of SUPPORTED_SPORTS) {
        const rule = (CONCEPT_GRADING_REGISTRY as Record<string, Record<string, ConceptGradingRule>>)[concept]![sport]!
        expect(rule.basis.length, `${concept} × ${sport} needs a basis`).toBeGreaterThan(10)
        if (rule.grader === 'withheld') expect(rule.reason, `${concept} × ${sport} is withheld without a reason`).toBeTruthy()
        if (rule.format) expect(sport, `${concept}: a format post-processor is NFL-only`).toBe('NFL')
      }
    }
  })
})

describe('(b) the registry picks the same sub-grader as the old if-chain', () => {
  // Raw stored types that are not concepts but dispatch today: the dynasty family and the import placeholder.
  const legacyTypes = ['imported', 'devy_dynasty', 'dynasty_superflex']
  const variants = [null, 'guillotine', 'dynasty', 'c2c']

  it.each(SUPPORTED_SPORTS)('%s: every registered concept and variant', async (sport) => {
    const mismatches: string[] = []
    for (const type of [...registeredGradedConcepts(), ...legacyTypes]) {
      for (const variant of variants) {
        const old = await oldChain({ type, variant, sport })
        const resolved = resolveConceptGrading({ type, variant, sport })
        const now = registryDecision(resolved.rule, resolved.format)
        if (JSON.stringify(old) !== JSON.stringify(now)) {
          mismatches.push(`${type} × ${sport} (variant ${variant}): old ${JSON.stringify(old)} vs registry ${JSON.stringify(now)}`)
        }
      }
    }
    expect(mismatches, `The registry (${REGISTRY_FILE}) disagrees with the old dispatch. A grade would change.`).toEqual([])
  })

  it('keeps the format post-processor keyed by the league’s own type', () => {
    expect(resolveConceptGrading({ type: 'keeper', sport: 'NFL' }).format).toBe('keeper_option')
    expect(resolveConceptGrading({ type: 'salary_cap', sport: 'NFL' }).format).toBe('salary_cap_surplus')
    expect(resolveConceptGrading({ type: 'c2c', sport: 'NFL' }).format).toBe('c2c_campus')
    // A guillotine variant grades on the guillotine rule but still carries the keeper post-processor, as before.
    const keeperGuilly = resolveConceptGrading({ type: 'keeper', variant: 'guillotine', sport: 'NFL' })
    expect([keeperGuilly.via, keeperGuilly.rule.grader, keeperGuilly.format]).toEqual(['guillotine_variant', 'guillotine', 'keeper_option'])
  })
})

describe('(c) an unregistered concept withholds instead of reaching the default chart', () => {
  it.each(SUPPORTED_SPORTS)('%s', async (sport) => {
    const resolved = resolveConceptGrading({ type: 'mystery_format', sport })
    expect(resolved.via).toBe('unregistered')
    expect(resolved.rule.grader).toBe('withheld')
    expect(resolved.rule.reason).toBe(UNREGISTERED_CONCEPT_REASON('mystery_format'))
    expect(resolved.format).toBeNull()
    // The old chain priced it anyway — the silent fall-through this contract closes.
    const old = await oldChain({ type: 'mystery_format', variant: null, sport })
    expect(['market_chart', 'sport_points', 'ncaaf_college_then_chart']).toContain(old.core)
  })

  it('an empty type is the redraft default, not unregistered', () => {
    expect(resolveConceptGrading({ type: '', sport: 'NFL' }).key).toBe('redraft')
    expect(resolveConceptGrading({ type: null, sport: 'NCAAF' }).rule.grader).toBe('ncaaf_college')
  })
})
