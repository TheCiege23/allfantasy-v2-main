import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('server-only', () => ({}))

import { CertifiedMatchupIntegrationService, MATCHUP_UNSUPPORTED } from '@/lib/sports-evidence/matchupIntegration'

const game = (id: string, status: string) => ({ canonicalGameId: id, homeTeamId: 'nfl:KC', awayTeamId: 'nfl:BUF', scheduledStart: '2026-09-10T00:20Z', status })
const meta = (ageMin: number) => ({ version: 'nfl-games-2026-w1', generatedAt: new Date(Date.now() - ageMin * 60000).toISOString(), provider: 'espn', limitations: [], unresolvedCount: 0, rejectedCount: 0 })
const svc = (games: unknown[], m: unknown) => new CertifiedMatchupIntegrationService({ getCertifiedRecords: async () => ({ records: games }), getCertifiedSnapshotMeta: async () => m } as never)

const root = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')
const SERVICE = 'lib/sports-evidence/matchupIntegration.ts'
// The Game Day OS normalizer + assembler this suite also pinned had no production caller and were
// removed (lib/shared-services/game-day); the certified service and the matchup read route remain.
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

describe('5E-g Matchup — wiring + authority preservation (static)', () => {
  it('service composes certified game reads + no provider access', () => {
    const src = read(SERVICE)
    expect(src).toMatch(/getCertifiedSchedule/)
    expect(src).not.toMatch(/fantasyPoints|calculateScore/)
    expect(noProvider(src)).toBe(false)
  })
  it('matchup read route consumes certified context, gated, with no new persistence and no provider access', () => {
    const src = read(ROUTE)
    expect(src).toMatch(/isSportsDataEnabled\('matchup'\)/)
    expect(src).toMatch(/describeMatchupGameStates/)
    expect(src).not.toMatch(/prisma\.\w+\.(update|create|delete|upsert)/) // read-only
    expect(noProvider(src)).toBe(false)
  })
})
