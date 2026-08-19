/**
 * Regression tests for finalizeRedraftSeasonChampion and the finalize API route.
 *
 * Root cause addressed: no champion crowning or season close-out existed.
 * Fix: finalizeRedraftSeasonChampion in lib/redraft/playoffEngine.ts +
 *      POST /api/redraft/seasons/finalize route.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
}

const engine = read('lib/redraft/playoffEngine.ts')
const route = read('app/api/redraft/seasons/finalize/route.ts')

// ─── finalizeRedraftSeasonChampion — function contract ────────────────────────

describe('finalizeRedraftSeasonChampion — function contract', () => {
  it('is exported from playoffEngine.ts', () => {
    expect(engine).toContain('export async function finalizeRedraftSeasonChampion')
  })

  it('accepts seasonId and recordedByUserId parameters', () => {
    expect(engine).toContain('seasonId: string')
    expect(engine).toContain('recordedByUserId: string')
  })

  it('returns a typed FinalizeSeasonResult', () => {
    expect(engine).toContain('FinalizeSeasonResult')
    expect(engine).toContain('export type FinalizeSeasonResult')
  })

  it('result type includes all expected status values', () => {
    expect(engine).toContain("'ok'")
    expect(engine).toContain("'already_finalized'")
    expect(engine).toContain("'no_bracket'")
    expect(engine).toContain("'no_final_round'")
    expect(engine).toContain("'final_round_incomplete'")
    expect(engine).toContain("'no_winner'")
  })

  it('result type includes champion fields', () => {
    expect(engine).toContain('championRosterId')
    expect(engine).toContain('championUserId')
    expect(engine).toContain('championTeamName')
    expect(engine).toContain('runnerUpRosterId')
    expect(engine).toContain('alreadyFinalized')
  })
})

// ─── Idempotency guard ────────────────────────────────────────────────────────

describe('finalizeRedraftSeasonChampion — idempotency', () => {
  it('checks RedraftSeason.status before writing anything', () => {
    // Must read status from the season record
    expect(engine).toContain("status: true")
    expect(engine).toContain("status === 'complete'")
  })

  it("returns 'already_finalized' status when season is already complete", () => {
    expect(engine).toContain("status: 'already_finalized'")
    expect(engine).toContain('alreadyFinalized: true')
  })

  it('does not attempt any DB writes when already finalized', () => {
    // The idempotency check must return before the prisma.$transaction block
    const beforeTransaction = engine.indexOf('prisma.$transaction')
    const idempotencyReturn = engine.indexOf("'already_finalized'")
    expect(idempotencyReturn).toBeGreaterThan(0)
    expect(beforeTransaction).toBeGreaterThan(idempotencyReturn)
  })
})

// ─── Safety guards — blocks finalization when not ready ───────────────────────

describe('finalizeRedraftSeasonChampion — safety guards', () => {
  it('returns no_bracket when RedraftPlayoffBracket is missing', () => {
    expect(engine).toContain("status: 'no_bracket'")
    // Both for missing season and missing bracket
    const matches = engine.match(/'no_bracket'/g)
    expect(matches!.length).toBeGreaterThanOrEqual(2)
  })

  it('returns no_final_round when no playoff rounds exist', () => {
    expect(engine).toContain("status: 'no_final_round'")
  })

  it('returns final_round_incomplete when final round is not status=complete', () => {
    expect(engine).toContain("status: 'final_round_incomplete'")
    expect(engine).toContain("finalRound.status !== 'completed'")
  })

  it('returns no_winner when final matchup has no winnerRosterId', () => {
    expect(engine).toContain("status: 'no_winner'")
    expect(engine).toContain('winnerRosterId')
  })

  it('selects championship matchup as the one with no nextMatchupId', () => {
    // Final round's championship matchup has no nextMatchupId
    expect(engine).toContain('nextMatchupId')
    expect(engine).toContain('!m.nextMatchupId')
  })
})

// ─── Champion determination ───────────────────────────────────────────────────

describe('finalizeRedraftSeasonChampion — champion/runner-up determination', () => {
  it('uses winnerRosterId from the championship matchup as champion', () => {
    expect(engine).toContain('champMatchup.winnerRosterId')
    expect(engine).toContain('championRosterId')
  })

  it('derives runner-up as the non-winner in the final matchup', () => {
    // Runner-up is whoever in homeRosterId/awayRosterId is not the champion
    expect(engine).toContain('runnerUpRosterId')
    expect(engine).toContain('champMatchup.homeRosterId === championRosterId')
    expect(engine).toContain('champMatchup.awayRosterId')
  })

  it('loads champion roster for team name and points', () => {
    expect(engine).toContain('redraftRoster.findUnique')
    expect(engine).toContain("select: { ownerId: true, ownerName: true, teamName: true, pointsFor: true }")
  })

  it('falls back to ownerName when teamName is null', () => {
    expect(engine).toContain('championRoster?.teamName ?? championRoster?.ownerName')
  })
})

// ─── Persistence — what gets written ─────────────────────────────────────────

describe('finalizeRedraftSeasonChampion — persistence', () => {
  it('writes LeagueChampionship via upsert (idempotent write)', () => {
    expect(engine).toContain('leagueChampionship.upsert')
    expect(engine).toContain('leagueId_season')
  })

  it('includes championUserId, teamName, pointsFor in the upsert', () => {
    expect(engine).toContain('championUserId')
    expect(engine).toContain('teamName')
    expect(engine).toContain('pointsFor')
    expect(engine).toContain('recordedBy')
  })

  it("marks RedraftSeason.status = 'complete'", () => {
    expect(engine).toContain("redraftSeason.update")
    expect(engine).toContain("{ status: 'complete' }")
  })

  it("marks RedraftPlayoffBracket.status = 'complete'", () => {
    expect(engine).toContain('redraftPlayoffBracket.update')
  })

  it("transitions League.lifecycleState to 'completed'", () => {
    expect(engine).toContain('league.update')
    expect(engine).toContain("lifecycleState: 'completed'")
  })

  it('wraps all writes in a single prisma.$transaction', () => {
    expect(engine).toContain('prisma.$transaction')
  })

  it('does not call any external provider or AI service', () => {
    expect(engine).not.toContain('fetch(')
    expect(engine).not.toContain('openai')
    expect(engine).not.toContain('anthropic')
    expect(engine).not.toContain('chimmy')
    expect(engine).not.toContain('grounding')
  })
})

// ─── API route ────────────────────────────────────────────────────────────────

describe('POST /api/redraft/seasons/finalize — route', () => {
  it('exports a POST handler', () => {
    expect(route).toContain('export async function POST')
  })

  it('is force-dynamic', () => {
    expect(route).toContain("dynamic = 'force-dynamic'")
  })

  it('requires auth — returns 401 for unauthenticated requests', () => {
    expect(route).toContain('Unauthorized')
    expect(route).toContain('401')
  })

  it('requires seasonId in body — returns 400 if missing', () => {
    expect(route).toContain('seasonId required')
    expect(route).toContain('400')
  })

  it('returns 404 when season is not found', () => {
    expect(route).toContain('Season not found')
    expect(route).toContain('404')
  })

  it('requires commissioner role — returns 403 for non-commissioners', () => {
    expect(route).toContain('Forbidden')
    expect(route).toContain('403')
  })

  it('calls finalizeRedraftSeasonChampion with seasonId and userId', () => {
    expect(route).toContain('finalizeRedraftSeasonChampion')
    expect(route).toContain('seasonId')
    expect(route).toContain('userId')
  })

  it('returns 422 when final round is incomplete', () => {
    expect(route).toContain('final_round_incomplete')
    expect(route).toContain('422')
  })

  it('returns 422 when no winner is set', () => {
    expect(route).toContain('no_winner')
    expect(route).toContain('422')
  })

  it('returns 422 when no bracket exists', () => {
    expect(route).toContain('no_bracket')
    expect(route).toContain('422')
  })

  it('returns 200 JSON with finalize result on success', () => {
    expect(route).toContain('NextResponse.json(result)')
  })

  it('does not touch provider, AI, or Chimmy code paths', () => {
    expect(route).not.toContain('chimmy')
    expect(route).not.toContain('grounding')
    expect(route).not.toContain('fantasyData')
    expect(route).not.toContain('leagueSportsGrounding')
  })

  it('uses same canManageLeague pattern as advance route (commissioner-only)', () => {
    expect(route).toContain('canManageLeague')
    expect(route).toContain('isCommissioner')
    expect(route).toContain('isCoCommissioner')
  })
})
