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

type Decision = { core: string; basis: string | null; format: boolean; campusDraft: boolean; combinedPick: boolean }

/**
 * 🛑 THE OLD IF-CHAIN, verbatim in order, as it stood in `createLeagueTradeGrader` before the registry:
 * zombie → college (NCAAF) → guillotine → sport points → NFL market chart, with the NFL format
 * post-processor and the Campus draft decided by the factories' own gates.
 *
 * ⚠ TWO GATES ARE FROZEN COPIES, not the live factories, because the 2026-11-26 fixes changed those
 * factories and an oracle that follows its subject proves nothing:
 *   - the college grader used to give a view only in redraft and dynasty-family leagues (else the chart);
 *   - the guillotine grader used to cover NFL, NBA, NHL and MLB only.
 * `basis` is the college basis for the college grader and the seasons rule for the points grader; the old
 * chain had no seasons rule (the type alone decided), so it is null there.
 */
async function oldChain(args: { type: string; variant: string | null; sport: string }): Promise<Decision> {
  const { type, variant, sport } = args
  const league = { id: 'L', settings: null, leagueSize: 12, sport }
  const nfl = sport === 'NFL'
  const format = nfl ? createFootballTradeFormatGrader({ id: 'L', type }) !== null : false
  const campusDraft = nfl ? createFootballCampusDraftGrader({ id: 'L', platform: 'native', type }) !== null : false
  const combinedPick = nfl && type === 'c2c'
  const flags = { format, campusDraft, combinedPick }
  const zombie = createZombieGrader({ leagueType: type, dynastyBase: false, league }, { loadContext: noLoad as never })
  if (zombie) return { core: 'zombie', basis: null, ...flags }
  if (sport === 'NCAAF') {
    // Frozen: `createNcaafLeagueGrader` before 2026-11-26 — a no-pick deal had a view only in these two.
    if (type === 'redraft') return { core: 'ncaaf_college', basis: 'rest_of_season', ...flags }
    if (type.includes('dynasty')) return { core: 'ncaaf_college', basis: 'dynasty', ...flags }
    return { core: 'ncaaf_college_then_chart', basis: null, ...flags }
  }
  // Frozen: the sports `createGuillotineGrader` covered before 2026-11-26.
  const guillotine = ['NFL', 'NBA', 'NHL', 'MLB'].includes(sport) && createGuillotineGrader(
    { sport, leagueType: type, leagueVariant: variant, league: { id: 'L', settings: null, leagueSize: 12 } },
    { loadContext: noLoad as never },
  )
  if (guillotine) return { core: 'guillotine', basis: null, ...flags }
  const points = createSportPointsGrader(
    { sport, league: { id: 'L', platform: 'sleeper', settings: null, leagueType: type, leagueSize: 12 } },
    { loadBase: noLoad as never },
  )
  if (points) return { core: 'sport_points', basis: null, ...flags }
  return { core: 'market_chart', basis: null, ...flags }
}

function registryDecision(rule: ConceptGradingRule, formatRule: string | null): Decision {
  return {
    core: rule.grader,
    basis: rule.college ?? rule.seasons ?? null,
    format: formatRule != null,
    campusDraft: formatRule === 'c2c_campus',
    combinedPick: formatRule === 'c2c_campus',
  }
}

/**
 * 🛑 THE DELIBERATE GRADE CHANGES, AND ONLY THESE (owner-approved, 2026-11-26). Each has behaviour tests:
 * `ncaaf-league-grader.test.ts`, `sport-dynasty-grade.test.ts`, `guillotine-daily-sports.test.ts` and the
 * end-to-end ones in `league-trade-grader.test.ts`. Every combination not named here must still equal the
 * old chain exactly — a new difference fails (b) below.
 */
const POINTS_SPORTS = ['NBA', 'NCAAB', 'NHL', 'MLB', 'SOCCER']
const INTENDED_CHANGES = {
  /** 1. NCAAF: college evidence for every concept. Rosters reset → the college redraft basis. */
  ncaafThisSeason: ['best_ball', 'survivor', 'tournament', 'big_brother', 'guillotine', 'pirate', 'efl', 'survivor_guillotine'],
  /** 1. NCAAF multi-season concepts with no format adjustment of their own → the college dynasty basis. */
  ncaafMultiSeason: ['devy', 'c2c'],
  /** 1. NCAAF concepts whose format adjustment has no college form (and the unconfirmed import) → withheld. */
  ncaafWithheld: ['keeper', 'salary_cap', 'imported'],
  /** 2. Pirate and EFL outside football → the league's book decides the seasons. */
  leagueBook: { concepts: ['pirate', 'efl'], sports: POINTS_SPORTS },
  /** 3. Guillotine — the concept, or a guillotine variant on any base but Zombie — in these sports. */
  guillotine: { sports: ['NCAAB', 'SOCCER'] },
}

/** What the registry must now say for a combination: the old chain's answer unless an intended change names it. */
function expectedDecision(type: string, variant: string | null, sport: string, old: Decision): { decision: Decision; fix: string | null } {
  const changed = (fix: string, d: Partial<Decision>) => ({ decision: { ...old, ...d }, fix })
  if (sport === 'NCAAF') {
    if (INTENDED_CHANGES.ncaafThisSeason.includes(type)) return changed('1', { core: 'ncaaf_college', basis: 'rest_of_season' })
    if (INTENDED_CHANGES.ncaafMultiSeason.includes(type)) return changed('1', { core: 'ncaaf_college', basis: 'dynasty' })
    if (INTENDED_CHANGES.ncaafWithheld.includes(type)) return changed('1', { core: 'withheld', basis: null })
  }
  if (INTENDED_CHANGES.guillotine.sports.includes(sport) && type !== 'zombie' && (type === 'guillotine' || variant === 'guillotine')) {
    return changed('3', { core: 'guillotine', basis: null })
  }
  // Only where the points grader grades: a guillotine variant still takes the guillotine rule, as before.
  if (INTENDED_CHANGES.leagueBook.sports.includes(sport) && INTENDED_CHANGES.leagueBook.concepts.includes(type) && old.core === 'sport_points') {
    return changed('2', { basis: 'league_book' })
  }
  return { decision: old, fix: null }
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
        // 🛑 An NCAAF deal is never priced on the NFL chart: every college rule names its college basis, or withholds.
        if (sport === 'NCAAF') expect(['ncaaf_college', 'zombie', 'withheld'], `${concept} × NCAAF`).toContain(rule.grader)
        if (rule.grader === 'ncaaf_college') expect(rule.college, `${concept} × ${sport} needs a college basis`).toBeTruthy()
        if (rule.college || rule.collegePicks) expect(rule.grader).toBe('ncaaf_college')
        if (rule.seasons) expect(rule.grader).toBe('sport_points')
      }
    }
  })
})

describe('(b) the registry picks the same sub-grader as the old if-chain, except the intended changes', () => {
  // Raw stored types that are not concepts but dispatch today: the dynasty family and the import placeholder.
  const legacyTypes = ['imported', 'devy_dynasty', 'dynasty_superflex']
  const variants = [null, 'guillotine', 'dynasty', 'c2c']
  const changedByFix = new Map<string, Set<string>>()

  it.each(SUPPORTED_SPORTS)('%s: every registered concept and variant', async (sport) => {
    const mismatches: string[] = []
    for (const type of [...registeredGradedConcepts(), ...legacyTypes]) {
      for (const variant of variants) {
        const old = await oldChain({ type, variant, sport })
        const { decision: expected, fix } = expectedDecision(type, variant, sport, old)
        const resolved = resolveConceptGrading({ type, variant, sport })
        const now = registryDecision(resolved.rule, resolved.format)
        if (JSON.stringify(expected) !== JSON.stringify(now)) {
          mismatches.push(`${type} × ${sport} (variant ${variant}): expected ${JSON.stringify(expected)} (${fix ? `fix ${fix}` : 'unchanged'}) vs registry ${JSON.stringify(now)}`)
        }
        if (fix) {
          // An intended change must actually change something, or it is not a change.
          expect(JSON.stringify(expected), `${type} × ${sport} (variant ${variant}) is listed as changed but the old chain already did this`).not.toBe(JSON.stringify(old))
          const rows = changedByFix.get(fix) ?? new Set<string>()
          // A row is a concept × sport; fix 3 also changes the guillotine-variant column of every other base.
          rows.add(fix === '3' && type !== 'guillotine' ? `${type} × ${sport} (guillotine variant)` : `${type} × ${sport}`)
          changedByFix.set(fix, rows)
        }
      }
    }
    expect(mismatches, `The registry (${REGISTRY_FILE}) disagrees with the old dispatch outside INTENDED_CHANGES. A grade would change.`).toEqual([])
  })

  it('the intended changes touch exactly the rows the owner approved', () => {
    // Fix 1: 13 NCAAF rows (8 this-season, 2 multi-season, 3 withheld). Fix 2: pirate + efl × 5 sports.
    // Fix 3: guillotine × NCAAB/SOCCER, plus a guillotine variant on every other non-Zombie base there.
    const nonZombieBases = registeredGradedConcepts().length + 3 - 2 // + legacy types, − zombie, − guillotine itself
    expect(changedByFix.get('1')?.size).toBe(13)
    expect(changedByFix.get('2')?.size).toBe(10)
    expect(changedByFix.get('3')?.size).toBe(2 * (1 + nonZombieBases))
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
