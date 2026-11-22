import { beforeEach, describe, expect, it, vi } from 'vitest'

const createLeagueChatMessage = vi.fn()
const routeTextCall = vi.fn()
const leagueFindUnique = vi.fn()
const scoreFindMany = vi.fn()
const stateFindMany = vi.fn()
const stateFindFirst = vi.fn()
const seasonFindFirst = vi.fn()
const evaluateUserFeatureAccess = vi.fn()
const hasAfCommissionerPlan = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: (...a: unknown[]) => leagueFindUnique(...a) },
    guillotinePeriodScore: { findMany: (...a: unknown[]) => scoreFindMany(...a) },
    guillotineRosterState: { findMany: (...a: unknown[]) => stateFindMany(...a), findFirst: (...a: unknown[]) => stateFindFirst(...a) },
    guillotineSeason: { findFirst: (...a: unknown[]) => seasonFindFirst(...a) },
  },
}))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({ createLeagueChatMessage: (...a: unknown[]) => createLeagueChatMessage(...a) }))
vi.mock('@/lib/subscription/FeatureGateService', () => ({
  FeatureGateService: class {
    evaluateUserFeatureAccess = (...a: unknown[]) => evaluateUserFeatureAccess(...a)
  },
}))
vi.mock('@/lib/entitlements/afCommissionerPlan', () => ({ hasAfCommissionerPlan: (...a: unknown[]) => hasAfCommissionerPlan(...a) }))
vi.mock('@/lib/ai/providerRouter', () => ({ routeTextCall: (...a: unknown[]) => routeTextCall(...a) }))
vi.mock('@/lib/guillotine/rosterDisplayNames', () => ({
  resolveRosterDisplayNames: async () => new Map([['r1', 'Hoop Dreams'], ['r2', 'Bench Mob'], ['r3', 'Ice Cold'], ['r4', 'Triple Threat']]),
}))

import { computeGuillotineWeekFacts, renderGuillotineRecap, postAutomaticGuillotineRecap, postAiGuillotineRecap, AUTO_AI_TIMEOUT_MS } from '@/lib/guillotine/weeklyRecap'

const SCORES = [
  { rosterId: 'r1', periodPoints: 180.4 },
  { rosterId: 'r2', periodPoints: 121.2 },
  { rosterId: 'r3', periodPoints: 98.75 },
  { rosterId: 'r4', periodPoints: 140 },
]
const NAMES = new Map([['r1', 'Hoop Dreams'], ['r2', 'Bench Mob'], ['r3', 'Ice Cold'], ['r4', 'Triple Threat']])

describe('computeGuillotineWeekFacts / renderGuillotineRecap', () => {
  it('names the chopped team, the closest call, the top scorer and what is next', () => {
    const f = computeGuillotineWeekFacts({ week: 3, scores: SCORES, choppedRosterIds: ['r3'], names: NAMES, sport: 'NBA' })
    expect(f.chopped.map((t) => t.name)).toEqual(['Ice Cold'])
    expect(f.topScorer?.name).toBe('Hoop Dreams')
    expect(f.narrowestEscape).toMatchObject({ name: 'Bench Mob', margin: 22.5 })
    expect(f.teamsRemaining).toBe(3)

    const text = renderGuillotineRecap(f)
    expect(text).toContain('Week 3 recap')
    expect(text).toContain('Chopped: Ice Cold (98.8)')
    expect(text).toContain('Closest call: Bench Mob survived with 121.2 — 22.5 above the blade.')
    expect(text).toContain('Top scorer: Hoop Dreams (180.4)')
    expect(text).toContain('3 teams remain.')
    expect(text).toContain('Thursday 7:00 AM ET') // NBA waivers
    expect(text).toContain('Next chop: by Wednesday 7:00 AM ET.')
  })

  it('handles a double chop and an unscored chopped roster without inventing a name', () => {
    const f = computeGuillotineWeekFacts({ week: 5, scores: SCORES.slice(0, 2), choppedRosterIds: ['r2', 'r9'], names: NAMES, sport: 'NFL' })
    expect(f.chopped.map((t) => t.name)).toEqual(['Bench Mob', 'Unknown manager'])
    expect(f.teamsRemaining).toBe(1)
    const text = renderGuillotineRecap(f)
    expect(text).toContain('1 team remains.')
    expect(text).toContain('The chopped rosters go to waivers')
    expect(text).not.toContain('Next chop') // one team left: the season is over
    // No sport profile: no schedule lines rather than made-up times.
    const bare = renderGuillotineRecap(computeGuillotineWeekFacts({ week: 5, scores: SCORES, choppedRosterIds: ['r3'], names: NAMES, sport: null }))
    expect(bare).not.toContain('waivers')
    expect(bare).not.toContain('Next chop')
  })
})

describe('postAutomaticGuillotineRecap', () => {
  const run = () => postAutomaticGuillotineRecap({ leagueId: 'L1', week: 3, season: 2026, scores: SCORES, choppedRosterIds: ['r3'], authorUserId: 'owner' })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    leagueFindUnique.mockResolvedValue({ sport: 'NBA', settings: {} })
    seasonFindFirst.mockResolvedValue({ season: 2026 })
    createLeagueChatMessage.mockResolvedValue({ id: 'm1' })
    evaluateUserFeatureAccess.mockResolvedValue({ allowed: false })
    hasAfCommissionerPlan.mockResolvedValue(false)
  })

  it('AF Commissioner without AF Pro also gets Chimmy\'s recap (owner\'s decision, 2026-10-25)', async () => {
    hasAfCommissionerPlan.mockResolvedValue(true)
    routeTextCall.mockResolvedValue({ ok: true, text: 'Ice Cold melted at 98.8.' })
    expect(await run()).toBe(true)
    expect(hasAfCommissionerPlan).toHaveBeenCalledWith({ id: 'owner' })
    expect(createLeagueChatMessage.mock.calls[0]![3]).toMatchObject({ idempotencyKey: 'guillotine-recap:L1:2026:w3:ai' })
  })

  it('free league: posts the standard recap once per week, with no model call', async () => {
    expect(await run()).toBe(true)
    expect(routeTextCall).not.toHaveBeenCalled()
    const [leagueId, userId, text, opts] = createLeagueChatMessage.mock.calls[0]!
    expect([leagueId, userId]).toEqual(['L1', 'owner'])
    expect(text).toContain('Chopped: Ice Cold')
    expect(opts).toMatchObject({ idempotencyKey: 'guillotine-recap:L1:2026:w3:auto', type: 'host_announcement' })
  })

  it('reports a duplicate (the chat service returns null on a repeated id)', async () => {
    createLeagueChatMessage.mockResolvedValue(null)
    expect(await run()).toBe(false)
  })

  it("paid league: Chimmy's recap is posted instead, under the key the button also uses", async () => {
    evaluateUserFeatureAccess.mockResolvedValue({ allowed: true })
    routeTextCall.mockResolvedValue({ ok: true, text: 'Ice Cold melted at 98.8.' })
    expect(await run()).toBe(true)
    expect(evaluateUserFeatureAccess).toHaveBeenCalledWith('owner', 'guillotine_ai')
    expect(createLeagueChatMessage).toHaveBeenCalledTimes(1)
    const [, , text, opts] = createLeagueChatMessage.mock.calls[0]!
    expect(text).toBe('🪓 Week 3 recap\nIce Cold melted at 98.8.')
    expect(opts).toMatchObject({ idempotencyKey: 'guillotine-recap:L1:2026:w3:ai', metadata: expect.objectContaining({ automatic: true, aiWritten: true }) })
  })

  it('paid league with the switch off: standard recap, no model call', async () => {
    evaluateUserFeatureAccess.mockResolvedValue({ allowed: true })
    leagueFindUnique.mockResolvedValue({ sport: 'NBA', settings: { guillotineAiRecapAuto: false } })
    await run()
    expect(routeTextCall).not.toHaveBeenCalled()
    expect(createLeagueChatMessage.mock.calls[0]![3]).toMatchObject({ idempotencyKey: 'guillotine-recap:L1:2026:w3:auto' })
  })

  it('paid league, model down or off-topic: falls back to the standard recap', async () => {
    evaluateUserFeatureAccess.mockResolvedValue({ allowed: true })
    routeTextCall.mockResolvedValue({ ok: false })
    await run()
    routeTextCall.mockResolvedValue({ ok: true, text: 'Sorry, I cannot help with that.' })
    await run()
    for (const call of createLeagueChatMessage.mock.calls) {
      expect(call[2]).toContain('Chopped: Ice Cold (98.8)')
      expect(call[3]).toMatchObject({ idempotencyKey: 'guillotine-recap:L1:2026:w3:auto' })
    }
  })

  it('paid league, model too slow: posts the standard recap after the timeout rather than holding up the chop', async () => {
    vi.useFakeTimers()
    evaluateUserFeatureAccess.mockResolvedValue({ allowed: true })
    routeTextCall.mockReturnValue(new Promise(() => {}))
    const pending = run()
    await vi.advanceTimersByTimeAsync(AUTO_AI_TIMEOUT_MS + 10)
    expect(await pending).toBe(true)
    expect(createLeagueChatMessage.mock.calls[0]![3]).toMatchObject({ idempotencyKey: 'guillotine-recap:L1:2026:w3:auto' })
    vi.useRealTimers()
  })
})

describe('postAiGuillotineRecap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    leagueFindUnique.mockResolvedValue({ sport: 'NBA' })
    scoreFindMany.mockResolvedValue(SCORES)
    stateFindMany.mockResolvedValue([{ rosterId: 'r3' }])
    stateFindFirst.mockResolvedValue({ choppedInPeriod: 3 })
    seasonFindFirst.mockResolvedValue({ season: 2026 })
    createLeagueChatMessage.mockResolvedValue({ id: 'm2' })
  })

  it('refuses before the first chop', async () => {
    stateFindFirst.mockResolvedValue(null)
    expect(await postAiGuillotineRecap({ leagueId: 'L1', userId: 'u1' })).toMatchObject({ ok: false, status: 409 })
    expect(routeTextCall).not.toHaveBeenCalled()
  })

  it('gives the model only the week facts, and posts its text', async () => {
    routeTextCall.mockResolvedValue({ ok: true, text: 'Ice Cold froze at 98.8 while Hoop Dreams caught fire.' })
    const r = await postAiGuillotineRecap({ leagueId: 'L1', userId: 'u1' })
    expect(r).toMatchObject({ ok: true, posted: true, aiWritten: true, week: 3 })
    const prompt = routeTextCall.mock.calls[0]![0].messages[1].content as string
    expect(prompt).toContain('Chopped: Ice Cold with 98.8 points')
    expect(routeTextCall.mock.calls[0]![0]).toMatchObject({ feature: 'guillotine_weekly_recap', leagueId: 'L1' })
    expect(createLeagueChatMessage.mock.calls[0]![3]).toMatchObject({ idempotencyKey: 'guillotine-recap:L1:2026:w3:ai' })
  })

  it('falls back to the standard recap when the model is unavailable or off-topic', async () => {
    routeTextCall.mockResolvedValue({ ok: false })
    const r1 = await postAiGuillotineRecap({ leagueId: 'L1', userId: 'u1' })
    expect(r1).toMatchObject({ ok: true, aiWritten: false })
    if (r1.ok) expect(r1.text).toContain('Chopped: Ice Cold (98.8)')
    // The fallback is the standard recap, so it can never post a second copy of it.
    expect(createLeagueChatMessage.mock.calls[0]![3]).toMatchObject({ idempotencyKey: 'guillotine-recap:L1:2026:w3:auto' })

    routeTextCall.mockResolvedValue({ ok: true, text: 'I cannot help with that.' })
    const r2 = await postAiGuillotineRecap({ leagueId: 'L1', userId: 'u1' })
    expect(r2).toMatchObject({ ok: true, aiWritten: false })
  })
})
