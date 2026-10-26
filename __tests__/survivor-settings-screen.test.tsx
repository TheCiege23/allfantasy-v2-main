/**
 * survivor-core §2 SurvivorSettings: one commissioner screen, one save, one audit entry. Locks at
 * draft start except the vote deadline, the Exile boss and the sharing switches; the preview
 * validates (swap before merge); existing leagues keep Chimmy's boss.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  buildSeasonPreview,
  changedSettingsKeys,
  lockedChanges,
  parseSettingsForm,
  validateSettingsForm,
  type SurvivorSettingsForm,
} from '@/lib/survivor/survivorSettingsScreen'

const m = vi.hoisted(() => ({
  session: { user: { id: 'commish' } } as { user?: { id?: string } } | null,
  access: { isLeagueMember: true, decisions: { canUpdateSettings: true } } as Record<string, unknown> | null,
  draftStarted: false,
  idolSave: vi.fn(),
  idolView: vi.fn(),
  upsertConfig: vi.fn(),
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
import { SurvivorSettingsScreen } from '@/components/survivor/SurvivorSettingsScreen'

const ctx = { managers: 12, firstWeek: 1, lastWeek: 13 }
function form(over: Partial<SurvivorSettingsForm> = {}): SurvivorSettingsForm {
  return {
    tribeCount: 2, tribeFormation: 'random', voteDay: 'Tuesday', voteTime: '20:00', selfVotesAllowed: false, tieRule: 'revote_then_season_points',
    idolCount: 7, hideIdolsFromCommissioner: false, exileEnabled: true, exileReturnTokens: 3, exileBossMode: 'median', exileBossFixedScore: null, exileBossTopN: 3,
    swapEnabled: true, swapWeek: 5, mergeTrigger: 'week', mergeWeek: 8, mergeActivePlayerCount: 7, finalistCount: 3, shareCardsEnabled: true, publicMomentPages: true, spectatorPageEnabled: false,
    ...over,
  }
}

const storedSettings = (over: Record<string, unknown> = {}) => ({
  defaultTeamCount: 12, minTeamCount: 12, maxTeamCount: 12, tribeCount: 2, tribeAssignmentMode: 'random', mergeTriggerType: 'week', mergeWeek: 8,
  exileIslandEnabled: true, exileReturnTokens: 3, exileBossMode: 'chimmy_roster', finalistCount: 3, ...over,
})

function req(body: unknown) {
  return new Request('http://test/api', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }) as never
}
const params = { params: Promise.resolve({ leagueId: 'L1' }) }

beforeEach(() => {
  m.session = { user: { id: 'commish' } }
  m.access = { isLeagueMember: true, decisions: { canUpdateSettings: true } }
  m.draftStarted = false
  m.idolSave.mockReset().mockResolvedValue({ ok: true, config: {} })
  m.idolView.mockReset().mockResolvedValue({ config: { mode: 'random', count: 7, hideFromCommish: true, pickedTypeIds: [], pointSurgePct: 10, tributePct: 5 }, saved: true })
  m.upsertConfig.mockReset()
  m.tx.league.findUnique.mockReset().mockImplementation(async () => ({ settings: storedSettings() }))
  m.tx.league.update.mockReset()
  m.tx.survivorCommissionerAction.create.mockReset()
  m.db.league.findUnique.mockReset().mockImplementation(async () => ({ name: 'Blah Survivor', sport: 'NBA', settings: storedSettings(), survivorSwapWeek: 5, survivorFinal3: true }))
  m.db.survivorTribeMember.count.mockReset().mockResolvedValue(0)
  m.db.$transaction.mockReset().mockImplementation(async (fn: (tx: typeof m.tx) => unknown) => fn(m.tx))
})

describe('settings model', () => {
  it('counts changed keys', () => {
    expect(changedSettingsKeys(form(), form({ voteDay: 'Wednesday', idolCount: 8 }))).toEqual(['voteDay', 'idolCount'])
  })

  it('locks everything after the draft except the vote deadline, the boss and sharing', () => {
    const locks = { draftStarted: true, finalistLocked: true, tribesLocked: true }
    expect(lockedChanges(['voteDay', 'voteTime', 'exileBossMode', 'exileBossTopN', 'shareCardsEnabled', 'publicMomentPages', 'spectatorPageEnabled'], locks)).toEqual([])
    expect(lockedChanges(['tribeCount', 'idolCount', 'swapWeek', 'mergeWeek', 'exileReturnTokens'], locks)).toEqual(['tribeCount', 'idolCount', 'swapWeek', 'mergeWeek', 'exileReturnTokens'])
  })

  it('requires the swap before the merge and the merge before the finale', () => {
    expect(validateSettingsForm(form({ swapWeek: 8 }), ctx)).toContain('The swap must come before the merge.')
    expect(validateSettingsForm(form({ swapEnabled: false, swapWeek: 9 }), ctx)).toEqual([])
    expect(validateSettingsForm(form({ mergeWeek: 13 }), ctx)).toContain('The merge must come before the finale.')
  })

  it('previews a 13-week strip with the swap, merge and finale marked', () => {
    const preview = buildSeasonPreview(form(), ctx)
    expect(preview.weeks).toHaveLength(13)
    expect(preview.weeks.find(w => w.week === 5)?.kind).toBe('swap')
    expect(preview.weeks.find(w => w.week === 8)?.kind).toBe('merge')
    expect(preview.weeks.find(w => w.week === 13)?.kind).toBe('finale')
    expect(preview.summary).toContain('Swap in week 5, merge in week 8')
    expect(preview.summary).toContain('Exile Island on: 3 tokens to return, boss score is the league median')
    expect(preview.summary).toContain('2 tribes of 6, formed random')
  })

  it('rejects a partial form', () => {
    expect(parseSettingsForm({ ...form(), tribeCount: undefined })).toBeNull()
    expect(parseSettingsForm(form())).toEqual(form())
  })
})

describe('settings-screen API', () => {
  it('is commissioner only', async () => {
    m.access = { isLeagueMember: true, decisions: { canUpdateSettings: false } }
    expect((await GET(req({}), params)).status).toBe(403)
    expect((await POST(req({ form: form() }), params)).status).toBe(403)
  })

  it('keeps an existing league on Chimmy’s boss and offers it', async () => {
    const data = await (await GET(req({}), params)).json()
    expect(data.form.exileBossMode).toBe('chimmy_roster')
    expect(data.chimmyBossAvailable).toBe(true)
  })

  it('saves several sections with ONE audit entry', async () => {
    const before = (await (await GET(req({}), params)).json()).form as SurvivorSettingsForm
    const res = await POST(req({ form: { ...before, voteDay: 'Wednesday', selfVotesAllowed: true, idolCount: 8, finalistCount: 2, swapWeek: 4 } }), params)
    expect(res.status).toBe(200)
    expect(m.tx.survivorCommissionerAction.create).toHaveBeenCalledTimes(1)
    const audit = m.tx.survivorCommissionerAction.create.mock.calls[0][0].data
    expect(audit.actionType).toBe('survivor_settings_saved')
    expect(Object.keys(audit.newState).sort()).toEqual(['finalistCount', 'idolCount', 'selfVotesAllowed', 'swapWeek', 'voteDay'])
    const update = m.tx.league.update.mock.calls[0][0].data
    expect(update.settings).toMatchObject({ tribalCouncilDay: 'Wednesday', selfVotesAllowed: true, finalistCount: 2 })
    expect(update).toMatchObject({ survivorSwapWeek: 4, survivorFinal3: false })
    // The idol count goes through IdolSetup's own save, keeping its mode and hide flag.
    expect(m.idolSave).toHaveBeenCalledWith('L1', expect.objectContaining({ count: 8, mode: 'random', hideFromCommish: true }), m.tx)
  })

  it('refuses locked changes after the draft but allows the vote deadline and boss', async () => {
    m.draftStarted = true
    const before = (await (await GET(req({}), params)).json()).form as SurvivorSettingsForm
    const locked = await POST(req({ form: { ...before, idolCount: 8 } }), params)
    expect(locked.status).toBe(409)
    expect((await locked.json()).locked).toEqual(['idolCount'])
    expect(m.tx.league.update).not.toHaveBeenCalled()
    const ok = await POST(req({ form: { ...before, voteTime: '21:00', exileBossMode: 'median' } }), params)
    expect(ok.status).toBe(200)
    expect(m.tx.league.update.mock.calls[0][0].data.settings).toMatchObject({ tribalCouncilTime: '21:00', exileBossMode: 'median' })
  })

  it('refuses a swap after the merge', async () => {
    const before = (await (await GET(req({}), params)).json()).form as SurvivorSettingsForm
    const res = await POST(req({ form: { ...before, swapWeek: 9 } }), params)
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('The swap must come before the merge.')
    expect(m.tx.survivorCommissionerAction.create).not.toHaveBeenCalled()
  })

  it('does not hand Chimmy’s boss to a league that never had it', async () => {
    m.db.league.findUnique.mockImplementation(async () => ({ name: 'New', settings: storedSettings({ exileBossMode: 'median' }), survivorSwapWeek: null, survivorFinal3: true }))
    const before = (await (await GET(req({}), params)).json()).form as SurvivorSettingsForm
    const res = await POST(req({ form: { ...before, exileBossMode: 'chimmy_roster' } }), params)
    expect(res.status).toBe(422)
  })
})

describe('settings screen UI', () => {
  it('shows the unsaved count and blocks saving an invalid season', async () => {
    const state = { leagueName: 'Blah Survivor', form: form(), context: ctx, locks: { draftStarted: false, finalistLocked: false, tribesLocked: false }, chimmyBossAvailable: false, commissionerPlays: false }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(state), { status: 200 })))
    render(<SurvivorSettingsScreen leagueId="L1" backHref="/league/L1" />)
    await waitFor(() => expect(screen.getByTestId('survivor-settings-screen')).toBeTruthy())
    expect(screen.getByTestId('survivor-settings-unsaved').textContent).toBe('All saved')
    fireEvent.click(screen.getByRole('button', { name: 'Increase swap week' }))
    fireEvent.click(screen.getByRole('button', { name: 'Increase swap week' }))
    fireEvent.click(screen.getByRole('button', { name: 'Increase swap week' }))
    expect(screen.getByTestId('survivor-settings-unsaved').textContent).toBe('1 unsaved change')
    expect(screen.getByTestId('survivor-settings-errors').textContent).toContain('The swap must come before the merge.')
    expect((screen.getByTestId('survivor-settings-save') as HTMLButtonElement).disabled).toBe(true)
    vi.unstubAllGlobals()
  })
})
