import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  entitled: true,
  storylines: [] as Array<{ id: string; season: number | null; storyType: string; metadata: unknown; createdAt: Date }>,
  pollMeta: null as unknown,
  chatPosts: [] as Array<{ text: string; options: Record<string, unknown> }>,
  patches: [] as Array<{ userId: string; body: Record<string, unknown> }>,
  patchStatus: 200,
}))

vi.mock('@/lib/subscription/FeatureGateService', () => ({
  FeatureGateService: class {
    async evaluateUserFeatureAccess() {
      return { allowed: state.entitled }
    }
  },
}))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({
  createLeagueChatMessage: vi.fn(async (_l: string, _u: string, text: string, options: Record<string, unknown>) => {
    state.chatPosts.push({ text, options })
    state.pollMeta = options.metadata
    return { id: options.idempotencyKey }
  }),
}))
vi.mock('@/lib/league/execute-league-settings-patch', () => ({
  executeLeagueSettingsPatch: vi.fn(async (userId: string, body: Record<string, unknown>) => {
    state.patches.push({ userId, body })
    return new Response(JSON.stringify(state.patchStatus === 200 ? { ok: true } : { error: 'Season is in progress' }), { status: state.patchStatus })
  }),
}))
vi.mock('@/lib/prisma', () => {
  const league = {
    findUnique: vi.fn(async () => ({ name: 'Dynasty Bros', season: 2026, userId: 'owner', settings: state.settings })),
    update: vi.fn(async ({ data }: { data: { settings: Record<string, unknown> } }) => {
      state.settings = data.settings
    }),
  }
  return {
    prisma: {
      league,
      leagueStoryline: {
        findMany: vi.fn(async () => [...state.storylines].filter((s) => s.season !== null).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())),
        create: vi.fn(async ({ data }: { data: { season: number; storyType: string; metadata: unknown } }) => {
          state.storylines.push({ id: `row${state.storylines.length + 1}`, season: data.season, storyType: data.storyType, metadata: data.metadata, createdAt: new Date(Date.now() + state.storylines.length) })
        }),
      },
      leagueChatMessage: { findUnique: vi.fn(async () => (state.pollMeta ? { metadata: state.pollMeta } : null)) },
      leagueAuditLog: { create: vi.fn(async () => ({})) },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ $queryRaw: vi.fn(async () => []), league })),
    },
  }
})

import {
  applyAmendmentsAtSeasonRollover,
  approveAmendment,
  declineAmendment,
  withdrawAmendment,
  proposeAmendment,
  publishVersion,
  readConstitutionView,
  resolveAmendments,
} from '@/lib/constitution/constitutionService'

const NOW = new Date('2026-10-19T12:00:00Z')
type Poll = { poll: { options: Array<{ id: string; votes: string[] }>; closeAt: string } }
const vote = (yes: number, no: number) => {
  const p = (state.pollMeta as Poll).poll
  p.options[0].votes = Array.from({ length: yes }, (_, i) => `y${i}`)
  p.options[1].votes = Array.from({ length: no }, (_, i) => `n${i}`)
}
const amendments = () => state.settings.constitution_amendments as Array<{ status: string; applyError: string | null }>

beforeEach(() => {
  state.settings = { constitution_answers: { amendmentThreshold: 67, voteDays: 3 } }
  state.entitled = true
  state.storylines = []
  state.pollMeta = null
  state.chatPosts = []
  state.patches = []
  state.patchStatus = 200
})

describe('versions', () => {
  it('each publish is a new numbered version, never overwritten', async () => {
    const sections = [{ title: 'Article 1', body: 'Be nice.' }]
    expect(await publishVersion('L1', 'c1', { sections })).toEqual({ ok: true, version: 1 })
    expect(await publishVersion('L1', 'c1', { sections, source: 'builder' })).toEqual({ ok: true, version: 2 })
    expect(state.storylines).toHaveLength(2)
    expect(state.storylines.every((s) => s.season === 2026 && s.storyType === 'constitution')).toBe(true)
    const view = await readConstitutionView('L1', { userId: 'm1', isCommissioner: false })
    expect(view?.current?.version).toBe(2)
    expect(view?.history.map((h) => [h.version, h.source])).toEqual([[2, 'builder'], [1, 'manual']])
  })

  it('refuses an empty document', async () => {
    expect(await publishVersion('L1', 'c1', { sections: [] })).toEqual({ ok: false, error: 'invalid_sections' })
  })
})

describe('amendments', () => {
  it('opens a yes/no league-chat poll that closes after the league’s vote window', async () => {
    const r = await proposeAmendment('L1', 'c1', { title: 'Six playoff teams', change: { key: 'playoffTeams', value: 6 } }, NOW)
    if (!r.ok) throw new Error(r.error)
    expect(state.chatPosts[0].options).toMatchObject({ type: 'poll', idempotencyKey: `amendment-poll:${r.amendment.id}` })
    const poll = (state.pollMeta as Poll).poll
    expect(poll.options.map((o) => o.id)).toEqual(['yes', 'no'])
    expect(poll.closeAt).toBe('2026-10-22T12:00:00.000Z')
    expect(r.amendment).toMatchObject({ status: 'voting', threshold: 67, effective: 'next_season' })
  })

  it('refuses a setting that is not on the amendable list', async () => {
    expect(await proposeAmendment('L1', 'c1', { title: 'Bigger league', change: { key: 'leagueSize', value: 14 } }, NOW)).toEqual({ ok: false, error: 'invalid_change' })
    expect(state.chatPosts).toEqual([])
  })

  it('a passed "now" amendment applies through the settings patch on the plan', async () => {
    await proposeAmendment('L1', 'c1', { title: 'Median game', change: { key: 'medianGame', value: true }, effective: 'now' }, NOW)
    vote(2, 1)
    await resolveAmendments('L1', new Date('2026-10-23T00:00:00Z'))
    expect(state.patches).toEqual([{ userId: 'owner', body: { leagueId: 'L1', medianGame: true } }])
    expect(amendments()[0].status).toBe('applied')
  })

  it('without the plan a passed amendment waits to be applied by hand', async () => {
    state.entitled = false
    await proposeAmendment('L1', 'c1', { title: 'Median game', change: { key: 'medianGame', value: true }, effective: 'now' }, NOW)
    vote(3, 0)
    await resolveAmendments('L1', new Date('2026-10-23T00:00:00Z'))
    expect(state.patches).toEqual([])
    expect(amendments()[0].status).toBe('passed')
  })

  it('an open vote stays open; a failed vote applies nothing', async () => {
    await proposeAmendment('L1', 'c1', { title: 'Median game', change: { key: 'medianGame', value: true }, effective: 'now' }, NOW)
    vote(1, 5)
    await resolveAmendments('L1', new Date('2026-10-20T00:00:00Z'))
    expect(amendments()[0].status).toBe('voting')
    await resolveAmendments('L1', new Date('2026-10-23T00:00:00Z'))
    expect(amendments()[0].status).toBe('failed')
    expect(state.patches).toEqual([])
  })
})

describe('season rollover', () => {
  it('applies passed next-season amendments, and records a refusal instead of hiding it', async () => {
    await proposeAmendment('L1', 'c1', { title: 'Six playoff teams', change: { key: 'playoffTeams', value: 6 } }, NOW)
    vote(4, 1)
    state.patchStatus = 409
    // The vote has closed by the time the season ends.
    vi.setSystemTime(new Date('2026-12-30T00:00:00Z'))
    const r = await applyAmendmentsAtSeasonRollover('L1')
    vi.useRealTimers()
    expect(r).toEqual({ applied: 0, failed: 1, skipped: null })
    expect(amendments()[0]).toMatchObject({ status: 'apply_failed', applyError: 'Season is in progress' })
  })

  it('does nothing without the plan', async () => {
    state.entitled = false
    expect(await applyAmendmentsAtSeasonRollover('L1')).toEqual({ applied: 0, failed: 0, skipped: 'no_plan' })
  })
})

describe('member proposals — the commissioner approves', () => {
  it('a member proposal waits for the commissioner: no poll, nothing to vote on yet', async () => {
    const r = await proposeAmendment('L1', 'member1', { title: 'Later deadline', change: { key: 'tradeDeadlineWeek', value: 13 } }, NOW, { asCommissioner: false })
    expect(r.ok).toBe(true)
    expect(state.chatPosts).toHaveLength(0)
    expect(amendments()[0]).toMatchObject({ status: 'pending_approval', proposedByRole: 'member', effectiveSeason: 2027 })
  })

  it('one member cannot queue more than two waiting proposals', async () => {
    for (let i = 0; i < 2; i++) await proposeAmendment('L1', 'member1', { title: `Idea ${i}` }, NOW, { asCommissioner: false })
    const third = await proposeAmendment('L1', 'member1', { title: 'Idea 3' }, NOW, { asCommissioner: false })
    expect(third).toEqual({ ok: false, error: 'too_many_pending' })
    expect((await proposeAmendment('L1', 'member2', { title: 'Other' }, NOW, { asCommissioner: false })).ok).toBe(true)
  })

  it('approving opens the league vote from that moment', async () => {
    const r = await proposeAmendment('L1', 'member1', { title: 'Later deadline' }, NOW, { asCommissioner: false })
    if (!r.ok) throw new Error('refused')
    const later = new Date(NOW.getTime() + 2 * 86_400_000)
    const ok = await approveAmendment('L1', 'owner', r.amendment.id, later)
    expect(ok.ok).toBe(true)
    expect(state.chatPosts).toHaveLength(1)
    expect(amendments()[0]).toMatchObject({ status: 'voting', closesAt: new Date(later.getTime() + 3 * 86_400_000).toISOString() })
    expect((await approveAmendment('L1', 'owner', r.amendment.id, later)).ok).toBe(false)
  })

  it('declining records the reason and opens nothing', async () => {
    const r = await proposeAmendment('L1', 'member1', { title: 'Ban QBs' }, NOW, { asCommissioner: false })
    if (!r.ok) throw new Error('refused')
    expect(await declineAmendment('L1', 'owner', r.amendment.id, 'Not a real rule')).toEqual({ ok: true })
    expect(state.chatPosts).toHaveLength(0)
    expect(amendments()[0]).toMatchObject({ status: 'declined', declineReason: 'Not a real rule' })
  })

  it('a member withdraws only their own waiting proposal', async () => {
    const r = await proposeAmendment('L1', 'member1', { title: 'Mine' }, NOW, { asCommissioner: false })
    if (!r.ok) throw new Error('refused')
    expect(await withdrawAmendment('L1', 'member2', r.amendment.id, { isCommissioner: false })).toBe(false)
    expect(await withdrawAmendment('L1', 'member1', r.amendment.id, { isCommissioner: false })).toBe(true)
    expect(amendments()[0].status).toBe('withdrawn')
  })

  it('a commissioner proposal still opens the vote at once, and names the season it takes effect', async () => {
    const r = await proposeAmendment('L1', 'owner', { title: 'Median game', change: { key: 'medianGame', value: true }, effective: 'next_season' }, NOW)
    expect(r.ok).toBe(true)
    expect(amendments()[0]).toMatchObject({ status: 'voting', proposedByRole: 'commissioner', effectiveSeason: 2027 })
    expect(state.chatPosts[0].text).toContain('takes effect in the 2027 season')
  })
})
