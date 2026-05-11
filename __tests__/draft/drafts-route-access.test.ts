/**
 * /drafts/[draftId] 404 fix — access contract & resolver fallback
 *
 * Source invariants (I1–I7):
 *   I1. Page imports canAccessLeagueDraft from @/lib/live-draft-engine/auth
 *   I2. Session API route imports canAccessLeagueDraft from the same module
 *   I3. Page calls notFound() when context is null (context_null branch)
 *   I4. Page calls notFound() when access is denied (access_denied branch)
 *   I5. canAccessLeagueDraft checks platformUserId via roster.findFirst
 *   I6. canAccessLeagueDraft checks claimedByUserId via leagueTeam OR clause
 *   I7. Resolver has direct league.findUnique fallback when join is null
 *
 * Behavioral tests (B1–B7):
 *   B1. resolveLiveDraftContextByDraftId returns context when league join is null
 *   B2. league.findUnique fallback is invoked when join is null
 *   B3. resolveLiveDraftContextByDraftId returns null when session not found
 *   B4. league.findUnique is NOT called when join is already populated
 *   B5. canAccessLeagueDraft returns true for platformUserId match
 *   B6. canAccessLeagueDraft returns true for claimedByUserId match
 *   B7. canAccessLeagueDraft returns false for non-member
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── mocks ──────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  isCommissioner: vi.fn(),
  getDraftOrderModeAndLotteryConfig: vi.fn(),
  prisma: {
    draftSession: { findUnique: vi.fn() },
    league: { findUnique: vi.fn(), findFirst: vi.fn() },
    roster: { findFirst: vi.fn() },
    leagueTeam: { findFirst: vi.fn() },
    mockDraft: { findUnique: vi.fn() },
  },
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/commissioner/permissions', () => ({
  isCommissioner: (...args: unknown[]) => mocks.isCommissioner(...args),
}))
vi.mock('@/lib/draft-lottery/lotteryConfigStorage', () => ({
  getDraftOrderModeAndLotteryConfig: (...args: unknown[]) =>
    mocks.getDraftOrderModeAndLotteryConfig(...args),
}))
vi.mock('@/lib/draft-lottery/dynastyYearGuard', () => ({
  checkDynastyLotteryEligibility: vi.fn().mockResolvedValue({ eligible: false }),
}))
vi.mock('@/lib/sport-scope', () => ({
  normalizeToSupportedSport: (s: string) => String(s ?? 'NFL'),
  DEFAULT_SPORT: 'NFL',
}))

// ── source file fixtures ───────────────────────────────────────────────────

const root = resolve(__dirname, '..', '..')
const pageSrc = readFileSync(resolve(root, 'app/drafts/[draftId]/page.tsx'), 'utf8')
const sessionRouteSrc = readFileSync(
  resolve(root, 'app/api/leagues/[leagueId]/draft/session/route.ts'),
  'utf8',
)
const resolverSrc = readFileSync(resolve(root, 'lib/draft/resolve-draft-context.ts'), 'utf8')
const authSrc = readFileSync(resolve(root, 'lib/live-draft-engine/auth.ts'), 'utf8')

import { resolveLiveDraftContextByDraftId } from '@/lib/draft/resolve-draft-context'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'

// ── source invariants ──────────────────────────────────────────────────────

describe('/drafts/[draftId] page — access module contract', () => {
  it('I1: page imports canAccessLeagueDraft from @/lib/live-draft-engine/auth', () => {
    expect(pageSrc).toMatch(/canAccessLeagueDraft[\s\S]*?from '@\/lib\/live-draft-engine\/auth'/)
  })

  it('I2: session API route imports canAccessLeagueDraft from the same module', () => {
    expect(sessionRouteSrc).toContain("canAccessLeagueDraft")
    expect(sessionRouteSrc).toMatch(/from '@\/lib\/live-draft-engine\/auth'/)
  })

  it('I3: page calls notFound() when context is null (context_null branch)', () => {
    expect(pageSrc).toMatch(/if \(!context\)[\s\S]*?notFound\(\)/)
  })

  it('I4: page calls notFound() when access is denied (access_denied branch)', () => {
    expect(pageSrc).toMatch(/if \(!allowed\)[\s\S]*?notFound\(\)/)
  })
})

describe('canAccessLeagueDraft — source invariants', () => {
  it('I5: checks platformUserId match via prisma.roster.findFirst', () => {
    expect(authSrc).toMatch(/roster\.findFirst[\s\S]*?platformUserId: userId/)
  })

  it('I6: checks claimedByUserId match via leagueTeam.findFirst OR clause', () => {
    expect(authSrc).toMatch(/leagueTeam\.findFirst[\s\S]*?claimedByUserId: userId/)
  })

  it('returns false as the fallback when no checks pass', () => {
    expect(authSrc).toContain('return false')
  })
})

describe('resolveLiveDraftContextByDraftId — source invariants', () => {
  it('I7: logs "league join null" warning before the direct league fallback', () => {
    expect(resolverSrc).toMatch(/league join null[\s\S]*?falling back to direct lookup/)
  })

  it('fallback calls prisma.league.findUnique with session.leagueId', () => {
    expect(resolverSrc).toMatch(/league\.findUnique\(\{[\s\S]*?id: session\.leagueId/)
  })
})

// ── behavioral: resolver ───────────────────────────────────────────────────

describe('resolveLiveDraftContextByDraftId — behavioral tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isCommissioner.mockResolvedValue(false)
    mocks.getDraftOrderModeAndLotteryConfig.mockResolvedValue(null)
    mocks.prisma.mockDraft.findUnique.mockResolvedValue(null)
  })

  it('B1: returns live context when session exists but league join is null', async () => {
    mocks.prisma.draftSession.findUnique.mockResolvedValue({
      id: 'draft-1',
      leagueId: 'league-1',
      status: 'pre_draft',
      draftType: 'snake',
      sportType: 'NFL',
      league: null,
    })
    mocks.prisma.league.findUnique.mockResolvedValue({
      id: 'league-1',
      name: 'Test League',
      sport: 'NFL',
      isDynasty: false,
      leagueVariant: null,
    })

    const ctx = await resolveLiveDraftContextByDraftId('draft-1', 'user-1')

    expect(ctx).not.toBeNull()
    expect(ctx?.kind).toBe('live')
    expect(ctx?.draftId).toBe('draft-1')
    expect(ctx?.leagueId).toBe('league-1')
  })

  it('B2: league.findUnique fallback is invoked when join is null', async () => {
    mocks.prisma.draftSession.findUnique.mockResolvedValue({
      id: 'draft-1',
      leagueId: 'league-1',
      status: 'pre_draft',
      draftType: 'snake',
      sportType: 'NFL',
      league: null,
    })
    mocks.prisma.league.findUnique.mockResolvedValue({
      id: 'league-1',
      name: 'Test League',
      sport: 'NFL',
      isDynasty: false,
      leagueVariant: null,
    })

    await resolveLiveDraftContextByDraftId('draft-1')

    expect(mocks.prisma.league.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'league-1' } }),
    )
  })

  it('B3: returns null when session does not exist (missing draft)', async () => {
    mocks.prisma.draftSession.findUnique.mockResolvedValue(null)

    const ctx = await resolveLiveDraftContextByDraftId('missing-id', 'user-1')

    expect(ctx).toBeNull()
    expect(mocks.prisma.league.findUnique).not.toHaveBeenCalled()
  })

  it('B4: skips league.findUnique when join is already populated', async () => {
    mocks.prisma.draftSession.findUnique.mockResolvedValue({
      id: 'draft-2',
      leagueId: 'league-2',
      status: 'in_progress',
      draftType: 'snake',
      sportType: 'NFL',
      league: { id: 'league-2', name: 'Live League', sport: 'NFL', isDynasty: false, leagueVariant: null },
    })

    const ctx = await resolveLiveDraftContextByDraftId('draft-2', 'user-1')

    expect(ctx).not.toBeNull()
    expect(ctx?.status).toBe('in_progress')
    expect(mocks.prisma.league.findUnique).not.toHaveBeenCalled()
  })
})

// ── behavioral: canAccessLeagueDraft ──────────────────────────────────────

describe('canAccessLeagueDraft — behavioral tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isCommissioner.mockResolvedValue(false)
    mocks.prisma.league.findFirst.mockResolvedValue(null)
    mocks.prisma.roster.findFirst.mockResolvedValue(null)
    mocks.prisma.leagueTeam.findFirst.mockResolvedValue(null)
  })

  it('B5: returns true when platformUserId matches a roster row', async () => {
    mocks.prisma.roster.findFirst.mockResolvedValue({ id: 'roster-1' })

    const result = await canAccessLeagueDraft('league-1', 'user-1')

    expect(result).toBe(true)
  })

  it('B6: returns true when claimedByUserId matches a league_teams row', async () => {
    mocks.prisma.leagueTeam.findFirst.mockResolvedValue({ id: 'team-1' })

    const result = await canAccessLeagueDraft('league-1', 'user-1')

    expect(result).toBe(true)
  })

  it('B7: returns false for non-member with no roster or team match', async () => {
    const result = await canAccessLeagueDraft('league-1', 'non-member')

    expect(result).toBe(false)
  })
})
