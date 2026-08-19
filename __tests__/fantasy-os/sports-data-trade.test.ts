import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('server-only', () => ({}))

import { CertifiedTradeIntegrationService, extractTradePlayerRefs } from '@/lib/fantasy-os/sports-runtime/tradeIntegration'
import type { CertifiedScheduleDescription } from '@/lib/fantasy-os/sports-runtime/lineupIntegration'

const descWith = (available: boolean, freshness: string, players: CertifiedScheduleDescription['players']): CertifiedScheduleDescription => ({
  available, freshnessStatus: freshness, identityStatus: available ? 'resolved' : 'unresolved', snapshotVersion: available ? 'v1' : null, players,
  unsupported: { injuries: 'unavailable', projections: 'unavailable', availability: 'unavailable' },
})
const player = (id: string, locked: boolean) => ({ canonicalPlayerId: id, kickoff: '2026-09-10T00:20Z', gameStatus: 'scheduled', lockEvidence: locked ? 'at_or_after_start' : 'before_start', locked })
const svcWith = (desc: CertifiedScheduleDescription) => new CertifiedTradeIntegrationService({ describeScheduleForPlayers: async () => desc } as never)

const root = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')
const PROPOSAL = 'app/api/leagues/[leagueId]/trades/route.ts'
const ACCEPT = 'app/api/leagues/[leagueId]/trades/[tradeId]/accept/route.ts'
const PROCESS = 'app/api/leagues/[leagueId]/trades/[tradeId]/process/route.ts'
const DETAIL = 'app/api/leagues/[leagueId]/trades/[tradeId]/route.ts'
const SERVICE = 'lib/fantasy-os/sports-runtime/tradeIntegration.ts'
const GUARD = 'lib/fantasy-os/sports-runtime/tradeSettlementGuard.ts'
const noProvider = (src: string) => /(from ['"]@\/lib\/sleeper|from ['"]@\/lib\/espn|sleeper-client|espn-client|api\.sleeper\.app|site\.api\.espn\.com)/.test(src)

describe('5E-f Trade — service (informational + reject-only, grounded)', () => {
  const refs = [{ canonicalPlayerId: 'p1' }]
  it('unsupported fields (injuries/projections/availability) remain unavailable — never fabricated', async () => {
    const d = await svcWith(descWith(true, 'current', [player('p1', false)])).describeTradeSportsContext({ season: '2026', week: '1', players: refs })
    expect(d.unsupported).toEqual({ injuries: 'unavailable', projections: 'unavailable', availability: 'unavailable' })
  })
  it('uncertain/started evidence does NOT invent a rejection when the engine does not enforce the policy', async () => {
    // current + locked player, but enforcePlayerLock:false (the value the real routes pass) => never blocks
    const r = await svcWith(descWith(true, 'current', [player('p1', true)])).evaluateTradeSettlementSafety({ season: '2026', week: '1', players: refs, enforcePlayerLock: false })
    expect(r.block).toBe(false)
    expect(r.startedPlayers).toContain('p1') // evidence surfaced, but not a rejection
    expect(r.reason).toMatch(/not enforce/i)
  })
  it('is reject-capable only when an existing rule enforces it (grounded, not invented)', async () => {
    const r = await svcWith(descWith(true, 'current', [player('p1', true)])).evaluateTradeProposalSafety({ season: '2026', week: '1', players: refs, enforcePlayerLock: true })
    expect(r.block).toBe(true)
  })
  it('fails open on unavailable/stale certified data', async () => {
    const un = await svcWith(descWith(false, 'unavailable', [])).evaluateTradeSettlementSafety({ season: '2026', week: '1', players: refs, enforcePlayerLock: true })
    expect(un.block).toBe(false)
    const stale = await svcWith(descWith(true, 'delayed', [player('p1', true)])).evaluateTradeSettlementSafety({ season: '2026', week: '1', players: refs, enforcePlayerLock: true })
    expect(stale.block).toBe(false)
  })
  it('extractTradePlayerRefs takes only player assets (skips picks/faab)', () => {
    const refsOut = extractTradePlayerRefs([{ itemType: 'player', itemReference: '123' }, { itemType: 'pick', itemReference: '2026-1' }, { itemType: 'faab', itemReference: '50' }])
    expect(refsOut).toHaveLength(1)
    expect(refsOut[0].canonicalPlayerId).toBe('123')
  })
})

describe('5E-f Trade — service/guard reuse + no provider access', () => {
  it('service composes the lineup schedule primitive (no duplicated schedule/lock/trade rules)', () => {
    const src = read(SERVICE)
    expect(src).toMatch(/CertifiedLineupIntegrationService/)
    expect(src).toMatch(/describeScheduleForPlayers/)
    expect(noProvider(src)).toBe(false)
  })
  it('settlement guard reuses getAfLeagueTrade + service and reaches no provider', () => {
    const src = read(GUARD)
    expect(src).toMatch(/getAfLeagueTrade/)
    expect(src).toMatch(/evaluateTradeSettlementSafety/)
    expect(src).toMatch(/enforcePlayerLock: false/)
    expect(noProvider(src)).toBe(false)
  })
})

describe('5E-f Trade — proposal path preserves existing rules', () => {
  const src = read(PROPOSAL)
  it('consumes certified evidence, gated, before createAfLeagueTrade (authoritative validate+persist)', () => {
    expect(src).toMatch(/isSportsDataEnabled\('trade'\)/)
    expect(src).toMatch(/evaluateTradeProposalSafety/)
    expect(src.indexOf('evaluateTradeProposalSafety')).toBeLessThan(src.indexOf('createAfLeagueTrade({'))
  })
  it('preserves createAfLeagueTrade authority, emits evidence, no provider access', () => {
    expect(src).toMatch(/createAfLeagueTrade\(/)
    expect(src).toMatch(/sportsDataDecision/)
    expect(noProvider(src)).toBe(false)
  })
})

describe('5E-f Trade — settlement paths invoke certified evidence before persistence', () => {
  it('accept: guard runs before acceptAfLeagueTrade (atomic settlement authority unchanged)', () => {
    const src = read(ACCEPT)
    expect(src).toMatch(/evaluateTradeSettlementGuard/)
    expect(src.indexOf('evaluateTradeSettlementGuard')).toBeLessThan(src.indexOf('acceptAfLeagueTrade({'))
    expect(src).toMatch(/assertLeagueMember/) // ownership/membership authority preserved
    expect(noProvider(src)).toBe(false)
  })
  it('process: guard runs before finalizeAfLeagueTradeProcessing (settlement authority final)', () => {
    const src = read(PROCESS)
    expect(src).toMatch(/evaluateTradeSettlementGuard/)
    expect(src.indexOf('evaluateTradeSettlementGuard')).toBeLessThan(src.indexOf('finalizeAfLeagueTradeProcessing({'))
    expect(src).toMatch(/isElevatedCommissioner/) // commissioner authority preserved
    expect(src).toMatch(/code: 'SPORTS_DATA_LOCK'/)
    expect(noProvider(src)).toBe(false)
  })
})

describe('5E-f Trade — analysis path is informational and deterministic', () => {
  const src = read(DETAIL)
  it('attaches informational sportsContext without altering the trade payload (valuation/reconstruction untouched)', () => {
    expect(src).toMatch(/describeTradeSportsContext/)
    expect(src).toMatch(/isSportsDataEnabled\('trade'\)/)
    // the trade object returned by getAfLeagueTrade is passed through unchanged; sportsContext is a sibling field
    expect(src).toMatch(/return NextResponse\.json\(\{ trade, \.\.\.\(sportsContext/)
    expect(noProvider(src)).toBe(false)
  })
})
