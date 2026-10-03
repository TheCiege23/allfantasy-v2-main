// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagerClass } from '@/lib/class-rating/reads'

const s = vi.hoisted(() => ({
  settings: null as unknown,
  leagueThrows: false,
  user: { status: 'unrated' } as ManagerClass,
  leagueDivision: null as number | null,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async () => {
        if (s.leagueThrows) throw new Error('db down')
        return { settings: s.settings }
      }),
    },
  },
}))
vi.mock('@/lib/class-rating/reads', () => ({ getManagerClass: vi.fn(async () => s.user) }))
vi.mock('@/lib/class-rating/divisionGate', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/class-rating/divisionGate')>()
  return { ...real, getLeagueDivision: vi.fn(async () => s.leagueDivision) }
})

import { evaluateJoinDivisionGate } from '@/lib/league-join/joinDivisionGate'

const est = (division: number): ManagerClass => ({
  status: 'established', rating: 1500, rd: 60, games: 50, classLevel: division * 5, division, percentile: 0.5, computedAt: 'x',
})
const PUBLIC = { inviteCode: 'CODE1', league_privacy_visibility: 'public' }

beforeEach(() => {
  s.settings = null
  s.leagueThrows = false
  s.user = { status: 'unrated' }
  s.leagueDivision = null
})

describe('evaluateJoinDivisionGate — the evaluator the three routes branch on', () => {
  it('🛑 refuses an out-of-band open join to a public league', async () => {
    Object.assign(s, { settings: PUBLIC, user: est(1), leagueDivision: 4 })
    const d = await evaluateJoinDivisionGate({ userId: 'u', leagueId: 'L', credential: { kind: 'league_code' } })
    expect(d).toMatchObject({ outcome: 'deny', userDivision: 1, leagueDivision: 4, band: [3, 5] })
  })

  it('🛑 allows the SAME player into the SAME division of a private league, flagged', async () => {
    Object.assign(s, { settings: { inviteCode: 'CODE1' }, user: est(1), leagueDivision: 4 })
    const d = await evaluateJoinDivisionGate({ userId: 'u', leagueId: 'L', credential: { kind: 'league_code' } })
    expect(d).toMatchObject({ outcome: 'allow_flagged', reason: 'invited_outside_band' })
  })

  it('a personal invite token into a public league is an invitation, not an open join', async () => {
    Object.assign(s, { settings: PUBLIC, user: est(1), leagueDivision: 4 })
    const d = await evaluateJoinDivisionGate({ userId: 'u', leagueId: 'L', credential: { kind: 'invite_token', token: 'personal' } })
    expect(d.outcome).toBe('allow_flagged')
    const viaPublicCode = await evaluateJoinDivisionGate({ userId: 'u', leagueId: 'L', credential: { kind: 'invite_token', token: 'code1' } })
    expect(viaPublicCode.outcome).toBe('deny')
  })

  it('🛑 a commissioner exception names ONE manager: they get in, flagged; anyone else is still refused', async () => {
    const excepted = { ...PUBLIC, classExceptions: [{ userId: 'u', grantedBy: 'c', grantedAt: '2026-10-01T00:00:00.000Z', via: 'request' }] }
    Object.assign(s, { settings: excepted, user: est(1), leagueDivision: 4 })
    const mine = await evaluateJoinDivisionGate({ userId: 'u', leagueId: 'L', credential: { kind: 'league_code' } })
    expect(mine).toMatchObject({ outcome: 'allow_flagged', reason: 'invited_outside_band' })
    const someoneElse = await evaluateJoinDivisionGate({ userId: 'other', leagueId: 'L', credential: { kind: 'league_code' } })
    expect(someoneElse.outcome).toBe('deny')
  })

  it('fails OPEN when the league cannot be read — a gate that cannot see locks nobody out', async () => {
    Object.assign(s, { leagueThrows: true, user: est(1), leagueDivision: 4 })
    const d = await evaluateJoinDivisionGate({ userId: 'u', leagueId: 'L', credential: { kind: 'league_code' } })
    expect(d).toMatchObject({ outcome: 'allow', reason: 'league_unrated' })
  })
})

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')

describe('the three self-service seat paths are wired (source contract)', () => {
  it('🛑 POST /api/leagues/join gates its code and refuses with 403 DIVISION_GATE_BLOCKED', () => {
    const src = read('app/api/leagues/join/route.ts')
    expect(src).toMatch(/evaluateJoinDivisionGate\(\{\s*userId,\s*leagueId: result\.leagueId,\s*credential: \{ kind: 'league_code' \},?\s*\}\)/)
    // The refusal body is shared by all three paths (divisionGateRefusal), so it is pinned there.
    expect(src).toMatch(/if \(divisionGate\.outcome === 'deny'\) \{\s*return NextResponse\.json\(divisionGateRefusal\(divisionGate, result\.leagueId\), \{ status: 403 \}\)/)
    expect(read('lib/league-join/joinDivisionGate.ts')).toMatch(/code: 'DIVISION_GATE_BLOCKED',\s*leagueId,[\s\S]{0,160}canRequest: true/)
    // The XP-level gate is retired from this route — and the module is gone.
    expect(src).not.toMatch(/resolveJoinRankGate|RANK_GATE_BLOCKED/)
  })

  it('🛑 the invite-accept fallback gates the same code before seating', () => {
    const src = read('lib/invite-engine/InviteEngine.ts')
    const at = src.indexOf('const fantasyValidation = await validateFantasyInviteCode(token, { userId })')
    const gate = src.indexOf("credential: { kind: 'league_code' }", at)
    const seat = src.indexOf('await createFantasyLeagueRoster(fantasyValidation.preview.leagueId, userId)', at)
    expect(at).toBeGreaterThan(0)
    expect(gate).toBeGreaterThan(at)
    expect(seat).toBeGreaterThan(gate)
  })

  it('🛑 the invite claim gates an OPEN seat with its token, and exempts a matched (own) team', () => {
    const src = read('app/api/league/invite/claim/route.ts')
    expect(src).toMatch(/if \(eligibility === 'open'\) \{\s*const divisionGate = await evaluateJoinDivisionGate\(\{[\s\S]{0,120}credential: \{ kind: 'invite_token', token \}/)
  })

  it('the join page shows a division refusal instead of retrying the code as a creator invite', () => {
    const src = read('app/join/page.tsx')
    // ClassGateNotice's guard is the DIVISION_GATE_BLOCKED check (pinned in class-requests.test.ts).
    const refusal = src.indexOf('if (isClassGateBlocked(data)) {')
    const retry = src.indexOf("fetch('/api/creator-invites/join'")
    expect(refusal).toBeGreaterThan(0)
    expect(retry).toBeGreaterThan(refusal)
  })
})
