// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ lifecycle: 'setup', draft: 'pre_draft' as string | null, broken: false }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findUnique: async () => ({ lifecycleState: h.lifecycle, status: h.lifecycle, leagueType: 'zombie', isDynasty: false }) },
  leagueWaiverSettings: { findUnique: async () => null },
  redraftSeason: { findFirst: async () => null, count: async () => 0 },
  draftSession: { findFirst: async () => { if (h.broken) throw new Error('unavailable'); return h.draft ? { status: h.draft } : null } },
} }))
import { loadWaiverPhasePolicy } from '@/lib/waiver-wire/season-phase-gate'
describe('pre-draft server waiver gate', () => {
  beforeEach(() => { h.lifecycle = 'setup'; h.draft = 'pre_draft'; h.broken = false })
  it.each(['pre_draft', 'in_progress', 'paused'])('locks adds and claims while draft is %s', async status => {
    h.draft = status
    const policy = await loadWaiverPhasePolicy('league', null)
    expect(policy.immediateAddsAllowed).toBe(false)
    expect(policy.claimsAllowed).toBe(false)
  })
  it('unlocks after the draft is completed', async () => {
    h.draft = 'completed'
    const policy = await loadWaiverPhasePolicy('league', null)
    expect(policy.immediateAddsAllowed).toBe(true)
    expect(policy.claimsAllowed).toBe(true)
  })
  it('fails closed if draft state cannot be read', async () => {
    h.broken = true
    const policy = await loadWaiverPhasePolicy('league', null)
    expect(policy.immediateAddsAllowed).toBe(false)
  })
})
