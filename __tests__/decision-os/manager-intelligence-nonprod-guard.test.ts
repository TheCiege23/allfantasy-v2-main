/**
 * Decision OS Manager Intelligence Platform — Phase 6: non-prod validation guard.
 *
 * Tests the PURE, database-free safety + readiness logic behind the read-only
 * validation script: it refuses without acknowledgement, refuses production-like
 * targets, is read-only + recommendation-free by construction, and reports a
 * missing league / module readiness honestly.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  assessNonprodSafety,
  checkRequiredFlags,
  deriveModuleReadiness,
  probeModuleReadiness,
  REQUIRED_HUB_FLAGS,
  VALIDATION_TARGETS,
  type ReadinessCounts,
  type ReadinessReader,
} from '@/scripts/manager-intelligence/nonprodValidationGuard'

describe('assessNonprodSafety — safe by default', () => {
  const localAckEnv = { NONPROD_VALIDATION_ACK: 'true', DATABASE_URL: 'postgresql://u:p@localhost:5432/af' }

  it('refuses without NONPROD_VALIDATION_ACK', () => {
    const a = assessNonprodSafety({ DATABASE_URL: 'postgresql://u:p@localhost:5432/af' })
    expect(a.ok).toBe(false)
    expect(a.blockers.some((b) => /NONPROD_VALIDATION_ACK/.test(b))).toBe(true)
  })

  it('refuses a production-like runtime even with acknowledgement', () => {
    expect(assessNonprodSafety({ ...localAckEnv, NODE_ENV: 'production' }).ok).toBe(false)
    expect(assessNonprodSafety({ ...localAckEnv, VERCEL_ENV: 'production' }).ok).toBe(false)
  })

  it('refuses a production-like DATABASE_URL', () => {
    const a = assessNonprodSafety({ NONPROD_VALIDATION_ACK: 'true', DATABASE_URL: 'postgresql://u:p@ep-prod-x.neon.tech/db' })
    expect(a.ok).toBe(false)
    expect(a.blockers.some((b) => /production-like/i.test(b))).toBe(true)
  })

  it('refuses an unmarked remote DB unless explicitly confirmed non-prod', () => {
    const remote = { NONPROD_VALIDATION_ACK: 'true', DATABASE_URL: 'postgresql://u:p@ep-spring-tooth.neon.tech/db' }
    expect(assessNonprodSafety(remote).ok).toBe(false)
    // Operator explicitly confirms it is non-prod → allowed.
    const confirmed = assessNonprodSafety({ ...remote, NONPROD_DB_CONFIRMED: 'true' })
    expect(confirmed.ok).toBe(true)
    expect(confirmed.acknowledgements.some((a) => /NONPROD_DB_CONFIRMED/.test(a))).toBe(true)
  })

  it('allows a localhost / staging DB with acknowledgement', () => {
    expect(assessNonprodSafety(localAckEnv).ok).toBe(true)
    expect(assessNonprodSafety({ NONPROD_VALIDATION_ACK: 'true', DATABASE_URL: 'postgresql://u:p@ep-staging-a.neon.tech/db' }).ok).toBe(true)
  })

  it('refuses when DATABASE_URL is absent', () => {
    expect(assessNonprodSafety({ NONPROD_VALIDATION_ACK: 'true' }).ok).toBe(false)
  })
})

describe('checkRequiredFlags', () => {
  it('reports each required flag as enabled/disabled', () => {
    const env = { NEXT_PUBLIC_MANAGER_INTELLIGENCE_HUB_ENABLED: 'true', MANAGER_TEAM_HEALTH_ENABLED: 'true' }
    const result = checkRequiredFlags(env)
    expect(result).toHaveLength(REQUIRED_HUB_FLAGS.length)
    expect(result.find((r) => r.flag === 'NEXT_PUBLIC_MANAGER_INTELLIGENCE_HUB_ENABLED')?.enabled).toBe(true)
    expect(result.find((r) => r.flag === 'MANAGER_WEEKLY_OUTLOOK_ENABLED')?.enabled).toBe(false)
  })
})

describe('VALIDATION_TARGETS — never targets a recommendation endpoint', () => {
  it('lists exactly the five read-only observational routes, none recommendation-y', () => {
    expect(VALIDATION_TARGETS).toHaveLength(5)
    for (const t of VALIDATION_TARGETS) {
      expect(t.route).not.toMatch(/waiver|trade-|recommend|ai-tools|matchup-prep|waiver-recs|trade-finder|analyzer/i)
    }
  })
})

describe('readiness probe — read-only + honest reporting', () => {
  const fullCounts: ReadinessCounts = {
    seasonFound: true,
    rosterCount: 12,
    activePlayerCount: 15,
    matchupCount: 7,
    completedTradeCount: 4,
  }

  it('reports a missing league honestly (no fabricated readiness)', () => {
    const readiness = deriveModuleReadiness(null)
    expect(readiness).toHaveLength(5)
    expect(readiness.every((r) => r.ready === false)).toBe(true)
    expect(readiness.every((r) => /no imported redraft season/i.test(r.note))).toBe(true)
  })

  it('reports each module ready when its data is present', () => {
    const readiness = deriveModuleReadiness(fullCounts)
    expect(readiness.every((r) => r.ready)).toBe(true)
    expect(readiness.find((r) => r.module === 'League Context')?.note).toMatch(/12 roster/)
  })

  it('reports honest per-module gaps (empty roster, no matchups, no trades)', () => {
    const readiness = deriveModuleReadiness({ seasonFound: true, rosterCount: 12, activePlayerCount: 0, matchupCount: 0, completedTradeCount: 0 })
    const ready = Object.fromEntries(readiness.map((r) => [r.module, r.ready]))
    expect(ready['League Context']).toBe(true) // rosters exist
    expect(ready['Team Health']).toBe(false) // no active players
    expect(ready['Weekly Outlook']).toBe(false) // no matchups
    expect(ready['Transaction Readiness']).toBe(false)
    expect(ready['Historical Replay']).toBe(false) // no completed trades
  })

  it('uses ONLY the injected read-only reader (no writes, no recommendation calls possible)', async () => {
    const readLeagueReadiness = vi.fn(async () => fullCounts)
    const reader: ReadinessReader = { readLeagueReadiness }
    const readiness = await probeModuleReadiness(reader, 'league-123')
    expect(readLeagueReadiness).toHaveBeenCalledTimes(1)
    expect(readLeagueReadiness).toHaveBeenCalledWith('league-123')
    // The reader interface exposes no write/recommendation method — read-only by construction.
    expect(Object.keys(reader)).toEqual(['readLeagueReadiness'])
    expect(readiness).toHaveLength(5)
  })
})
