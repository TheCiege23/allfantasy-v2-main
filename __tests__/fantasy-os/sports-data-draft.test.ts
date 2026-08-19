import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('server-only', () => ({}))

import { CertifiedDraftIntegrationService } from '@/lib/fantasy-os/sports-runtime/draftIntegration'
import type { CertifiedScheduleDescription } from '@/lib/fantasy-os/sports-runtime/lineupIntegration'

const descWith = (available: boolean, freshness: string, players: CertifiedScheduleDescription['players']): CertifiedScheduleDescription => ({
  available, freshnessStatus: freshness, identityStatus: available ? 'resolved' : 'unresolved', snapshotVersion: available ? 'v1' : null, players,
  unsupported: { injuries: 'unavailable', projections: 'unavailable', availability: 'unavailable' },
})
const player = (id: string, locked: boolean) => ({ canonicalPlayerId: id, kickoff: '2026-09-10T00:20Z', gameStatus: 'scheduled', lockEvidence: locked ? 'at_or_after_start' : 'before_start', locked })
const svcWith = (desc: CertifiedScheduleDescription) => new CertifiedDraftIntegrationService({ describeScheduleForPlayers: async () => desc } as never)

const root = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')
const PICK = 'app/api/leagues/[leagueId]/draft/pick/route.ts'
const SESSION = 'app/api/leagues/[leagueId]/draft/session/route.ts'
const SERVICE = 'lib/fantasy-os/sports-runtime/draftIntegration.ts'
const noProvider = (src: string) => /(from ['"]@\/lib\/sleeper|from ['"]@\/lib\/espn|sleeper-client|espn-client|api\.sleeper\.app|site\.api\.espn\.com)/.test(src)

describe('5E-f Draft — service (evidence only, never a Draft legality rule)', () => {
  const ref = { canonicalPlayerId: 'p1' }
  it('unsupported injury/projection/availability remain unavailable', async () => {
    const d = await svcWith(descWith(true, 'current', [player('p1', false)])).describeDraftPlayerSportsContext({ season: '2026', week: '1', player: ref })
    expect(d.unsupported).toEqual({ injuries: 'unavailable', projections: 'unavailable', availability: 'unavailable' })
  })
  it('evaluateDraftPickSafety NEVER blocks — even when identity unresolved / schedule unavailable', async () => {
    const r = await svcWith(descWith(false, 'unavailable', [])).evaluateDraftPickSafety({ season: '2026', week: '1', player: ref })
    expect(r.block).toBe(false)
    expect(r.identityStatus).toBe('unresolved')
  })
  it('evaluateDraftPickSafety NEVER blocks — even when the drafted player game has started (not a Draft rule)', async () => {
    const r = await svcWith(descWith(true, 'current', [player('p1', true)])).evaluateDraftPickSafety({ season: '2026', week: '1', player: ref })
    expect(r.block).toBe(false)
    expect(r.player?.locked).toBe(true) // evidence attached, but never blocks
  })
  it('composes the lineup schedule primitive + no provider access', () => {
    const src = read(SERVICE)
    expect(src).toMatch(/CertifiedLineupIntegrationService/)
    expect(src).toMatch(/describeScheduleForPlayers/)
    expect(src).not.toMatch(/block: true/)
    expect(noProvider(src)).toBe(false)
  })
})

describe('5E-f Draft — live pick route preserves all pick authorities', () => {
  const src = read(PICK)
  it('consumes the shared integration service (player-card evidence), gated', () => {
    expect(src).toMatch(/CertifiedDraftIntegrationService/)
    expect(src).toMatch(/isSportsDataEnabled\('draft'\)/)
  })
  it('current-pick + ownership authority remains final (DRAFT_PICK_NOT_ON_CLOCK, canSubmitPickForRoster)', () => {
    expect(src).toMatch(/DRAFT_PICK_NOT_ON_CLOCK/)
    expect(src).toMatch(/canSubmitPickForRoster/)
  })
  it('submitPick remains the authoritative persist + duplicate/roster-construction authority', () => {
    expect(src).toMatch(/const result = await submitPick\(/)
    // evidence is computed AFTER submitPick (at its call site), never gating it
    expect(src.indexOf('const result = await submitPick(')).toBeLessThan(src.indexOf('const sportsDataDecision = await draftPickSportsEvidence('))
  })
  it('idempotent replay + exactly-once side effects are preserved', () => {
    expect(src).toMatch(/result\.idempotentReplay/)
    expect(src).toMatch(/expectedOverall/) // conflicting/stale retry authority preserved
    // the idempotentReplay early return happens before the audit/fanout side effects
    expect(src.indexOf('if (result.idempotentReplay)')).toBeLessThan(src.indexOf("actionType: 'draft_pick'"))
  })
  it('emits evidence and reaches no provider directly', () => {
    expect(src).toMatch(/sportsDataDecision/)
    expect(noProvider(src)).toBe(false)
  })
})

describe('5E-f Draft — room/board informational context', () => {
  const src = read(SESSION)
  it('session route consumes certified board context, gated, informational only', () => {
    expect(src).toMatch(/describeDraftBoardSportsContext/)
    expect(src).toMatch(/isSportsDataEnabled\('draft'\)/)
    expect(src).toMatch(/sportsContext/)
  })
  it('preserves existing draft authorities (submitPick/pool untouched) and no provider access', () => {
    // the session route does not submit picks; board context is a sibling field on the response only
    expect(src).not.toMatch(/submitPick/)
    expect(noProvider(src)).toBe(false)
  })
})
