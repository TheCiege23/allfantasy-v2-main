// @vitest-environment node
/**
 * A playing commissioner can use the finale controls (rules + windows); every other manual control
 * still needs a non-playing host. A commissioner who is a finalist or juror keeps only that role's
 * view. Finale validation messages follow League.language.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { buildSurvivorAccessContextFromSnapshot, survivorFinaleControlAccess, type SurvivorAccessSnapshot } from '@/lib/survivor/survivorAccessControl'

const h = vi.hoisted(() => ({
  snapshot: null as null | Record<string, unknown>,
  language: 'en' as string,
  db: {
    league: { findUnique: vi.fn(), update: vi.fn() },
    survivorTribalCouncil: { findFirst: vi.fn() },
    jurySession: { findUnique: vi.fn(), upsert: vi.fn() },
    survivorCommissionerAction: { create: vi.fn() },
  },
  commissionerRole: vi.fn(),
  advancePhase: vi.fn(),
  applyStep: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'commish' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerRole: h.commissionerRole, getLeagueRole: vi.fn() }))
vi.mock('@/lib/survivor/survivorAccessControl', async () => {
  const actual = await vi.importActual<typeof import('@/lib/survivor/survivorAccessControl')>('@/lib/survivor/survivorAccessControl')
  return { ...actual, resolveSurvivorAccessContext: vi.fn(async () => (h.snapshot ? actual.buildSurvivorAccessContextFromSnapshot(h.snapshot as unknown as SurvivorAccessSnapshot) : null)) }
})
vi.mock('@/lib/survivor/juryEngine', () => ({ openFinale: vi.fn(), openJuryPhase: vi.fn(), openJuryVoting: vi.fn(), ensureJuryVotingOpen: vi.fn() }))
vi.mock('@/lib/survivor/gameStateMachine', () => ({ advancePhase: h.advancePhase }))
vi.mock('@/lib/survivor/exileEngine', () => ({ processReturnFromExile: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorTribeShuffleEngine', () => ({ runShuffle: vi.fn() }))
vi.mock('@/lib/survivor/survivorTribalOverride', () => ({ overrideTribalResult: vi.fn(), readTribalOverrideTarget: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ getSurvivorConfig: vi.fn() }))
vi.mock('@/lib/survivor/notificationEngine', () => ({ enqueueNotification: vi.fn() }))
vi.mock('@/lib/survivor/survivorCouncilPause', () => ({ setCouncilPaused: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorSitOutEngine', () => ({ maybeTriggerSurvivorTribeShuffleRecommendation: vi.fn() }))
vi.mock('@/lib/survivor/survivorFinalJuryStepService', () => ({ applyFinalJuryStepIfDue: h.applyStep }))

import { GET, POST } from '@/app/api/survivor/commissioner/route'

const post = (body: object) => POST(new NextRequest('https://x.test/api/survivor/commissioner', { method: 'POST', body: JSON.stringify({ leagueId: 'L1', ...body }) }))
const getFinale = () => GET(new NextRequest('https://x.test/api/survivor/commissioner?leagueId=L1&type=finale'))

const commissioner = (player: Record<string, unknown> | null, settings: Record<string, unknown> = {}) => ({
  leagueId: 'L1', userId: 'commish', role: 'commissioner', settings,
  player: player ? { userId: 'commish', ...player } : null,
  roster: player ? { id: 'r-commish' } : null,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.language = 'en'
  h.commissionerRole.mockResolvedValue(undefined)
  h.db.league.findUnique.mockImplementation(async () => ({ settings: { existing: 1 }, language: h.language }))
  h.db.survivorTribalCouncil.findFirst.mockResolvedValue(null)
  h.db.jurySession.findUnique.mockResolvedValue(null)
  h.snapshot = commissioner({ playerState: 'active' })
})

describe('survivorFinaleControlAccess (pure)', () => {
  const ctx = (snap: Record<string, unknown>) => buildSurvivorAccessContextFromSnapshot(snap as unknown as SurvivorAccessSnapshot)
  it('a playing commissioner configures, a host also sees private finale state, a juror/finalist commissioner does not', () => {
    expect(survivorFinaleControlAccess(ctx(commissioner({ playerState: 'active' })))).toEqual({ canConfigure: true, canSeePrivateFinale: false, role: 'playing_commissioner' })
    expect(survivorFinaleControlAccess(ctx(commissioner(null)))).toEqual({ canConfigure: true, canSeePrivateFinale: true, role: 'host' })
    expect(survivorFinaleControlAccess(ctx(commissioner({ playerState: 'eliminated', isJuryMember: true })))).toEqual({ canConfigure: true, canSeePrivateFinale: false, role: 'juror' })
    expect(survivorFinaleControlAccess(ctx(commissioner({ playerState: 'active', isFinalist: true })))).toEqual({ canConfigure: true, canSeePrivateFinale: false, role: 'finalist' })
    expect(survivorFinaleControlAccess(ctx({ leagueId: 'L1', userId: 'u2', role: 'member', player: { userId: 'u2', playerState: 'active' } }))).toEqual({ canConfigure: false, canSeePrivateFinale: false, role: 'none' })
    expect(survivorFinaleControlAccess(null).canConfigure).toBe(false)
  })
})

describe('/api/survivor/commissioner — finale controls for a playing commissioner', () => {
  it('lets a playing commissioner save finale rules and windows', async () => {
    const rules = await post({ action: 'finale_settings', settings: { finalJuryStepEnabled: true, finalJuryStepCount: 1 } })
    expect(rules.status).toBe(200)
    expect(h.db.league.update).toHaveBeenCalledWith({ where: { id: 'L1' }, data: { settings: { existing: 1, finalJuryStepEnabled: true, finalJuryStepCount: 1 } } })
    const windows = await post({ action: 'finale_windows', windows: { speechesDeadline: new Date(Date.now() + 86_400_000).toISOString() } })
    expect(windows.status).toBe(200)
  })

  it('still refuses every other manual control to a playing commissioner (403)', async () => {
    const res = await post({ action: 'force_phase', toPhase: 'merge' })
    expect(res.status).toBe(403)
    expect(h.advancePhase).not.toHaveBeenCalled()
    expect((await post({ action: 'final_jury_step', week: 17 })).status).toBe(403)
    expect(h.applyStep).not.toHaveBeenCalled()
  })

  it('a commissioner on the jury may change the windows but sees only a juror’s view', async () => {
    h.snapshot = commissioner({ playerState: 'eliminated', isJuryMember: true })
    expect((await post({ action: 'finale_windows', windows: { speechesDeadline: new Date(Date.now() + 86_400_000).toISOString() } })).status).toBe(200)
    const res = await getFinale()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.viewer).toEqual({ canConfigure: true, canSeePrivateFinale: false, role: 'juror' })
    // Nothing private rides this payload for anyone: no questions, answers or ballots.
    expect(Object.keys(body).sort()).toEqual(['councilOpen', 'jurySessionStatus', 'juryVoteDeadline', 'settings', 'viewer', 'windows'])
  })

  it('403 for a non-commissioner, 400 for bad input', async () => {
    h.commissionerRole.mockRejectedValueOnce(new Response('Forbidden', { status: 403 }))
    expect((await post({ action: 'finale_settings', settings: { sealedImmunity: true } })).status).toBe(403)
    h.snapshot = { leagueId: 'L1', userId: 'commish', role: 'member', player: { userId: 'commish', playerState: 'active' } }
    expect((await post({ action: 'finale_settings', settings: { sealedImmunity: true } })).status).toBe(403)
    h.snapshot = commissioner({ playerState: 'active' })
    expect((await post({ action: 'finale_settings', settings: { finalJuryStepCount: 5 } })).status).toBe(400)
    expect((await post({ action: 'finale_windows', windows: {} })).status).toBe(400)
  })

  it('words the finale refusals in Spanish for a Spanish league', async () => {
    h.language = 'es'
    const bad = await post({ action: 'finale_settings', settings: { sealedImmunity: 'si' } })
    expect((await bad.json()).error).toBe('sealedImmunity debe ser verdadero o falso.')
    const empty = await post({ action: 'finale_windows', windows: {} })
    expect((await empty.json()).error).toBe('La solicitud no trae plazos de la final.')
    const order = await post({ action: 'finale_windows', windows: { speechesDeadline: new Date(Date.now() + 86_400_000).toISOString(), juryVoteDeadline: new Date(Date.now() + 3_600_000).toISOString() } })
    expect((await order.json()).error).toBe('La votación del jurado debe cerrar después de los discursos finales.')
  })

  it('locks the final jury step once the finale has started (409)', async () => {
    h.db.jurySession.findUnique.mockResolvedValue({ status: 'questions_open' })
    const res = await post({ action: 'finale_settings', settings: { finalJuryStepEnabled: true } })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('finale_started')
    expect(h.db.league.update).not.toHaveBeenCalled()
  })

  it('a non-playing host can apply the final jury step on demand', async () => {
    h.snapshot = commissioner(null)
    h.applyStep.mockResolvedValueOnce('applied')
    const res = await post({ action: 'final_jury_step', week: 17 })
    expect(res.status).toBe(200)
    expect(h.applyStep).toHaveBeenCalledWith('L1', 17, { actorUserId: 'commish' })
    expect((await post({ action: 'final_jury_step' })).status).toBe(400)
  })
})
