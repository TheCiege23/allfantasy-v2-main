import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildRuntimeContext, identityStatusFrom, unavailableRuntimeContext } from '@/lib/fantasy-os/sports-runtime/context'
import type { SportsDataContext } from '@/lib/sports-data-gateway/contracts'

vi.mock('server-only', () => ({}))

const ctx = (over: Partial<SportsDataContext> = {}): SportsDataContext => ({ generatedAt: 't', lastSuccessfulSyncAt: null, sourceProviders: ['espn'], snapshotVersions: ['v1'], freshnessStatus: 'delayed', limitations: ['x'], ...over } as SportsDataContext)

describe('shared runtime context envelope (Part 1)', () => {
  it('stale stays stale; provider-neutral fields only', () => {
    const r = buildRuntimeContext({ dataContext: ctx({ freshnessStatus: 'delayed' }), identityStatus: 'resolved', evidenceIds: ['v1'] })
    expect(r.freshnessStatus).toBe('delayed')
    expect(Object.keys(r).sort()).toEqual(['evidenceIds', 'freshnessStatus', 'generatedAt', 'identityStatus', 'limitations', 'snapshotVersions', 'sourceProviders'])
  })
  it('unavailable is never empty-but-current', () => {
    const u = unavailableRuntimeContext('no snapshot')
    expect(u.freshnessStatus).toBe('unavailable')
    expect(u.snapshotVersions).toEqual([])
  })
  it('surfaces partial identity as a visible limitation', () => {
    const r = buildRuntimeContext({ dataContext: ctx(), identityStatus: 'partially_resolved', evidenceIds: [] })
    expect(r.identityStatus).toBe('partially_resolved')
    expect(r.limitations.some((l) => /partially_resolved/.test(l))).toBe(true)
  })
  it('identityStatusFrom classifies deterministically', () => {
    expect(identityStatusFrom(0, 5)).toBe('unresolved')
    expect(identityStatusFrom(3, 5)).toBe('partially_resolved')
    expect(identityStatusFrom(5, 5)).toBe('resolved')
  })
})

describe('runtime feature gates (Stop-gate 2)', () => {
  const OLD = { ...process.env }
  beforeEach(() => { vi.resetModules(); for (const k of Object.keys(process.env)) if (k.startsWith('FANTASY_OS_SPORTS_DATA_')) delete process.env[k] })
  afterEach(() => { process.env = { ...OLD } })

  it('disabled by default; enabled only when explicitly "true"', async () => {
    const { isSportsDataEnabled } = await import('@/lib/fantasy-os/sports-runtime/gates')
    expect(isSportsDataEnabled('lineup')).toBe(false)
    process.env.FANTASY_OS_SPORTS_DATA_LINEUP_ENABLED = 'true'
    const mod = await import('@/lib/fantasy-os/sports-runtime/gates')
    expect(mod.isSportsDataEnabled('lineup')).toBe(true)
    expect(mod.isSportsDataEnabled('waiver')).toBe(false)
  })
  it('diagnostics expose names + booleans only (no values)', async () => {
    const { sportsDataGateDiagnostics } = await import('@/lib/fantasy-os/sports-runtime/gates')
    const d = sportsDataGateDiagnostics()
    expect(d).toHaveLength(9) // 5E-g added scoring, 5E-h added observability
    expect(d.some((x) => x.subsystem === 'scoring' && x.envKey === 'FANTASY_OS_SPORTS_DATA_SCORING_ENABLED')).toBe(true)
    expect(d.some((x) => x.subsystem === 'observability' && x.envKey === 'FANTASY_OS_SPORTS_DATA_OBSERVABILITY_ENABLED')).toBe(true)
    expect(d.every((x) => typeof x.enabled === 'boolean' && x.envKey.startsWith('FANTASY_OS_SPORTS_DATA_'))).toBe(true)
  })
})

describe('call-graph proof + direct-provider-import guard (Parts 14, 17)', () => {
  const root = process.cwd()
  const routeFile = 'app/api/fantasy-os/sports/lineup-context/route.ts'
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

  it('the real lineup-context route imports the runtime ports (not a parallel interface)', () => {
    const src = read(routeFile)
    expect(src).toMatch(/sports-runtime\/gates/)
    expect(src).toMatch(/runtime\/playerGameResolution/)
    expect(src).toMatch(/runtime\/lineupSafety/)
    expect(src).toMatch(/runtime\/scheduleRuntime/)
  })

  it('the wired route + runtime consumer layer do NOT import a provider client or hit a provider URL directly', () => {
    // Allowlist for direct provider access: gateway adapters + sync fetchers only.
    const wired = [routeFile, 'lib/fantasy-os/sports-runtime/gates.ts', 'lib/fantasy-os/sports-runtime/context.ts', 'lib/sports-data-gateway/runtime/certifiedReads.ts', 'lib/sports-data-gateway/ports/runtimePortsDb.ts']
    const FORBIDDEN = /(sleeper-client|espn-client|api\.sleeper\.app|site\.api\.espn\.com|from ['"]@\/lib\/sleeper|from ['"]@\/lib\/espn)/
    for (const f of wired) {
      const src = read(f)
      expect(FORBIDDEN.test(src), `${f} must not import a provider client or hit a provider URL directly`).toBe(false)
    }
  })
})
