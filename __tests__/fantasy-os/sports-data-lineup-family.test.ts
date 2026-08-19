import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('server-only', () => ({}))

import { CertifiedLineupIntegrationService } from '@/lib/fantasy-os/sports-runtime/lineupIntegration'
import type { LiveLineupSportsContext } from '@/lib/sports-data-gateway/runtime/lineupSafety'

const ctx = (id: string, lock: LiveLineupSportsContext['sportsDataLockEvidence'], start = '2026-09-10T00:20Z'): LiveLineupSportsContext => ({
  canonicalPlayerId: id, canonicalTeamId: 'nfl:KC', canonicalGameId: 'espn:nfl:1', scheduledStart: start,
  gameStatus: 'scheduled', gameResolutionStatus: 'resolved', sportsDataLockEvidence: lock, dataContext: {} as never, limitations: [],
})
const svcWith = (available: boolean, freshness: string, contexts: LiveLineupSportsContext[]) => {
  const s = new CertifiedLineupIntegrationService({} as never)
  s.getScheduleEvidenceForPlayers = async () => ({ available, contexts, runtimeContext: { generatedAt: 't', sourceProviders: ['espn'], snapshotVersions: ['v1'], freshnessStatus: freshness as never, identityStatus: available ? 'resolved' : 'unresolved', limitations: [], evidenceIds: ['v1'] } })
  return s
}

const root = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')
const SAVE = 'app/api/leagues/roster/save/route.ts'
const START_SIT = 'app/api/leagues/[leagueId]/ai/start-sit/route.ts'
const TODAY = 'app/api/today/lineup-actions/[leagueId]/route.ts'
const noProvider = (src: string) => /(from ['"]@\/lib\/sleeper|from ['"]@\/lib\/espn|sleeper-client|espn-client|api\.sleeper\.app|site\.api\.espn\.com)/.test(src)

describe('5E-d — informational certified schedule description', () => {
  const refs = [{ canonicalPlayerId: 'p1' }, { canonicalPlayerId: 'p2' }]
  it('exposes schedule evidence (kickoff, status, lock) for read-only surfaces', async () => {
    const d = await svcWith(true, 'current', [ctx('p1', 'before_start'), ctx('p2', 'at_or_after_start')]).describeScheduleForPlayers({ season: '2026', week: '1', players: refs })
    expect(d.available).toBe(true)
    expect(d.players).toHaveLength(2)
    expect(d.players[0]).toMatchObject({ canonicalPlayerId: 'p1', kickoff: '2026-09-10T00:20Z', locked: false })
    expect(d.players[1].locked).toBe(true) // at_or_after_start
  })
  it('marks injuries/projections/availability explicitly unavailable — never fabricated', async () => {
    const d = await svcWith(true, 'current', [ctx('p1', 'before_start')]).describeScheduleForPlayers({ season: '2026', week: '1', players: [refs[0]] })
    expect(d.unsupported).toEqual({ injuries: 'unavailable', projections: 'unavailable', availability: 'unavailable' })
  })
  it('fails to available:false (no fabricated schedule) when certified snapshot is unavailable', async () => {
    const d = await svcWith(false, 'unavailable', []).describeScheduleForPlayers({ season: '2026', week: '1', players: refs })
    expect(d.available).toBe(false)
    expect(d.players).toEqual([])
    expect(d.unsupported.injuries).toBe('unavailable')
  })
})

describe('5E-d — canonical save route wiring + authority preservation', () => {
  const src = read(SAVE)
  it('uses the certified context (service + gate)', () => {
    expect(src).toMatch(/lineupIntegration/)
    expect(src).toMatch(/isSportsDataEnabled\('lineup'\)/)
    expect(src).toMatch(/evaluateLineupPersistSafety/)
  })
  it('the certified check runs BEFORE persist and is reject-only (409)', () => {
    expect(src.indexOf('evaluateLineupPersistSafety')).toBeLessThan(src.indexOf('persistRosterLineupWithEngine({'))
    expect(src).toMatch(/code: 'SPORTS_DATA_LOCK'[\s\S]*status: 409/)
  })
  it('preserves the deterministic authority: engine persist with skipLockCheck:false (atomic persistence unchanged)', () => {
    expect(src).toMatch(/persistRosterLineupWithEngine/)
    expect(src).toMatch(/skipLockCheck:\s*false/)
  })
  it('is gated + wrapped so gate OFF preserves behavior and never turns a safe save into an error', () => {
    expect(src).toMatch(/if \(isSportsDataEnabled\('lineup'\)/)
    expect(src).toMatch(/try \{[\s\S]*evaluateLineupPersistSafety[\s\S]*catch/)
  })
  it('reaches providers only through gateway ports (no direct provider import/URL)', () => {
    expect(noProvider(src)).toBe(false)
  })
})

describe('5E-d — Start/Sit wiring (schedule evidence only, no mutation)', () => {
  const src = read(START_SIT)
  it('injects informational schedule evidence + gate', () => {
    expect(src).toMatch(/describeScheduleForPlayers/)
    expect(src).toMatch(/isSportsDataEnabled\('lineup'\)/)
    expect(src).toMatch(/sportsSchedule/)
  })
  it('preserves the existing advice authority (runStartSitAiEngine) and does not persist', () => {
    expect(src).toMatch(/runStartSitAiEngine/)
    expect(src).not.toMatch(/persistRosterLineupWithEngine/)
  })
  it('is gated + wrapped and uses no direct provider access', () => {
    expect(src).toMatch(/try \{[\s\S]*describeScheduleForPlayers[\s\S]*catch/)
    expect(noProvider(src)).toBe(false)
  })
})

describe('5E-d — Today Lineup Actions wiring (urgency only, never mutates)', () => {
  const src = read(TODAY)
  it('exposes informational schedule urgency + gate', () => {
    expect(src).toMatch(/describeScheduleForPlayers/)
    expect(src).toMatch(/isSportsDataEnabled\('lineup'\)/)
    expect(src).toMatch(/informationalOnly/)
    expect(src).toMatch(/lockUrgency/)
  })
  it('preserves computeLineupActionsForUser as the authority and never persists/mutates a lineup', () => {
    expect(src).toMatch(/computeLineupActionsForUser/)
    expect(src).not.toMatch(/persistRosterLineupWithEngine/)
  })
  it('is gated + wrapped and uses no direct provider access', () => {
    expect(src).toMatch(/try \{[\s\S]*buildSportsScheduleUrgency[\s\S]*catch/)
    expect(noProvider(src)).toBe(false)
  })
})
