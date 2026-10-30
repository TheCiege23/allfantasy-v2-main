// @vitest-environment node
/**
 * The rules popup's waiver lines come from the settings the claims ENGINE runs
 * (`getEffectiveLeagueWaiverSettings`), not the League columns the commissioner's Waivers panel never
 * writes. And that panel's save now publishes a "What changed" card.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  session: vi.fn(),
  effective: vi.fn(),
  upsert: vi.fn(),
  publish: vi.fn(async () => undefined),
}))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: vi.fn(async () => undefined) }))
vi.mock('@/lib/waiver-wire', () => ({
  getEffectiveLeagueWaiverSettings: h.effective,
  upsertLeagueWaiverSettings: h.upsert,
  getPendingClaims: vi.fn(),
  getProcessedClaimsAndTransactions: vi.fn(),
}))
vi.mock('@/lib/waiver-wire/process-engine', () => ({ processWaiverClaimsForLeague: vi.fn() }))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({ setWaiverProcessingLocked: vi.fn(), refreshLeagueWaiverNextRunAt: vi.fn() }))
vi.mock('@/lib/league-rules-explainer/publishRuleChanges', () => ({ publishRuleChangesEvent: h.publish }))

import { PUT } from '@/app/api/commissioner/leagues/[leagueId]/waivers/route'
import { waiverRulesFromEffective, ruleSnapshotFromLeague, type RulesLeagueRow } from '@/lib/league-rules-explainer/snapshot'
import { explainLeagueRules } from '@/lib/league-rules-explainer/explain'
import { renderRuleText } from '@/lib/league-rules-explainer/render'
import { translations } from '@/lib/i18n/translations'

const ROLLING = { normalizedWaiverType: 'rolling', waiverType: 'rolling', faabBudget: null, faabMinBid: null }
const FAAB = { normalizedWaiverType: 'faab', waiverType: 'faab', faabBudget: 200, faabMinBid: 1 }

describe('waiverRulesFromEffective', () => {
  it('reads the engine’s type, budget and minimum bid', () => {
    expect(waiverRulesFromEffective(FAAB)).toEqual({ waiverType: 'faab', waiverBudget: 200, waiverMinBid: 1 })
    expect(waiverRulesFromEffective({ normalizedWaiverType: 'reverse_standings' })).toEqual({ waiverType: 'reverse_standings' })
  })
  it('leaves out what the engine does not set, so the League column stands', () => {
    expect(waiverRulesFromEffective(ROLLING)).toEqual({ waiverType: 'rolling' })
    expect('waiverBudget' in waiverRulesFromEffective(ROLLING)).toBe(false)
  })
})

describe('the popup describes the engine’s waivers, not a stale column', () => {
  const row: RulesLeagueRow = {
    platform: 'allfantasy', sport: 'NFL', leagueType: 'redraft', leagueSize: 12, scoring: 'ppr',
    playoffTeams: 6, playoffStartWeek: 15, waiverType: 'rolling', waiverBudget: 100, settings: { scoring_mode: 'points' },
  }
  const t = (k: string) => translations.en[k] ?? k
  const lines = (over: Record<string, unknown>) =>
    explainLeagueRules({ ...ruleSnapshotFromLeague(row), ...over })
      .filter((s) => s.id === 'waivers')
      .flatMap((s) => s.lines.map((l) => renderRuleText(l.text, t, 'en')))
      .join('\n')

  it('a commissioner who switched to FAAB with a $200 budget sees FAAB and $200', () => {
    const out = lines(waiverRulesFromEffective(FAAB))
    expect(out).toMatch(/200/)
    expect(out).not.toMatch(/\b100\b/)
  })
})

describe('the commissioner Waivers save publishes a "What changed" card', () => {
  const put = (body: unknown) =>
    PUT(new NextRequest('https://example.test/api/commissioner/leagues/L1/waivers', { method: 'PUT', body: JSON.stringify(body) }), {
      params: Promise.resolve({ leagueId: 'L1' }),
    })
  beforeEach(() => {
    vi.clearAllMocks()
    h.session.mockResolvedValue({ user: { id: 'U1' } })
    h.upsert.mockResolvedValue({ leagueId: 'L1' })
  })

  it('with exactly the waiver rules that moved', async () => {
    h.effective.mockResolvedValueOnce(ROLLING).mockResolvedValueOnce(FAAB)
    expect((await put({ waiverType: 'faab', faabBudget: 200 })).status).toBe(200)
    expect(h.publish).toHaveBeenCalledWith({
      leagueId: 'L1',
      actorUserId: 'U1',
      section: 'waivers',
      changes: [{ key: 'waiverType', before: 'rolling', after: 'faab' }],
    })
  })

  it('a budget change alone', async () => {
    h.effective.mockResolvedValueOnce(FAAB).mockResolvedValueOnce({ ...FAAB, faabBudget: 300 })
    await put({ faabBudget: 300 })
    expect(h.publish.mock.calls[0][0].changes).toEqual([{ key: 'waiverBudget', before: 200, after: 300 }])
  })

  it('a card failure never fails the save', async () => {
    h.effective.mockResolvedValueOnce(ROLLING).mockRejectedValueOnce(new Error('db down'))
    expect((await put({ waiverType: 'faab' })).status).toBe(200)
    expect(h.upsert).toHaveBeenCalled()
  })
})
