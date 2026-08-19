import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('server-only', () => ({}))

import { CertifiedWaiverIntegrationService } from '@/lib/fantasy-os/sports-runtime/waiverIntegration'
import type { CertifiedScheduleDescription } from '@/lib/fantasy-os/sports-runtime/lineupIntegration'

// Stub the composed lineup schedule primitive (single source of truth for schedule evidence).
const descWith = (available: boolean, freshness: string, players: CertifiedScheduleDescription['players']): CertifiedScheduleDescription => ({
  available, freshnessStatus: freshness, identityStatus: available ? 'resolved' : 'unresolved', snapshotVersion: available ? 'v1' : null, players,
  unsupported: { injuries: 'unavailable', projections: 'unavailable', availability: 'unavailable' },
})
const player = (id: string, locked: boolean) => ({ canonicalPlayerId: id, kickoff: '2026-09-10T00:20Z', gameStatus: 'scheduled', lockEvidence: locked ? 'at_or_after_start' : 'before_start', locked })
const svcWith = (desc: CertifiedScheduleDescription) => {
  const s = new CertifiedWaiverIntegrationService({ describeScheduleForPlayers: async () => desc } as never)
  return s
}

const root = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')
const CLAIMS = 'app/api/waiver-wire/leagues/[leagueId]/claims/route.ts'
const ELIG = 'app/api/waiver-wire/leagues/[leagueId]/eligibility/route.ts'
const ASSEMBLER = 'lib/shared-services/waiver/WaiverContextAssembler.ts'
const SERVICE = 'lib/fantasy-os/sports-runtime/waiverIntegration.ts'
const noProvider = (src: string) => /(from ['"]@\/lib\/sleeper|from ['"]@\/lib\/espn|sleeper-client|espn-client|api\.sleeper\.app|site\.api\.espn\.com)/.test(src)

describe('5E-e — CertifiedWaiverIntegrationService (reject-only + informational)', () => {
  const addRefs = [{ canonicalPlayerId: 'add1' }]
  it('BLOCKS a claim only on trustworthy (current) evidence an add/drop player is locked/started', async () => {
    const r = await svcWith(descWith(true, 'current', [player('add1', true)])).evaluateWaiverClaimSafety({ season: '2026', week: '1', addRefs, dropRefs: [] })
    expect(r.block).toBe(true)
    expect(r.blockedPlayers).toContain('add1')
  })
  it('does NOT block when the add/drop player is before start (current)', async () => {
    const r = await svcWith(descWith(true, 'current', [player('add1', false)])).evaluateWaiverClaimSafety({ season: '2026', week: '1', addRefs, dropRefs: [] })
    expect(r.block).toBe(false)
  })
  it('fails OPEN on a stale schedule (never blocks a human-confirmed manual claim)', async () => {
    const r = await svcWith(descWith(true, 'delayed', [player('add1', true)])).evaluateWaiverClaimSafety({ season: '2026', week: '1', addRefs, dropRefs: [] })
    expect(r.block).toBe(false)
    expect(r.reason).toMatch(/not used to block/i)
  })
  it('fails OPEN (existing authority final) when certified schedule is unavailable', async () => {
    const r = await svcWith(descWith(false, 'unavailable', [])).evaluateWaiverClaimSafety({ season: '2026', week: '1', addRefs, dropRefs: [] })
    expect(r.block).toBe(false)
    expect(r.reason).toMatch(/unavailable/i)
  })
  it('describeWaiverScheduleContext surfaces unsupported injury/projection/availability as unavailable', async () => {
    const d = await svcWith(descWith(true, 'current', [player('add1', false)])).describeWaiverScheduleContext({ season: '2026', week: '1', players: addRefs })
    expect(d.unsupported).toEqual({ injuries: 'unavailable', projections: 'unavailable', availability: 'unavailable' })
    expect(d.available).toBe(true)
  })
})

describe('5E-e — service reuses the lineup schedule primitive (no duplicated rules) + no provider access', () => {
  const src = read(SERVICE)
  it('composes CertifiedLineupIntegrationService rather than reimplementing schedule/lock logic', () => {
    expect(src).toMatch(/CertifiedLineupIntegrationService/)
    expect(src).toMatch(/describeScheduleForPlayers/)
    // does not redefine its own lock-evidence set
    expect(src).not.toMatch(/new Set\(\[['"]at_or_after_start/)
  })
  it('reaches providers only through gateway ports', () => { expect(noProvider(src)).toBe(false) })
})

describe('5E-e — submission (claims) route wiring + authority preservation', () => {
  const src = read(CLAIMS)
  it('consumes certified context via the waiver service + gate', () => {
    expect(src).toMatch(/waiverIntegration/)
    expect(src).toMatch(/isSportsDataEnabled\('waiver'\)/)
    expect(src).toMatch(/evaluateWaiverClaimSafety/)
  })
  it('the certified check runs BEFORE createClaim and is reject-only (409 SPORTS_DATA_LOCK)', () => {
    expect(src.indexOf('evaluateWaiverClaimSafety')).toBeLessThan(src.indexOf('createClaim(leagueId'))
    expect(src).toMatch(/code: 'SPORTS_DATA_LOCK'[\s\S]*status: 409/)
  })
  it('preserves the deterministic waiver authority (createClaim) + roster legality gate (atomic persistence unchanged)', () => {
    expect(src).toMatch(/createClaim\(leagueId/)
    expect(src).toMatch(/assertRosterTransactionsAllowed/)
  })
  it('is gated + wrapped so gate OFF preserves behavior and never turns a valid claim into an error', () => {
    expect(src).toMatch(/if \(isSportsDataEnabled\('waiver'\)/)
    expect(src).toMatch(/try \{[\s\S]*evaluateWaiverClaimSafety[\s\S]*catch/)
  })
  it('emits decision evidence and uses no direct provider access', () => {
    expect(src).toMatch(/sportsDataDecision/)
    expect(noProvider(src)).toBe(false)
  })
})

describe('5E-e — eligibility/preview route wiring (informational, no mutation)', () => {
  const src = read(ELIG)
  it('consumes certified schedule context (describeWaiverScheduleContext) + gate', () => {
    expect(src).toMatch(/describeWaiverScheduleContext/)
    expect(src).toMatch(/isSportsDataEnabled\('waiver'\)/)
    expect(src).toMatch(/sportsSchedule/)
  })
  it('preserves the existing eligibility authority (assertWaiverClaimEligibility) and does not persist', () => {
    expect(src).toMatch(/assertWaiverClaimEligibility/)
    expect(src).not.toMatch(/createClaim/)
  })
  it('is gated + wrapped and uses no direct provider access', () => {
    expect(src).toMatch(/try \{[\s\S]*describeWaiverScheduleContext[\s\S]*catch/)
    expect(noProvider(src)).toBe(false)
  })
})

describe('5E-e — WaiverContextAssembler consumes certified context (additive, engineInput untouched)', () => {
  const src = read(ASSEMBLER)
  it('imports the gate + waiver service and returns a sportsContext field', () => {
    expect(src).toMatch(/isSportsDataEnabled\('waiver'\)/)
    expect(src).toMatch(/CertifiedWaiverIntegrationService/)
    expect(src).toMatch(/sportsContext/)
  })
  it('never feeds engineInput from certified context (deterministic recommender unchanged)', () => {
    // engineInput is assembled before sportsContext is computed; sportsContext is a sibling return field only.
    expect(src.indexOf('const engineInput')).toBeLessThan(src.indexOf('sportsContext = await'))
    // the engineInput object literal itself must not reference sportsContext
    const engIdx = src.indexOf('WaiverAIEngineInput = {')
    const engBlock = src.slice(engIdx, src.indexOf('\n  }', engIdx))
    expect(engBlock).not.toMatch(/sportsContext/)
  })
  it('is gated + wrapped and uses no direct provider access', () => {
    expect(src).toMatch(/try \{[\s\S]*describeWaiverScheduleContext[\s\S]*catch/)
    expect(noProvider(src)).toBe(false)
  })
})
