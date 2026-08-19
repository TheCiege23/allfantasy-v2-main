import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('server-only', () => ({}))

import { CertifiedLineupIntegrationService } from '@/lib/fantasy-os/sports-runtime/lineupIntegration'
import type { LiveLineupSportsContext } from '@/lib/sports-data-gateway/runtime/lineupSafety'

const ctx = (id: string, lock: LiveLineupSportsContext['sportsDataLockEvidence']): LiveLineupSportsContext => ({
  canonicalPlayerId: id, canonicalTeamId: 'nfl:KC', canonicalGameId: 'espn:nfl:1', scheduledStart: '2026-09-10T00:20Z',
  gameStatus: 'scheduled', gameResolutionStatus: 'resolved', sportsDataLockEvidence: lock, dataContext: {} as never, limitations: [],
})
const svcWith = (available: boolean, freshness: string, contexts: LiveLineupSportsContext[]) => {
  const s = new CertifiedLineupIntegrationService({} as never)
  s.getScheduleEvidenceForPlayers = async () => ({ available, contexts, runtimeContext: { generatedAt: 't', sourceProviders: ['espn'], snapshotVersions: ['v1'], freshnessStatus: freshness as never, identityStatus: 'resolved', limitations: [], evidenceIds: ['v1'] } })
  return s
}

describe('pre-persist certified safety (write path)', () => {
  const refs = [{ canonicalPlayerId: 'p1' }]
  it('BLOCKS on trustworthy (current) evidence of a locked/started/final started player', async () => {
    for (const lock of ['at_or_after_start', 'final', 'postponed', 'suspended'] as const) {
      const r = await svcWith(true, 'current', [ctx('p1', lock)]).evaluateLineupPersistSafety({ season: '2026', week: '1', starterRefs: refs })
      expect(r.block, lock).toBe(true)
      expect(r.blockedPlayers).toContain('p1')
    }
  })
  it('does NOT block when the started player is before start (current)', async () => {
    const r = await svcWith(true, 'current', [ctx('p1', 'before_start')]).evaluateLineupPersistSafety({ season: '2026', week: '1', starterRefs: refs })
    expect(r.block).toBe(false)
  })
  it('fail-OPEN on a stale schedule (never blocks a human-confirmed manual save)', async () => {
    const r = await svcWith(true, 'delayed', [ctx('p1', 'final')]).evaluateLineupPersistSafety({ season: '2026', week: '1', starterRefs: refs })
    expect(r.block).toBe(false)
    expect(r.reason).toMatch(/not used to block/i)
  })
  it('fail-OPEN (existing authority final) when certified schedule is unavailable', async () => {
    const r = await svcWith(false, 'unavailable', []).evaluateLineupPersistSafety({ season: '2026', week: '1', starterRefs: refs })
    expect(r.block).toBe(false)
    expect(r.reason).toMatch(/unavailable/i)
  })
})

describe('persisting route wiring + authority preservation', () => {
  const root = process.cwd()
  const routeFile = 'app/api/leagues/[leagueId]/roster/ai-apply-lineup/route.ts'
  const src = fs.readFileSync(path.join(root, routeFile), 'utf8')

  it('imports the integration service + gate', () => {
    expect(src).toMatch(/lineupIntegration/)
    expect(src).toMatch(/isSportsDataEnabled\('lineup'\)/)
  })
  it('keeps existing authorities: roster legality + engine persist with skipLockCheck:false', () => {
    expect(src).toMatch(/evaluateLegalityForPersistedRoster/)
    expect(src).toMatch(/persistRosterLineupWithEngine/)
    expect(src).toMatch(/skipLockCheck:\s*false/)
  })
  it('the certified check runs BEFORE persistence and is reject-only (409)', () => {
    const guardIdx = src.indexOf('evaluateLineupPersistSafety')
    const persistIdx = src.indexOf('persistRosterLineupWithEngine({')
    expect(guardIdx).toBeGreaterThan(0)
    expect(guardIdx).toBeLessThan(persistIdx) // evaluated before persist
    expect(src).toMatch(/code: 'SPORTS_DATA_LOCK'[\s\S]*status: 409/)
  })
  it('the certified block is gated + wrapped so it can never turn a safe save into an error', () => {
    expect(src).toMatch(/if \(isSportsDataEnabled\('lineup'\)/)
    expect(src).toMatch(/try \{[\s\S]*evaluateLineupPersistSafety[\s\S]*catch/)
  })
  it('reaches providers only through the gateway ports (no direct provider import/URL)', () => {
    expect(/(from ['"]@\/lib\/sleeper|from ['"]@\/lib\/espn|sleeper-client|espn-client|api\.sleeper\.app|site\.api\.espn\.com)/.test(src)).toBe(false)
  })
})
