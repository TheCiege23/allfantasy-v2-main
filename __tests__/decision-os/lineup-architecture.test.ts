import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveLineupWorld } from '@/lib/decision-os/lineup/world'
import { buildLineupDCO } from '@/lib/decision-os/lineup/dco'
import { decideLineupSet } from '@/lib/decision-os/lineup/decision'
import { registerDecisionTelemetrySink } from '@/lib/decision-os/core/telemetry'
import { assertFourAnswers } from '@/lib/decision-os/core/decision'
import { fakeWorldDeps, fakeValidate, fakePlayers, payload } from './lineupFakes'

/**
 * Architecture Regression Suite for `manager.lineup.set`. Tests the ARCHITECTURE, not fantasy:
 * every decision must flow through the DCO + Rule Framework, read-only, with no sport leak.
 */
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')
const DECISION = read('lib/decision-os/lineup/decision.ts')
const WORLD = read('lib/decision-os/lineup/world.ts')
const DCO = read('lib/decision-os/lineup/dco.ts')
const RULES = read('lib/decision-os/lineup/rules.ts')
const VALIDATOR_PARITY = read('lib/decision-os/lineup/validatorParity.ts')
const CANONICAL_ADAPTER = read('lib/decision-os/lineup/canonicalAdapter.ts')
const CORE_PARITY = [
  'lib/decision-os/core/parity/validatorParity.ts',
  'lib/decision-os/core/parity/shadowParity.ts',
  'lib/decision-os/core/parity/telemetry.ts',
  'lib/decision-os/core/shadow/flag.ts',
].map((p) => [p, read(p)] as const)

afterEach(() => registerDecisionTelemetrySink(null))

describe('architecture: the decision layer consumes only the DCO', () => {
  it('decision.ts performs NO direct prisma / league / scoring reads', () => {
    expect(DECISION).not.toContain('@/lib/prisma')
    expect(DECISION).not.toMatch(/prisma\./)
    expect(DECISION).not.toMatch(/\.(findMany|findFirst|findUnique)\(/)
    expect(DECISION).not.toContain('scoringEngine')
    expect(DECISION).not.toContain('playerWeeklyScoreService')
  })

  it('decision.ts contains NO sport-specific branch (no NFL/NCAAF/sport=== logic in core)', () => {
    expect(DECISION).not.toMatch(/['"]NFL['"]/)
    expect(DECISION).not.toMatch(/['"]NCAAF['"]/)
    expect(DECISION).not.toMatch(/sport\s*===|toUpperCase\(\)\s*===/)
  })
})

describe('architecture: core parity/shadow infrastructure is DOMAIN-BLIND (Ticket #10)', () => {
  it('core/parity + core/shadow import no lineup/domain modules and no prisma', () => {
    for (const [path, src] of CORE_PARITY) {
      expect(`${path}: ${src.includes('@/lib/lineup-actions')}`).toBe(`${path}: false`)
      expect(`${path}: ${src.includes('decision-os/lineup')}`).toBe(`${path}: false`)
      expect(`${path}: ${src.includes('@/lib/roster-lineup-engine')}`).toBe(`${path}: false`)
      expect(`${path}: ${src.includes('@/lib/prisma')}`).toBe(`${path}: false`)
    }
  })
})

describe('architecture: the rule/parity layer reads NO Prisma / league / template (Ticket #6)', () => {
  it('rules.ts, validatorParity.ts, canonicalAdapter.ts perform NO prisma / template / league config reads', () => {
    for (const src of [RULES, VALIDATOR_PARITY, CANONICAL_ADAPTER]) {
      expect(src).not.toContain('@/lib/prisma')
      expect(src).not.toMatch(/prisma\./)
      expect(src).not.toMatch(/\.(findMany|findFirst|findUnique)\(/)
      // template + league-config resolution happens ONLY at the route seam (loader/deps), never here
      expect(src).not.toContain('getRosterTemplateForLeague')
      expect(src).not.toContain('MultiSportRosterService')
    }
  })
})

describe('architecture: World / Context / DCO are read-only', () => {
  it('world.ts and dco.ts perform ZERO writes and no prisma', () => {
    for (const src of [WORLD, DCO]) {
      expect(src).not.toContain('@/lib/prisma')
      expect(src).not.toMatch(/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/)
    }
  })
})

describe('architecture: a Decision Object is emitted with the four contract answers + telemetry', () => {
  it('decideLineupSet (DCO + fakes only) emits a complete, explainable, rule-gated Decision', async () => {
    const emitted: unknown[] = []
    registerDecisionTelemetrySink((e) => emitted.push(e))

    const world = resolveLineupWorld(
      { sport: 'NFL', leagueSettings: {}, leagueWeek: 1, editingWeek: 1 },
      fakeWorldDeps(false),
    )
    const dco = buildLineupDCO({ world, userId: 'u1', leagueId: 'L1', sport: 'NFL', rosterId: 'r1', players: fakePlayers() })

    const decision = await decideLineupSet(dco, {
      recommend: vi.fn(async () => payload('L1', [])), // clean lineup
      ruleDeps: { validateRedraft: fakeValidate() },
    })

    expect(() => assertFourAnswers(decision)).not.toThrow()
    expect(decision.decision_type).toBe('manager.lineup.set')
    expect(decision.telemetry).toMatchObject({
      dco_consumed: true,
      rule_gated: true,
      decision_object_emitted: true,
      explainable: true,
      world_resolution_read_only: true,
    })
    // telemetry was emitted on issue
    expect(emitted.length).toBeGreaterThan(0)
    // legality came from the Rule Framework (verdicts present/array), not inline
    expect(Array.isArray(decision.rule_verdicts)).toBe(true)
  })
})
