import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('server-only', () => ({}))

import { CertifiedScoringIntegrationService } from '@/lib/fantasy-os/sports-runtime/scoringIntegration'
import { CertifiedMatchupIntegrationService } from '@/lib/fantasy-os/sports-runtime/matchupIntegration'
import { isSportsDataEnabled } from '@/lib/fantasy-os/sports-runtime/gates'

const game = (id: string, status: string) => ({ canonicalGameId: id, homeTeamId: 'nfl:KC', awayTeamId: 'nfl:BUF', scheduledStart: '2026-09-10T00:20Z', status })
const meta = (ageMin: number) => ({ version: 'nfl-games-2026-w1', generatedAt: new Date(Date.now() - ageMin * 60000).toISOString(), provider: 'espn', limitations: [], unresolvedCount: 0, rejectedCount: 0 })
const scoringSvc = (games: unknown[], m: unknown) => new CertifiedScoringIntegrationService(new CertifiedMatchupIntegrationService({ getCertifiedRecords: async () => ({ records: games }), getCertifiedSnapshotMeta: async () => m } as never))

const root = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')
const SERVICE = 'lib/fantasy-os/sports-runtime/scoringIntegration.ts'
const ENGINE = 'lib/redraft/scoringEngine.ts'
const GATES = 'lib/fantasy-os/sports-runtime/gates.ts'
const noProvider = (src: string) => /(from ['"]@\/lib\/sleeper|from ['"]@\/lib\/espn|sleeper-client|espn-client|api\.sleeper\.app|site\.api\.espn\.com)/.test(src)

describe('5E-g Scoring — honest capability + finality evidence', () => {
  it('5F-a: certified player statistics now exist but are NOT a scoring input (existing inputs stay authoritative)', () => {
    const avail = scoringSvc([], null).describeStatSourceAvailability()
    expect(avail.certifiedPlayerStatistics).toBe('certified-not-scoring-input')
    expect(avail.authoritativeStatInputs).toContain('PlayerWeeklyScore')
    expect(avail.authoritativeStatInputs).toContain('PlayerGameLogCache')
  })
  it('certified statistics are not yet wired as a scoring input (scoring still uses existing inputs)', () => {
    const avail = scoringSvc([], null).describeStatSourceAvailability()
    expect(avail.certifiedGameContext).toBe('available')
    expect(avail.certifiedPlayerStatistics).not.toBe('scoring-input')
  })
  it('consumes certified game-state evidence for the scoring week', async () => {
    const ctx = await scoringSvc([game('g1', 'final')], meta(5)).describeScoringGameContext({ season: '2026', week: '1' })
    expect(ctx.available).toBe(true)
    expect(ctx.allGamesFinal).toBe(true)
  })
  it('final game status alone does not finalize scoring — evidence only SUPPORTS finalization', async () => {
    const support = await scoringSvc([game('g1', 'final')], meta(5)).evaluateScoringFinalityEvidence({ season: '2026', week: '1' })
    expect(support.certifiedGamesSupportFinalization).toBe(true) // supports, does not itself finalize
    const notYet = await scoringSvc([game('g1', 'live')], meta(5)).evaluateScoringFinalityEvidence({ season: '2026', week: '1' })
    expect(notYet.certifiedGamesSupportFinalization).toBe(false)
  })
  it('fails open on stale/unavailable certified data', async () => {
    const stale = await scoringSvc([game('g1', 'final')], meta(180)).evaluateScoringFinalityEvidence({ season: '2026', week: '1' })
    expect(stale.certifiedGamesSupportFinalization).toBe(false)
    const un = await scoringSvc([], null).evaluateScoringFinalityEvidence({ season: '2026', week: '1' })
    expect(un.certifiedGamesSupportFinalization).toBe(false)
  })
})

describe('5E-g Scoring — gate registry', () => {
  it('a dedicated scoring gate exists and is off by default', () => {
    expect(read(GATES)).toMatch(/FANTASY_OS_SPORTS_DATA_SCORING_ENABLED/)
    expect(isSportsDataEnabled('scoring')).toBe(false)
  })
})

describe('5E-g Scoring — engine finalization guard (stricter-only, static)', () => {
  const src = read(ENGINE)
  it('consumes the certified scoring service, gated', () => {
    expect(src).toMatch(/CertifiedScoringIntegrationService/)
    expect(src).toMatch(/isSportsDataEnabled\('scoring'\)/)
  })
  it('preserves the existing finalization authority (existingFinal) and can only make it stricter', () => {
    expect(src).toMatch(/const existingFinal = isComplete && home\.allFinal && away\.allFinal/)
    // the guard only ever sets isFinal to false (withholds), never to true
    expect(src).toMatch(/if \(existingFinal && isSportsDataEnabled\('scoring'\)/)
    expect(src).toMatch(/isFinal = false/)
    expect(src).not.toMatch(/isFinal = true/)
  })
  it('fantasy points are unchanged by the guard (only status/isFinal is touched)', () => {
    expect(src).toMatch(/homeScore: home\.points/)
    expect(src).toMatch(/awayScore: away\.points/)
  })
  it('idempotent finalization event key + transaction boundary preserved', () => {
    expect(src).toMatch(/idempotencyKey: `matchup\.finalized:\$\{matchupId\}`/)
    expect(src).toMatch(/prisma\.redraftMatchup\.update/)
  })
  it('emits evidence and reaches no provider directly', () => {
    expect(src).toMatch(/\[scoring\]\[sports-data\]/)
    expect(noProvider(src)).toBe(false)
  })
})

describe('5E-g Scoring — service reuse + no provider access', () => {
  it('composes the matchup game service (no duplicated schedule/scoring rules) + no provider', () => {
    const src = read(SERVICE)
    expect(src).toMatch(/CertifiedMatchupIntegrationService/)
    // does not import or call the real fantasy-point calculator (evidence only, never computes points)
    expect(src).not.toMatch(/calculateFantasyPoints|scoreStatsWithCategories|calculateScoreFromSportConfig/)
    expect(noProvider(src)).toBe(false)
  })
})
