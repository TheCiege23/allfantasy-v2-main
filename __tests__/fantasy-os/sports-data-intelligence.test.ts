import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('server-only', () => ({}))

import { CertifiedIntelligenceIntegrationService, INTELLIGENCE_UNSUPPORTED } from '@/lib/fantasy-os/sports-runtime/intelligenceIntegration'

const meta = (ageMin: number | null) => ageMin == null ? null : ({ version: 'nfl-games-2026-w1', generatedAt: new Date(Date.now() - ageMin * 60000).toISOString(), provider: 'espn', limitations: [], unresolvedCount: 0, rejectedCount: 0 })
const fakeStore = (gamesMeta: unknown, playersMeta: unknown) => ({
  getCertifiedSnapshotMeta: async (_s: string, cap: string) => (cap === 'games' ? gamesMeta : playersMeta),
})
const fakeMatchup = () => ({ describeMatchupGameStates: async () => ({ available: true, freshnessStatus: 'delayed', snapshotVersion: 'v1', totalGames: 16, finalGames: 0, allGamesFinal: false, games: [], unsupported: {} }) })
const svc = () => new CertifiedIntelligenceIntegrationService(fakeStore(meta(180), meta(9999)) as never, fakeMatchup() as never)

const root = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')
const SERVICE = 'lib/fantasy-os/sports-runtime/intelligenceIntegration.ts'
const COACH = 'app/api/coach/advice/route.ts'
const CHIMMY = 'app/api/ai/chimmy/route.ts'
const MANAGER = 'app/api/decision-os/manager-command-center/route.ts'
const COMMISSIONER = 'app/api/decision-os/mission-control/route.ts'
const OBSERVABILITY = 'app/api/admin/fantasy-os/sports-data/observability/route.ts'
const noProvider = (src: string) => /(from ['"]@\/lib\/sleeper|from ['"]@\/lib\/espn|sleeper-client|espn-client|api\.sleeper\.app|site\.api\.espn\.com|fetch\()/.test(src)

describe('5E-h Intelligence — service (facts only, honest capability)', () => {
  it('League Intelligence context is factual only (freshness + game context + evidence)', async () => {
    const ctx = await svc().describeLeagueSportsContext({ season: '2026', week: '1' })
    expect(ctx.subsystem).toBe('league_intelligence')
    expect(ctx.snapshotFreshness.length).toBeGreaterThan(0)
    expect(ctx.evidenceAvailability.certifiedCapabilities).toContain('games')
  })
  it('unsupported fields (injuries/projections/rankings/predictions/psychology/intent/retention) remain unavailable', () => {
    for (const k of ['injuries', 'projections', 'rankings', 'predictions', 'managerPsychology', 'commissionerIntent', 'retentionLikelihood'] as const) {
      expect(INTELLIGENCE_UNSUPPORTED[k]).toBe('unavailable')
    }
  })
  it('provider health surfaces provenance only — NO env var names / credentials', () => {
    const health = svc().describeProviderHealth()
    expect(health.length).toBeGreaterThan(0)
    const keys = new Set(health.flatMap((h) => Object.keys(h)))
    expect(keys.has('requiredEnvironmentVariables')).toBe(false)
    expect(keys.has('clientLocations')).toBe(false)
    expect([...keys].sort()).toEqual(['capabilities', 'lastVerifiedAt', 'provider', 'sports', 'status'])
  })
  it('freshness surfaces correctly (delayed vs unavailable) from certified snapshot meta', async () => {
    const fresh = await svc().describeSnapshotFreshness({ season: '2026', week: '1' })
    const games = fresh.find((f) => f.capability === 'games')
    expect(games?.available).toBe(true)
    expect(games?.freshnessStatus).toBe('delayed')
  })
  it('evidence availability reports certified vs not-certified honestly (5F-a: statistics now certified; injuries/projections still not)', () => {
    const ev = svc().describeEvidenceAvailability()
    expect(ev.certifiedCapabilities).toContain('games')
    expect(ev.certifiedCapabilities).toContain('statistics')
    expect(ev.notCertifiedCapabilities).toEqual(expect.arrayContaining(['injuries', 'projections']))
    expect(ev.notCertifiedCapabilities).not.toContain('statistics')
  })
  it('platform context includes provider health + no game context leakage of unsupported facts', async () => {
    const p = await svc().describePlatformSportsContext({ season: '2026', week: '1' })
    expect(p.providerHealth.length).toBeGreaterThan(0)
    expect(p.unsupported.injuries).toBe('unavailable')
  })
})

describe('5E-h Intelligence — service composition + no provider access', () => {
  const src = read(SERVICE)
  it('composes runtime primitives (store/freshness/inventory/matchup), imports no reasoning/recommendation engine', () => {
    expect(src).toMatch(/buildCertifiedFreshness/)
    expect(src).toMatch(/PROVIDER_INVENTORY/)
    expect(src).toMatch(/CertifiedMatchupIntegrationService/)
    // imports only runtime primitives — no reasoning/recommendation/confidence/scoring engine imports
    const imports = src.split('\n').filter((l) => l.trim().startsWith('import'))
    expect(imports.some((l) => /recommend|reasoning|confidence|ai-coach|ai-orchestration|waiver-ai|trade-engine|scoringEngine/i.test(l))).toBe(false)
  })
  it('reaches no provider directly', () => { expect(noProvider(src)).toBe(false) })
})

describe('5E-h Intelligence — surface wiring (informational; reasoning authoritative; gate OFF preserves behavior)', () => {
  it('Coach consumes certified context, gated, reasoning (getAICoachResponse) unchanged', () => {
    const src = read(COACH)
    expect(src).toMatch(/describeCoachSportsContext/)
    expect(src).toMatch(/isSportsDataEnabled\('coach'\)/)
    expect(src).toMatch(/getAICoachResponse\(/)
    expect(src).toMatch(/recommendation: result\.recommendation/) // recommendation unchanged
    expect(noProvider(src)).toBe(false)
  })
  it('Chimmy consumes certified context, gated, orchestration (runUnifiedOrchestration) unchanged', () => {
    const src = read(CHIMMY)
    expect(src).toMatch(/intelligenceIntegration/)
    expect(src).toMatch(/isSportsDataEnabled\('intelligence'\)/)
    expect(src).toMatch(/runUnifiedOrchestration\(/)
    expect(noProvider(src)).toBe(false)
  })
  it('Manager Intelligence consumes certified context, gated, snapshot unchanged', () => {
    const src = read(MANAGER)
    expect(src).toMatch(/describeManagerSportsContext/)
    expect(src).toMatch(/isSportsDataEnabled\('intelligence'\)/)
    expect(src).toMatch(/resolveManagerCommandCenterSnapshot/)
    expect(noProvider(src)).toBe(false)
  })
  it('Commissioner Intelligence consumes certified context, gated, snapshot unchanged', () => {
    const src = read(COMMISSIONER)
    expect(src).toMatch(/describeCommissionerSportsContext/)
    expect(src).toMatch(/isSportsDataEnabled\('intelligence'\)/)
    expect(src).toMatch(/resolveMissionControlSnapshot/)
    expect(noProvider(src)).toBe(false)
  })
  it('Operator observability route is admin-gated + observability-gated, exposes no credentials', () => {
    const src = read(OBSERVABILITY)
    expect(src).toMatch(/requireAdmin\(\)/)
    expect(src).toMatch(/isSportsDataEnabled\('observability'\)/)
    expect(src).toMatch(/describePlatformSportsContext/)
    expect(src).not.toMatch(/requiredEnvironmentVariables|process\.env\.[A-Z]/)
    expect(noProvider(src)).toBe(false)
  })
})
