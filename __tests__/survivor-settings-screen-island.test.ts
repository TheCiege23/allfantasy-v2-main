/**
 * The island banner scene rides the Survivor settings screen's own commissioner write path
 * (POST /api/leagues/[leagueId]/survivor/settings-screen): commissioner only, editable all season,
 * validated against the eight scenes plus 'auto', stored in league.settings.survivorIslandScene.
 * Island control's inline rule edits use the same POST, so its locks are the settings screen's.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SurvivorSettingsForm } from '@/lib/survivor/survivorSettingsScreen'

const m = vi.hoisted(() => ({
  session: { user: { id: 'commish' } } as { user?: { id?: string } } | null,
  access: { isLeagueMember: true, decisions: { canUpdateSettings: true } } as Record<string, unknown> | null,
  draftStarted: false,
  idolSave: vi.fn(),
  idolView: vi.fn(),
  upsertConfig: vi.fn(),
  settings: {} as Record<string, unknown>,
  tx: {
    league: { findUnique: vi.fn(), update: vi.fn() },
    survivorCommissionerAction: { create: vi.fn() },
  },
  db: {
    league: { findUnique: vi.fn() },
    survivorTribeMember: { count: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => m.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/lib/survivor/survivorAccessControl', () => ({ resolveSurvivorAccessContext: vi.fn(async () => m.access) }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ upsertSurvivorConfig: m.upsertConfig }))
vi.mock('@/lib/survivor/survivorIdolConfigService', () => ({
  isSurvivorDraftStarted: vi.fn(async () => m.draftStarted),
  getSurvivorIdolSetupView: m.idolView,
  saveSurvivorIdolConfig: m.idolSave,
}))

import { GET, POST } from '@/server/api-route-modules/league-survivor/settings-screen/route'

const storedSettings = (over: Record<string, unknown> = {}) => ({
  defaultTeamCount: 12, minTeamCount: 12, maxTeamCount: 12, tribeCount: 2, tribeAssignmentMode: 'random', mergeTriggerType: 'week', mergeWeek: 8,
  exileIslandEnabled: true, exileReturnTokens: 3, exileBossMode: 'median', finalistCount: 3, ...over,
})

function req(body: unknown) {
  return new Request('http://test/api', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }) as never
}
const params = { params: Promise.resolve({ leagueId: 'L1' }) }
const current = async () => (await (await GET(req({}), params)).json()).form as SurvivorSettingsForm

beforeEach(() => {
  m.session = { user: { id: 'commish' } }
  m.access = { isLeagueMember: true, decisions: { canUpdateSettings: true } }
  m.draftStarted = false
  m.settings = storedSettings()
  m.idolSave.mockReset().mockResolvedValue({ ok: true, config: {} })
  m.idolView.mockReset().mockResolvedValue({ config: { mode: 'random', count: 7, hideFromCommish: true, pickedTypeIds: [], pointSurgePct: 10, tributePct: 5 }, saved: true })
  m.upsertConfig.mockReset()
  m.tx.league.findUnique.mockReset().mockImplementation(async () => ({ settings: m.settings }))
  m.tx.league.update.mockReset()
  m.tx.survivorCommissionerAction.create.mockReset()
  m.db.league.findUnique.mockReset().mockImplementation(async () => ({ name: 'Blah Survivor', sport: 'NFL', settings: m.settings, survivorSwapWeek: 5, survivorFinal3: true }))
  m.db.survivorTribeMember.count.mockReset().mockResolvedValue(0)
  m.db.$transaction.mockReset().mockImplementation(async (fn: (tx: typeof m.tx) => unknown) => fn(m.tx))
})

describe('island scene through the settings screen', () => {
  it('reads the saved scene, and follows the season when there is none or it is unknown', async () => {
    expect((await current()).islandScene).toBe('auto')
    m.settings = storedSettings({ survivorIslandScene: 'volcano' })
    expect((await current()).islandScene).toBe('volcano')
    m.settings = storedSettings({ survivorIslandScene: 'moon' })
    expect((await current()).islandScene).toBe('auto')
  })

  it('lets the commissioner pick a scene: one setting, one audit entry, written to league settings', async () => {
    const before = await current()
    const res = await POST(req({ form: { ...before, islandScene: 'lagoon' } }), params)
    expect(res.status).toBe(200)
    expect((await res.json()).changed).toEqual(['islandScene'])
    const data = m.tx.league.update.mock.calls[0][0].data
    expect(data.settings).toMatchObject({ survivorIslandScene: 'lagoon' })
    // Nothing else moved: no column patch and no config upsert for a scene-only save.
    expect(Object.keys(data)).toEqual(['settings'])
    expect(m.upsertConfig).not.toHaveBeenCalled()
    expect(m.tx.survivorCommissionerAction.create.mock.calls[0][0].data.newState).toEqual({ islandScene: 'lagoon' })
  })

  it('still changes the scene after the draft starts (art, not a rule)', async () => {
    m.draftStarted = true
    const before = await current()
    const res = await POST(req({ form: { ...before, islandScene: 'exile' } }), params)
    expect(res.status).toBe(200)
    expect(m.tx.league.update.mock.calls[0][0].data.settings).toMatchObject({ survivorIslandScene: 'exile' })
  })

  it('refuses a scene that is not one of the eight or auto, and writes nothing', async () => {
    const before = await current()
    for (const bad of ['moon', '', 7, null]) {
      const res = await POST(req({ form: { ...before, islandScene: bad } }), params)
      expect(res.status).toBe(400)
    }
    expect(m.tx.league.update).not.toHaveBeenCalled()
  })

  it('is commissioner only', async () => {
    m.access = { isLeagueMember: true, decisions: { canUpdateSettings: false } }
    const res = await POST(req({ form: { islandScene: 'volcano' } }), params)
    expect(res.status).toBe(403)
    expect((await GET(req({}), params)).status).toBe(403)
    expect(m.tx.league.update).not.toHaveBeenCalled()
  })

  it('leaves a saved scene alone when an older screen posts a form without it', async () => {
    m.settings = storedSettings({ survivorIslandScene: 'volcano' })
    const { islandScene: _drop, ...older } = await current()
    const res = await POST(req({ form: { ...older, voteTime: '21:00' } }), params)
    expect(res.status).toBe(200)
    expect((await res.json()).changed).toEqual(['voteTime'])
    expect(m.tx.league.update.mock.calls[0][0].data.settings.survivorIslandScene).toBe('volcano')
  })
})

describe('inline rule edits keep the settings screen locks', () => {
  it('refuses the idol count once the draft started but saves the vote deadline', async () => {
    m.draftStarted = true
    const before = await current()
    const locked = await POST(req({ form: { ...before, idolCount: 8 } }), params)
    expect(locked.status).toBe(409)
    expect((await locked.json()).locked).toEqual(['idolCount'])
    const ok = await POST(req({ form: { ...before, voteDay: 'Thursday' } }), params)
    expect(ok.status).toBe(200)
    expect(m.tx.league.update.mock.calls[0][0].data.settings).toMatchObject({ tribalCouncilDay: 'Thursday' })
  })
})
