import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('server-only', () => ({}))

import { CertifiedMatchupIntegrationService, MATCHUP_UNSUPPORTED } from '@/lib/fantasy-os/sports-runtime/matchupIntegration'
import { normalizeMatchupState } from '@/lib/shared-services/game-day/MatchupStateNormalizer'
import type { MatchupCenterPayload } from '@/lib/matchup-center/types'

const game = (id: string, status: string) => ({ canonicalGameId: id, homeTeamId: 'nfl:KC', awayTeamId: 'nfl:BUF', scheduledStart: '2026-09-10T00:20Z', status })
const meta = (ageMin: number) => ({ version: 'nfl-games-2026-w1', generatedAt: new Date(Date.now() - ageMin * 60000).toISOString(), provider: 'espn', limitations: [], unresolvedCount: 0, rejectedCount: 0 })
const svc = (games: unknown[], m: unknown) => new CertifiedMatchupIntegrationService({ getCertifiedRecords: async () => ({ records: games }), getCertifiedSnapshotMeta: async () => m } as never)

const root = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')
const SERVICE = 'lib/fantasy-os/sports-runtime/matchupIntegration.ts'
const NORMALIZER = 'lib/shared-services/game-day/MatchupStateNormalizer.ts'
const ASSEMBLER = 'lib/shared-services/game-day/GameDayContextAssembler.ts'
const ROUTE = 'app/api/leagues/[leagueId]/matchup-center/route.ts'
const noProvider = (src: string) => /(from ['"]@\/lib\/sleeper|from ['"]@\/lib\/espn|sleeper-client|espn-client|api\.sleeper\.app|site\.api\.espn\.com)/.test(src)

describe('5E-g Matchup — service (informational + finality evidence)', () => {
  it('describes certified game states + finality (all final)', async () => {
    const ctx = await svc([game('g1', 'final'), game('g2', 'final')], meta(5)).describeMatchupGameStates({ season: '2026', week: '1' })
    expect(ctx.available).toBe(true)
    expect(ctx.allGamesFinal).toBe(true)
    expect(ctx.finalGames).toBe(2)
    expect(ctx.freshnessStatus).toBe('current')
  })
  it('surfaces a stale schedule truthfully (delayed)', async () => {
    const ctx = await svc([game('g1', 'final')], meta(180)).describeMatchupGameStates({ season: '2026', week: '1' })
    expect(ctx.freshnessStatus).toBe('delayed')
  })
  it('surfaces an unavailable schedule truthfully', async () => {
    const ctx = await svc([], null).describeMatchupGameStates({ season: '2026', week: '1' })
    expect(ctx.available).toBe(false)
    expect(ctx.freshnessStatus).toBe('unavailable')
  })
  it('unsupported fantasy fields (score/projection/injury/winProbability) remain unavailable', () => {
    expect(MATCHUP_UNSUPPORTED.liveFantasyScore).toBe('unavailable')
    expect(MATCHUP_UNSUPPORTED.winProbability).toBe('unavailable')
    expect(MATCHUP_UNSUPPORTED.inferredWinner).toBe('unavailable')
  })
  it('game-final evidence alone only SUPPORTS finalization (trustworthy+allFinal), never causes it', async () => {
    const canFinal = await svc([game('g1', 'final')], meta(5)).evaluateMatchupFinalityEvidence({ season: '2026', week: '1' })
    expect(canFinal.canSupportFinalization).toBe(true)
    const notFinal = await svc([game('g1', 'live')], meta(5)).evaluateMatchupFinalityEvidence({ season: '2026', week: '1' })
    expect(notFinal.canSupportFinalization).toBe(false)
    // stale evidence never supports finalization even if all games say final
    const stale = await svc([game('g1', 'final')], meta(180)).evaluateMatchupFinalityEvidence({ season: '2026', week: '1' })
    expect(stale.canSupportFinalization).toBe(false)
  })
})

describe('5E-g Matchup — normalizer receives evidence without losing authority', () => {
  const payload = { left: { rosterId: 'r1' }, right: { rosterId: 'r2' }, matchupStatus: 'live', partialData: false } as unknown as MatchupCenterPayload
  it('attaches certified evidence but never changes the authoritative state', () => {
    const base = normalizeMatchupState({ matchup: payload, fetchedAt: new Date().toISOString(), unavailableReason: null })
    const withEv = normalizeMatchupState({ matchup: payload, fetchedAt: new Date().toISOString(), unavailableReason: null, certifiedGameEvidence: { available: true, freshnessStatus: 'current', snapshotVersion: 'v1', totalGames: 16, finalGames: 16, allGamesFinal: true } })
    expect(withEv.state).toBe(base.state) // state unchanged
    expect(withEv.certifiedGameEvidence?.allGamesFinal).toBe(true) // evidence attached
  })
  it('final certified evidence does NOT flip a live matchup to final', () => {
    const withEv = normalizeMatchupState({ matchup: payload, fetchedAt: new Date().toISOString(), unavailableReason: null, certifiedGameEvidence: { available: true, freshnessStatus: 'current', snapshotVersion: 'v1', totalGames: 16, finalGames: 16, allGamesFinal: true } })
    expect(withEv.state).not.toBe('final')
  })
})

describe('5E-g Matchup — wiring + authority preservation (static)', () => {
  it('service composes certified game reads + no provider access', () => {
    const src = read(SERVICE)
    expect(src).toMatch(/getCertifiedSchedule/)
    expect(src).not.toMatch(/fantasyPoints|calculateScore/)
    expect(noProvider(src)).toBe(false)
  })
  it('normalizer is additive: certified evidence never touches state derivation', () => {
    const src = read(NORMALIZER)
    expect(src).toMatch(/withCertifiedEvidence/)
    expect(src).toMatch(/NEVER changes/i)
  })
  it('game-day assembler feeds evidence into the normalizer, gated, wrapped', () => {
    const src = read(ASSEMBLER)
    expect(src).toMatch(/isSportsDataEnabled\('matchup'\)/)
    expect(src).toMatch(/certifiedGameEvidence/)
    expect(src).toMatch(/try \{[\s\S]*describeMatchupGameStates[\s\S]*catch/)
  })
  it('matchup read route consumes certified context, gated, with no new persistence and no provider access', () => {
    const src = read(ROUTE)
    expect(src).toMatch(/isSportsDataEnabled\('matchup'\)/)
    expect(src).toMatch(/describeMatchupGameStates/)
    expect(src).not.toMatch(/prisma\.\w+\.(update|create|delete|upsert)/) // read-only
    expect(noProvider(src)).toBe(false)
  })
})
