import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('server-only', () => ({}))

const root = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')
const LOCK_STATE = 'app/api/leagues/[leagueId]/roster/lineup/lock-state/route.ts'
const AUTO_SUB = 'app/api/lineup/auto-sub/route.ts'
const INTEGRATION = 'lib/fantasy-os/sports-runtime/lineupIntegration.ts'

describe('live Lineup call-graph wiring (Parts 6, 8, 15)', () => {
  it('lock-state route imports the shared integration service + gate', () => {
    const src = read(LOCK_STATE)
    expect(src).toMatch(/lineupIntegration/)
    expect(src).toMatch(/isSportsDataEnabled/)
    // authority preserved: still calls the existing lock service
    expect(src).toMatch(/resolveFullLineupLockContext/)
  })
  it('auto-sub route imports the integration service + gate, keeps the deterministic engine authoritative', () => {
    const src = read(AUTO_SUB)
    expect(src).toMatch(/lineupIntegration/)
    expect(src).toMatch(/isSportsDataEnabled\('lineup'\)/)
    expect(src).toMatch(/runAutoSubLineupEngine/) // engine still runs + is authoritative
  })
})

describe('feature-gate + additive behavior (Part 10)', () => {
  it('both wired routes gate the sports-data block behind the lineup feature gate', () => {
    expect(read(LOCK_STATE)).toMatch(/if \(isSportsDataEnabled\('lineup'\)/)
    expect(read(AUTO_SUB)).toMatch(/if \(isSportsDataEnabled\('lineup'\)/)
  })
  it('the sports-data block is additive (spread into the response, existing fields untouched)', () => {
    expect(read(LOCK_STATE)).toMatch(/lock: lockCtx,\s*\n\s*\.\.\.\(certifiedSportsEvidence/)
    expect(read(AUTO_SUB)).toMatch(/\.\.\.\(sportsDataGuard/)
  })
  it('evidence computation is wrapped so it can never turn a safe result into an error', () => {
    expect(read(LOCK_STATE)).toMatch(/try \{[\s\S]*catch/)
    expect(read(AUTO_SUB)).toMatch(/try \{[\s\S]*sportsDataGuard[\s\S]*catch/)
  })
})

describe('direct-provider import guard (Part 12)', () => {
  it('wired Lineup routes + integration service do not import a provider client or hit a provider URL', () => {
    const FORBIDDEN = /(from ['"]@\/lib\/sleeper|from ['"]@\/lib\/espn|sleeper-client|espn-client|api\.sleeper\.app|site\.api\.espn\.com)/
    for (const f of [LOCK_STATE, AUTO_SUB, INTEGRATION]) {
      expect(FORBIDDEN.test(read(f)), `${f} must reach providers only through the gateway ports`).toBe(false)
    }
  })
})

describe('extractPlayerRefs (defensive roster parsing)', () => {
  it('extracts sleeper ids from arrays and objects; bounds the result', async () => {
    const { extractPlayerRefs } = await import('@/lib/fantasy-os/sports-runtime/lineupIntegration')
    expect(extractPlayerRefs(['1', '2'])).toEqual([{ canonicalPlayerId: '1', providerSleeperId: '1' }, { canonicalPlayerId: '2', providerSleeperId: '2' }])
    expect(extractPlayerRefs({ starters: [{ playerId: '4046' }] })).toEqual([{ canonicalPlayerId: '4046', providerSleeperId: '4046' }])
    expect(extractPlayerRefs(null)).toEqual([])
    expect(extractPlayerRefs({ players: Array.from({ length: 100 }, (_, i) => String(i)) }).length).toBe(60)
  })
})
