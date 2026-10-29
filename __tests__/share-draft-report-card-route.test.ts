// @vitest-environment node
/**
 * The post-draft report card image, folded into /api/share/draft as GET `?card=report`.
 * League draft access is the gate; a roster with no results is a 404, never an empty card.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftResultsPayload, PickScoreEntry } from '@/lib/post-draft-manager-ranking/types'

const h = vi.hoisted(() => ({
  session: vi.fn(),
  access: vi.fn(),
  results: vi.fn(),
  images: [] as unknown[],
}))

vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/rankings-engine/draft-grades', () => ({ getDraftGrades: vi.fn() }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: h.access }))
vi.mock('@/lib/post-draft-manager-ranking', () => ({ getDraftResults: h.results }))
vi.mock('next/og', () => ({
  ImageResponse: class {
    status = 200
    constructor(element: unknown) {
      h.images.push(element)
    }
  },
}))

import { GET } from '@/app/api/share/draft/route'

const req = (qs: string) => new Request(`https://allfantasy.test/api/share/draft?${qs}`)
const text = (node: unknown): string => {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  const el = node as { type?: unknown; props?: { children?: unknown } }
  if (typeof el.type === 'function') return text((el.type as (p: unknown) => unknown)(el.props))
  return text(el.props?.children)
}

const pk = (overall: number, playerName: string, adp: number): PickScoreEntry => ({
  id: `p${overall}`, overall, round: overall, slot: 1, rosterId: 'r1', displayName: 'Alpha', playerName,
  position: 'RB', team: 'ATL', byeWeek: null, adp, adpSource: 'at_pick', valueScore: adp - overall,
})

function results(): DraftResultsPayload {
  const picks = [pk(1, 'Bijan Robinson', 1.2), pk(12, 'Late Steal', 30), pk(20, 'Early Reach', 8)]
  const entry = {
    rank: 2, rosterId: 'r1', displayName: 'Alpha', slot: 1, grade: 'B+', score: 72, totalValueScore: 18.2,
    positionalScore: 0, positionalDepthScore: 0, benchScore: 0, balanceScore: 0, upsideScore: 0,
    reachPenaltyScore: 0, injuryRiskScore: 0, byeWeekScore: 0, pickCount: 3, picks, bestPick: null, worstReach: null,
  }
  return {
    leagueId: 'L1', leagueName: 'Dynasty Den', sport: 'NFL', draftType: 'snake', season: '2026', status: 'completed',
    rounds: 3, teamCount: 2, totalPicks: 6, pickLog: [],
    managerRankings: [{ ...entry, rank: 1, rosterId: 'r2', displayName: 'Bravo', picks: [] }, entry],
    bestPickOfDraft: null, worstReachOfDraft: null, stealOfDraft: null,
  }
}

beforeEach(() => {
  h.images.length = 0
  h.session.mockResolvedValue({ user: { id: 'u1' } })
  h.access.mockResolvedValue(true)
  h.results.mockResolvedValue(results())
})

describe('GET /api/share/draft?card=report', () => {
  it('renders the roster’s grade, rank, steal and reach', async () => {
    const res = await GET(req('card=report&leagueId=L1&rosterId=r1'))
    expect(res.status).toBe(200)
    const out = text(h.images[0])
    expect(out).toContain('B+')
    expect(out).toContain('Ranked #2 of 2 drafts')
    expect(out).toContain('Late Steal')
    expect(out).toContain('+18 spots')
    expect(out).toContain('Early Reach')
    expect(out).toContain('-12 spots')
    expect(out).toContain('market ADP at the moment of each pick')
    expect(h.access).toHaveBeenCalledWith('L1', 'u1')
  })

  it('401s signed out, 403s without league access, 404s an unknown roster', async () => {
    h.session.mockResolvedValueOnce(null)
    expect((await GET(req('card=report&leagueId=L1&rosterId=r1'))).status).toBe(401)
    h.access.mockResolvedValueOnce(false)
    expect((await GET(req('card=report&leagueId=L1&rosterId=r1'))).status).toBe(403)
    expect((await GET(req('card=report&leagueId=L1&rosterId=zz'))).status).toBe(404)
    h.results.mockResolvedValueOnce(null)
    expect((await GET(req('card=report&leagueId=L1&rosterId=r1'))).status).toBe(404)
    expect(h.images).toHaveLength(0)
  })

  it('400s an unknown card or missing ids', async () => {
    expect((await GET(req('card=other&leagueId=L1&rosterId=r1'))).status).toBe(400)
    expect((await GET(req('card=report&leagueId=L1'))).status).toBe(400)
  })
})
