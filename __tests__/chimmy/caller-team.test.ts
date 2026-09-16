import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `resolveCallerTeamId` — a client-sent team id survives only when it is the caller's own claimed
 * team in the verified league. See `lib/chimmy/callerTeam.ts`.
 */

const h = vi.hoisted(() => ({ findFirst: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { leagueTeam: { findFirst: h.findFirst } } }))

import { resolveCallerTeamId } from '@/lib/chimmy/callerTeam'

beforeEach(() => {
  h.findFirst.mockReset()
})

describe('resolveCallerTeamId', () => {
  it("returns the team's platform id when the caller has claimed it", async () => {
    h.findFirst.mockResolvedValue({ externalId: '3' })
    expect(await resolveCallerTeamId({ leagueId: 'L1', userId: 'u1', teamId: ' lt-1 ' })).toBe('3')
    expect(h.findFirst).toHaveBeenCalledWith({
      where: { leagueId: 'L1', claimedByUserId: 'u1', OR: [{ id: 'lt-1' }, { externalId: 'lt-1' }] },
      select: { externalId: true },
    })
  })

  it("returns null for a team the caller has not claimed", async () => {
    h.findFirst.mockResolvedValue(null)
    expect(await resolveCallerTeamId({ leagueId: 'L1', userId: 'u1', teamId: 'someone-else' })).toBeNull()
  })

  it('never looks anything up without a team, a verified league or a user', async () => {
    for (const args of [
      { leagueId: 'L1', userId: 'u1', teamId: null },
      { leagueId: 'L1', userId: 'u1', teamId: '   ' },
      { leagueId: null, userId: 'u1', teamId: 't' },
      { leagueId: 'L1', userId: null, teamId: 't' },
      { leagueId: undefined, userId: undefined, teamId: undefined },
    ]) {
      expect(await resolveCallerTeamId(args)).toBeNull()
    }
    expect(h.findFirst).not.toHaveBeenCalled()
  })

  it('a failed lookup is not a yes', async () => {
    h.findFirst.mockRejectedValue(new Error('db down'))
    expect(await resolveCallerTeamId({ leagueId: 'L1', userId: 'u1', teamId: 't' })).toBeNull()
    h.findFirst.mockResolvedValue({ externalId: '  ' })
    expect(await resolveCallerTeamId({ leagueId: 'L1', userId: 'u1', teamId: 't' })).toBeNull()
  })
})

/*
 * The planner input is not reachable from the route tests without mocking the whole memory stack,
 * so its wiring is pinned from the source: every team-keyed reader takes the verified id, and the
 * raw field is left with the one job that only makes the route stricter.
 */
describe('the chat route uses the verified team everywhere a team is read', () => {
  const src = readFileSync(path.join(process.cwd(), 'app/api/chat/chimmy/route.ts'), 'utf8')

  it('resolves it once, after the league is verified', () => {
    const at = src.indexOf('const verifiedTeamId = await resolveCallerTeamId({ leagueId: leagueSnapshot?.id, userId, teamId })')
    expect(at).toBeGreaterThan(-1)
    expect(at).toBeGreaterThan(src.indexOf('const leagueSnapshot = leagueGrounding.ok'))
  })

  it('passes it to the planner, the insight bundle and the prompt context', () => {
    const pecrAt = src.indexOf('const pecrResult = await runPECR(')
    const pecrInput = src.slice(pecrAt, src.indexOf('feature:', pecrAt))
    expect(pecrInput).toContain('teamId: verifiedTeamId ?? undefined')
    expect(src).toMatch(/getInsightBundle\(leagueSnapshot\.id, insightType, \{\s*teamId: verifiedTeamId \?\? undefined/)
    expect(src).toMatch(/contextSnapshot: compactRecord\(\{[\s\S]{0,200}teamId: verifiedTeamId \?\? undefined/)
    expect(src).toContain('compactRecord({ leagueId, teamId: verifiedTeamId ?? undefined, week')
  })

  it('leaves the raw id with only the grounding decision', () => {
    // Every `teamId: <raw>` property in the file — exactly one, and it feeds requiresLeagueGrounding.
    const rawProps = [...src.matchAll(/\bteamId:\s*teamId\b/g)]
    expect(rawProps).toHaveLength(1)
    const groundingAt = src.indexOf('requiresLeagueGrounding({')
    const groundingCall = src.slice(groundingAt, src.indexOf('})', groundingAt))
    expect(groundingCall).toContain('teamId: teamId ?? undefined')
    // …and no reader receives the raw id by shorthand either.
    expect(src).not.toMatch(/compactRecord\(\{[^)]*\bteamId\s*[,}]/)
    expect(src).not.toMatch(/getInsightBundle\([^)]*\{\s*teamId\s*[,}]/)
  })
})
